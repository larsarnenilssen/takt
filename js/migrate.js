'use strict';
/* ---------- datastruktur, oppgradering og kontroll av data ----------
   Alt brukeren legger inn, ligger i ett objekt (state). Nye versjoner av appen
   kan endre strukturen; migrate() oppgraderer eldre data trinn for trinn, og
   sanitize() godtar bare gyldige verdier, både fra lageret og fra filer.

   state = {
     version, profile: { name },
     places: [{ id, role: 'home' | 'work' | '', name, label, lat, lon, note }],
     travel: { before, after, walk, oneWay, fastest: { to, home },
               favorites: [{ id, lines: [{ code, id, mode }] }] },
     rota: { codes: { KODE: { label, kind, start, end } }, shifts: { dato: KODE } (fra import),
             overrides: { dato: KODE eller '' }, custom: { dato: { start, end, label } }, source },
     days: { dato: { from: stedId, to: stedId, pick: { to | home: { leave, arrive, sig } } } },
     items: [{ id, kind, date, time, title, note, done, shared, updated }],
     settings: { theme, textSize, dognName }, meta: { created, setupDone, lastExport } } */
const DATA_VERSION = 1;
const SHIFT_KINDS = ['work', 'night', 'off'];
const ITEM_KINDS = ['todo', 'appt', 'note', 'shop'];
const WALK_SPEEDS = { slow: 1.1, normal: 1.35, fast: 1.6 };   // meter per sekund
const THEMES = ['auto', 'light', 'dark'];
const TEXT_SIZES = [1, 1.1, 1.2];
const CODE_RE = /^[\wÆØÅæøå.+-]{1,12}$/;

function defaultState() {
  return {
    version: DATA_VERSION,
    profile: { name: '' },
    places: [],
    travel: { before: 15, after: 15, walk: 'normal', oneWay: 0, fastest: { to: 0, home: 0 }, favorites: [] },
    rota: { codes: {}, shifts: {}, overrides: {}, custom: {}, source: null },
    days: {},
    items: [],
    settings: { theme: 'auto', textSize: 1, dognName: '' },
    meta: { created: todayISO(), setupDone: false, lastExport: '' },
  };
}

/* Oppgraderer eldre data. Nye trinn legges til her når DATA_VERSION økes. */
function migrate(o) {
  if (!o || typeof o !== 'object' || typeof o.version !== 'number') throw new UserError(T.file.notTakt);
  if (o.version > DATA_VERSION) throw new UserError(T.file.newer);
  // Ingen eldre versjoner ennå
  return sanitize(o);
}

const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const arr = v => Array.isArray(v) ? v : [];
const isCode = c => typeof c === 'string' && CODE_RE.test(c);

function cleanCode(def) {
  const d = obj(def);
  return { label: str(d.label, 60), kind: SHIFT_KINDS.includes(d.kind) ? d.kind : 'work', start: isTime(d.start) ? d.start : '', end: isTime(d.end) ? d.end : '' };
}
function cleanPlace(p) {
  p = obj(p);
  const lat = Number(p.lat), lon = Number(p.lon);
  if (!isCoord(lat, lon)) return null;
  return { id: str(p.id, 20) || uid(), role: ['home', 'work'].includes(p.role) ? p.role : '', name: str(p.name, 60), label: str(p.label, 120), lat, lon, note: str(p.note, 120) };
}
function cleanItem(x) {
  x = obj(x);
  const title = str(x.title, 200).trim();
  if (!title) return null;
  return {
    id: str(x.id, 20) || uid(), kind: ITEM_KINDS.includes(x.kind) ? x.kind : 'todo',
    date: isDate(x.date) ? x.date : '', time: isTime(x.time) ? x.time : '',
    title, note: str(x.note, 2000), done: !!x.done, shared: !!x.shared,
    updated: typeof x.updated === 'string' && !isNaN(Date.parse(x.updated)) ? x.updated : new Date().toISOString(),
  };
}
function cleanFavorite(f) {
  f = obj(f);
  const lines = arr(f.lines).map(l => obj(l)).filter(l => str(l.code, 12)).slice(0, 4)
    .map(l => ({ code: str(l.code, 12), id: str(l.id, 80), mode: str(l.mode, 20) }));
  return lines.length ? { id: str(f.id, 20) || uid(), lines } : null;
}

/* Godtar bare gyldige verdier. Brukes på alt som lastes inn. */
function sanitize(o) {
  const s = defaultState(), src = obj(o);
  s.profile.name = str(obj(src.profile).name, 60);
  s.places = arr(src.places).map(cleanPlace).filter(Boolean).slice(0, 30);
  for (const role of ['home', 'work']) s.places.filter(p => p.role === role).slice(1).forEach(p => { p.role = ''; });

  const tr = obj(src.travel);
  s.travel.before = num(tr.before, 15, 0, 120);
  s.travel.after = num(tr.after, 15, 0, 120);
  s.travel.walk = tr.walk in WALK_SPEEDS ? tr.walk : 'normal';
  s.travel.oneWay = num(tr.oneWay, 0, 0, 240);
  for (const dir of ['to', 'home']) s.travel.fastest[dir] = num(obj(tr.fastest)[dir], 0, 0, 300);
  s.travel.favorites = arr(tr.favorites).map(cleanFavorite).filter(Boolean).slice(0, 8);

  const R = obj(src.rota);
  for (const [c, def] of Object.entries(obj(R.codes))) if (isCode(c)) s.rota.codes[c] = cleanCode(def);
  for (const [d, c] of Object.entries(obj(R.shifts))) if (isDate(d) && isCode(c)) s.rota.shifts[d] = c;
  for (const [d, c] of Object.entries(obj(R.custom))) {
    const x = obj(c);
    if (isDate(d) && isTime(x.start) && isTime(x.end)) s.rota.custom[d] = { start: x.start, end: x.end, label: str(x.label, 60) };
  }
  for (const [d, c] of Object.entries(obj(R.overrides))) if (isDate(d) && (c === '' || isCode(c))) s.rota.overrides[d] = c;
  const so = obj(R.source);
  if (isDate(so.from) && isDate(so.to)) s.rota.source = { from: so.from, to: so.to, importedAt: str(so.importedAt, 40) };

  const ids = new Set(s.places.map(p => p.id));
  for (const [d, v] of Object.entries(obj(src.days))) {
    if (!isDate(d)) continue;
    const x = obj(v), rec = {};
    if (ids.has(x.from)) rec.from = x.from;
    if (ids.has(x.to)) rec.to = x.to;
    const pick = {};
    for (const dir of ['to', 'home']) {
      const t = obj(obj(x.pick)[dir]);
      if (!isNaN(Date.parse(t.leave)) && !isNaN(Date.parse(t.arrive))) pick[dir] = { leave: str(t.leave, 40), arrive: str(t.arrive, 40), sig: str(t.sig, 40) };
    }
    if (Object.keys(pick).length) rec.pick = pick;
    if (Object.keys(rec).length) s.days[d] = rec;
  }
  s.items = arr(src.items).map(cleanItem).filter(Boolean).slice(0, 2000);

  const st = obj(src.settings);
  s.settings.theme = THEMES.includes(st.theme) ? st.theme : 'auto';
  s.settings.textSize = TEXT_SIZES.includes(st.textSize) ? st.textSize : 1;
  s.settings.dognName = str(st.dognName, 40);

  const m = obj(src.meta);
  s.meta.created = isDate(m.created) ? m.created : todayISO();
  s.meta.setupDone = !!m.setupDone;
  s.meta.lastExport = isDate(m.lastExport) ? m.lastExport : '';
  return s;
}
