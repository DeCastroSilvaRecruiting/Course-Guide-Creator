// Course Guide Creator — service worker.
// Golf courses are notorious for poor cell signal, so the app shell (HTML/
// CSS/JS/icons) is precached and served cache-first: once a course has been
// loaded and saved to localStorage, re-opening the app, viewing its
// scorecard/verification dashboard, or using the on-course "Play" screen
// keeps working with no connection. Map tiles and the Nominatim/Overpass/
// OpenTopography API calls genuinely need the network (they're either live
// geodata or third-party tiles under their own caching rules), so cross-
// origin requests are left alone entirely rather than intercepted here —
// that avoids ever serving a stale map tile indefinitely from a broken cache.

const CACHE_VERSION = "cgc-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./hole-builder.html",
  "./play.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/storage.js",
  "./js/geocode.js",
  "./js/elevation.js",
  "./js/maps.js",
  "./js/scorecard.js",
  "./js/verification.js",
  "./js/app.js",
  "./js/hole-builder.js",
  "./js/play.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (maps/APIs)

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return cached || Response.error();
      }
    })
  );
});
