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
  PARALLEL: 2,       // kall mot Google samtidig (Google tåler ikke mange raske på rad)
  APPT_MIN: 60,      // avtaler uten sluttid varer så lenge
};
const cal = { cfg: null, busy: false, timer: null, progress: '' };   // cfg: { on, calId, synced: { id: hash }, lastSync, lastError, dirty, result }
const calOn = () => googleReady() && !!(cal.cfg && cal.cfg.on);
const calTokenOk = () => calOn() && googleHas('cal');
async function loadCal() { cal.cfg = (await store.get('cal')) || null; }
const saveCal = () => store.set('cal', cal.cfg);

/* ---------- hva kalenderen skal inneholde ---------- */
const hexId = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
const localDT = d => iso(d) + 'T' + hm(d) + ':00';
/* { events: { id: hendelse }, dates: { id: dato }, shifts, appts } for vakter og avtaler i perioden */
function calendarEvents() {
  const events = {}, dates = {}, today = todayISO(), from = addDays(today, -CAL.BACK), to = addDays(today, CAL.AHEAD);
  const R = state.rota;
  const days = new Set([...Object.keys(R.shifts), ...Object.keys(R.overrides), ...Object.keys(R.custom)].filter(d => d >= from && d <= to));
  let shifts = 0, appts = 0;
  for (const d of days) {
    const sh = shiftFor(d);
    if (!isWorkShift(sh)) continue;
    const span = shiftSpan(d, sh), id = 'tks' + d.replace(/-/g, '');
    events[id] = {
      summary: sh.code && !sh.custom ? sh.code + (sh.label ? ' · ' + sh.label : '') : sh.label,
      start: { dateTime: localDT(span.start), timeZone: CAL.TZ }, end: { dateTime: localDT(span.end), timeZone: CAL.TZ },
      description: T.calendar.fromTakt, status: 'confirmed',
    };
    dates[id] = d; shifts++;
  }
  for (const x of state.items) {
    if (x.kind !== 'appt' || !x.date || !x.cal || x.date < from || x.date > to) continue;
    const ev = { summary: x.title, description: x.note, status: 'confirmed' };
    if (x.time) {
      const s = at(x.date, toMin(x.time));
      const e = x.end && toMin(x.end) > toMin(x.time) ? at(x.date, toMin(x.end)) : new Date(+s + CAL.APPT_MIN * 60000);
      ev.start = { dateTime: localDT(s), timeZone: CAL.TZ }; ev.end = { dateTime: localDT(e), timeZone: CAL.TZ };
    } else { ev.start = { date: x.date }; ev.end = { date: addDays(x.date, 1) }; }
    const id = 'tka' + hexId(x.id);
    events[id] = ev; dates[id] = x.date; appts++;
  }
  return { events, dates, shifts, appts, from };
}

/* ---------- Google-kalenderen ---------- */
const calUrl = path => CAL.API + '/calendars/' + encodeURIComponent(cal.cfg.calId) + path;
const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/* Google begrenser hvor fort hendelser kan lages, og svarer da 403 eller 429.
   Da ventes det litt lenger for hvert forsøk før det prøves igjen. Det samme ved feil hos Google (5xx). */
const RETRY_MS = [1000, 2000, 4000, 8000, 16000, 32000];
const retryable = e => e.status === 429 || e.status >= 500 || (e.status === 403 && /limit|quota/i.test(e.reason || ''));
async function call(url, opts) {
  for (let i = 0; ; i++) {
    try { return await gfetch(url, opts); }
    catch (e) {
      if (!retryable(e) || i >= RETRY_MS.length) throw e;
      await new Promise(r => setTimeout(r, RETRY_MS[i] + Math.random() * 500));
    }
  }
}
async function ensureCalendar() {
  if (cal.cfg.calId) return;
  const r = await call(CAL.API + '/calendars', jsonBody('POST', { summary: T.calendar.name, timeZone: CAL.TZ }));
  cal.cfg.calId = (await r.json()).id;
  cal.cfg.synced = {};
  saveCal();
}
/* Ny hendelse (409: finnes fra før, for eksempel slettet i kalenderen) eller endret hendelse (404: borte) */
async function addEvent(id, ev) {
  try { await call(calUrl('/events'), jsonBody('POST', { ...ev, id })); }
  catch (e) { if (e.status !== 409) throw e; await call(calUrl('/events/' + id), jsonBody('PUT', { ...ev, id })); }
}
async function putEvent(id, ev) {
  try { await call(calUrl('/events/' + id), jsonBody('PUT', { ...ev, id })); }
  catch (e) { if (e.status !== 404) throw e; await addEvent(id, ev); }
}
async function deleteEvent(id) {
  try { await call(calUrl('/events/' + id), { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
}
/* Alle hendelser som faktisk ligger i kalenderen i Google: { id: hendelse } */
async function listEvents() {
  const out = {};
  let page = '';
  do {
    const q = new URLSearchParams({ maxResults: '2500', showDeleted: 'false', fields: 'items(id,summary,description,start,end),nextPageToken' });
    if (page) q.set('pageToken', page);
    const j = await (await call(calUrl('/events?' + q))).json();
    for (const e of j.items || []) out[e.id] = e;
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
const sameTime = (a, b) => b.date ? !!a && a.date === b.date : !!(a && a.dateTime) && new Date(a.dateTime).getTime() === new Date(b.dateTime).getTime();
const sameEvent = (g, ev) => g.summary === ev.summary && (g.description || '') === (ev.description || '') && sameTime(g.start, ev.start) && sameTime(g.end, ev.end);
/* Dato for en hendelse Takt har laget (fra ID-en for vakter, ellers fra starttiden) */
const eventDate = (id, g) => /^tks\d{8}$/.test(id) ? id.slice(3, 7) + '-' + id.slice(7, 9) + '-' + id.slice(9) : g && g.start ? (g.start.date || String(g.start.dateTime).slice(0, 10)) : '';

/* Noen få kall om gangen. En hendelse som feiler, hindrer ikke de andre, men utløpt
   innlogging (401) eller en kalender som er borte (404) stopper alt. Funksjonen returnerer
   først når alle kall er ferdige, og feiler da med den første feilen. */
async function inBatches(jobs, report) {
  let i = 0, done = 0, failed = null, stop = false;
  const worker = async () => {
    while (i < jobs.length && !stop) {
      const job = jobs[i++];
      try { await job(); report(++done, jobs.length); }
      catch (e) { failed = failed || e; if (e.status === 401 || e.status === 404 || !e.status) stop = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CAL.PARALLEL, jobs.length) }, worker));
  if (failed) { failed.done = done; failed.total = jobs.length; throw failed; }
  return done;
}

/* Gjør kalenderen lik turnusen.
   Vanlig: bare det som er nytt, endret eller borte siden sist, sendes (ut fra hva Takt husker).
   check: hendelsene i Google leses og sammenlignes én for én, og alt som mangler eller avviker, rettes.
   Hendelser eldre enn perioden blir liggende som historikk. Hendelser brukeren selv har lagt i
   kalenderen, røres ikke. */
async function calSync(check) {
  if (!calTokenOk() || cal.busy) return false;
  cal.busy = true;
  clearTimeout(cal.timer);
  let ok = false;
  const report = (n, of) => { cal.progress = T.calendar.progress(n, of); setProgress(); };
  try {
    await ensureCalendar();   // kan lage kalenderen og nullstille det Takt husker, så had hentes etterpå
    const had = cal.cfg.synced;
    const W = calendarEvents(), hashes = {};
    for (const [id, ev] of Object.entries(W.events)) hashes[id] = JSON.stringify(ev);
    const jobs = [];
    const send = (id, fn) => jobs.push(async () => { await fn(id, W.events[id]); had[id] = hashes[id]; });
    if (check) {
      cal.progress = T.calendar.checking; setProgress();
      const g = await listEvents();
      for (const k of Object.keys(had)) delete had[k];
      for (const id of Object.keys(W.events)) {
        if (!g[id]) send(id, addEvent);
        else if (!sameEvent(g[id], W.events[id])) send(id, putEvent);
        else had[id] = hashes[id];
      }
      for (const [id, ev] of Object.entries(g)) {
        if (!/^tk[sa]/.test(id) || id in W.events || eventDate(id, ev) < W.from) continue;
        jobs.push(async () => { await deleteEvent(id); });
      }
    } else {
      for (const id of Object.keys(W.events)) if (had[id] !== hashes[id]) send(id, id in had ? putEvent : addEvent);
      for (const id of Object.keys(had)) {
        if (id in W.events) continue;
        // Utenfor perioden (eldre vakter): blir liggende i kalenderen, Takt slutter bare å følge den
        if (/^tks/.test(id) && eventDate(id) < W.from) { delete had[id]; continue; }
        jobs.push(async () => { await deleteEvent(id); delete had[id]; });
      }
    }
    const changed = await inBatches(jobs, report);
    Object.assign(cal.cfg, { lastSync: new Date().toISOString(), lastError: '', dirty: false, result: { shifts: W.shifts, appts: W.appts, changed, checked: !!check } });
    ok = true;
  } catch (e) {
    // Kalenderen er slettet i Google: lag den på nytt neste gang
    if (e.status === 404) { cal.cfg.calId = ''; cal.cfg.synced = {}; }
    cal.cfg.lastError = (e instanceof UserError ? e.message : T.calendar.noContact) + (e.total ? ' ' + T.calendar.partial(e.done, e.total) : '');
    cal.cfg.dirty = true;
  } finally {
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
  for (const [id, ev] of Object.entries(calendarEvents().events)) {
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
