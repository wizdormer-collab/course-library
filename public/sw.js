const CACHE_NAME = "courselib-v32";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/schools.json"
];

const CACHEABLE_API = [
  "/api/courses",
  "/api/me",
  "/api/files/progress",
  "/api/auth/reminders",
  "/api/notifications"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    if (event.request.method !== "GET") return;
    const canCache = CACHEABLE_API.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
    if (!canCache) return;
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cache.match(event.request))
      )
    );
    return;
  }
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
