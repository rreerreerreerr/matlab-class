// Enables cross-origin isolation (needed for SharedArrayBuffer, used by input()/pause)
// on static hosts that cannot set COOP/COEP headers, e.g. GitHub Pages.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (new URL(req.url).origin !== self.location.origin) return;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(fetch(req).then((res) => {
      if (res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  const key = 'coi-reloaded';
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    const reload = () => { if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); location.reload(); } };
    if (navigator.serviceWorker.controller) { reload(); return; }
    (reg.installing || reg.waiting || reg.active)?.addEventListener('statechange', (ev) => { if (ev.target.state === 'activated') reload(); });
    if (reg.active) reload();
  }).catch((e) => console.warn('COI service worker failed:', e));
} else if (window.crossOriginIsolated) {
  sessionStorage.removeItem('coi-reloaded');
}
