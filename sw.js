const CACHE_NAME = "food-stall-shell-v6";
const SHELL = [
  "./stall.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/app-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Always prefer the latest deployed page and scripts. Use cached files only
  // when the device is offline, so fixes are not hidden by an old app shell.
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() =>
      caches.match(request).then(cached =>
        cached || (request.mode === "navigate" ? caches.match("./stall.html") : Response.error())
      )
    )
  );
});
