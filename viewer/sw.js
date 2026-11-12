// Service worker for return visits on the published site (registered from index.html; never on localhost).
// Large files that only change with a deploy (assets/, paleo/, vendor/, site/borders/) are served from a cache kept
// per deploy; the API and the HTML go to the network first and fall back to the cache when offline. Every page load
// first asks version.json (written by build-static.mjs) which deploy is live: a new one empties the old cache, so a
// new deploy shows after one reload, and { "sw": false } there makes this worker remove itself and its caches.
const PREFIX = 'atlas-';
const CACHE_FIRST = /\/(assets|paleo|vendor|site\/borders)\//;
const NETWORK_FIRST = /\/api\/|\.html$|\/$/;
let current = null;   // the live deploy's cache name, once known

async function cacheName() {
  if (current) return current;
  const names = (await caches.keys()).filter(n => n.startsWith(PREFIX));
  return (current = names[0] || null);
}
async function checkVersion() {
  let v;
  try { v = await (await fetch(new URL('version.json', self.registration.scope), { cache: 'no-store' })).json(); }
  catch { return cacheName(); }   // offline or no version file: keep what we have
  const names = (await caches.keys()).filter(n => n.startsWith(PREFIX));
  if (v.sw === false) {
    await Promise.all(names.map(n => caches.delete(n)));
    await self.registration.unregister();
    return (current = null);
  }
  const want = PREFIX + v.version;
  await Promise.all(names.filter(n => n !== want).map(n => caches.delete(n)));
  return (current = want);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(checkVersion().then(() => self.clients.claim())));

// Ask the server, not the browser's own cache (GitHub Pages lets it keep files for 10 minutes), so a new deploy is
// seen at once; an unchanged file costs only a 304.
const fresh = req => new Request(req, { cache: 'no-cache' });
async function cacheFirst(req) {
  const name = await cacheName();
  const hit = name && await caches.match(req, { cacheName: name });
  if (hit) return hit;
  const res = await fetch(fresh(req));
  if (name && res.ok && res.status === 200) { const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)); }
  return res;
}
async function networkFirst(req) {
  const name = await cacheName();
  try {
    const res = await fetch(req.mode === 'navigate' ? req : fresh(req));
    if (name && res.ok && res.status === 200) { const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)); }
    return res;
  } catch (err) {
    const hit = name && await caches.match(req, { cacheName: name, ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range') || url.pathname.endsWith('/version.json')) return;
  if (req.mode === 'navigate') { e.respondWith(checkVersion().then(() => networkFirst(req))); return; }
  if (CACHE_FIRST.test(url.pathname)) e.respondWith(cacheFirst(req));
  else if (NETWORK_FIRST.test(url.pathname)) e.respondWith(networkFirst(req));
});
