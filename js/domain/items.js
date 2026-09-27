'use strict';
/* ---------- notater, gjøremål, avtaler og handling ----------
   Et punkt kan høre til en dag eller ikke. Gjøremål og handling uten dag vises
   i dag til de er gjort. Punkter merket «delt» sendes til Døgn (se sync.js),
   og det som er krysset av der, vises her. Handling havner på handlelisten i Døgn. */
const KIND_ORDER = { appt: 0, todo: 1, shop: 2, note: 3 };

/* Avkrysset her eller i Døgn */
const doneInDogn = x => !!(x.shared && dogn.data && dogn.data.acks && dogn.data.acks[x.id] && dogn.data.acks[x.id].done);
const isDone = x => x.done || doneInDogn(x);

function itemsFor(date) {
  const today = todayISO();
  const floating = x => !x.date && x.kind !== 'note' && date === today && !isDone(x);
  return state.items.filter(x => x.date === date || floating(x)).sort((a, b) =>
    (isDone(a) - isDone(b)) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title, 'nb'));
}
const hasItems = date => state.items.some(x => x.date === date);
function saveItem(x) {
  const clean = cleanItem({ ...x, updated: new Date().toISOString() });
  if (!clean) throw new UserError(T.items.needTitle);
  const i = state.items.findIndex(y => y.id === clean.id);
  if (i >= 0) state.items[i] = clean; else state.items.push(clean);
  return clean;
}
function toggleItem(id) {
  const x = state.items.find(y => y.id === id);
  if (!x) return;
  x.done = !isDone(x);
  x.updated = new Date().toISOString();
}
function deleteItem(id) { state.items = state.items.filter(x => x.id !== id); }
/* Rydder bort gjorte punkter eldre enn en måned, så listen ikke vokser for alltid */
function pruneItems() {
  const limit = addDays(todayISO(), -31);
  state.items = state.items.filter(x => !(x.done && (x.date || x.updated.slice(0, 10)) < limit));
}
