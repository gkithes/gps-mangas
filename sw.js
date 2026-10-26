// Service worker: η εφαρμογή ανοίγει αμέσως από τη μνήμη του κινητού και ενημερώνεται
// στο παρασκήνιο. Κρατάει και τα κομμάτια του χάρτη που έχεις δει.

const VERSION = "v2.3.1";
const APP = `gps-mangas-app-${VERSION}`;
const TILES = "gps-mangas-tiles";
const MAX_TILES = 1500;

const FILES = [
  "./", "index.html", "manifest.json", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "css/app.css",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/NoSleep.min.js",
  ...["main", "config", "util", "store", "state", "format", "net", "recordings", "poi", "route",
    "voice", "phrases", "phrases-world", "i18n", "ui", "nav", "gps", "preview", "nearby", "search", "drawer", "settings-ui"].map((m) => `js/${m}.js`),
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Από τη μνήμη αμέσως, και ανανέωση για την επόμενη φορά.
async function app(req) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || fresh;
}

let tileWrites = 0;
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    if (++tileWrites % 100 === 0) {
      cache.keys().then((keys) => keys.slice(0, Math.max(0, keys.length - MAX_TILES)).forEach((k) => cache.delete(k)));
    }
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) e.respondWith(app(e.request));
  else if (url.hostname.endsWith("tile.openstreetmap.org") || url.hostname === "server.arcgisonline.com") e.respondWith(tile(e.request));
});
