// Course Guide Creator — service worker.
// Golf courses are notorious for poor cell signal, so the app shell (HTML/
// CSS/JS/icons) is precached and kept available offline: once a course has
// been loaded and saved to localStorage, re-opening the app, viewing its
// scorecard/verification dashboard, or using the on-course "Play" screen
// keeps working with no connection. Map tiles and the Nominatim/Overpass/
// OpenTopography API calls genuinely need the network (they're either live
// geodata or third-party tiles under their own caching rules), so cross-
// origin requests are left alone entirely rather than intercepted here —
// that avoids ever serving a stale map tile indefinitely from a broken cache.
//
// Same-origin shell files are network-first, falling back to the cache only
// when the fetch itself fails (offline). An earlier cache-first version
// served whatever was cached on first visit forever: since this static site
// has no build step, CACHE_VERSION below never changes between deploys, so
// the browser never even re-runs "install" to refresh the cache — a code
// update would never reach a returning visitor without them manually
// clearing site data. Network-first fixes that (online visitors always get
// the latest code; offline visitors still get the last-cached shell) at the
// cost of one network round-trip per file when online, which is fine for a
// handful of small JS/CSS files.

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
                        (async () => {
                          const cache = await caches.open(CACHE_VERSION);
                          try {
                            const fresh = await fetch(req);
                            if (fresh && fresh.ok) cache.put(req, fresh.clone());
                            return fresh;
                          } catch (e) {
                            const cached = await cache.match(req);
                            return cached || Response.error();
                          }
                        })()
                        );
});
