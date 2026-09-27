'use strict';
/* ---------- turnus fra en kalenderfil (.ics), for eksempel eksportert fra MinGat ----------
   Hver vakt er en hendelse med start, slutt og en tittel der vaktkoden står
   (for eksempel «D1 07:30–15:00»). Takt finner koden i tittelen, og tidene
   som er vanligst for koden, blir kodens tider. Dager der vakten har andre
   tider, får egne tider. Alt vises i kontrollen før noe lagres. */

/* Linjer med fortsettelse (starter med mellomrom eller tab) slås sammen, og tekst avkodes */
function icsLines(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter(Boolean);
}
const icsUnescape = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
/* Tid fra DTSTART/DTEND: { date, time } i lokal tid. UTC (Z) regnes om; med TZID eller uten sone er tiden lokal. */
function icsTime(params, value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, z] = m;
  if (hh == null || /VALUE=DATE(?!-)/.test(params)) return { date: y + '-' + mo + '-' + d, time: '' };
  if (z) { const t = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi)); return { date: iso(t), time: pad(t.getHours()) + ':' + pad(t.getMinutes()) }; }
  return { date: y + '-' + mo + '-' + d, time: hh + ':' + mi };
}
/* Hendelsene i filen: [{ date, start, end, summary }] (start/end er '' for heldagshendelser) */
function parseIcs(text) {
  const out = [];
  let ev = null;
  for (const line of icsLines(text)) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev && ev.start && !/CANCELLED/i.test(ev.status || '')) out.push({ date: ev.start.date, start: ev.start.time, end: ev.end ? ev.end.time : '', summary: ev.summary || '' });
      ev = null;
      continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';'), value = line.slice(i + 1);
    const key = name.toUpperCase();
    if (key === 'DTSTART') ev.start = icsTime(params.join(';'), value);
    else if (key === 'DTEND') ev.end = icsTime(params.join(';'), value);
    else if (key === 'SUMMARY') ev.summary = icsUnescape(value);
    else if (key === 'STATUS') ev.status = value;
  }
  return out;
}
/* Vaktkoden i en tittel: første ord med minst én bokstav som er en gyldig kode. Resten er navnet. */
function icsCode(summary) {
  const words = summary.split(/[\s,:;/()]+/).filter(Boolean);
  const code = words.find(w => /[A-Za-zÆØÅæøå]/.test(w) && CODE_RE.test(w)) || '';
  const label = summary.replace(code, '').replace(/\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}/g, '').replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '');
  return { code: code.toUpperCase(), label: str(label, 60) };
}
/* Fra hendelsene til et forslag for kontrollen: { entries, codes, custom, from, to } */
function icsProposal(events) {
  const byDay = {};
  for (const e of events) {
    const { code, label } = icsCode(e.summary);
    if (!code || !isDate(e.date)) continue;
    const cur = byDay[e.date];
    // Flere hendelser samme dag: den som starter først, gjelder
    if (!cur || (e.start && (!cur.start || e.start < cur.start))) byDay[e.date] = { code, label, start: e.start, end: e.end };
  }
  const dates = Object.keys(byDay).sort();
  if (!dates.length) throw new UserError(T.rota.icsEmpty);
  // Tidene som er vanligst for hver kode, blir kodens tider
  const seen = {};
  for (const x of Object.values(byDay)) {
    const k = x.start + '-' + x.end, s = (seen[x.code] ??= { times: {}, label: x.label });
    s.times[k] = (s.times[k] || 0) + 1;
  }
  const known = state.rota.codes, codes = {}, main = {};
  for (const [c, s] of Object.entries(seen)) {
    const [start, end] = Object.entries(s.times).sort((a, b) => b[1] - a[1])[0][0].split('-');
    main[c] = known[c] ? known[c].start + '-' + known[c].end : start + '-' + end;
    if (!known[c]) codes[c] = isTime(start) && isTime(end)
      ? { label: s.label, kind: toMin(end) <= toMin(start) ? 'night' : 'work', start, end }
      : { label: s.label, kind: 'off', start: '', end: '' };
  }
  const entries = {}, custom = {};
  for (const d of dates) {
    const x = byDay[d];
    entries[d] = x.code;
    const def = known[x.code] || codes[x.code];
    if (def.kind !== 'off' && isTime(x.start) && isTime(x.end) && x.start + '-' + x.end !== main[x.code]) custom[d] = { start: x.start, end: x.end, label: x.label || x.code };
  }
  return { entries, codes, custom, from: dates[0], to: dates[dates.length - 1] };
}
