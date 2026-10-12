/* FizzFinder offline support.
 * Everything the app needs is a small static file, so we cache them all.
 * Strategy: try the network first so updates show up right away, fall back to the cache when offline.
 * Nothing about the user is stored or sent here; favorites and menus live in localStorage. */
var CACHE = "fizzfinder-v1";
var FILES = [
  "./", "index.html", "menus.js", "manifest.webmanifest",
  "fonts/space-grotesk-500.woff2", "fonts/space-grotesk-700.woff2",
  "fonts/inter-400.woff2", "fonts/inter-500.woff2", "fonts/inter-600.woff2",
  "brand/fizzfinder-compact-dark.svg", "brand/fizzfinder-icon.svg", "brand/fizzfinder-app-icon.svg",
  "brand/favicon-32.png", "brand/apple-touch-icon.png", "brand/icon-192.png", "brand/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
      });
    })
  );
});
