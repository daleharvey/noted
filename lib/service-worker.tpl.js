"use strict";

// Copied mostly from
// https://googlechrome.github.io/samples/service-worker/basic/
// Removed the runtime cache as I only want static assets cached
// and used async functions

// Cache name, needs updated
const PRECACHE = 'precache-%NAME%';

// A list of local resources we always want to be cached.
const PRECACHE_URLS = [
  "/", // Alias for index.html
"%FILES%"
];

const install = async () => {
  console.log("SW: Installing ...");
  const cache = await caches.open(PRECACHE);
  await cache.addAll(PRECACHE_URLS);
  await self.skipWaiting()
  console.log("SW: Done installing ...");
}

const activate = async () => {
  console.log("SW: Activating ...");
  const keys = await caches.keys();
  const toDelete = keys.filter(name => name != PRECACHE);
  await Promise.all(toDelete.map(cache => caches.delete(cache)));
  await self.clients.claim();
  console.log("SW: Done activating ...");
}

const handleFetch = async (event) => {
  // Ignore cross origin quests
  if (!event.request.url.startsWith(self.location.origin)) {
    console.log("SW: Ignoring cross origin request");
    return;
  }

  // Ignore database or api requests
  let path = event.request.url.slice(self.location.origin.length);
  if (path.startsWith("/db/") || path.startsWith("/api/")) {
    console.log("SW: Ignoring /api or /db requests");
    return;
  }

  console.log(`SW: Handling fetch request for ${path}`);
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
}

self.addEventListener('install', e => e.waitUntil(install(e)));
self.addEventListener('activate', e => e.waitUntil(activate(e)));
self.addEventListener('fetch', handleFetch);
