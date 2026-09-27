// Gastos service worker (v3): keeps a copy of the app's own files so it opens with no signal.
// Rules from Kenshin's v3 review (M9, M10):
//  - Only this site's own GET requests. Supabase, Turnstile and the exchange-rate sites are never
//    touched, so no account data, token or API answer ever lands in the cache.
//  - Page loads try the network first (3 s), so a fixed build reaches everyone at their next open.
//  - The files are cached as one all-or-nothing set per build. scripts/write-sw.mjs fills in the
//    list and the version after `expo export`; this file is not usable before that.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = 'gastos-shell-' + VERSION;
const SHELL = new Set(PRECACHE.filter((p) => !/^\/(_expo|assets)\//.test(p)));

self.addEventListener('install', (e) => {
  // addAll is all-or-nothing: a half-downloaded build can never become the active one.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gastos-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

async function networkFirst(req, ms) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
    // Only the start page becomes the offline copy; a direct visit to another file must not replace it (audit L-7).
    if (cacheable(res) && new URL(req.url).pathname === '/') cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (cacheable(res)) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return; // POST/PATCH (Supabase, RPCs) are never touched
  if (url.origin !== self.location.origin) return; // Supabase, Turnstile, rates: straight to the network
  if (url.pathname.startsWith('/.well-known/')) return; // Android app link check: always live
  if (url.pathname === '/sw.js') return;
  if (url.search) return; // nothing with a query string is ever cached
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, 3000));
  if (/^\/(_expo\/static\/|assets\/)/.test(url.pathname)) return e.respondWith(cacheFirst(req)); // hashed files
  if (SHELL.has(url.pathname)) return e.respondWith(staleWhileRevalidate(req)); // manifest, icons, favicon
  // anything else: not handled, normal network
});
