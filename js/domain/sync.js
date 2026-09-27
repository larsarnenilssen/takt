'use strict';
/* ---------- backup og deling via et privat GitHub-repo (valgfritt) ----------
   Tre filer i repoet, se docs/deling.md:
     takt-backup.json  – alle dataene i Takt (backup), høyst én gang i timen
     takt-deling.json  – turnus og det som er merket «delt», leses av Døgn
     dogn-deling.json  – dagen hjemme, skrevet av Døgn og lest her
   Hver app skriver bare sine egne filer, så de kan aldri overskrive hverandre.
   Tilgangsnøkkelen lagres bare på telefonen, aldri i dataene som eksporteres. */
const FILES = { backup: 'takt-backup.json', share: 'takt-deling.json', dogn: 'dogn-deling.json' };
const PUSH_INTERVAL = 60 * 60 * 1000;   // backup
const SHARE_DELAY = 20 * 1000;          // deling: venter litt, så flere endringer går samlet
const PULL_INTERVAL = 5 * 60 * 1000;    // henter dagen hjemme så ofte mens appen er åpen
const sync = { cfg: null, timer: null, shareTimer: null, busy: false };
const syncOn = () => !!(sync.cfg && sync.cfg.token && sync.cfg.owner && sync.cfg.repo);
const dognOn = () => syncOn() && sync.cfg.dogn;

async function loadSync() { sync.cfg = (await store.get('sync')) || null; }
function saveSync() { store.set('sync', sync.cfg); }
const fileUrl = path => '/repos/' + encodeURIComponent(sync.cfg.owner) + '/' + encodeURIComponent(sync.cfg.repo) + '/contents/' + encodeURIComponent(path);
async function gh(method, url, body, accept) {
  const headers = { 'Authorization': 'Bearer ' + sync.cfg.token, 'Accept': accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch('https://api.github.com' + url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
}
const ghError = r => new UserError(T.sync.errors[r.status] || T.sync.errCode(r.status));
const netMessage = e => e instanceof UserError ? e.message : e instanceof TypeError ? T.sync.noContact : T.sync.unknown;
function b64enc(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function putFile(path, data) {
  let sha = null;
  const g = await gh('GET', fileUrl(path));
  if (g.ok) sha = (await g.json()).sha;
  else if (g.status !== 404) throw ghError(g);
  const body = { message: T.sync.commitMsg(path), content: b64enc(JSON.stringify(data, null, 1)) };
  if (sha) body.sha = sha;
  const p = await gh('PUT', fileUrl(path), body);
  if (!p.ok) throw ghError(p);
}
async function getFile(path) {
  const r = await gh('GET', fileUrl(path), null, 'application/vnd.github.raw+json');
  if (r.status === 404) return null;
  if (!r.ok) throw ghError(r);
  return JSON.parse(await r.text());
}

/* Det Døgn får: turnusen, fraværet dag for dag og punktene som er merket «delt».
   Fraværet sendes for en uke bakover og tre måneder fram. */
const AWAY_BACK = 7, AWAY_AHEAD = 92;
function awayList() {
  const out = {}, t = todayISO();
  for (let i = -AWAY_BACK; i <= AWAY_AHEAD; i++) {
    const d = addDays(t, i), a = awayFor(d);
    if (!a) continue;
    out[d] = { leave: hm(a.leave), back: hm(a.back), backDay: diffDays(d, iso(a.back)), chosenTo: a.chosen.to, chosenHome: a.chosen.home, basis: a.basis };
  }
  return out;
}
function shareFile() {
  return {
    format: 'takt-deling', v: 1, updated: new Date().toISOString(), name: state.profile.name,
    rota: { codes: state.rota.codes, shifts: effectiveShifts(), custom: state.rota.custom },
    away: awayList(),
    items: state.items.filter(x => x.shared).map(({ id, kind, date, time, title, note, done }) => ({ id, kind, date, time, title, note, done })),
  };
}

/* Én jobb om gangen. Feil lagres og vises under Backup og deling. */
async function runSync(job) {
  if (!syncOn()) return false;
  if (sync.busy) { setTimeout(scheduleSync, 5000); return false; }   // prøver igjen når forrige jobb er ferdig
  sync.busy = true;
  let ok = false;
  try { await job(); sync.cfg.lastError = ''; ok = true; }
  catch (e) { sync.cfg.lastError = netMessage(e); }
  finally {
    sync.busy = false;
    saveSync();
    scheduleSync();
    render();
    if (sheetOpen() && reopen === openSyncSheet) openSyncSheet();
  }
  return ok;
}
const pushBackup = () => runSync(async () => {
  await putFile(FILES.backup, state);
  Object.assign(sync.cfg, { lastPush: new Date().toISOString(), dirty: false });
});
const pushShare = () => runSync(async () => {
  await putFile(FILES.share, shareFile());
  Object.assign(sync.cfg, { lastShare: new Date().toISOString(), shareDirty: false });
});
const pullDogn = () => runSync(async () => {
  const data = await getFile(FILES.dogn);
  if (!data) throw new UserError(T.sync.noDognFile);
  setDognData(data);
  sync.cfg.lastPull = new Date().toISOString();
});
async function pullBackup() {
  const data = await getFile(FILES.backup);
  if (!data) throw new UserError(T.sync.noBackup);
  return migrate(data);
}

function scheduleSync() {
  if (!syncOn()) return;
  const c = sync.cfg;
  clearTimeout(sync.timer); clearTimeout(sync.shareTimer);
  if (c.share && c.shareDirty) sync.shareTimer = setTimeout(pushShare, SHARE_DELAY);
  if (c.backup && c.dirty) sync.timer = setTimeout(pushBackup, Math.max(10000, Date.parse(c.lastPush || 0) + PUSH_INTERVAL - Date.now()));
}
/* Kalles ved hver lagring. shared: endringen gjelder også det Døgn leser. */
function markDirty(shared) {
  if (!syncOn()) return;
  const c = sync.cfg;
  if (c.backup) c.dirty = true;
  if (c.share && shared) c.shareDirty = true;
  saveSync();
  scheduleSync();
}
/* Henter dagen hjemme når det er en stund siden sist */
function maybePullDogn() {
  if (dognOn() && !sync.busy && Date.now() - Date.parse(sync.cfg.lastPull || 0) > PULL_INTERVAL - 5000) pullDogn();
}

async function connectSync(owner, repo, token) {
  sync.cfg = { owner, repo, token, backup: true, share: true, dogn: true, lastPush: '', lastShare: '', lastPull: '', lastError: '', dirty: true, shareDirty: true };
  const r = await gh('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo));
  if (!r.ok) { const e = ghError(r); sync.cfg = null; throw e; }
  const info = await r.json();
  saveSync();
  return { isPublic: info.private === false };
}
function disconnectSync() { clearTimeout(sync.timer); clearTimeout(sync.shareTimer); sync.cfg = null; saveSync(); }
