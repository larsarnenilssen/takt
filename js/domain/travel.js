'use strict';
/* ---------- reiser med Skyss (Entur reiseplanlegger) ----------
   Entur har ruter og sanntid for Skyss. Reisen søkes fra dør til dør, så
   gangtiden til og fra holdeplassene er med. Til vakt: siste reise som er
   fram senest «før vakt» minutter før vakten. Hjem: første reise etter at
   vakten er slutt pluss «etter vakt» minutter.
   Favoritter er rekker av linjer (for eksempel 16E, eller 1 + 5). Hver
   favoritt får sitt eget søk, slik at den alltid vises når den går.
   Retningene heter 'to' (til vakt) og 'home' (hjem etter vakt).

   Fraværet en dag (awayFor) er fra hun går hjemmefra til hun er hjemme igjen.
   Det regnes ut fra, i denne rekkefølgen: reisen hun har valgt for dagen,
   reisetiden hun har skrevet inn, og den raskeste reisen Takt har funnet. */
const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const TRIP_FIELDS = `tripPatterns { expectedStartTime expectedEndTime duration walkTime
  legs { mode duration aimedStartTime expectedStartTime expectedEndTime realtime
    fromPlace { name } toPlace { name } line { id publicCode transportMode }
    fromEstimatedCall { destinationDisplay { frontText } cancellation } } }`;
const TRIP_QUERY = `query($from: Location!, $to: Location!, $dateTime: DateTime!, $arriveBy: Boolean!, $n: Int!, $walkSpeed: Float!) {
  trip(from: $from, to: $to, dateTime: $dateTime, arriveBy: $arriveBy, numTripPatterns: $n, walkSpeed: $walkSpeed) { ${TRIP_FIELDS} } }`;
const TRIP_QUERY_LINES = `query($from: Location!, $to: Location!, $dateTime: DateTime!, $arriveBy: Boolean!, $n: Int!, $walkSpeed: Float!, $lines: [ID]) {
  trip(from: $from, to: $to, dateTime: $dateTime, arriveBy: $arriveBy, numTripPatterns: $n, walkSpeed: $walkSpeed, whiteListed: { lines: $lines }) { ${TRIP_FIELDS} } }`;
const TRIPS_ALL = 8, TRIPS_FAV = 3;
const LIVE_WINDOW = 3 * 60;        // minutter fram der sanntid er interessant
const TTL_LIVE = 60 * 1000, TTL_PLAN = 15 * 60 * 1000;

async function jp(query, variables) {
  const r = await fetch(JP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new UserError(T.travel.failed);
  const j = await r.json();
  if (j.errors || !j.data || !j.data.trip) throw new UserError(T.travel.failed);
  return j.data.trip.tripPatterns.map(normTrip);
}
function normTrip(p) {
  const legs = p.legs.map(l => ({
    mode: l.mode, code: (l.line && l.line.publicCode) || '', lineId: (l.line && l.line.id) || '',
    from: l.fromPlace.name, to: l.toPlace.name, start: l.expectedStartTime, aimed: l.aimedStartTime, end: l.expectedEndTime,
    min: Math.max(1, Math.round(l.duration / 60)), rt: !!l.realtime,
    dest: (l.fromEstimatedCall && l.fromEstimatedCall.destinationDisplay && l.fromEstimatedCall.destinationDisplay.frontText) || '',
    cancelled: !!(l.fromEstimatedCall && l.fromEstimatedCall.cancellation),
  }));
  const ride = legs.filter(l => l.mode !== 'foot');
  return { start: p.expectedStartTime, end: p.expectedEndTime, min: Math.round(p.duration / 60), walk: Math.round(p.walkTime / 60), legs, sig: ride.map(l => l.code).join('+') };
}
const favSig = f => f.lines.map(l => l.code).join('+');
const favName = f => f.lines.map(l => l.code).join(' + ');
const tripKey = t => t.start + '|' + t.sig;

/* Hva reisen skal passe med en dag: { dir, target (Date), arriveBy, sh } eller null */
function travelNeed(date, dir) {
  const sh = shiftFor(date);
  if (!isWorkShift(sh)) return null;
  const span = shiftSpan(date, sh), T0 = state.travel;
  return dir === 'to'
    ? { dir, sh, arriveBy: true, target: new Date(span.start - T0.before * 60000) }
    : { dir, sh, arriveBy: false, target: new Date(+span.end + T0.after * 60000) };
}

/* Hurtiglager for søk: i minnet, og siste svar lagres for bruk uten nett */
const tripCache = new Map();
async function loadTripCache() { const c = await store.get('trips'); if (c) for (const [k, v] of Object.entries(c)) tripCache.set(k, v); }
function saveTripCache() {
  const keep = [...tripCache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 24);
  store.set('trips', Object.fromEntries(keep));
}

/* Søker reiser for en dag og retning. Gir { need, from, to, best: [{ fav, trip }], other: [trip], at, stale } */
async function planTrips(date, dir, force) {
  const need = travelNeed(date, dir);
  const { from: home, to: work } = dayPlaces(date);
  if (!need || !home || !work) return null;
  const [from, to] = dir === 'to' ? [home, work] : [work, home];
  const favs = state.travel.favorites;
  const key = [date, dir, from.id, to.id, need.target.toISOString(), state.travel.walk, favs.map(favSig).join(',')].join('|');
  const live = (need.target - Date.now()) / 60000 < LIVE_WINDOW;
  const hit = tripCache.get(key);
  if (hit && !force && Date.now() - hit.at < (live ? TTL_LIVE : TTL_PLAN)) return { need, from, to, ...hit.data, at: hit.at };

  const vars = {
    from: { coordinates: { latitude: from.lat, longitude: from.lon }, name: placeName(from) },
    to: { coordinates: { latitude: to.lat, longitude: to.lon }, name: placeName(to) },
    dateTime: need.target.toISOString(), arriveBy: need.arriveBy, walkSpeed: WALK_SPEEDS[state.travel.walk],
  };
  try {
    const searches = [jp(TRIP_QUERY, { ...vars, n: TRIPS_ALL })];
    for (const f of favs) {
      const ids = f.lines.map(l => l.id).filter(Boolean);
      searches.push(ids.length === f.lines.length ? jp(TRIP_QUERY_LINES, { ...vars, n: TRIPS_FAV, lines: ids }).catch(() => []) : Promise.resolve([]));
    }
    const lists = await Promise.all(searches);
    const all = [...new Map(lists.flat().map(t => [tripKey(t), t])).values()].sort((a, b) => new Date(a.start) - new Date(b.start));
    const data = pickTrips(all, need, favs);
    tripCache.set(key, { at: Date.now(), data });
    saveTripCache();
    learnLineIds(all, favs);
    if (from.role && to.role) learnFastest(dir, lists[0]);
    return { need, from, to, ...data, at: Date.now() };
  } catch (e) {
    if (hit) return { need, from, to, ...hit.data, at: hit.at, stale: true };
    throw e;
  }
}
/* Til vakt: den siste reisen som er fram i tide. Hjem: den første etter målet. */
function pickTrips(all, need, favs) {
  const ok = need.arriveBy ? all.filter(t => new Date(t.end) <= need.target) : all.filter(t => new Date(t.start) >= need.target);
  const bestOf = list => need.arriveBy ? list[list.length - 1] : list[0];
  const best = [];
  for (const f of favs) { const t = bestOf(ok.filter(x => x.sig === favSig(f))); if (t) best.push({ fav: f.id, trip: t }); }
  const used = new Set(best.map(b => tripKey(b.trip)));
  const rest = ok.filter(t => !used.has(tripKey(t)));
  const other = need.arriveBy ? rest.slice(-3).reverse() : rest.slice(0, 3);
  return { best, other };
}
/* Favoritter lagret med bare linjenummer får linje-ID første gang de dukker opp i et søk */
function learnLineIds(all, favs) {
  const missing = favs.filter(f => f.lines.some(l => !l.id));
  if (!missing.length) return;
  const learned = [];
  for (const f of missing) {
    const t = all.find(x => x.sig === favSig(f));
    if (t) learned.push([f.id, t.legs.filter(l => l.mode !== 'foot')]);
  }
  if (learned.length) commit(null, () => learned.forEach(([id, ride]) => {
    const f = state.travel.favorites.find(x => x.id === id);
    if (f) f.lines = ride.map(l => ({ code: l.code, id: l.lineId, mode: l.mode }));
  }));
}
/* Raskeste reise mellom hjem og arbeidssted (dør til dør), brukt når ingen reise er valgt */
function learnFastest(dir, trips) {
  if (!trips.length) return;
  const m = Math.min(...trips.map(t => t.min));
  if (m !== state.travel.fastest[dir]) commit(null, () => { state.travel.fastest[dir] = m; });
}
/* Valgt reise for en dag og retning (eller null) */
const pickOf = (date, dir) => ((state.days[date] || {}).pick || {})[dir] || null;
function setPick(date, dir, trip) {
  const d = (state.days[date] ??= {}), p = (d.pick ??= {});
  if (trip) p[dir] = { leave: leaveAt(trip), arrive: trip.end, sig: trip.sig }; else delete p[dir];
  if (!Object.keys(p).length) delete d.pick;
  if (!Object.keys(d).length) delete state.days[date];
}
const isPicked = (date, dir, trip) => { const p = pickOf(date, dir); return !!p && p.leave === leaveAt(trip) && p.sig === trip.sig; };
/* Reisetid én vei i minutter: den hun har skrevet inn, ellers den raskeste som er funnet */
const oneWay = dir => state.travel.oneWay || state.travel.fastest[dir] || 0;
/* Fravær en dag: { leave, back (Date), chosen: { to, home }, basis } eller null */
function awayFor(date) {
  const sh = shiftFor(date);
  if (!isWorkShift(sh)) return null;
  const span = shiftSpan(date, sh), T0 = state.travel;
  const pt = pickOf(date, 'to'), ph = pickOf(date, 'home');
  const mt = oneWay('to'), mh = oneWay('home');
  if ((!pt && !mt) || (!ph && !mh)) return null;
  return {
    leave: pt ? new Date(pt.leave) : new Date(span.start - (T0.before + mt) * 60000),
    back: ph ? new Date(ph.arrive) : new Date(+span.end + (T0.after + mh) * 60000),
    chosen: { to: !!pt, home: !!ph },
    basis: T0.oneWay ? 'set' : 'fastest',
  };
}

/* Lagrer rekken av linjer i en reise som favoritt */
function addFavorite(trip) {
  const lines = trip.legs.filter(l => l.mode !== 'foot').map(l => ({ code: l.code, id: l.lineId, mode: l.mode }));
  if (!lines.length || state.travel.favorites.some(f => favSig(f) === trip.sig)) return false;
  state.travel.favorites.push({ id: uid(), lines });
  return true;
}
/* Favoritt fra linjenumre skrevet inn for hånd: «16E», «1 + 5» */
function addFavoriteCodes(text) {
  const codes = String(text).split(/[+,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
  if (!codes.length || codes.some(c => !/^[\wÆØÅ]{1,6}$/.test(c))) throw new UserError(T.travel.badLines);
  if (state.travel.favorites.some(f => favSig(f) === codes.join('+'))) throw new UserError(T.travel.favExists);
  state.travel.favorites.push({ id: uid(), lines: codes.map(code => ({ code, id: '', mode: '' })) });
}

/* Når må hun gå hjemmefra: første etappe (ofte gange) starter */
const leaveAt = t => t.legs[0].start;
/* Forsinkelse på første kjøretøy i minutter (positiv = senere enn rutetiden) */
function delayOf(t) {
  const ride = t.legs.find(l => l.mode !== 'foot');
  return ride && ride.aimed ? minutesBetween(ride.aimed, ride.start) : 0;
}
