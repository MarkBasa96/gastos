// EMERGENCY ONLY. If a service worker ever strands phones on a broken build, deploy THIS file as
// /sw.js (replace the export's sw.js with it). At each phone's next online open it deletes every
// cache and unregisters itself, and Gastos goes back to plain online loading (Kenshin v3 M9).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url))),
  );
});
