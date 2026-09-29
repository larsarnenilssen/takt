'use strict';
/* ---------- hjemme: dagen i Døgn ----------
   Døgn lagrer en oversikt (dogn-deling.json) i det private repoet, se
   docs/deling.md: planen, det som er logget (søvn, natt, mat, helse) og
   merknader om det som skiller seg ut. Reglene for merknadene står i Døgn;
   her gjøres dataene om til rader og linjer som vises (views/home.js).
   Oversikten lagres på telefonen, så siste utgave vises også uten nett. */
const dogn = { data: null, at: 0 };
const DOGN_STALE = 3 * 60 * 60 * 1000;   // eldre enn dette vises som gammelt
const RATES = ['godt', 'middels', 'lite'];
const HEALTH_KINDS = ['temp', 'med', 'sym', 'other'];
const FLAG_KINDS = ['fever', 'sick', 'med', 'night', 'nap', 'food'];

async function loadDognCache() { const c = await store.get('dogn'); if (c && c.data) Object.assign(dogn, c); }
function setDognData(data) {
  dogn.data = cleanDogn(data);
  dogn.at = Date.now();
  store.set('dogn', { data: dogn.data, at: dogn.at });
}

/* ---------- kontroll av filen: bare feltene Takt bruker, med gyldige verdier ---------- */
const mins = v => Math.round(num(v, 0, 0, 1440));
const minsOrNull = v => v == null ? null : mins(v);
function cleanFlag(f) {
  const x = { kind: f.kind, level: f.level === 'high' ? 'high' : 'note', kid: str(f.kid, 20) };
  if (isTime(f.time)) x.time = f.time;
  if (f.kind === 'fever') x.temp = num(f.temp, 0, 30, 45);
  if (f.kind === 'med') x.what = str(f.what, 60);
  if (f.kind === 'night') Object.assign(x, { net: mins(f.net), wakes: Math.round(num(f.wakes, 0, 0, 30)), usual: mins(f.usual) });
  if (f.kind === 'nap') Object.assign(x, { total: mins(f.total), usual: mins(f.usual) });
  if (f.kind === 'food') x.count = Math.round(num(f.count, 0, 0, 20));
  return x;
}
function cleanDay(x) {
  const nights = {};
  for (const [k, v] of Object.entries(obj(x.nights))) {
    const n = obj(v);
    nights[str(k, 20)] = { asleep: isTime(n.asleep) ? n.asleep : '', wake: isTime(n.wake) ? n.wake : '', net: mins(n.net), wakes: Math.round(num(n.wakes, 0, 0, 30)), up: mins(n.up) };
  }
  const note = obj(x.note);
  return {
    blocks: arr(x.blocks).map(obj).filter(b => isTime(b.start)).map(b => ({ start: b.start, end: isTime(b.end) ? b.end : '', title: str(b.title, 80), type: str(b.type, 20), meal: str(b.meal, 120) })),
    sleep: arr(x.sleep).map(obj).filter(e => isTime(e.start)).map(e => ({ kid: str(e.kid, 20), start: e.start, end: isTime(e.end) ? e.end : '', night: !!e.night })),
    nights,
    meals: arr(x.meals).map(obj).filter(m => isTime(m.start)).map(m => {
      const rates = {};
      for (const [k, r] of Object.entries(obj(m.rates))) if (RATES.includes(r)) rates[str(k, 20)] = r;
      return { title: str(m.title, 80), start: m.start, rates };
    }),
    did: arr(x.did).map(obj).filter(a => isTime(a.start) && str(a.name)).map(a => ({ start: a.start, name: str(a.name, 80) })),
    health: arr(x.health).map(obj).filter(e => isTime(e.time)).map(e => ({ kid: str(e.kid, 20), time: e.time, kind: HEALTH_KINDS.includes(e.kind) ? e.kind : 'other', value: str(e.value, 60) })),
    note: str(note.text).trim() ? { text: str(note.text, 1000).trim(), important: note.important === true } : null,
    flags: arr(x.flags).map(obj).filter(f => FLAG_KINDS.includes(f.kind)).map(cleanFlag),
    lastLog: isTime(x.lastLog) ? x.lastLog : '',
    dinner: x.dinner ? { dish: str(obj(x.dinner).dish, 120), partnerEats: obj(x.dinner).partnerEats === true } : null,
    appts: arr(x.appts).map(obj).filter(a => str(a.title)).map(a => ({ title: str(a.title, 120), start: isTime(a.start) ? a.start : '', where: str(a.where, 120) })),
  };
}
function cleanDogn(o) {
  o = obj(o);
  if (o.format !== 'dogn-deling') throw new UserError(T.sync.notDogn);
  const days = {}, usual = {}, acks = {};
  for (const [d, v] of Object.entries(obj(o.days))) if (isDate(d)) days[d] = cleanDay(obj(v));
  for (const [k, v] of Object.entries(obj(o.usual))) { const u = obj(v); usual[str(k, 20)] = { night: minsOrNull(u.night), wakes: u.wakes == null ? null : num(u.wakes, 0, 0, 30), nap: minsOrNull(u.nap) }; }
  for (const [id, a] of Object.entries(obj(o.acks))) acks[str(id, 20)] = { done: obj(a).done === true };
  return {
    updated: typeof o.updated === 'string' && !isNaN(Date.parse(o.updated)) ? o.updated : '',
    kids: arr(o.kids).map(obj).map(k => ({ id: str(k.id, 20), name: str(k.name, 40) })).filter(k => k.id),
    usual, days, shop: arr(o.shop).map(s => str(s, 120)).filter(Boolean).slice(0, 100), acks,
    // Avtalene i Døgn (fra Døgn 2.9.4). null: eldre Døgn, da brukes avtalene i dagene.
    appts: Array.isArray(o.appts) ? o.appts.map(obj).filter(a => isDate(a.date) && str(a.title)).slice(0, 300).map(a => ({
      id: str(a.id, 40), date: a.date, start: isTime(a.start) ? a.start : '', end: isTime(a.end) ? a.end : '', title: str(a.title, 120), where: str(a.where, 120),
    })) : null,
  };
}
/* Avtalene i Døgn, til orientering: [{ date, start, end, title, where }] sortert etter tid */
function dognAppts(from, to) {
  if (!dognOn() || !dogn.data) return [];
  const D = dogn.data;
  const all = D.appts || Object.entries(D.days).flatMap(([date, r]) => r.appts.map(a => ({ ...a, date, end: '' })));
  return all.filter(a => a.date >= from && a.date <= to).sort((a, b) => (a.date + (a.start || '99')).localeCompare(b.date + (b.start || '99')));
}

/* ---------- fra filen til det som vises ---------- */
const kidNameOf = id => { const k = dogn.data.kids.find(x => x.id === id); return k ? k.name : id; };
const dognDates = () => dogn.data ? Object.keys(dogn.data.days).sort() : [];

/* Hvem sover akkurat nå: { barn: siden }. En søvn uten slutt pågår: en lur i dag,
   eller natten som startet i går kveld (fram til midt på dagen, i tilfelle
   «våknet» aldri ble logget), eller i kveld. */
const NIGHT_UNTIL = 12 * 60;
function sleepingNow(date, now) {
  const out = {};
  const y = dogn.data.days[addDays(date, -1)], t = dogn.data.days[date];
  if (y && now < NIGHT_UNTIL) for (const e of y.sleep) if (e.night && !e.end) out[e.kid] = e.start;
  if (t) for (const e of t.sleep) if (!e.end && toMin(e.start) <= now) out[e.kid] = e.start;
  return out;
}
/* Linjene øverst: merknader fra Døgn og beskjeden. Medisin legges på linjen om feber eller sykdom. */
function flagLines(rec) {
  const lines = [], ill = new Set(rec.flags.filter(f => f.kind === 'fever' || f.kind === 'sick').map(f => f.kid));
  const medFor = kid => rec.flags.find(f => f.kind === 'med' && f.kid === kid);
  for (const f of rec.flags) {
    const name = kidNameOf(f.kid), med = medFor(f.kid);
    const withMed = text => med ? text + T.home.flag.andMed(med.what, med.time) : text;
    if (f.kind === 'fever') lines.push({ level: f.level, text: withMed(T.home.flag.fever(name, f.temp.toFixed(1).replace('.', ','), f.time)) });
    else if (f.kind === 'sick') lines.push({ level: f.level, text: withMed(T.home.flag.sick(name)) });
    else if (f.kind === 'med' && !ill.has(f.kid)) lines.push({ level: f.level, text: T.home.flag.med(name, f.what, f.time) });
    else if (f.kind === 'night') lines.push({ level: f.level, text: T.home.flag.night(name, fmtDurShort(f.net), f.wakes, fmtDurShort(f.usual)) });
    else if (f.kind === 'nap') lines.push({ level: f.level, text: T.home.flag.nap(name, fmtDurShort(f.total), fmtDurShort(f.usual)) });
    else if (f.kind === 'food') lines.push({ level: f.level, text: T.home.flag.food(name, f.count) });
  }
  if (rec.note) lines.push({ level: rec.note.important ? 'high' : 'note', text: T.home.flag.note(rec.note.text) });
  return lines.sort((a, b) => (a.level === 'high' ? 0 : 1) - (b.level === 'high' ? 0 : 1));
}
/* Nivået på en celle (natt, lur, mat) for et barn: 'high', 'note' eller '' */
const cellLevel = (rec, kid, kind) => { const f = rec.flags.find(x => x.kid === kid && x.kind === kind); return f ? f.level : ''; };
const napsOf = (rec, kid) => rec.sleep.filter(e => !e.night && e.kid === kid).sort((a, b) => a.start.localeCompare(b.start));
const napTotal = (rec, kid) => napsOf(rec, kid).filter(e => e.end).reduce((s, e) => s + Math.max(0, toMin(e.end) - toMin(e.start)), 0);

/* Oversikten for en dag, eller null uten data. Per barn: nå, natt, lurer og mat, med nivå for avvik. */
function homeDay(date) {
  if (!dogn.data) return null;
  const rec = dogn.data.days[date];
  const updated = dogn.data.updated;
  const old = updated ? Date.now() - Date.parse(updated) > DOGN_STALE : true;
  if (!rec) return { empty: true, appts: dognAppts(date, date), updated, old };
  const isToday = date === todayISO(), now = nowMin();
  const asleep = isToday ? sleepingNow(date, now) : {};
  const kids = dogn.data.kids.map((k, i) => {
    const n = rec.nights[k.id], naps = napsOf(rec, k.id);
    const lastRate = [...rec.meals].reverse().map(m => m.rates[k.id]).find(Boolean) || '';
    const woke = naps.filter(e => e.end).map(e => e.end).pop() || (n && n.wake) || '';
    return {
      id: k.id, name: k.name, tint: i % 3,
      now: asleep[k.id] ? { asleep: true, since: asleep[k.id] } : { asleep: false, since: woke },
      night: n ? { ...n, usual: (dogn.data.usual[k.id] || {}).night || null, level: cellLevel(rec, k.id, 'night') } : null,
      naps: { list: naps, total: napTotal(rec, k.id), level: cellLevel(rec, k.id, 'nap') },
      food: { rate: lastRate, level: cellLevel(rec, k.id, 'food') },
    };
  });
  const blocks = rec.blocks.map(b => ({ ...b, past: isToday && toMin(b.end || b.start) <= now, did: (rec.did.find(a => a.start === b.start) || {}).name || '' }));
  const next = isToday ? blocks.filter(b => toMin(b.start) > now).slice(0, 2) : [];
  return { date, isToday, lines: flagLines(rec), kids, blocks, next, meals: rec.meals, health: rec.health, note: rec.note,
    dinner: rec.dinner, appts: dognAppts(date, date), lastLog: rec.lastLog, updated, old };
}
