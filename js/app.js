'use strict';
/* ---------- hendelser og oppstart ---------- */
$('#prev').setAttribute('aria-label', T.top.prev);
$('#next').setAttribute('aria-label', T.top.next);
$('#date').setAttribute('aria-label', T.top.pickDay);
$('#bottombar').setAttribute('aria-label', T.nav.label);
$('#tab-today').textContent = T.nav.today;
$('#tab-month').textContent = T.nav.month;
$('#tab-add').setAttribute('aria-label', T.nav.addAria);
$('#tab-more').textContent = T.nav.more;

$('#prev').addEventListener('click', () => go(-1));
$('#next').addEventListener('click', () => go(1));
$('#date').addEventListener('click', () => openCalendarSheet());
$('#tab-today').addEventListener('click', () => go(0));
$('#tab-month').addEventListener('click', () => openCalendarSheet());
$('#tab-add').addEventListener('click', () => openItemSheet(null, view));
$('#tab-more').addEventListener('click', openMenu);

$('#page').addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { goTo(g.dataset.go); return; }
  const tr = e.target.closest('[data-trip], [data-pick]');
  if (tr) {
    const [dir, i] = (tr.dataset.trip || tr.dataset.pick).split(':');
    const trip = shown[dir][Number(i)];
    if (!trip) return;
    if (tr.dataset.trip) openTripSheet(view, dir, trip);
    else { const on = isPicked(view, dir, trip); commit(on ? T.trip.unpicked : T.trip.pickedToast, () => setPick(view, dir, on ? null : trip)); }
    return;
  }
  const mo = e.target.closest('[data-more]');
  if (mo) { const d = mo.dataset.more; if (moreTrips.has(d)) moreTrips.delete(d); else moreTrips.add(d); render(); return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg) { commit(null, () => toggleItem(tg.dataset.toggle)); return; }
  const it = e.target.closest('[data-item]');
  if (it) { openItemSheet(it.dataset.item); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  switch (a.dataset.act) {
    case 'shift': openShiftSheet(view); break;
    case 'import': openRotaSheet(null); break;
    case 'places': openPlacesSheet(null); break;
    case 'dayplaces': openDayPlacesSheet(view); break;
    case 'refresh': tripCache.clear(); render(); break;
    case 'add': openItemSheet(null, view); break;
  }
});

/* Hver halve minutt: ny dag ved midnatt, oppdaterte reiser og dagen hjemme */
function tick() {
  if (!state) return;
  const t = todayISO();
  if (t !== lastToday) {
    if (view === lastToday) view = t;
    lastToday = t;
    if (syncOn()) markDirty(true);   // fraværet som sendes til Døgn, følger datoen
  }
  if (!document.hidden) { maybePullDogn(); if (!sheetOpen()) render(); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else tick(); });
window.addEventListener('pagehide', flush);
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state && state.settings.theme === 'auto') applyTheme(); }); } catch (e) {}

(async () => {
  await store.init();
  await loadSync();
  await loadDognCache();
  await loadTripCache();
  let saved = null;
  try { saved = await store.get('state'); } catch (e) {}
  let rescued = false;
  try { state = saved ? migrate(saved) : defaultState(); }
  catch (e) {
    // Lagrede data kunne ikke leses: ta vare på en kopi før appen starter på nytt
    if (saved) { await store.set('rescue', saved); rescued = true; }
    state = defaultState();
  }
  pruneItems();
  save();
  if (rescued) setTimeout(() => toast(T.file.rescued), 800);
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {}
  applyTheme();
  render();
  setTimeout(() => { if (!state.meta.setupDone && !sheetOpen()) openSetupSheet(1); }, 300);
  if (syncOn()) { scheduleSync(); if (sync.cfg.share && (sync.cfg.lastShare || '').slice(0, 10) !== todayISO()) markDirty(true); maybePullDogn(); }
  setInterval(tick, 30000);
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window.self) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  } catch (e) {}
})();
