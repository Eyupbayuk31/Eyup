/* İrsaliye Pro — Service Worker
   Strateji: gezinme (HTML) için AĞ ÖNCELİKLİ, varlıklar için önbellek öncelikli.
   Uygulama tek dosya ve sık güncelleniyor; HTML'i önbellekten vermek kullanıcıyı
   eski sürümde bırakır. Bu yüzden HTML her zaman ağdan istenir, ağ yoksa
   önbellekteki son sürüm gösterilir (çevrimdışı çalışsın diye). */
const CACHE = 'irsaliye-v2';
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

// Ne ağ ne önbellek varsa tarayıcının "Bu siteye ulaşılamıyor" sayfası yerine
// sade bir sayfa: bağlantı gelince kendiliğinden yeniden dener.
function cevrimdisiSayfa() {
  const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Bağlantı yok</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font-family:system-ui,sans-serif;background:#111;color:#eee;text-align:center;padding:24px;box-sizing:border-box}'
    + 'button{margin-top:18px;padding:14px 28px;font-size:16px;border:0;border-radius:12px;background:#f5b800;color:#111;font-weight:700}'
    + 'p{color:#aaa;line-height:1.5}</style></head><body><div><h2>Bağlantı kurulamadı</h2>'
    + '<p>İnternet gelince sayfa kendiliğinden açılır.</p><button onclick="location.reload()">Tekrar dene</button></div>'
    + '<script>addEventListener("online",function(){location.reload()});setInterval(function(){if(navigator.onLine)location.reload()},8000)<\/script></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const istek = e.request;
  if (istek.method !== 'GET') return;
  const url = new URL(istek.url);
  // Barkod okuyucu (iPhone/bilgisayar yedeği): sürümü sabit, değişmez dosyalar.
  // Önbellekte tutulur ki atölyede internet yokken de kamera barkodu okusun.
  if (/(^|\.)jsdelivr\.net$/.test(url.hostname) && /\/npm\/(barcode-detector|zxing-wasm)@/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(c => c.match(istek).then(y => y || fetch(istek).then(ag => {
        if (ag && (ag.ok || ag.type === 'opaque')) c.put(istek, ag.clone());
        return ag;
      })))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;   // CDN/Firebase isteklerine karışma

  // HTML ve CSS → ağ öncelikli. style.css her sürümde HTML ile birlikte
  // değişiyor; önbellekten verilince yeni ekranlar eski stille açılıyor
  // (kutular üst üste biniyor, liste kaymıyor). Ağ yoksa önbelleğe düşer.
  const cssMi = url.pathname.endsWith('.css');
  if (cssMi || istek.mode === 'navigate' || (istek.headers.get('accept') || '').includes('text/html')) {
    // Ağ bir kez takılırsa 1,5 sn sonra bir kez daha denenir (telefonda Wi-Fi
    // geçişlerinde ilk istek sık düşüyor).
    const getir = () => fetch(istek).catch(() => new Promise(r => setTimeout(r, 1500)).then(() => fetch(istek)));
    e.respondWith(
      getir()
        .then(y => { const kopya = y.clone(); caches.open(CACHE).then(c => c.put(istek, kopya)); return y; })
        .catch(() => caches.match(istek).then(y => {
          if (y) return y;
          if (cssMi) return Response.error();
          // Uygulama dışı sayfalar (ör. /gamze) çevrimdışıyken uygulama
          // kabuğuna düşmesin — alakasız bir ekran açılıyor.
          const kabukMu = !(url.pathname.replace(/\/+$/, '') !== '' && !url.pathname.endsWith('/index.html')
              && !/^\/(#|$)/.test(url.pathname));
          return (kabukMu ? caches.match('/index.html').then(k => k || caches.match('/')) : Promise.resolve(null))
            .then(k => k || cevrimdisiSayfa());
        }))
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
