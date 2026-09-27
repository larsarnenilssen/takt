'use strict';
/* ---------- vaktene i Google-kalenderen (valgfritt) ----------
   Takt lager en egen kalender («Takt – vakter») i brukerens Google-kalender og
   holder den lik turnusen: én hendelse per vakt, med vaktens lengde. Fridager
   tas ikke med. Avtaler i Takt legges også inn, når de er merket for det.
   Det går bare én vei: Takt skriver til kalenderen, men leser ikke fra den.
   Takt har bare tilgang til kalendere den selv har laget.

   Hver hendelse har en fast ID ut fra dato eller punkt, og Takt husker hva som
   sist ble sendt. Da sendes bare det som er nytt, endret eller borte.

   Uten Google: calendarFile() lager en kalenderfil (.ics) med det samme. */
const CAL = {
  API: 'https://www.googleapis.com/calendar/v3',
  TZ: 'Europe/Oslo',
  BACK: 14,          // dager bakover som holdes oppdatert
  AHEAD: 400,        // dager framover
  DELAY: 5000,       // venter litt etter en endring, så flere endringer går samlet
  PARALLEL: 4,       // kall mot Google samtidig
  APPT_MIN: 60,      // avtaler uten sluttid varer så lenge
};
const cal = { cfg: null, busy: false, timer: null, progress: '' };   // cfg: { on, calId, synced: { id: hash }, lastSync, lastError, dirty }
const calOn = () => googleReady() && !!(cal.cfg && cal.cfg.on);
const calTokenOk = () => calOn() && googleHas('cal');
async function loadCal() { cal.cfg = (await store.get('cal')) || null; }
const saveCal = () => store.set('cal', cal.cfg);

/* ---------- hva kalenderen skal inneholde ---------- */
const hexId = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
const localDT = d => iso(d) + 'T' + hm(d) + ':00';
/* { id: hendelse } for vakter og avtaler i perioden */
function calendarEvents() {
  const out = {}, today = todayISO(), from = addDays(today, -CAL.BACK), to = addDays(today, CAL.AHEAD);
  const R = state.rota;
  const days = new Set([...Object.keys(R.shifts), ...Object.keys(R.overrides), ...Object.keys(R.custom)].filter(d => d >= from && d <= to));
  for (const d of days) {
    const sh = shiftFor(d);
    if (!isWorkShift(sh)) continue;
    const span = shiftSpan(d, sh);
    out['tks' + d.replace(/-/g, '')] = {
      summary: sh.code && !sh.custom ? sh.code + (sh.label ? ' · ' + sh.label : '') : sh.label,
      start: { dateTime: localDT(span.start), timeZone: CAL.TZ }, end: { dateTime: localDT(span.end), timeZone: CAL.TZ },
      description: T.calendar.fromTakt, status: 'confirmed',
    };
  }
  for (const x of state.items) {
    if (x.kind !== 'appt' || !x.date || !x.cal || x.date < from || x.date > to) continue;
    const ev = { summary: x.title, description: x.note, status: 'confirmed' };
    if (x.time) {
      const s = at(x.date, toMin(x.time));
      const e = x.end && toMin(x.end) > toMin(x.time) ? at(x.date, toMin(x.end)) : new Date(+s + CAL.APPT_MIN * 60000);
      ev.start = { dateTime: localDT(s), timeZone: CAL.TZ }; ev.end = { dateTime: localDT(e), timeZone: CAL.TZ };
    } else { ev.start = { date: x.date }; ev.end = { date: addDays(x.date, 1) }; }
    out['tka' + hexId(x.id)] = ev;
  }
  return out;
}

/* ---------- Google-kalenderen ---------- */
const calUrl = path => CAL.API + '/calendars/' + encodeURIComponent(cal.cfg.calId) + path;
const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function ensureCalendar() {
  if (cal.cfg.calId) return;
  const r = await gfetch(CAL.API + '/calendars', jsonBody('POST', { summary: T.calendar.name, timeZone: CAL.TZ }));
  cal.cfg.calId = (await r.json()).id;
  cal.cfg.synced = {};
  saveCal();
}
/* Ny hendelse (409: finnes fra før, for eksempel slettet i kalenderen) eller endret hendelse (404: borte) */
async function addEvent(id, ev) {
  try { await gfetch(calUrl('/events'), jsonBody('POST', { ...ev, id })); }
  catch (e) { if (e.status !== 409) throw e; await gfetch(calUrl('/events/' + id), jsonBody('PUT', { ...ev, id })); }
}
async function putEvent(id, ev) {
  try { await gfetch(calUrl('/events/' + id), jsonBody('PUT', { ...ev, id })); }
  catch (e) { if (e.status !== 404) throw e; await addEvent(id, ev); }
}
async function deleteEvent(id) {
  try { await gfetch(calUrl('/events/' + id), { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
}
/* Noen få kall om gangen */
async function inBatches(jobs, report) {
  let i = 0, done = 0;
  const worker = async () => { while (i < jobs.length) { const job = jobs[i++]; await job(); report(++done, jobs.length); } };
  await Promise.all(Array.from({ length: Math.min(CAL.PARALLEL, jobs.length) }, worker));
}
/* Gjør kalenderen lik turnusen. Bare det som er nytt, endret eller borte, sendes. */
async function calSync() {
  if (!calTokenOk() || cal.busy) return false;
  cal.busy = true;
  clearTimeout(cal.timer);
  let ok = false;
  const report = (n, of) => { cal.progress = T.calendar.progress(n, of); setProgress(); };
  try {
    await ensureCalendar();
    const want = calendarEvents(), had = cal.cfg.synced, hashes = {};
    for (const [id, ev] of Object.entries(want)) hashes[id] = JSON.stringify(ev);
    const jobs = [];
    for (const [id, ev] of Object.entries(want)) {
      if (had[id] === hashes[id]) continue;
      const send = id in had ? putEvent : addEvent;
      jobs.push(async () => { await send(id, ev); had[id] = hashes[id]; });
    }
    for (const id of Object.keys(had)) if (!(id in want)) jobs.push(async () => { await deleteEvent(id); delete had[id]; });
    try { await inBatches(jobs, report); }
    catch (e) {
      // Kalenderen er slettet i Google: lag den på nytt neste gang
      if (e.status === 404) { cal.cfg.calId = ''; cal.cfg.synced = {}; }
      throw e;
    }
    Object.assign(cal.cfg, { lastSync: new Date().toISOString(), lastError: '', dirty: false });
    ok = true;
  } catch (e) { cal.cfg.lastError = e instanceof UserError ? e.message : T.calendar.noContact; }
  finally {
    cal.busy = false; cal.progress = '';
    saveCal();
    render();
    refreshSheet('calendar');
  }
  return ok;
}
/* Kalles ved lagring når turnus eller avtaler er endret */
function calDirty() {
  if (!calOn()) return;
  if (!cal.cfg.dirty) { cal.cfg.dirty = true; saveCal(); }
  clearTimeout(cal.timer);
  if (calTokenOk()) cal.timer = setTimeout(calSync, CAL.DELAY);
}
const calNeedsLogin = () => calOn() && cal.cfg.dirty && !calTokenOk();
function calConnect() {
  cal.cfg = { on: true, calId: '', synced: {}, lastSync: '', lastError: '', dirty: true };
  saveCal();
  if (googleHas('cal')) calSync(); else googleLogin('calendar', ['cal']);
}
/* Slår av. removeCalendar: sletter også kalenderen «Takt – vakter» i Google. */
async function calDisconnect(removeCalendar) {
  if (removeCalendar && calTokenOk() && cal.cfg.calId) { try { await gfetch(calUrl(''), { method: 'DELETE' }); } catch (e) {} }
  clearTimeout(cal.timer);
  cal.cfg = null;
  saveCal();
  googleRelease();
}

/* ---------- kalenderfil (.ics) ---------- */
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/* Lange linjer brettes etter 75 tegn, som formatet krever */
const icsFold = line => line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n ');
function calendarFile() {
  const now = icsUtc(new Date()), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Takt//NO', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + icsText(T.calendar.name)];
  for (const [id, ev] of Object.entries(calendarEvents())) {
    lines.push('BEGIN:VEVENT', 'UID:' + id + '@takt', 'DTSTAMP:' + now);
    if (ev.start.date) lines.push('DTSTART;VALUE=DATE:' + ev.start.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + ev.end.date.replace(/-/g, ''));
    else lines.push('DTSTART:' + icsUtc(new Date(ev.start.dateTime)), 'DTEND:' + icsUtc(new Date(ev.end.dateTime)));
    lines.push('SUMMARY:' + icsText(ev.summary));
    if (ev.description) lines.push('DESCRIPTION:' + icsText(ev.description));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
