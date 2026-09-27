'use strict';
/* ---------- backup til Google Drive (valgfritt, anbefalt for de fleste) ----------
   Backupen lagres i en skjult app-mappe i brukerens egen Google Drive
   (appDataFolder). Takt ser bare denne mappen, ikke resten av Drive, og
   dataene går rett mellom telefonen og brukerens konto.

   Backupen krypteres på telefonen (AES-GCM, nøkkel fra en kode brukeren
   velger, PBKDF2). Uten koden kan den ikke leses, heller ikke av Google.
   Koden lagres på telefonen, slik at backupen kan tas automatisk, og må
   skrives inn på nytt på en ny telefon.

   Innlogging: siden sendes til Google og kommer tilbake med en tilgangsnøkkel
   i adressen (#access_token=…). Nøkkelen varer omtrent en time og lagres bare
   på telefonen. Backup tas høyst én gang i timen mens nøkkelen gjelder, og når
   appen lukkes. Har nøkkelen gått ut og det er endringer som venter, ber siden
   om et trykk for å logge inn igjen. */
const GD = {
  AUTH: 'https://accounts.google.com/o/oauth2/v2/auth',
  API: 'https://www.googleapis.com/drive/v3/files',
  UPLOAD: 'https://www.googleapis.com/upload/drive/v3/files',
  REVOKE: 'https://oauth2.googleapis.com/revoke',
  SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
  FILE: 'takt-backup.json',
  EVERY: 60 * 60 * 1000,        // backup høyst så ofte
  REMIND: 3 * 864e5,            // påminnelse når ventende endringer er eldre enn dette
  ITER: 310000,                 // PBKDF2-runder
  MIN_CODE: 6,
};
const drive = { cfg: null, busy: false, timer: null, key: null };
const driveReady = () => !!GOOGLE_CLIENT_ID;
const driveOn = () => driveReady() && !!(drive.cfg && drive.cfg.on);
const tokenOk = () => driveOn() && !!drive.cfg.token && drive.cfg.exp - Date.now() > 60000;
async function loadDrive() { drive.cfg = (await store.get('drive')) || null; }
const saveDrive = () => store.set('drive', drive.cfg);
/* Adressen Google sender tilbake til. Må være registrert på klient-ID-en. */
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

/* ---------- innlogging ---------- */
async function driveLogin(next) {
  const st = uid() + uid();
  try { localStorage.setItem('takt-oauth', JSON.stringify({ state: st, next })); } catch (e) {}
  // Alt må være lagret før siden forlates
  clearTimeout(saveTimer);
  await Promise.all([saveDrive(), store.set('state', state)]);
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: GD.SCOPE, state: st, include_granted_scopes: 'true' });
  location.assign(GD.AUTH + '?' + q);
}
/* Kalles ved oppstart. Gir handlingen som skal fortsette ('connect', 'backup', 'restore') eller null. */
function takeLoginReturn() {
  const hash = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(hash)) return null;
  history.replaceState(null, '', redirectUri());
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('takt-oauth')); localStorage.removeItem('takt-oauth'); } catch (e) {}
  const p = new URLSearchParams(hash);
  if (!saved || p.get('state') !== saved.state || !drive.cfg) return null;
  if (p.get('error') || !p.get('access_token')) { drive.cfg.lastError = T.drive.loginFailed; saveDrive(); return null; }
  Object.assign(drive.cfg, { token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000, lastError: '' });
  saveDrive();
  return saved.next;
}

/* ---------- kryptering ---------- */
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(code, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(data) {
  const c = drive.cfg, salt = unb64(c.salt);
  if (!drive.key) drive.key = await deriveKey(c.code, salt, GD.ITER);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, drive.key, new TextEncoder().encode(JSON.stringify(data))));
  return { format: 'takt-kryptert', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: GD.ITER, salt: c.salt }, iv: b64(iv), data: b64(ct), saved: new Date().toISOString() };
}
async function unseal(file, code) {
  if (!file || file.format !== 'takt-kryptert' || !file.kdf || typeof file.data !== 'string') throw new UserError(T.drive.notBackup);
  try {
    const key = await deriveKey(code, unb64(file.kdf.salt), Math.min(2e6, Number(file.kdf.iter) || GD.ITER));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) { throw new UserError(T.drive.wrongCode); }
}

/* ---------- Drive ---------- */
async function gapi(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + drive.cfg.token } });
  if (r.status === 401) { drive.cfg.token = ''; saveDrive(); throw new UserError(T.drive.loginAgain); }
  if (!r.ok) { const e = new UserError(T.drive.failed(r.status)); e.status = r.status; throw e; }
  return r;
}
async function findBackup() {
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: "name = '" + GD.FILE + "' and trashed = false", fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '1' });
  const j = await (await gapi(GD.API + '?' + q)).json();
  return (j.files && j.files[0]) || null;
}
async function uploadBackup(text) {
  const c = drive.cfg;
  if (!c.fileId) { const f = await findBackup(); if (f) c.fileId = f.id; }
  if (c.fileId) {
    try { await gapi(GD.UPLOAD + '/' + encodeURIComponent(c.fileId) + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }); return; }
    catch (e) { if (e.status !== 404) throw e; c.fileId = ''; }
  }
  const bd = 'takt' + uid();
  const body = '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: GD.FILE, parents: ['appDataFolder'] }) +
    '\r\n--' + bd + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + bd + '--';
  const r = await gapi(GD.UPLOAD + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bd }, body });
  c.fileId = (await r.json()).id;
}
async function downloadBackup() {
  const f = await findBackup();
  if (!f) return null;
  drive.cfg.fileId = f.id;
  return { file: await (await gapi(GD.API + '/' + encodeURIComponent(f.id) + '?alt=media')).json(), modified: f.modifiedTime };
}

/* ---------- backup ---------- */
async function driveBackup() {
  // pending: tilkoblingen er ikke avklart ennå (finnes det en backup som skal hentes?). Da lagres ingenting.
  if (!tokenOk() || drive.busy || drive.cfg.pending) return false;
  drive.busy = true;
  let ok = false;
  try {
    await uploadBackup(JSON.stringify(await seal(state)));
    Object.assign(drive.cfg, { lastBackup: new Date().toISOString(), dirty: false, lastError: '' });
    ok = true;
  } catch (e) { drive.cfg.lastError = e instanceof UserError ? e.message : T.drive.noContact; }
  finally { drive.busy = false; saveDrive(); scheduleDrive(); render(); if (sheetOpen() && reopen === openDriveSheet) openDriveSheet(); }
  return ok;
}
function scheduleDrive() {
  clearTimeout(drive.timer);
  if (!tokenOk() || !drive.cfg.dirty || drive.cfg.pending) return;
  drive.timer = setTimeout(driveBackup, Math.max(10000, Date.parse(drive.cfg.lastBackup || 0) + GD.EVERY - Date.now()));
}
/* Kalles ved hver lagring */
function driveDirty() {
  if (!driveOn()) return;
  if (!drive.cfg.dirty) { drive.cfg.dirty = true; saveDrive(); }
  scheduleDrive();
}
/* Endringer har ventet lenge uten at det er tatt backup (innloggingen har gått ut) */
const driveNeedsLogin = () => driveOn() && drive.cfg.dirty && !tokenOk() && Date.now() - Date.parse(drive.cfg.lastBackup || drive.cfg.since || 0) > GD.REMIND;

/* Slår på backup: koden lagres, og brukeren sendes til Google for å logge inn */
function driveConnect(code) {
  code = String(code || '');
  if (code.length < GD.MIN_CODE) throw new UserError(T.drive.codeShort(GD.MIN_CODE));
  drive.cfg = { on: true, code, salt: b64(crypto.getRandomValues(new Uint8Array(16))), token: '', exp: 0, fileId: '', lastBackup: '', lastError: '', dirty: true, pending: true, since: new Date().toISOString() };
  drive.key = null;
  saveDrive();
  driveLogin('connect');
}
function driveDisconnect() {
  const t = drive.cfg && drive.cfg.token;
  if (t) fetch(GD.REVOKE + '?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
  clearTimeout(drive.timer);
  drive.cfg = null; drive.key = null;
  saveDrive();
}
/* Bruk det som er i appen og lagre over backupen i Drive */
async function driveKeepLocal() {
  drive.cfg.pending = false;
  drive.cfg.dirty = true;
  await driveBackup();
  openDriveSheet();
}
/* Ny kode (for eksempel når den som ble skrevet, ikke passet til backupen) */
function driveSetCode(code) {
  if (String(code || '').length < GD.MIN_CODE) throw new UserError(T.drive.codeShort(GD.MIN_CODE));
  drive.cfg.code = String(code);
  drive.key = null;
  drive.cfg.lastError = '';
  saveDrive();
}
/* Appen er tom (ny telefon): en backup kan hentes inn uten å spørre */
const appIsEmpty = () => !Object.keys(state.rota.codes).length && !state.items.length && !state.places.length;

/* Etter innlogging ved tilkobling: finnes det en backup, hentes den inn når appen er tom,
   ellers spør vi. Finnes det ingen, tas den første backupen nå. */
async function driveAfterConnect() {
  let found = null;
  try { found = await downloadBackup(); } catch (e) { drive.cfg.lastError = e.message; saveDrive(); openDriveSheet(); return; }
  if (!found) { drive.cfg.pending = false; await driveBackup(); openDriveSheet(); return; }
  if (appIsEmpty()) { await driveRestoreFrom(found); return; }
  openDriveChoiceSheet(found);
}
async function driveRestoreFrom(found) {
  let data;
  try { data = migrate(await unseal(found.file, drive.cfg.code)); }
  catch (e) { drive.cfg.lastError = e.message; saveDrive(); openDriveSheet(); return; }
  commit(T.drive.restored, () => { state = data; state.meta.setupDone = true; });
  Object.assign(drive.cfg, { dirty: false, pending: false, lastBackup: found.modified || '', lastError: '' });
  saveDrive();
  applyTheme();
  if (!placeByRole('home') || !placeByRole('work')) openSetupSheet(2); else closeSheet();
}
