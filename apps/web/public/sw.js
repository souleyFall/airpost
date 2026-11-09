/*
 * Service worker d'airpost : rend l'application installable et garde en mémoire seulement la COQUILLE
 * (page d'index, icônes, fichiers de l'interface). Règle de sécurité : jamais une réponse de l'API
 * (/api) ni aucune donnée personnelle n'est mise en cache ; hors ligne, l'interface s'ouvre mais ses
 * données ne s'affichent pas.
 */
const CACHE = 'airpost-shell-v1';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Seulement les lectures de notre propre origine, jamais l'API.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }
  // Réseau d'abord (toujours la dernière version) ; le cache ne sert qu'hors ligne.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Navigation hors ligne : l'index de l'application (le routeur affichera l'écran demandé).
        if (request.mode === 'navigate') return caches.match('/');
        return Response.error();
      }),
  );
});
