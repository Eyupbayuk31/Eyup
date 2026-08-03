/* İrsaliye Pro — Service Worker
   Strateji: gezinme (HTML) için AĞ ÖNCELİKLİ, varlıklar için önbellek öncelikli.
   Uygulama tek dosya ve sık güncelleniyor; HTML'i önbellekten vermek kullanıcıyı
   eski sürümde bırakır. Bu yüzden HTML her zaman ağdan istenir, ağ yoksa
   önbellekteki son sürüm gösterilir (çevrimdışı çalışsın diye). */
const CACHE = 'irsaliye-v1';
const KABUK = ['/', '/index.html', '/style.css',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const istek = e.request;
  if (istek.method !== 'GET') return;
  const url = new URL(istek.url);
  if (url.origin !== self.location.origin) return;   // CDN/Firebase isteklerine karışma

  // HTML gezinmesi → ağ öncelikli
  if (istek.mode === 'navigate' || (istek.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(istek)
        .then(y => { const kopya = y.clone(); caches.open(CACHE).then(c => c.put(istek, kopya)); return y; })
        .catch(() => caches.match(istek).then(y => y || caches.match('/index.html')))
    );
    return;
  }
  // Diğer aynı-köken varlıklar → önbellek öncelikli, arkada tazele
  e.respondWith(
    caches.match(istek).then(onbellek => {
      const ag = fetch(istek).then(y => {
        if (y && y.status === 200) { const kopya = y.clone(); caches.open(CACHE).then(c => c.put(istek, kopya)); }
        return y;
      }).catch(() => onbellek);
      return onbellek || ag;
    })
  );
});
