// Service worker: η εφαρμογή ανοίγει αμέσως από τη μνήμη του κινητού
// και ενημερώνεται στο παρασκήνιο. Κρατάει και τα κομμάτια του χάρτη που έχεις δει.
const CACHE = "gps-mangas-v5";
const TILES = "gps-mangas-tiles";
const MAX_TILES = 1500;
const FILES = ["./", "index.html", "style.css", "app.js", "phrases.js", "recordings.js", "places.js", "poi.js", "net.js", "vendor/NoSleep.min.js", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "manifest.json", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Από τη μνήμη αμέσως, και ταυτόχρονα ανανέωση για την επόμενη φορά.
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req, { ignoreSearch: true }).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    })
  );
}

let tileWrites = 0;
function tile(req) {
  return caches.open(TILES).then((cache) =>
    cache.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            cache.put(req, res.clone());
            if (++tileWrites % 100 === 0) trimTiles(cache);
          }
          return res;
        })
    )
  );
}

function trimTiles(cache) {
  cache.keys().then((keys) => {
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) cache.delete(keys[i]);
  });
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(e.request));
  } else if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith(tile(e.request));
  }
});
