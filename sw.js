/* Service worker minimal : installable + hors-ligne quand servi en http(s).
   Réseau d'abord pour le code (les mises à jour arrivent toujours), repli cache. */
const CACHE = 'bopvec-v8';
const SHELL = ['./index.html', './core.js', './ne50.js', './polygon-clipping.min.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // jamais d'interception ni de mise en cache des requêtes externes (API GitHub avec jeton, etc.)
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
