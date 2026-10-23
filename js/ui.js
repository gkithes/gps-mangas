// Χάρτης και κοινά κομμάτια της οθόνης: ειδοποιήσεις, κάρτες, φύλλα επιλογών.

import { SERVERS, DEFAULT_VIEW } from "./config.js";
import { $, escapeHtml } from "./util.js";
import { lastPos, settings, saveSettings } from "./store.js";
import { state } from "./state.js";

// ---------- χάρτης ----------

const start = lastPos.value || DEFAULT_VIEW;
export const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([start.lat, start.lng], lastPos.value ? 15 : DEFAULT_VIEW.zoom);
L.control.attribution({ position: "topright", prefix: false }).addTo(map);

// ---------- χάρτης ή δορυφόρος ----------

const BASE = {
  map: L.tileLayer(SERVERS.tiles, { maxZoom: 19, attribution: "&copy; OpenStreetMap" }),
  satellite: L.layerGroup([
    L.tileLayer(SERVERS.satellite, { maxZoom: 19, maxNativeZoom: 18, attribution: "Εικόνες &copy; Esri" }),
    L.tileLayer(SERVERS.satRoads, { maxZoom: 19, maxNativeZoom: 18 }),
    L.tileLayer(SERVERS.satLabels, { maxZoom: 19, maxNativeZoom: 18 }),
  ]),
};

export function setMapStyle(style) {
  if (!BASE[style]) style = "map";
  for (const [k, layer] of Object.entries(BASE)) {
    if (k === style) layer.addTo(map);
    else layer.remove();
  }
  settings.mapStyle = style;
  saveSettings();
  // το κουμπί δείχνει σε τι θα αλλάξει
  $("map-style").textContent = style === "map" ? "🛰" : "🗺";
  $("map-style").setAttribute("aria-label", style === "map" ? "Δορυφόρος" : "Χάρτης");
  $("s-mapstyle").value = style;
}
setMapStyle(settings.mapStyle);
$("map-style").onclick = () => {
  setMapStyle(settings.mapStyle === "map" ? "satellite" : "map");
  toast(settings.mapStyle === "map" ? "Χάρτης" : "Δορυφόρος");
};
$("s-mapstyle").onchange = (e) => setMapStyle(e.target.value);

export const layers = {
  route: L.layerGroup().addTo(map),
  poi: L.layerGroup().addTo(map),
  user: L.circleMarker([0, 0], { radius: 9, color: "#fff", weight: 3, fillColor: "#2a7de1", fillOpacity: 1 }),
  dest: null,
};

const destIcon = L.divIcon({
  className: "dest-pin",
  html: '<svg viewBox="0 0 32 44" width="32" height="44"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z" fill="#e5484d" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5.5" fill="#fff"/></svg>',
  iconSize: [32, 44],
  iconAnchor: [16, 43],
});

export function setDestMarker(p) {
  layers.dest?.remove();
  layers.dest = p ? L.marker([p.lat, p.lng], { icon: destIcon }).addTo(map) : null;
}

export function showUser(pos) {
  layers.user.setLatLng([pos.lat, pos.lng]);
  if (!map.hasLayer(layers.user)) layers.user.addTo(map);
}

// Περιθώρια ώστε ό,τι δείχνουμε να μην κρύβεται κάτω από την αναζήτηση ή τις κάρτες.
export function fitPadding() {
  const top = $("top").getBoundingClientRect().bottom + 20;
  const bottom = window.innerHeight - $("bottom").getBoundingClientRect().top + 20;
  return { paddingTopLeft: [30, top], paddingBottomRight: [30, Math.max(bottom, 40)] };
}

map.on("dragstart", () => {
  if (!state.pos) return;
  state.follow = false;
  $("recenter").hidden = false;
});
map.on("click", () => ($("results").innerHTML = ""));
$("recenter").onclick = () => {
  state.follow = true;
  $("recenter").hidden = true;
  if (state.pos) map.setView([state.pos.lat, state.pos.lng], Math.max(map.getZoom(), 16));
};

// ---------- ποια κάρτα φαίνεται ----------

const modeHooks = [];
export const onModeChange = (fn) => modeHooks.push(fn);

export function setMode(mode) {
  state.mode = mode;
  $("home-panel").hidden = mode !== "home";
  $("places-panel").hidden = mode !== "places";
  $("preview-panel").hidden = mode !== "preview";
  $("navbar").hidden = mode !== "nav";
  $("banner").hidden = mode !== "nav";
  document.body.classList.toggle("navigating", mode === "nav");
  if (mode !== "places") {
    layers.poi.clearLayers();
    document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
  }
  if (mode === "home") {
    layers.route.clearLayers();
    setDestMarker(null);
  }
  modeHooks.forEach((fn) => fn(mode));
}

// ---------- μικρά κομμάτια ----------

export function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($("toast").hidden = true), 2500);
}

export function setStatus(text) {
  $("status").textContent = text || "";
  $("status").hidden = !text;
}

export function placeRow(icon, name, sub, right) {
  const li = document.createElement("li");
  li.innerHTML = `<div class="badge">${icon}</div>
    <div class="body"><div class="name">${escapeHtml(name)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</div>
    ${right ? `<div class="right">${escapeHtml(right)}</div>` : ""}`;
  return li;
}

export function listMessage(ul, text, cls = "empty") {
  ul.innerHTML = "";
  const li = document.createElement("li");
  li.className = cls;
  li.textContent = text;
  ul.appendChild(li);
}

// Φύλλο επιλογών από κάτω: τίτλος (ή κείμενο) και κουμπιά.
export function openActions({ title, html }, buttons) {
  if (html) $("actions-title").innerHTML = html;
  else $("actions-title").textContent = title;
  const box = $("actions-buttons");
  box.innerHTML = "";
  for (const { label, danger, fn } of buttons) {
    const b = document.createElement("button");
    b.className = "pill" + (danger ? " danger" : "");
    b.textContent = label;
    b.onclick = () => {
      $("actions").hidden = true;
      fn();
    };
    box.appendChild(b);
  }
  $("actions").hidden = false;
}
$("actions-cancel").onclick = () => ($("actions").hidden = true);
$("actions").onclick = (e) => {
  if (e.target === $("actions")) $("actions").hidden = true;
};

// Το iPhone να μη μεγεθύνει τη σελίδα με τσίμπημα (ο χάρτης ζουμάρει κανονικά).
document.addEventListener("gesturestart", (e) => e.preventDefault());
