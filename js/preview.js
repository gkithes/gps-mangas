// Επιλογή διαδρομής: οι εναλλακτικές στον χάρτη, κάρτα με λεπτομέρειες για κάθε μία, «Ξεκίνα».

import { $, escapeHtml } from "./util.js";
import { places, settings, saveSettings } from "./store.js";
import { state, origin } from "./state.js";
import { map, layers, setMode, setDestMarker, fitPadding, toast, listMessage } from "./ui.js";
import { duration, shortDist, clockIn } from "./format.js";
import { fetchRoutes } from "./route.js";
import { startNavigation } from "./nav.js";
import { t } from "./i18n.js";

export async function previewDestination(dest) {
  const want = (state.dest = { lat: +dest.lat, lng: +dest.lng, name: dest.name, sub: dest.sub || "" });
  state.routes = [];
  $("results").innerHTML = "";
  setMode("preview");
  $("preview-title").textContent = want.name;
  $("preview-sub").textContent = want.sub;
  renderFav();
  renderTravel();
  $("go").disabled = true;
  layers.route.clearLayers();
  setDestMarker(want);

  const from = origin();
  if (!from) return listMessage($("route-list"), t("route.noLocation"));
  listMessage($("route-list"), t("route.finding"), "loading");

  let routes;
  try {
    routes = await fetchRoutes(from, want);
  } catch {
    if (state.mode === "preview" && state.dest === want) listMessage($("route-list"), t("route.none"));
    return;
  }
  if (state.mode !== "preview" || state.dest !== want) return; // άλλαξες στο μεταξύ
  state.routes = routes;
  $("go").disabled = false;
  select(0, true);
}

function select(i, fit = false) {
  state.selected = i;
  draw();
  renderCards();
  if (fit) map.fitBounds(L.latLngBounds(state.routes.flatMap((r) => r.coords)), fitPadding());
}

function draw() {
  layers.route.clearLayers();
  // η επιλεγμένη τελευταία, για να φαίνεται από πάνω
  const order = state.routes.map((_, i) => i).filter((i) => i !== state.selected).concat(state.selected);
  for (const i of order) {
    const r = state.routes[i];
    const sel = i === state.selected;
    if (sel) L.polyline(r.coords, { color: "#0b3d91", weight: 11, opacity: 0.9, interactive: false }).addTo(layers.route);
    L.polyline(r.coords, { color: sel ? "#3d8bfd" : "#8e99a8", weight: 7, opacity: sel ? 1 : 0.85, interactive: false }).addTo(layers.route);
    // φαρδιά αόρατη γραμμή, για να πατιέται εύκολα με το δάχτυλο
    L.polyline(r.coords, { opacity: 0, weight: 26 })
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        select(i);
      })
      .addTo(layers.route);
    // ετικέτα χρόνου, σε διαφορετικό σημείο για κάθε διαδρομή
    const at = r.coords[Math.floor(r.coords.length * (0.35 + 0.15 * (i % 3)))];
    L.marker(at, {
      icon: L.divIcon({ className: "route-label" + (sel ? " sel" : ""), html: `<div>${duration(r.duration)}</div>`, iconSize: [0, 0] }),
      zIndexOffset: sel ? 1000 : 0,
    })
      .on("click", () => select(i))
      .addTo(layers.route);
  }
}

export function renderCards() {
  const ul = $("route-list");
  if (!state.routes.length) return;
  ul.innerHTML = "";
  const fastest = state.routes[0].duration;
  state.routes.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "route" + (i === state.selected ? " sel" : "");
    const tag = i === 0 ? `<span class="tag">${t("route.fastest")}</span>` : `<span class="tag slow">${t("route.slower", { n: Math.round((r.duration - fastest) / 60) })}</span>`;
    const car = r.travel !== "walk"; // αυτοκινητόδρομος/διόδια δεν αφορούν πεζούς
    const flags = [
      `<span>${t("route.arrive", { time: clockIn(r.duration) })}</span>`,
      `<span>${r.turns === 1 ? t("route.turn1") : t("route.turns", { n: r.turns })}</span>`,
      car ? `<span>${r.motorway ? t("route.motorway") : t("route.noMotorway")}</span>` : "",
      car ? (r.toll ? `<span class="warn">${t("route.toll")}</span>` : `<span>${t("route.noToll")}</span>`) : "",
      r.ferry ? `<span class="warn">${t("route.ferry")}</span>` : "",
    ].join("");
    li.innerHTML = `
      <div class="line1"><span class="time">${duration(r.duration)}</span><span class="dist">${shortDist(r.distance)}</span>${tag}</div>
      ${r.via ? `<div class="via">${t("route.via", { via: escapeHtml(r.via) })}</div>` : ""}
      <div class="flags">${flags}</div>`;
    li.onclick = () => select(i);
    ul.appendChild(li);
  });
}

// 🚗 / 🚶: αλλάζει και ξαναβρίσκει διαδρομές· το θυμάται για την επόμενη φορά.
function renderTravel() {
  document.querySelectorAll(".travel button").forEach((b) => b.classList.toggle("on", b.dataset.travel === settings.travel));
}
document.querySelectorAll(".travel button").forEach((b) => {
  b.onclick = () => {
    if (settings.travel === b.dataset.travel) return;
    settings.travel = b.dataset.travel;
    saveSettings();
    if (state.dest) previewDestination(state.dest);
  };
});

function renderFav() {
  const fav = !!state.dest && places.isFavorite(state.dest);
  $("preview-fav").textContent = fav ? "★" : "☆";
  $("preview-fav").classList.toggle("on", fav);
}

$("preview-fav").onclick = () => {
  if (!state.dest) return;
  toast(places.toggleFavorite(state.dest) ? t("fav.added") : t("fav.removed"));
  renderFav();
};
$("preview-close").onclick = () => setMode("home");
$("go").onclick = () => {
  if (!state.routes.length) return;
  places.addHistory(state.dest);
  startNavigation(state.routes[state.selected]);
};
