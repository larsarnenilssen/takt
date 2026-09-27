'use strict';
/* ---------- hjelpefunksjoner: tid, datoer, formatering og trygg HTML ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);   // b − a
const todayISO = () => iso(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const isoWd = s => ((parseISO(s).getDay() + 6) % 7) + 1;                        // 1 = mandag
const weekStart = s => addDays(s, 1 - isoWd(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
/* Et tidspunkt på en dato som Date (lokal tid). min kan være over 24 t (neste dag). */
const at = (date, min) => { const d = parseISO(date); d.setMinutes(min); return d; };
/* Klokkeslett fra en Date eller en ISO-tid med tidssone */
const hm = t => { const d = t instanceof Date ? t : new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

/* Formatering med tekstene fra text.nb.js */
const fmtDateLong = s => { const d = parseISO(s); return cap(T.date.wd[d.getDay()]) + ' ' + d.getDate() + '. ' + T.date.mo[d.getMonth()]; };
const fmtDateShort = s => { const d = parseISO(s); return d.getDate() + '. ' + T.date.moShort[d.getMonth()]; };
const wdShort = n => T.date.wdShort[n - 1];
const isoWeek = s => { const d = parseISO(s); d.setDate(d.getDate() + 4 - (d.getDay() || 7)); return Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7); };
const fmtDur = m => m < 60 ? m + ' ' + T.unit.min : (m % 60 ? Math.floor(m / 60) + ' ' + T.unit.hour + ' ' + (m % 60) + ' ' + T.unit.min : (m / 60) + ' ' + T.unit.hour);
/* Kort: «55 min», «7 t 20», «11 t» */
const fmtDurShort = m => m < 60 ? m + ' ' + T.unit.min : Math.floor(m / 60) + ' ' + T.unit.hour + (m % 60 ? ' ' + pad(m % 60) : '');
/* «i dag 14:05», «i går 22:10» eller «3. okt. 08:00» */
function fmtStamp(isoStr) {
  const d = new Date(isoStr), day = iso(d), t = todayISO();
  const when = day === t ? T.date.today : day === addDays(t, -1) ? T.date.yesterday : fmtDateShort(day);
  return when + ' ' + hm(d);
}
/* Relativ dag: «i dag», «i morgen», «i går» eller null */
const relDay = s => { const n = diffDays(todayISO(), s); return n === 0 ? T.date.today : n === 1 ? T.date.tomorrow : n === -1 ? T.date.yesterday : null; };

/* ---------- gyldige verdier (brukes ved import og lagring) ---------- */
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(parseISO(v)) === v;
const isCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const str = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const num = (v, d, min, max) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };

/* Feil som skal vises til brukeren som de er */
class UserError extends Error {}

/* ---------- trygg HTML ----------
   All HTML bygges med h`…`. Verdier som settes inn, escapes automatisk.
   Ferdig HTML (fra h`` eller raw()) settes inn uendret, og lister slås sammen.
   Linjeskift med innrykk i selve malen fjernes, slik at lange maler kan brytes
   over flere linjer (men aldri midt i en tagg eller en tekst).
   Slå aldri sammen h``-verdier med +, da blir de vanlig tekst igjen. */
class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = s => new Html(String(s ?? ''));
const toHtml = v => v == null || v === false ? '' : v instanceof Html ? v.s : Array.isArray(v) ? v.map(toHtml).join('') : esc(v);
const tplCache = new WeakMap();
function h(strings, ...vals) {
  let st = tplCache.get(strings);
  if (!st) { st = strings.map(x => x.replace(/\n\s*/g, '')); tplCache.set(strings, st); }
  let s = st[0];
  for (let i = 0; i < vals.length; i++) s += toHtml(vals[i]) + st[i + 1];
  return new Html(s);
}
const setHtml = (el, html) => { el.innerHTML = toHtml(html); };
/* <option>-liste fra [[verdi, tekst], …] */
const options = (pairs, sel) => pairs.map(([v, l]) => h`<option value="${v}"${String(v) === String(sel) ? raw(' selected') : ''}>${l}</option>`);
