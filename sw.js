// Service Worker mínimo — habilita instalación como PWA
self.addEventListener('install', function(e) {
  self.skipWaiting();
});
self.addEventListener('activate', function(e) {
  e.waitUntil(clients.claim());
});
// Sin caché offline — siempre carga desde la red
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request));
});
