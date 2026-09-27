'use strict';
/* ---------- hjemme: dagen i Døgn ----------
   Døgn lagrer en kort oversikt (dogn-deling.json) i det private repoet, se
   docs/deling.md. Takt henter den og viser det viktigste: hvem som sover,
   hva som skjer nå og snart, middag og avtaler. Oversikten lagres på
   telefonen, så siste utgave vises også uten nett. */
const dogn = { data: null, at: 0 };
const DOGN_STALE = 3 * 60 * 60 * 1000;   // eldre enn dette vises som gammelt

async function loadDognCache() { const c = await store.get('dogn'); if (c && c.data) Object.assign(dogn, c); }
function setDognData(data) {
  dogn.data = cleanDogn(data);
  dogn.at = Date.now();
  store.set('dogn', { data: dogn.data, at: dogn.at });
}
/* Godtar bare de feltene Takt bruker, med gyldige verdier */
function cleanDogn(o) {
  o = obj(o);
  if (o.format !== 'dogn-deling') throw new UserError(T.sync.notDogn);
  const days = {};
  for (const [d, v] of Object.entries(obj(o.days))) {
    if (!isDate(d)) continue;
    const x = obj(v);
    days[d] = {
      blocks: arr(x.blocks).map(obj).filter(b => isTime(b.start)).map(b => ({ start: b.start, end: isTime(b.end) ? b.end : '', title: str(b.title, 80), type: str(b.type, 20), meal: str(b.meal, 120) })),
      sleep: arr(x.sleep).map(obj).filter(e => isTime(e.start)).map(e => ({ kid: str(e.kid, 20), start: e.start, end: isTime(e.end) ? e.end : '', night: !!e.night })),
      dinner: x.dinner ? { dish: str(obj(x.dinner).dish, 120), partnerEats: obj(x.dinner).partnerEats === true } : null,
      appts: arr(x.appts).map(obj).filter(a => str(a.title)).map(a => ({ title: str(a.title, 120), start: isTime(a.start) ? a.start : '', where: str(a.where, 120) })),
      sick: arr(x.sick).map(k => str(k, 40)).filter(Boolean),
    };
  }
  const acks = {};
  for (const [id, a] of Object.entries(obj(o.acks))) acks[str(id, 20)] = { done: obj(a).done === true };
  return {
    updated: typeof o.updated === 'string' && !isNaN(Date.parse(o.updated)) ? o.updated : '',
    kidsWord: str(o.kidsWord, 30), kids: arr(o.kids).map(obj).map(k => ({ id: str(k.id, 20), name: str(k.name, 40) })).filter(k => k.id),
    days, shop: arr(o.shop).map(s => str(s, 120)).filter(Boolean).slice(0, 100), acks,
  };
}

const kidNameOf = id => { const k = dogn.data.kids.find(x => x.id === id); return k ? k.name : id; };
const kidsWordOf = () => dogn.data.kidsWord || T.home.kids;
const joinNames = names => names.length > 1 ? names.slice(0, -1).join(', ') + T.home.and + names[names.length - 1] : names[0] || '';

/* Hvem sover akkurat nå: { barn: siden }. En søvn uten slutt pågår: en lur i dag,
   eller natten som startet i går kveld (eller i kveld). */
function sleepingNow(date, now) {
  const out = {};
  const y = dogn.data.days[addDays(date, -1)], t = dogn.data.days[date];
  if (y) for (const e of y.sleep) if (e.night && !e.end) out[e.kid] = e.start;
  if (t) for (const e of t.sleep) if (!e.end && toMin(e.start) <= now) out[e.kid] = e.start;
  return out;
}

/* Oversikten for en dag: { status, next, dinner, appts, sick, updated, old } eller null */
function homeDay(date) {
  if (!dogn.data) return null;
  const rec = dogn.data.days[date];
  const updated = dogn.data.updated;
  const old = updated ? Date.now() - Date.parse(updated) > DOGN_STALE : true;
  if (!rec) return { empty: true, updated, old };
  const isToday = date === todayISO(), now = nowMin();
  let status = '', next = [];
  if (isToday) {
    const asleep = sleepingNow(date, now);
    const ids = Object.keys(asleep), all = dogn.data.kids.map(k => k.id);
    if (ids.length) {
      const since = ids.map(k => asleep[k]).sort()[0];
      status = ids.length === all.length && all.length > 1 ? T.home.allAsleep(cap(kidsWordOf()), since)
        : T.home.someAsleep(joinNames(ids.map(kidNameOf)), since, joinNames(all.filter(k => !ids.includes(k)).map(kidNameOf)));
    }
    const cur = [...rec.blocks].reverse().find(b => toMin(b.start) <= now);
    if (!status && cur) status = cur.end ? T.home.nowUntil(cur.title, cur.end) : cur.title;
    next = rec.blocks.filter(b => toMin(b.start) > now).slice(0, 3);
  }
  return { status, next, dinner: rec.dinner, appts: rec.appts, sick: rec.sick, updated, old };
}
