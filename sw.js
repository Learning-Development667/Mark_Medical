/* Care Log service worker.
   Rule: NETWORK-FIRST, ALWAYS. Never cache-first.
   - install: skipWaiting so a new worker takes over immediately
   - activate: delete every cache so stale files can never be served
   - fetch: go to the network; only if the network fails, fall back to a
     copy saved from an earlier successful response (offline safety net) */

const RUNTIME_CACHE = 'care-log-runtime';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin app files. Firebase, fonts and CDN requests go straight to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
