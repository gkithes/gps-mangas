// Η κάτω μπάρα «κοντά μου»: βενζίνη, φαγητό, καφές…
// Δείχνει αμέσως ό,τι υπάρχει στο κινητό και συμπληρώνει από το ίντερνετ στο παρασκήνιο.

import { $, haversine } from "./util.js";
import { state, origin } from "./state.js";
import { map, layers, setMode, placeRow, listMessage, fitPadding } from "./ui.js";
import { shortDist } from "./format.js";
import * as POI from "./poi.js";
import { previewDestination } from "./preview.js";
import { freshPosition } from "./gps.js";
import { t } from "./i18n.js";

const chip = (key) => document.querySelector(`.chip[data-key="${key}"]`);

for (const [key, [, icon]] of Object.entries(POI.CATS)) {
  const label = POI.catLabel(key);
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.key = key;
  b.innerHTML = `<span>${icon}</span>${label}`;
  b.onclick = () => showNearby(key);
  $("ribbon").appendChild(b);
}
$("places-close").onclick = () => setMode("home");

function render(key, items, loading) {
  const icon = POI.CATS[key][1];
  const label = POI.catLabel(key);
  const list = $("places-list");
  const from = origin();
  list.innerHTML = "";
  layers.poi.clearLayers();
  if (!state.pos) listMessage(list, t("near.lastKnown"), "head");
  if (loading) {
    const li = document.createElement("li");
    li.className = "loading";
    li.textContent = items.length ? t("near.refreshing") : t("near.searching");
    list.appendChild(li);
  }
  if (!items.length) {
    if (!loading) listMessage(list, t("near.none"));
    return;
  }
  const pin = L.divIcon({ className: "poi-pin", html: `<div data-key="${key}">${icon}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  for (const p of items) {
    const li = placeRow(icon, p.name || label, p.sub, shortDist(p.dist));
    li.onclick = () => previewDestination(p);
    list.appendChild(li);
    L.marker([p.lat, p.lng], { icon: pin }).on("click", () => previewDestination(p)).addTo(layers.poi);
  }
  const bounds = L.latLngBounds(items.slice(0, 8).map((p) => [p.lat, p.lng])).extend([from.lat, from.lng]);
  map.fitBounds(bounds, fitPadding());
}

// Αν η λίστα είναι ανοιχτή και μετακινηθείς πάνω από ~250 μ, ξαναβγαίνει από τη νέα θέση.
// (και μόλις έρθει το πρώτο GPS, αν η λίστα βγήκε από την τελευταία γνωστή θέση)
let shown = null; // { key, lat, lng, approx }
export function nearbyFollow(pos) {
  if (state.mode !== "places" || !shown || state.navigating) return;
  if (shown.approx || haversine([shown.lat, shown.lng], [pos.lat, pos.lng]) > 250) showNearby(shown.key);
}

export async function showNearby(key) {
  const icon = POI.CATS[key][1];
  const label = POI.catLabel(key);
  const button = chip(key);
  setMode("places");
  button.classList.add("on");
  button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  $("places-title").textContent = t("near.title", { icon, label });
  $("places-panel").dataset.key = key; // χρώμα της κατηγορίας στην κεφαλίδα

  const stillHere = () => state.mode === "places" && button.classList.contains("on");
  // Πού είσαι: δείχνουμε αμέσως από την πιο πρόσφατη θέση που ξέρουμε και ζητάμε καινούργια
  // στο παρασκήνιο — αν έχεις μετακινηθεί, η λίστα ξαναβγαίνει μόνη της (nearbyFollow).
  // Περιμένουμε το GPS μόνο αν δεν ξέρουμε καθόλου πού είσαι.
  if (!state.pos || Date.now() - state.lastFix > 30000) {
    if (origin()) freshPosition();
    else {
      listMessage($("places-list"), t("near.findingYou"), "loading");
      await freshPosition();
      if (!stillHere()) return;
    }
  }
  const from = origin();
  if (!from) return listMessage($("places-list"), t("near.noLocation"));
  shown = { key, lat: from.lat, lng: from.lng, approx: !state.pos };

  // 1) αμέσως ό,τι υπάρχει στο κινητό (αν η περιοχή δεν έχει κατέβει, μόνο τα πολύ κοντινά)
  const fresh = POI.isFresh(from);
  let items = POI.nearby(key, from, { strict: !fresh });
  const enough = items.length >= 3 || POI.searchedWide(key, from);
  render(key, items, !fresh || !enough);
  if (fresh && enough) return;

  // 2) γρήγορη απάντηση σε ~1″ όσο κατεβαίνει ολόκληρη η περιοχή:
  //    μόνο αυτή η κατηγορία και μόνο κοντά σου (Overpass), και παράλληλα το Nominatim
  let finished = false;
  const strict = () => !POI.isFresh(from);
  const early = () => stillHere() && !finished && render(key, POI.nearby(key, from, { strict: strict() }), true);
  const quickOnes = () => Promise.all([POI.fast(key, from), POI.quick(key, from)].map((p) => p.then(early).catch(() => {})));
  // (πάρκινγκ/τουαλέτες δεν είναι στο κατέβασμα της περιοχής, οπότε πάντα γρήγορη αναζήτηση)
  const quick = fresh && POI.inFull(key) ? Promise.resolve() : quickOnes();

  // 3) ολόκληρη η περιοχή, 4) αν είναι ακόμα λίγα, πιο μακριά
  try {
    if (!fresh) await POI.refresh(from, { force: true });
    else await quick;
    if (!stillHere()) return;
    if (POI.nearby(key, from).length < 3 && !POI.searchedWide(key, from)) {
      render(key, POI.nearby(key, from), true);
      await POI.searchWide(key, from);
    }
  } catch {
    await quick;
  }
  if (!stillHere()) return;
  // τίποτα ακόμα; μία τελευταία γρήγορη προσπάθεια πριν πούμε «δεν βρέθηκε»
  if (!POI.nearby(key, from, { strict: strict() }).length) await POI.fast(key, from).catch(() => {});
  finished = true;
  if (!stillHere()) return;
  items = POI.nearby(key, from, { strict: strict() });
  if (items.length) render(key, items, false);
  else listMessage($("places-list"), t("near.failed"));
}
