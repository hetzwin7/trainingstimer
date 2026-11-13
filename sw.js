/* Offline: eerst het netwerk (zodat een nieuw weekschema of een app-update direct binnenkomt),
   bij geen of traag bereik de laatst bewaarde versie. */
const CACHE = "trainingstimer-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "figures.js", "plan.json", "manifest.webmanifest",
  "icon-180.png", "icon-192.png", "icon-512.png",
  "fonts/saira-condensed-latin-700-normal.woff2", "fonts/saira-condensed-latin-800-normal.woff2",
  "fonts/atkinson-hyperlegible-latin-400-normal.woff2", "fonts/atkinson-hyperlegible-latin-700-normal.woff2"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, {ignoreSearch: true});
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(url.pathname, r.clone()); return r; });
    if (!cached) return net;
    net.catch(() => {});
    const slow = new Promise(res => setTimeout(() => res(cached), 2500));
    return Promise.race([net.catch(() => cached), slow]);
  })());
});
