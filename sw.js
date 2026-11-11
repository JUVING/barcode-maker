const C = 'bc-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || !r.url.startsWith('http')) return;
  const same = new URL(r.url).origin === location.origin;
  const store = res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; };
  e.respondWith(same
    ? fetch(r, { cache: 'no-cache' }).then(store).catch(() => caches.match(r))                       // 내 파일: 온라인이면 최신, 오프라인이면 저장본
    : caches.match(r).then(h => h || fetch(r, { cache: 'no-cache' }).then(store)));                  // 외부 라이브러리: 한 번 받으면 저장본 사용
});
