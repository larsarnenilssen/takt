'use strict';
/* ---------- turnus: vaktkoder, vakter og endringer for hånd ----------
   En vaktkode har navn, type (work = vakt, night = natt, off = fri) og tider.
   shifts er turnusen slik den ble importert. En dag kan i tillegg ha en annen
   kode satt for hånd (overrides, '' = ingen vakt) eller egne tider (custom).
   Endringene for hånd ligger ved siden av turnusen, så dagen kan settes
   tilbake, og de beholdes når en ny turnus importeres (om brukeren vil). */

/* Koden en dag etter endringer for hånd */
function codeOn(date) {
  const R = state.rota;
  return date in R.overrides ? R.overrides[date] : (R.shifts[date] || '');
}
const isManual = date => date in state.rota.overrides || date in state.rota.custom;
/* Vakten en dag: { code, label, kind, start, end, tone, custom, manual } eller null */
function shiftFor(date) {
  const R = state.rota, code = codeOn(date), cu = R.custom[date];
  if (cu) return { code, label: cu.label || T.rota.customLabel, kind: 'work', start: cu.start, end: cu.end, tone: toneOf('work', cu.start), custom: true, manual: true };
  if (!code) return null;
  const def = R.codes[code] || { label: '', kind: 'work', start: '', end: '' };
  return { code, label: def.label, kind: def.kind, start: def.start, end: def.end, tone: toneOf(def.kind, def.start), custom: false, manual: isManual(date) };
}
/* Turnusen med endringene for hånd, slik Døgn skal se den */
function effectiveShifts() {
  const out = {};
  for (const d of new Set([...Object.keys(state.rota.shifts), ...Object.keys(state.rota.overrides)])) { const c = codeOn(d); if (c) out[d] = c; }
  return out;
}
/* Fargen for en vakt: dag, kveld, natt, fri eller annet (uten tider) */
function toneOf(kind, start) {
  if (kind === 'off') return 'off';
  if (!start) return 'other';
  const m = toMin(start);
  if (kind === 'night' || m >= 18 * 60) return 'night';
  return m >= 11 * 60 ? 'eve' : 'day';
}
const isWorkShift = sh => !!(sh && sh.kind !== 'off' && sh.start && sh.end);
/* Start og slutt som Date. Slutter vakten før den starter, slutter den neste dag. */
function shiftSpan(date, sh) {
  const s = toMin(sh.start), e = toMin(sh.end);
  return { start: at(date, s), end: at(date, e <= s ? e + 1440 : e) };
}
/* Kort tekst: «D · 07:00–15:00», «F1 · fri» */
function shiftText(sh) {
  if (!sh) return T.rota.none;
  const head = sh.code || sh.label;
  if (sh.kind === 'off') return head + ' · ' + T.rota.off;
  return head + (sh.start && sh.end ? ' · ' + sh.start + '–' + sh.end : '');
}
const codeList = () => Object.keys(state.rota.codes).sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }));
const codeUses = code => Object.values(effectiveShifts()).filter(c => c === code).length;

/* ---------- endringer én dag ---------- */
function setDayCode(date, code) {
  const R = state.rota;
  delete R.custom[date];
  if (code === (R.shifts[date] || '')) delete R.overrides[date]; else R.overrides[date] = code;
}
function setDayCustom(date, start, end, label) {
  if (!isTime(start) || !isTime(end)) throw new UserError(T.rota.needTimes);
  state.rota.custom[date] = { start, end, label: str(label, 60) };
}
/* Tilbake til turnusen slik den ble importert */
function resetDay(date) { delete state.rota.custom[date]; delete state.rota.overrides[date]; }

/* ---------- vaktkoder ---------- */
function saveCode(code, def, oldCode) {
  code = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new UserError(T.rota.badCode);
  const R = state.rota;
  if (oldCode && oldCode !== code) {
    if (R.codes[code]) throw new UserError(T.rota.codeExists(code));
    delete R.codes[oldCode];
    for (const m of [R.shifts, R.overrides]) for (const d of Object.keys(m)) if (m[d] === oldCode) m[d] = code;
  } else if (!oldCode && R.codes[code]) throw new UserError(T.rota.codeExists(code));
  if (def.kind !== 'off' && (!isTime(def.start) || !isTime(def.end))) throw new UserError(T.rota.needTimes);
  R.codes[code] = cleanCode(def);
  return code;
}
function deleteCode(code) {
  const R = state.rota;
  delete R.codes[code];
  for (const m of [R.shifts, R.overrides]) for (const d of Object.keys(m)) if (m[d] === code) delete m[d];
}

/* ---------- import ----------
   entries: { dato: kode }. Turnusen fra og med from til og med to erstattes.
   Endringer for hånd i perioden beholdes når keepManual er satt, ellers fjernes de. */
function applyRota(entries, newCodes, { from, to, keepManual }) {
  const R = state.rota;
  for (const [c, def] of Object.entries(newCodes || {})) R.codes[c] = cleanCode(def);
  const inRange = d => d >= from && d <= to;
  for (const d of Object.keys(R.shifts)) if (inRange(d)) delete R.shifts[d];
  if (!keepManual) for (const m of [R.overrides, R.custom]) for (const d of Object.keys(m)) if (inRange(d)) delete m[d];
  let n = 0;
  for (const [d, c] of Object.entries(entries)) if (inRange(d) && c) { R.shifts[d] = c; n++; }
  R.source = { from, to, importedAt: new Date().toISOString() };
  return n;
}
/* Turnusfil (JSON fra Takt eller Døgn), eller tekst med én dag per linje: «2026-10-01 D» / «01.10.2026 D» */
function parseRotaText(text) {
  const t = String(text).trim();
  if (t.startsWith('{')) {
    let o;
    try { o = JSON.parse(t); } catch (e) { throw new UserError(T.rota.notRota); }
    const shifts = {}, codes = {};
    for (const [d, c] of Object.entries(obj(o.shifts))) if (isDate(d) && isCode(c)) shifts[d] = c;
    for (const [c, def] of Object.entries(obj(o.codes))) if (isCode(c)) codes[c] = cleanCode(def);
    if (!Object.keys(shifts).length) throw new UserError(T.rota.noLines);
    return { codes, shifts };
  }
  const shifts = {};
  t.split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\s+(\S+)/);
    if (!m) return;
    let d = m[1];
    if (d.includes('.')) { const [dd, mm, yy] = d.split('.'); d = yy + '-' + pad(mm) + '-' + pad(dd); }
    const c = m[2].toUpperCase();
    if (isDate(d) && isCode(c)) shifts[d] = c;
  });
  if (!Object.keys(shifts).length) throw new UserError(T.rota.noLines);
  return { codes: {}, shifts };
}
/* Turnusfil som kan deles med kolleger eller leses av Døgn */
const rotaFile = () => ({ format: 'takt-turnus', v: 1, codes: state.rota.codes, shifts: effectiveShifts() });
