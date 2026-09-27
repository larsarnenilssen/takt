'use strict';
/* ---------- steder: hjem, arbeidssted og andre mål ----------
   Et sted har koordinater, slik at gangtiden til og fra holdeplassene kan
   regnes med. Adresser søkes opp hos Entur (samme kilde som reisene).
   En dag kan ha et annet mål eller utgangspunkt enn vanlig, for eksempel kurs. */
const ENTUR_CLIENT = 'privat-takt';
const GEO_URL = 'https://api.entur.io/geocoder/v1/';
const BERGEN = { lat: 60.3913, lon: 5.3221 };   // søket foretrekker treff i nærheten av hjemmet, ellers Bergen

const placeById = id => state.places.find(p => p.id === id) || null;
const placeByRole = role => state.places.find(p => p.role === role) || null;
const placeName = p => p ? (p.name || p.label) : '';
/* Utgangspunkt og mål en dag (vanligvis hjem og arbeidssted) */
function dayPlaces(date) {
  const d = state.days[date] || {};
  return { from: placeById(d.from) || placeByRole('home'), to: placeById(d.to) || placeByRole('work') };
}
function setDayPlace(date, which, id) {
  const d = (state.days[date] ??= {});
  const def = placeByRole(which === 'from' ? 'home' : 'work');
  if (!id || (def && def.id === id)) delete d[which]; else d[which] = id;
  delete d.pick;   // en valgt reise gjelder ikke lenger når stedet endres
  if (!Object.keys(d).length) delete state.days[date];
}
function savePlace(p) {
  const clean = cleanPlace(p);
  if (!clean) throw new UserError(T.places.needAddress);
  if (clean.role) state.places.forEach(x => { if (x.role === clean.role && x.id !== clean.id) x.role = ''; });
  const i = state.places.findIndex(x => x.id === clean.id);
  if (i >= 0) state.places[i] = clean; else state.places.push(clean);
  return clean;
}
function deletePlace(id) {
  state.places = state.places.filter(p => p.id !== id);
  for (const [d, v] of Object.entries(state.days)) {
    if (v.from === id) delete v.from;
    if (v.to === id) delete v.to;
    if (!Object.keys(v).length) delete state.days[d];
  }
}

async function geoFetch(path) {
  const r = await fetch(GEO_URL + path, { headers: { 'ET-Client-Name': ENTUR_CLIENT } });
  if (!r.ok) throw new UserError(T.places.searchFailed);
  return (await r.json()).features || [];
}
const fromFeature = f => ({ label: f.properties.label || f.properties.name, name: f.properties.name || '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
/* Adressesøk. Gir [{ label, name, lat, lon }] */
async function searchPlaces(text) {
  const near = placeByRole('home') || BERGEN;
  const q = new URLSearchParams({ text, size: '6', lang: 'no', 'focus.point.lat': near.lat, 'focus.point.lon': near.lon });
  return (await geoFetch('autocomplete?' + q)).map(fromFeature);
}
/* Nærmeste adresse til et punkt (for «Bruk der jeg er nå») */
async function reversePlace(lat, lon) {
  const q = new URLSearchParams({ 'point.lat': lat, 'point.lon': lon, size: '1', lang: 'no' });
  const f = (await geoFetch('reverse?' + q))[0];
  return f ? { ...fromFeature(f), lat, lon } : { label: lat.toFixed(5) + ', ' + lon.toFixed(5), name: '', lat, lon };
}
function hereNow() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(new UserError(T.places.noGps)); return; }
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => rej(new UserError(T.places.noGps)), { enableHighAccuracy: true, timeout: 15000 });
  });
}
