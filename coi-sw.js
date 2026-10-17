/* AVJ RetroPlay · Service Worker de aislamiento (COOP/COEP) · build c
   Permite usar SharedArrayBuffer en hostings que no dejan configurar cabeceras (GitHub Pages).
   Añade las cabeceras necesarias a las respuestas de tu propio sitio. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  const req = r.mode === 'no-cors' ? new Request(r, { credentials: 'omit' }) : r;
  e.respondWith(
    fetch(req, new URL(r.url).origin === self.location.origin ? { cache: 'no-store' } : undefined).then((res) => {
      if (res.status === 0) return res;               // respuesta opaca: no se puede modificar
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy', 'credentialless');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch((err) => { console.error('[coi-sw]', err); return new Response('Error de red', { status: 502 }); })
  );
});
