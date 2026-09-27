/* Takt – service worker
   Appfilene hentes fra nettet når det er mulig (slik at oppdateringer kommer
   automatisk), og fra lageret når telefonen er uten dekning.
   Navnet på lageret følger versjonen i js/version.js, så gamle filer ryddes
   bort av seg selv. Bibliotekene for PDF-import (vendor/) lagres første gang
   de brukes. Dataene dine ligger ikke her, men i nettleserens database. */
importScripts('js/version.js');
const CACHE = 'takt-' + APP_VERSION;
const VENDOR_CACHE = 'takt-vendor-' + VENDOR_VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('takt-') && k !== CACHE && k !== VENDOR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;

  // Store biblioteker: lager først, hentes og lagres første gang
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open(VENDOR_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }

  // Appfiler: nett først (maks 4 sek), ellers lager
  e.respondWith(
    Promise.race([fetch(req), timeout(4000)])
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
