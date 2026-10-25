// Η κάτω μπάρα «κοντά μου»: βενζίνη, φαγητό, καφές…
// Δείχνει αμέσως ό,τι υπάρχει στο κινητό και συμπληρώνει από το ίντερνετ στο παρασκήνιο.

import { $ } from "./util.js";
import { state, origin } from "./state.js";
import { map, layers, setMode, placeRow, listMessage, fitPadding } from "./ui.js";
import { shortDist } from "./format.js";
import * as POI from "./poi.js";
import { previewDestination } from "./preview.js";
import { freshPosition } from "./gps.js";

const chip = (key) => document.querySelector(`.chip[data-key="${key}"]`);

for (const [key, [label, icon]] of Object.entries(POI.CATS)) {
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.key = key;
  b.innerHTML = `<span>${icon}</span>${label}`;
  b.onclick = () => showNearby(key);
  $("ribbon").appendChild(b);
}
$("places-close").onclick = () => setMode("home");

function render(key, items, loading) {
  const [label, icon] = POI.CATS[key];
  const list = $("places-list");
  const from = origin();
  list.innerHTML = "";
  layers.poi.clearLayers();
  if (!state.pos) listMessage(list, "📍 Με βάση την τελευταία γνωστή θέση σου", "head");
  if (loading) {
    const li = document.createElement("li");
    li.className = "loading";
    li.textContent = items.length ? "Ανανέωση…" : "Ψάχνω…";
    list.appendChild(li);
  }
  if (!items.length) {
    if (!loading) listMessage(list, "Τίποτα εδώ γύρω. Έρημος, ρε!");
    return;
  }
  const pin = L.divIcon({ className: "poi-pin", html: `<div>${icon}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  for (const p of items) {
    const li = placeRow(icon, p.name || label, p.sub, shortDist(p.dist));
    li.onclick = () => previewDestination(p);
    list.appendChild(li);
    L.marker([p.lat, p.lng], { icon: pin }).on("click", () => previewDestination(p)).addTo(layers.poi);
  }
  const bounds = L.latLngBounds(items.slice(0, 8).map((p) => [p.lat, p.lng])).extend([from.lat, from.lng]);
  map.fitBounds(bounds, fitPadding());
}

export async function showNearby(key) {
  const [label, icon] = POI.CATS[key];
  const button = chip(key);
  setMode("places");
  button.classList.add("on");
  button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  $("places-title").textContent = `${icon} ${label} κοντά σου`;

  const stillHere = () => state.mode === "places" && button.classList.contains("on");
  // πρώτα πού είσαι ΤΩΡΑ (όχι πού ήσουν πριν από λίγα λεπτά)
  if (!state.pos || Date.now() - state.lastFix > 30000) {
    listMessage($("places-list"), "Βρίσκω πού είσαι…", "loading");
    await freshPosition();
    if (!stillHere()) return;
  }
  const from = origin();
  if (!from) return listMessage($("places-list"), "📍 Δεν ξέρω πού είσαι. Πάτα το κόκκινο κουμπί για να ενεργοποιήσεις την τοποθεσία.");

  // 1) αμέσως ό,τι υπάρχει στο κινητό (αν η περιοχή δεν έχει κατέβει, μόνο τα πολύ κοντινά)
  const fresh = POI.isFresh(from);
  let items = POI.nearby(key, from, { strict: !fresh });
  const enough = items.length >= 3 || POI.searchedWide(key, from);
  render(key, items, !fresh || !enough);
  if (fresh && enough) return;

  // 2) γρήγορη απάντηση σε ~1″ όσο κατεβαίνει ολόκληρη η περιοχή
  const quick = fresh
    ? Promise.resolve()
    : POI.quick(key, from)
        .then(() => stillHere() && !POI.isFresh(from) && render(key, POI.nearby(key, from, { strict: true }), true))
        .catch(() => {});

  // 3) ολόκληρη η περιοχή, 4) αν είναι ακόμα λίγα, πιο μακριά
  try {
    if (!fresh) await POI.refresh(from, { force: true });
    if (!stillHere()) return;
    if (POI.nearby(key, from).length < 3 && !POI.searchedWide(key, from)) {
      render(key, POI.nearby(key, from), true);
      await POI.searchWide(key, from);
    }
  } catch {
    await quick;
  }
  if (!stillHere()) return;
  items = POI.nearby(key, from);
  if (items.length) render(key, items, false);
  else listMessage($("places-list"), "Δεν βρήκα τίποτα ή δεν απαντάει ο χάρτης. Δοκίμασε ξανά σε λίγο.");
}
