"use strict";

// Cache name, needs updated
const PRECACHE = 'precache-%NAME%';

// A list of local resources we always want to be cached.
const PRECACHE_URLS = [
  "/", // Alias for index.html
"%FILES%"
];

const install = async () => {
  const cache = await caches.open(PRECACHE);
  return cache.addAll(PRECACHE_URLS);
}

const activate = async () => {
  const keys = await caches.keys();
  const toDelete = keys.filter(name => name === PRECACHE);
  await Promise.all(toDelete.map(cacheToDelete => {
    return caches.delete(cacheToDelete);
  }));
  await self.clients.claim();
}

const handleFetch = async (event) => {
  // Ignore cross origin quests
  if (!event.request.url.startsWith(self.location.origin)) {
    console.log("Ignoring cross origin request");
    return;
  }
  let path = event.request.url.slice(self.location.origin.length);
  console.log("PATH IS", path)
  if (path.startsWith("/db/") || path.startsWith("/api/")) {
    console.log("Ignoring /api or /db requests");
    return;
  }

  console.log(`Handling fetch request for ${path}`);
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
}

self.addEventListener('install', e => e.waitUntil(install(e)));
self.addEventListener('activate', e => e.waitUntil(activate(e)));
self.addEventListener('fetch', handleFetch);
