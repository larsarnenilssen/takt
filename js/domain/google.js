'use strict';
/* ---------- innlogging hos Google (felles for Drive-backup og kalender) ----------
   Siden sendes til Google og kommer tilbake med en tilgangsnøkkel i adressen
   (#access_token=…&scope=…). Nøkkelen varer omtrent en time og lagres bare på
   telefonen. Det bes bare om tillatelsene som er slått på:
     drive – en skjult app-mappe i brukerens Drive (backup)
     cal   – kalendere Takt selv har laget (vakter og avtaler)
   Google husker tillatelser som er gitt før (include_granted_scopes), så en ny
   tillatelse kommer i tillegg til de gamle. */
const GOOGLE = {
  AUTH: 'https://accounts.google.com/o/oauth2/v2/auth',
  REVOKE: 'https://oauth2.googleapis.com/revoke',
  SCOPES: { drive: 'https://www.googleapis.com/auth/drive.appdata', cal: 'https://www.googleapis.com/auth/calendar.app.created' },
  MARGIN: 60000,   // nøkkelen regnes som utløpt litt før den faktisk gjør det
};
const google = { cfg: null };   // { token, exp, scopes: [], lastError }
const googleReady = () => !!GOOGLE_CLIENT_ID;
async function loadGoogle() {
  google.cfg = (await store.get('google')) || null;
  // Fra 1.1: nøkkelen lå tidligere i innstillingene for Drive
  const d = await store.get('drive');
  if (!google.cfg && d && d.token) { google.cfg = { token: d.token, exp: d.exp, scopes: [GOOGLE.SCOPES.drive], lastError: '' }; saveGoogle(); }
}
const saveGoogle = () => store.set('google', google.cfg);
/* Gyldig nøkkel som omfatter tillatelsen (drive eller cal) */
const googleHas = which => !!(google.cfg && google.cfg.token && google.cfg.exp - Date.now() > GOOGLE.MARGIN && google.cfg.scopes.includes(GOOGLE.SCOPES[which]));
/* Adressen Google sender tilbake til. Må være registrert på klient-ID-en. */
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

/* Logger inn. next: hva som skal skje etterpå. want: tillatelser som trengs nå, i tillegg til dem som er slått på. */
async function googleLogin(next, want = []) {
  const st = uid() + uid();
  const scopes = new Set(want.map(w => GOOGLE.SCOPES[w]));
  if (driveOn()) scopes.add(GOOGLE.SCOPES.drive);
  if (calOn()) scopes.add(GOOGLE.SCOPES.cal);
  try { localStorage.setItem('takt-oauth', JSON.stringify({ state: st, next })); } catch (e) {}
  // Alt må være lagret før siden forlates
  clearTimeout(saveTimer);
  await Promise.all([store.set('state', state), store.set('drive', drive.cfg), store.set('cal', cal.cfg)]);
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: [...scopes].join(' '), state: st, include_granted_scopes: 'true' });
  location.assign(GOOGLE.AUTH + '?' + q);
}
/* Kalles ved oppstart. Gir handlingen som skal fortsette, eller null. */
function takeLoginReturn() {
  const hash = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(hash)) return null;
  history.replaceState(null, '', redirectUri());
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('takt-oauth')); localStorage.removeItem('takt-oauth'); } catch (e) {}
  const p = new URLSearchParams(hash);
  if (!saved || p.get('state') !== saved.state) return null;
  google.cfg = google.cfg || { token: '', exp: 0, scopes: [], lastError: '' };
  if (p.get('error') || !p.get('access_token')) { google.cfg.lastError = T.google.loginFailed; saveGoogle(); return null; }
  Object.assign(google.cfg, { token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000, scopes: (p.get('scope') || '').split(' ').filter(Boolean), lastError: '' });
  saveGoogle();
  return saved.next;
}
/* Kall mot Googles API. 401: nøkkelen er utløpt eller trukket tilbake. */
async function gfetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + google.cfg.token } });
  if (r.status === 401) { google.cfg.token = ''; saveGoogle(); throw new UserError(T.google.loginAgain); }
  if (!r.ok) {
    const e = new UserError(T.google.failed(r.status));
    e.status = r.status;
    try { const j = await r.json(); e.reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || ''; } catch (x) { e.reason = ''; }
    throw e;
  }
  return r;
}
/* Når verken backup eller kalender er i bruk, gis nøkkelen tilbake */
function googleRelease() {
  if (driveOn() || calOn() || !google.cfg) return;
  if (google.cfg.token) fetch(GOOGLE.REVOKE + '?token=' + encodeURIComponent(google.cfg.token), { method: 'POST' }).catch(() => {});
  google.cfg = null;
  saveGoogle();
}
