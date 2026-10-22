// GPS Μάγκας — πλοήγηση με ατάκες.
// Χάρτης: OpenStreetMap, διαδρομές: OSRM, αναζήτηση: Nominatim, κοντινά μέρη: Overpass,
// φωνή: Web Speech (el-GR).

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

const ANNOUNCE_FAR_M = 250;   // "Σε 200 μέτρα..."
const ANNOUNCE_NEAR_M = 45;   // εδώ πέφτει η ατάκα
const OFF_ROUTE_M = 60;
const IDLE_SECONDS = 90;

const CATEGORIES = {
  start: "Ξεκίνημα",
  left: "Αριστερά",
  right: "Δεξιά",
  straight: "Ευθεία",
  uturn: "Αναστροφή",
  roundabout: "Κυκλικός κόμβος",
  highway: "Εθνική / ράμπες",
  recalc: "Λάθος δρόμος",
  speeding: "Τρέχεις",
  idle: "Ακινησία",
  arrive: "Άφιξη",
};

// Κουμπιά «κοντά μου» στην κάτω μπάρα: [όνομα, εικονίδιο, φίλτρα OpenStreetMap]
const NEARBY = {
  fuel: ["Βενζίνη", "⛽", ['["amenity"="fuel"]']],
  food: ["Φαγητό", "🍽", ['["amenity"~"^(restaurant|fast_food)$"]']],
  cafe: ["Καφές", "☕", ['["amenity"="cafe"]']],
  market: ["Σούπερ μάρκετ", "🛒", ['["shop"~"^(supermarket|convenience)$"]']],
  pharmacy: ["Φαρμακείο", "💊", ['["amenity"="pharmacy"]']],
  parking: ["Πάρκινγκ", "🅿️", ['["amenity"="parking"]']],
  atm: ["ATM", "🏧", ['["amenity"~"^(atm|bank)$"]']],
  ev: ["Φόρτιση EV", "🔌", ['["amenity"="charging_station"]']],
  hotel: ["Ξενοδοχείο", "🏨", ['["tourism"~"^(hotel|motel|guest_house)$"]']],
  hospital: ["Νοσοκομείο", "🏥", ['["amenity"~"^(hospital|clinic)$"]']],
  carwash: ["Πλυντήριο", "🧽", ['["amenity"="car_wash"]']],
  repair: ["Συνεργείο", "🔧", ['["shop"~"^(car_repair|tyres)$"]']],
  wc: ["Τουαλέτα", "🚻", ['["amenity"="toilets"]']],
};

const $ = (id) => document.getElementById(id);

// Το iPhone να μη μεγεθύνει τη σελίδα με τσίμπημα (ο χάρτης ζουμάρει κανονικά).
document.addEventListener("gesturestart", (e) => e.preventDefault());

// ---------- ρυθμίσεις ----------

const DEFAULTS = {
  units: "auto",    // auto | km | mi
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  mode: "both",     // both | quips | plain | mute
  lang: "el",       // el | pnt | mix
  chime: true,
  speedLimit: 120,  // πάντα σε χλμ/ώρα
  myAudio: "mix",   // mix | only | off
  drawerOpen: false,
  drawerTab: "history",
};

const settings = { ...DEFAULTS };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("gps-mangas-settings") || "{}"));
} catch {}

function saveSettings() {
  try {
    localStorage.setItem("gps-mangas-settings", JSON.stringify(settings));
  } catch {}
}

// ---------- μονάδες ----------

function useMiles() {
  if (settings.units === "mi") return true;
  if (settings.units === "km") return false;
  return /^(en-(US|LR|GB)|my)/i.test(navigator.language || "");
}

// Για τη φωνή.
function fmtDist(m) {
  if (useMiles()) {
    if (m < 160) return Math.round((m * 3.281) / 50) * 50 + " πόδια";
    return (m / 1609.34).toFixed(1).replace(".", ",") + " μίλια";
  }
  if (m >= 1000) return (m / 1000).toFixed(1).replace(".", ",") + " χιλιόμετρα";
  return Math.round(m / 10) * 10 + " μέτρα";
}

// Για την οθόνη.
function fmtShort(m) {
  if (useMiles()) {
    if (m < 160) return Math.round((m * 3.281) / 10) * 10 + " ft";
    const mi = m / 1609.34;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
  }
  if (m >= 1000) return (m < 10000 ? (m / 1000).toFixed(1).replace(".", ",") : Math.round(m / 1000)) + " χλμ";
  return Math.round(m / 10) * 10 + " μ";
}

function fmtDuration(secs) {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} λεπ.`;
  return `${Math.floor(mins / 60)} ώρ. ${mins % 60} λεπ.`;
}

function fmtClock(secsFromNow) {
  return new Date(Date.now() + secsFromNow * 1000).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
}

// ---------- χάρτης ----------

const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([37.9838, 23.7275], 13);
L.control.attribution({ position: "topright", prefix: false }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const userMarker = L.circleMarker([0, 0], {
  radius: 9, color: "#fff", weight: 3, fillColor: "#2a7de1", fillOpacity: 1,
});
const destIcon = L.divIcon({
  className: "dest-pin",
  html: '<svg viewBox="0 0 32 44" width="32" height="44"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z" fill="#e5484d" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5.5" fill="#fff"/></svg>',
  iconSize: [32, 44],
  iconAnchor: [16, 43],
});
let destMarker = null;
const routeLayer = L.layerGroup().addTo(map);
const poiLayer = L.layerGroup().addTo(map);

const state = {
  mode: "home",       // home | places | preview | nav
  pos: null,          // { lat, lng, speed (m/s) | null, accuracy }
  dest: null,         // { lat, lng, name, sub }
  routes: [],         // εναλλακτικές διαδρομές στην προεπισκόπηση
  selected: 0,
  route: null,        // η διαδρομή της πλοήγησης: { coords, steps, distance, duration, ... }
  next: 0,            // index of the next maneuver in route.steps
  announced: { far: false, near: false },
  minDist: Infinity,
  offCount: 0,
  lastReroute: 0,
  lastSpeedWarn: 0,
  stillSince: null,
  lastIdleWarn: 0,
  navigating: false,
  follow: true,
  simTimer: null,
  wakeLock: null,
  lastPicked: {},
};

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

function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($("toast").hidden = true), 2500);
}

// Ποια κάρτα φαίνεται κάτω: αρχική, κοντινά, επιλογή διαδρομής ή πλοήγηση.
function setMode(mode) {
  state.mode = mode;
  $("home-panel").hidden = mode !== "home";
  $("places-panel").hidden = mode !== "places";
  $("preview-panel").hidden = mode !== "preview";
  $("navbar").hidden = mode !== "nav";
  $("banner").hidden = mode !== "nav";
  document.body.classList.toggle("navigating", mode === "nav");
  if (mode !== "places") {
    poiLayer.clearLayers();
    document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
  }
  if (mode === "home") {
    routeLayer.clearLayers();
    if (destMarker) destMarker.remove();
    destMarker = null;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- ήχος ----------

let audioCtx = null;
const player = new Audio();
player.playsInline = true;

// Το iPhone παίζει ήχο μόνο αφού ο χρήστης αγγίξει κάτι. Ξεκλειδώνουμε με το πρώτο άγγιγμα.
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {}
  player.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  player.play().catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  document.removeEventListener("pointerdown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);

function chime() {
  if (!settings.chime || !audioCtx) return;
  const t = audioCtx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.12);
    g.gain.linearRampToValueAtTime(0.25 * settings.volume, t + i * 0.12 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(t + i * 0.12);
    o.stop(t + i * 0.12 + 0.3);
  });
}

let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $("s-voice");
  const greek = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("el"));
  const others = voices.filter((v) => !greek.includes(v));
  sel.innerHTML = '<option value="">Αυτόματα (ελληνική)</option>';
  const addGroup = (label, list) => {
    if (!list.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const v of list) {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  addGroup("Ελληνικές", greek);
  addGroup("Άλλες γλώσσες", others);
  sel.value = settings.voiceURI;
  if (sel.value !== settings.voiceURI) sel.value = "";
  $("voice-hint").hidden = greek.length > 1;
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function currentVoice() {
  return (
    voices.find((v) => v.voiceURI === settings.voiceURI) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("el")) ||
    null
  );
}

function stopSound() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  player.pause();
}

function speak(text, interrupt = false) {
  if (settings.mode === "mute" || !text || !("speechSynthesis" in window)) return;
  if (interrupt) stopSound();
  chime();
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  u.lang = v ? v.lang : "el-GR";
  if (v) u.voice = v;
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  u.volume = settings.volume;
  speechSynthesis.speak(u);
}

function playClip(clip, interrupt = true) {
  if (settings.mode === "mute") return;
  if (interrupt) stopSound();
  chime();
  if (player.dataset.url) URL.revokeObjectURL(player.dataset.url);
  const url = URL.createObjectURL(clip.blob);
  player.dataset.url = url;
  player.src = url;
  player.volume = settings.volume;
  setTimeout(() => player.play().catch(() => {}), settings.chime ? 350 : 0);
}

// ---------- ατάκες ----------

// Διαλέγει ατάκα: γραπτή (θα τη διαβάσει η φωνή) ή δική σου ηχογράφηση.
function pick(category) {
  const set = window.PHRASES[category] || { el: [] };
  let texts;
  if (settings.lang === "mix") texts = [...(set.el || []), ...(set.pnt || [])];
  else texts = set[settings.lang] && set[settings.lang].length ? set[settings.lang] : set.el || [];

  const clips = settings.myAudio === "off" ? [] : Recordings.forCategory(category);
  let pool;
  if (settings.myAudio === "only" && clips.length) pool = clips.map((c) => ({ clip: c }));
  else pool = [...texts.map((t) => ({ text: t })), ...clips.map((c) => ({ clip: c }))];
  if (!pool.length) return { text: "" };

  let p;
  do {
    p = pool[Math.floor(Math.random() * pool.length)];
  } while (pool.length > 1 && (p.text || p.clip.id) === state.lastPicked[category]);
  state.lastPicked[category] = p.text || p.clip.id;
  return p;
}

// Λέει την ατάκα της κατηγορίας. Στο «σοβαρό» λέει μόνο την κανονική οδηγία.
// Επιστρέφει το κείμενο που δείχνει η κάρτα.
function quip(category, plainText, interrupt = true) {
  if (settings.mode === "plain") {
    if (plainText) speak(plainText, interrupt);
    return "";
  }
  const p = pick(category);
  if (p.clip) {
    playClip(p.clip, interrupt);
    return "🎙 " + (p.clip.name || CATEGORIES[category]);
  }
  speak(p.text, interrupt);
  return p.text;
}

// ---------- γεωμετρία ----------

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Απόσταση σημείου από τη διαδρομή (σε μέτρα), με τοπική επίπεδη προβολή.
function distanceToRoute(p, coords) {
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][1] - p[1]) * kx, ay = (coords[i][0] - p[0]) * ky;
    const bx = (coords[i + 1][1] - p[1]) * kx, by = (coords[i + 1][0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

// ---------- οδηγίες ----------

const MOD = {
  left: "αριστερά",
  right: "δεξιά",
  "slight left": "ελαφρώς αριστερά",
  "slight right": "ελαφρώς δεξιά",
  "sharp left": "απότομα αριστερά",
  "sharp right": "απότομα δεξιά",
  straight: "ευθεία",
  uturn: "αναστροφή",
};

const ANGLE = {
  straight: 0, "slight right": 45, right: 90, "sharp right": 135,
  "slight left": -45, left: -90, "sharp left": -135,
};

function category(step) {
  const t = step.type, m = step.modifier || "";
  if (t === "arrive") return "arrive";
  if (t.includes("roundabout") || t.includes("rotary")) return "roundabout";
  if (m === "uturn") return "uturn";
  if (t === "on ramp" || t === "off ramp" || t === "merge") return "highway";
  if (m.includes("left")) return "left";
  if (m.includes("right")) return "right";
  return "straight";
}

function instruction(step) {
  const m = MOD[step.modifier] || "";
  const onto = step.name ? `, προς ${step.name}` : "";
  switch (step.type) {
    case "arrive": return "Έφτασες στον προορισμό";
    case "roundabout":
    case "rotary":
      return step.exit ? `Στον κυκλικό κόμβο, πάρε την ${step.exit}η έξοδο${onto}` : `Μπες στον κυκλικό κόμβο${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Βγες από τον κυκλικό κόμβο${onto}`;
    case "on ramp": return `Μπες στη ράμπα ${m}${onto}`.trim();
    case "off ramp": return `Πάρε την έξοδο ${m}${onto}`.trim();
    case "merge": return `Μπες στην κυκλοφορία ${m}${onto}`.trim();
    default:
      if (step.modifier === "uturn") return "Κάνε αναστροφή";
      if (step.modifier === "straight") return `Συνέχισε ευθεία${onto}`;
      return `Στρίψε ${m}${onto}`;
  }
}

// Εικονίδιο βέλους για την κάρτα.
function arrowSvg(step) {
  const s = 'fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"';
  if (!step) return "";
  if (step.type === "arrive")
    return `<path d="M14 42V8M14 9h20l-5 7 5 7H14" ${s}/>`;
  if (step.type.includes("roundabout") || step.type.includes("rotary"))
    return `<circle cx="24" cy="20" r="8" ${s}/><path d="M24 44V28M30 14l6-6M30 8h6v6" ${s}/>`;
  if (step.modifier === "uturn")
    return `<path d="M30 42V18a8 8 0 0 0-16 0v10M8 22l6 7 6-7" ${s}/>`;
  const a = ANGLE[step.modifier] || 0;
  return `<g transform="rotate(${a} 24 26)"><path d="M24 44V8M13 19L24 8l11 11" ${s}/></g>`;
}

// ---------- αναζήτηση ----------

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("dest").value.trim();
  // Η μπάρα αδειάζει εντελώς μόλις πατηθεί «Πάμε».
  $("dest").value = "";
  $("dest").blur();
  if (!q) return;
  const params = new URLSearchParams({ q, format: "json", limit: "8", "accept-language": "el" });
  const from = origin();
  const d = 1.5;
  params.set("viewbox", [from.lng - d, from.lat + d, from.lng + d, from.lat - d].join(","));
  const list = $("results");
  list.innerHTML = `<li class="head">Ψάχνω «${escapeHtml(q)}»…</li>`;
  try {
    const res = await fetch(`${NOMINATIM}?${params}`);
    const data = await res.json();
    if (!data.length) {
      list.innerHTML = `<li class="empty">Δεν βρήκα «${escapeHtml(q)}». Γράψ' το σωστά, ρε!</li>`;
      return;
    }
    list.innerHTML = `<li class="head">Αποτελέσματα για «${escapeHtml(q)}»</li>`;
    for (const r of data) {
      const [first, ...rest] = r.display_name.split(",");
      const place = { lat: +r.lat, lng: +r.lon, name: first.trim(), sub: rest.join(",").trim() };
      const dist = haversine([from.lat, from.lng], [place.lat, place.lng]);
      const li = placeRow("📍", place.name, place.sub, fmtShort(dist));
      li.onclick = () => {
        list.innerHTML = "";
        previewDestination(place);
      };
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = '<li class="empty">Δεν έχει ίντερνετ; Ούτε κι εγώ.</li>';
  }
});

function placeRow(icon, name, sub, right) {
  const li = document.createElement("li");
  li.innerHTML = `<div class="badge">${icon}</div>
    <div class="body"><div class="name">${escapeHtml(name)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</div>
    ${right ? `<div class="right">${escapeHtml(right)}</div>` : ""}`;
  return li;
}

// ---------- κοντινά μέρη (κάτω μπάρα) ----------

for (const [key, [label, icon]] of Object.entries(NEARBY)) {
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.key = key;
  b.innerHTML = `<span>${icon}</span>${label}`;
  b.onclick = () => searchNearby(key, b);
  $("ribbon").appendChild(b);
}

async function overpass(filters, from, radius) {
  const parts = filters.map((f) => `nwr${f}(around:${radius},${from.lat},${from.lng});`).join("");
  const query = `[out:json][timeout:20];(${parts});out center 150;`;
  const res = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: query }) });
  if (!res.ok) throw new Error("overpass " + res.status);
  return (await res.json()).elements || [];
}

function describePoi(tags, name) {
  const bits = [];
  if (tags.brand && tags.brand !== name) bits.push(tags.brand);
  if (tags.cuisine) bits.push(tags.cuisine.split(";").slice(0, 2).join(", ").replace(/_/g, " "));
  if (tags.opening_hours) bits.push(tags.opening_hours === "24/7" ? "Ανοιχτό 24ω" : tags.opening_hours);
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  if (street) bits.push(street);
  return bits.join(" · ");
}

async function searchNearby(key, chip) {
  const [label, icon, filters] = NEARBY[key];
  setMode("places");
  chip.classList.add("on");
  chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  $("places-title").textContent = `${icon} ${label} κοντά σου`;
  const list = $("places-list");
  list.innerHTML = '<li class="empty">Ψάχνω…</li>';
  const from = origin();
  let found = [];
  try {
    for (const radius of [2500, 10000, 30000]) {
      found = await overpass(filters, from, radius);
      if (found.length >= 5) break;
    }
  } catch {
    if (state.mode === "places") list.innerHTML = '<li class="empty">Δεν απαντάει ο χάρτης. Δοκίμασε ξανά σε λίγο.</li>';
    return;
  }
  if (state.mode !== "places" || !chip.classList.contains("on")) return; // άλλαξε στο μεταξύ

  const items = found
    .map((el) => {
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
      if (lat == null) return null;
      const tags = el.tags || {};
      const name = tags.name || tags.brand || label;
      return {
        lat, lng, name,
        sub: describePoi(tags, name),
        dist: haversine([from.lat, from.lng], [lat, lng]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 25);

  poiLayer.clearLayers();
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = '<li class="empty">Τίποτα εδώ γύρω. Έρημος, ρε!</li>';
    return;
  }
  const poiIcon = L.divIcon({ className: "poi-pin", html: `<div>${icon}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  for (const p of items) {
    const li = placeRow(icon, p.name, p.sub, fmtShort(p.dist));
    li.onclick = () => previewDestination(p);
    list.appendChild(li);
    L.marker([p.lat, p.lng], { icon: poiIcon }).on("click", () => previewDestination(p)).addTo(poiLayer);
  }
  const bounds = L.latLngBounds(items.slice(0, 8).map((p) => [p.lat, p.lng])).extend([from.lat, from.lng]);
  map.fitBounds(bounds, fitPadding());
}

$("places-close").onclick = () => setMode("home");

// Περιθώρια ώστε ό,τι δείχνουμε να μην κρύβεται κάτω από την αναζήτηση ή τις κάρτες.
function fitPadding() {
  const top = $("top").getBoundingClientRect().bottom + 20;
  const bottom = window.innerHeight - $("bottom").getBoundingClientRect().top + 20;
  return { paddingTopLeft: [30, top], paddingBottomRight: [30, Math.max(bottom, 40)] };
}

// ---------- πρόσφατα & αγαπημένα ----------

function renderDrawer() {
  const open = settings.drawerOpen;
  $("drawer").classList.toggle("open", open);
  $("drawer-body").hidden = !open;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === settings.drawerTab));
  if (!open) return;
  const listName = settings.drawerTab;
  const items = listName === "history" ? Places.history() : Places.favorites();
  const ul = $("saved-list");
  ul.innerHTML = "";
  if (!items.length) {
    ul.innerHTML = `<li class="empty">${listName === "history" ? "Δεν έχεις πάει πουθενά ακόμα." : "Πάτα ⋯ σε έναν προορισμό ή ☆ στη διαδρομή για να μπει εδώ."}</li>`;
    return;
  }
  for (const p of items) {
    const icon = Places.isFavorite(p) ? "★" : "🕘";
    const right = state.pos ? fmtShort(haversine([state.pos.lat, state.pos.lng], [p.lat, p.lng])) : "";
    const li = placeRow(icon, p.name, p.sub, right);
    const more = document.createElement("button");
    more.className = "more";
    more.setAttribute("aria-label", "Επιλογές");
    more.textContent = "⋯";
    more.onclick = (e) => {
      e.stopPropagation();
      placeActions(listName, p);
    };
    li.appendChild(more);
    li.onclick = () => previewDestination(p);
    ul.appendChild(li);
  }
}

$("drawer-toggle").onclick = () => {
  settings.drawerOpen = !settings.drawerOpen;
  saveSettings();
  renderDrawer();
};
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    settings.drawerTab = b.dataset.tab;
    saveSettings();
    renderDrawer();
  };
});

function openActions(title, buttons) {
  $("actions-title").textContent = title;
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

function placeActions(listName, p) {
  const fav = Places.isFavorite(p);
  const buttons = [
    { label: "🧭  Διαδρομές προς τα εκεί", fn: () => previewDestination(p) },
    {
      label: fav ? "☆  Αφαίρεση από τα αγαπημένα" : "★  Προσθήκη στα αγαπημένα",
      fn: () => {
        toast(Places.toggleFavorite(p) ? "Μπήκε στα αγαπημένα" : "Βγήκε από τα αγαπημένα");
        renderDrawer();
      },
    },
    {
      label: "✏️  Μετονομασία",
      fn: () => {
        const name = prompt("Νέο όνομα:", p.name);
        if (name && name.trim()) {
          Places.rename(listName, p.id, name.trim());
          renderDrawer();
        }
      },
    },
    {
      label: listName === "history" ? "🗑  Διαγραφή από τα πρόσφατα" : "🗑  Διαγραφή από τα αγαπημένα",
      danger: true,
      fn: () => {
        Places.remove(listName, p.id);
        renderDrawer();
      },
    },
  ];
  if (listName === "history") {
    buttons.push({
      label: "🧹  Καθάρισμα όλων των πρόσφατων",
      danger: true,
      fn: () => {
        if (confirm("Να σβηστούν όλα τα πρόσφατα;")) {
          Places.clearHistory();
          renderDrawer();
        }
      },
    });
  }
  openActions(p.name, buttons);
}

// ---------- διαδρομές ----------

function parseRoute(r) {
  const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const classes = new Set();
  let turns = 0;
  const steps = r.legs[0].steps.map((s) => {
    for (const it of s.intersections || []) for (const c of it.classes || []) classes.add(c);
    const t = s.maneuver.type, m = s.maneuver.modifier || "";
    if (t !== "depart" && t !== "arrive" && (/left|right|uturn/.test(m) || t.includes("roundabout"))) turns++;
    return {
      type: t,
      modifier: s.maneuver.modifier,
      exit: s.maneuver.exit,
      name: s.name,
      distance: s.distance || 0,
      loc: [s.maneuver.location[1], s.maneuver.location[0]],
    };
  });
  return {
    coords, steps,
    distance: r.distance,
    duration: r.duration,
    via: r.legs[0].summary || "",
    toll: classes.has("toll"),
    motorway: classes.has("motorway"),
    ferry: classes.has("ferry"),
    turns,
  };
}

async function fetchRoutes(from, to, alternatives = true) {
  const url = `${OSRM}${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? 3 : "false"}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes.length) throw new Error(data.message || "no route");
  return data.routes.map(parseRoute).sort((a, b) => a.duration - b.duration);
}

function origin() {
  if (state.pos) return state.pos;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, speed: null, accuracy: 0 };
}

// Δείχνει τις εναλλακτικές διαδρομές στον χάρτη για να διαλέξεις.
async function previewDestination(dest) {
  state.dest = { lat: +dest.lat, lng: +dest.lng, name: dest.name, sub: dest.sub || "" };
  $("results").innerHTML = "";
  setMode("preview");
  $("preview-title").textContent = state.dest.name;
  $("preview-sub").textContent = state.dest.sub;
  renderFavButton();
  $("route-list").innerHTML = '<li class="empty">Βρίσκω διαδρομές…</li>';
  $("go").disabled = true;
  routeLayer.clearLayers();
  if (destMarker) destMarker.remove();
  destMarker = L.marker([state.dest.lat, state.dest.lng], { icon: destIcon }).addTo(map);

  let routes;
  try {
    routes = await fetchRoutes(origin(), state.dest);
  } catch {
    $("route-list").innerHTML = '<li class="empty">Δεν βρήκα δρόμο. Με βάρκα θα πας;</li>';
    return;
  }
  if (state.mode !== "preview") return;
  state.routes = routes;
  state.selected = 0;
  $("go").disabled = false;
  selectRoute(0, true);
}

function selectRoute(i, fit = false) {
  state.selected = i;
  drawRouteOptions();
  renderRouteCards();
  if (fit) {
    const b = L.latLngBounds(state.routes.flatMap((r) => r.coords));
    map.fitBounds(b, fitPadding());
  }
}

function drawRouteOptions() {
  routeLayer.clearLayers();
  const order = state.routes.map((_, i) => i).filter((i) => i !== state.selected).concat(state.selected);
  for (const i of order) {
    const r = state.routes[i];
    const sel = i === state.selected;
    if (sel) L.polyline(r.coords, { color: "#0b3d91", weight: 11, opacity: 0.9, interactive: false }).addTo(routeLayer);
    const line = L.polyline(r.coords, { color: sel ? "#3d8bfd" : "#8e99a8", weight: sel ? 7 : 7, opacity: sel ? 1 : 0.85 });
    // πιο φαρδιά αόρατη γραμμή ώστε να πατιέται εύκολα με το δάχτυλο
    const hit = L.polyline(r.coords, { opacity: 0, weight: 26 });
    hit.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      selectRoute(i);
    });
    line.addTo(routeLayer);
    hit.addTo(routeLayer);
    // ετικέτα με χρόνο/απόσταση, σε διαφορετικό σημείο για κάθε διαδρομή
    const at = r.coords[Math.floor(r.coords.length * (0.35 + 0.15 * (i % 3)))];
    L.marker(at, {
      icon: L.divIcon({ className: "route-label" + (sel ? " sel" : ""), html: `<div>${fmtDuration(r.duration)}</div>`, iconSize: [0, 0] }),
      zIndexOffset: sel ? 1000 : 0,
    }).on("click", () => selectRoute(i)).addTo(routeLayer);
  }
}

function renderRouteCards() {
  const ul = $("route-list");
  ul.innerHTML = "";
  const fastest = state.routes[0].duration;
  state.routes.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "route" + (i === state.selected ? " sel" : "");
    const extra = Math.round((r.duration - fastest) / 60);
    const tag = i === 0 ? '<span class="tag">Ταχύτερη</span>' : `<span class="tag slow">+${extra} λεπ.</span>`;
    const flags = [
      `<span>🕐 άφιξη ${fmtClock(r.duration)}</span>`,
      `<span>↪ ${r.turns} ${r.turns === 1 ? "στροφή" : "στροφές"}</span>`,
      r.motorway ? "<span>🛣 Αυτοκινητόδρομος</span>" : "<span>🏘 Χωρίς αυτοκινητόδρομο</span>",
      r.toll ? '<span class="warn">💶 Διόδια</span>' : "<span>Χωρίς διόδια</span>",
      r.ferry ? '<span class="warn">⛴ Πλοίο</span>' : "",
    ].join("");
    li.innerHTML = `
      <div class="line1"><span class="time">${fmtDuration(r.duration)}</span><span class="dist">${fmtShort(r.distance)}</span>${tag}</div>
      ${r.via ? `<div class="via">μέσω ${escapeHtml(r.via)}</div>` : ""}
      <div class="flags">${flags}</div>`;
    li.onclick = () => selectRoute(i);
    ul.appendChild(li);
  });
}

function renderFavButton() {
  const fav = state.dest && Places.isFavorite(state.dest);
  $("preview-fav").textContent = fav ? "★" : "☆";
  $("preview-fav").classList.toggle("on", fav);
}
$("preview-fav").onclick = () => {
  if (!state.dest) return;
  toast(Places.toggleFavorite(state.dest) ? "Μπήκε στα αγαπημένα" : "Βγήκε από τα αγαπημένα");
  renderFavButton();
};
$("preview-close").onclick = () => {
  setMode("home");
  renderDrawer();
};
$("go").onclick = () => {
  if (!state.routes.length) return;
  Places.addHistory(state.dest);
  state.route = state.routes[state.selected];
  startNavigation();
};

function drawNavRoute() {
  routeLayer.clearLayers();
  L.polyline(state.route.coords, { color: "#0b3d91", weight: 10, opacity: 0.9 }).addTo(routeLayer);
  L.polyline(state.route.coords, { color: "#3d8bfd", weight: 6, opacity: 1 }).addTo(routeLayer);
}

function resetProgress() {
  state.next = 1;
  state.announced = { far: false, near: false };
  state.minDist = Infinity;
  state.offCount = 0;
}

function startNavigation() {
  resetProgress();
  setMode("nav");
  state.navigating = true;
  state.follow = true;
  drawNavRoute();
  if (state.pos) map.setView([state.pos.lat, state.pos.lng], 17);
  requestWakeLock();
  const step = state.route.steps[state.next];
  const d = state.pos ? haversine([state.pos.lat, state.pos.lng], step.loc) : state.route.steps[0].distance;
  showStep(step, d, quip("start", "Ξεκινάμε"));
  updateTrip(d);
}

function stopNavigation() {
  state.navigating = false;
  stopSim();
  setMode("home");
  state.route = null;
  renderDrawer();
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}
$("stop").onclick = () => {
  stopNavigation();
  speak("Άντε, γεια.", true);
};

async function reroute() {
  const now = Date.now();
  if (now - state.lastReroute < 15000 || !state.dest || !state.pos) return;
  state.lastReroute = now;
  showStep(null, null, quip("recalc", "Επανυπολογισμός διαδρομής"));
  $("instr").textContent = "Επανυπολογισμός…";
  try {
    [state.route] = await fetchRoutes(state.pos, state.dest, false);
    drawNavRoute();
    resetProgress();
  } catch {
    /* θα ξαναδοκιμάσει στην επόμενη απόκλιση */
  }
}

function showStep(step, dist, quipText) {
  $("arrow").innerHTML = arrowSvg(step);
  $("dist").textContent = dist != null ? fmtShort(dist) : "";
  $("instr").textContent = step ? instruction(step) : "";
  if (quipText !== undefined) $("quip").textContent = quipText;
}

function updateTrip(distToNext) {
  const r = state.route;
  let rest = distToNext;
  for (let i = state.next; i < r.steps.length; i++) rest += r.steps[i].distance;
  const secs = r.distance ? (rest / r.distance) * r.duration : 0;
  $("eta-min").textContent = Math.max(1, Math.round(secs / 60));
  $("eta-km").textContent = fmtShort(rest);
  $("eta-clock").textContent = fmtClock(secs);
}

// ---------- κάθε νέα θέση ----------

function onPosition(pos) {
  const first = !state.pos;
  state.pos = pos;
  const here = [pos.lat, pos.lng];
  userMarker.setLatLng(here);
  if (!map.hasLayer(userMarker)) userMarker.addTo(map);
  if (first && state.mode === "home") map.setView(here, 16);
  if (!state.navigating || !state.route) return;

  if (state.follow) map.setView(here, Math.max(map.getZoom(), 16), { animate: true });
  const now = Date.now();
  const kmh = pos.speed != null ? pos.speed * 3.6 : null;

  // ταχύτητα
  if (kmh != null && kmh > settings.speedLimit && now - state.lastSpeedWarn > 60000) {
    state.lastSpeedWarn = now;
    quip("speeding", "Προσοχή, υπερβολική ταχύτητα", false);
  }

  // ακινησία
  if (kmh != null && kmh < 3) {
    state.stillSince = state.stillSince || now;
    if (now - state.stillSince > IDLE_SECONDS * 1000 && now - state.lastIdleWarn > 120000) {
      state.lastIdleWarn = now;
      if (settings.mode !== "plain") quip("idle", "", false);
    }
  } else {
    state.stillSince = null;
  }

  // εκτός διαδρομής
  const off = distanceToRoute(here, state.route.coords);
  if (off > OFF_ROUTE_M && (pos.accuracy || 0) < 50) {
    if (++state.offCount >= 3) return void reroute();
  } else {
    state.offCount = 0;
  }

  const step = state.route.steps[state.next];
  if (!step) return;
  const d = haversine(here, step.loc);
  state.minDist = Math.min(state.minDist, d);
  const instr = instruction(step);
  updateTrip(d);

  if (step.type === "arrive" && d < 30) {
    showStep(step, null, quip("arrive", "Έφτασες στον προορισμό"));
    state.navigating = false;
    stopSim();
    return;
  }

  if (!state.announced.far && d < ANNOUNCE_FAR_M && d > ANNOUNCE_NEAR_M) {
    state.announced.far = true;
    if (settings.mode !== "quips") {
      if (step.type === "arrive") speak(`Σε ${fmtDist(d)} φτάνεις στον προορισμό`);
      else speak(`Σε ${fmtDist(d)}, ${instr.charAt(0).toLowerCase()}${instr.slice(1)}`);
    }
  }

  if (!state.announced.near && d <= ANNOUNCE_NEAR_M && step.type !== "arrive") {
    state.announced.near = true;
    showStep(step, d, quip(category(step), instr));
  } else {
    showStep(step, d);
  }

  // πέρασε τη στροφή
  if (d < 12 || (state.minDist < ANNOUNCE_NEAR_M && d > state.minDist + 15)) {
    state.next++;
    state.announced = { far: false, near: false };
    state.minDist = Infinity;
    const nxt = state.route.steps[state.next];
    if (nxt) showStep(nxt, haversine(here, nxt.loc), "");
  }
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (p) => {
      if (state.simTimer) return; // η προσομοίωση έχει τον έλεγχο
      onPosition({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        speed: p.coords.speed,
        accuracy: p.coords.accuracy,
      });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

// ---------- προσομοίωση ----------

function stopSim() {
  clearInterval(state.simTimer);
  state.simTimer = null;
  $("sim").textContent = "Προσομοίωση";
}

$("sim").onclick = () => {
  if (state.simTimer) return stopSim();
  if (!state.route) return toast("Βάλε πρώτα προορισμό.");
  if (!state.navigating) startNavigation();
  const coords = state.route.coords;
  const SPEED = 14; // m/s ≈ 50 χλμ/ώρα
  let i = 0, along = 0;
  state.follow = true;
  $("sim").textContent = "Παύση";
  state.simTimer = setInterval(() => {
    let move = SPEED;
    while (i < coords.length - 1) {
      const seg = haversine(coords[i], coords[i + 1]);
      if (along + move < seg) { along += move; break; }
      move -= seg - along;
      along = 0;
      i++;
    }
    if (i >= coords.length - 1) {
      const last = coords[coords.length - 1];
      onPosition({ lat: last[0], lng: last[1], speed: 0, accuracy: 5 });
      return stopSim();
    }
    const a = coords[i], b = coords[i + 1];
    const t = along / (haversine(a, b) || 1);
    onPosition({
      lat: a[0] + (b[0] - a[0]) * t,
      lng: a[1] + (b[1] - a[1]) * t,
      speed: SPEED,
      accuracy: 5,
    });
  }, 1000);
};

// ---------- σίγαση ----------

const SPEAKER_ON = '<svg class="ico" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
const SPEAKER_OFF = '<svg class="ico" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>';
let modeBeforeMute = settings.mode === "mute" ? "both" : settings.mode;

function renderMute() {
  const muted = settings.mode === "mute";
  $("mute").innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
  $("mute").classList.toggle("off", muted);
}
$("mute").onclick = () => {
  if (settings.mode === "mute") settings.mode = modeBeforeMute;
  else {
    modeBeforeMute = settings.mode;
    settings.mode = "mute";
    stopSound();
  }
  $("s-mode").value = settings.mode;
  saveSettings();
  renderMute();
  toast(settings.mode === "mute" ? "Σίγαση" : "Ήχος ανοιχτός");
};

// ---------- οθόνη ρυθμίσεων ----------

$("open-settings").onclick = () => {
  $("settings").hidden = false;
  renderClips();
};
$("close-settings").onclick = () => ($("settings").hidden = true);
$("settings").onclick = (e) => {
  if (e.target === $("settings")) $("settings").hidden = true;
};

function bindSetting(id, key, { output, format = (v) => v, parse = (v) => v, onChange } = {}) {
  const el = $(id);
  const isBox = el.type === "checkbox";
  if (isBox) el.checked = settings[key];
  else el.value = settings[key];
  const show = () => output && ($(output).textContent = format(settings[key]));
  show();
  el.addEventListener(isBox || el.tagName === "SELECT" ? "change" : "input", () => {
    settings[key] = isBox ? el.checked : parse(el.value);
    show();
    saveSettings();
    if (onChange) onChange();
  });
  return show;
}

const speedLabel = (v) => (useMiles() ? `${Math.round(v * 0.621)} mph` : `${v} χλμ/ώρα`);

const showSpeed = bindSetting("s-speed", "speedLimit", { output: "o-speed", parse: Number, format: speedLabel });
bindSetting("s-units", "units", {
  onChange: () => {
    showSpeed();
    renderDrawer();
    if (state.mode === "preview" && state.routes.length) renderRouteCards();
  },
});
bindSetting("s-voice", "voiceURI");
bindSetting("s-rate", "rate", { output: "o-rate", parse: Number, format: (v) => v.toFixed(1) + "×" });
bindSetting("s-pitch", "pitch", { output: "o-pitch", parse: Number, format: (v) => v.toFixed(1) });
bindSetting("s-volume", "volume", { output: "o-volume", parse: Number, format: (v) => Math.round(v * 100) + "%" });
bindSetting("s-mode", "mode", {
  onChange: () => {
    renderMute();
    if (settings.mode !== "mute") modeBeforeMute = settings.mode;
  },
});
bindSetting("s-lang", "lang");
bindSetting("s-chime", "chime");
bindSetting("s-myaudio", "myAudio");
renderMute();

$("test-voice").onclick = () => {
  const wasMuted = settings.mode === "mute";
  if (wasMuted) settings.mode = "both";
  quip("right", "Στρίψε δεξιά");
  if (wasMuted) settings.mode = "mute";
};

// ---------- ηχογραφήσεις ----------

for (const [key, label] of Object.entries(CATEGORIES)) {
  const o = document.createElement("option");
  o.value = key;
  o.textContent = label;
  $("rec-cat").appendChild(o);
}
$("rec-cat").onchange = renderClips;

function renderClips() {
  const cat = $("rec-cat").value;
  const list = $("rec-list");
  const clips = Recordings.forCategory(cat);
  list.innerHTML = "";
  if (!clips.length) {
    list.innerHTML = '<li class="empty">Καμία ηχογράφηση ακόμα</li>';
    return;
  }
  for (const c of clips) {
    const li = document.createElement("li");
    const play = document.createElement("button");
    play.className = "icon-btn";
    play.textContent = "▶";
    play.onclick = () => playClip(c);
    const name = document.createElement("span");
    name.textContent = c.name;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Διαγραφή");
    del.onclick = async () => {
      if (!confirm("Να σβηστεί αυτή η ηχογράφηση;")) return;
      await Recordings.remove(c.id);
      renderClips();
    };
    li.append(play, name, del);
    list.appendChild(li);
  }
}

function clipName(cat) {
  const n = Recordings.forCategory(cat).length + 1;
  return `${CATEGORIES[cat]} #${n}`;
}

let recorder = null;
$("rec-btn").onclick = async () => {
  if (recorder && recorder.state === "recording") return recorder.stop();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast("Το κινητό δεν υποστηρίζει ηχογράφηση εδώ.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast("Χρειάζομαι άδεια για το μικρόφωνο.");
  }
  const type = ["audio/mp4", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const cat = $("rec-cat").value;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    $("rec-btn").classList.remove("on");
    $("rec-btn").textContent = "● Ηχογράφηση";
    if (!chunks.length) return;
    await Recordings.add(cat, new Blob(chunks, { type: recorder.mimeType || type }), clipName(cat));
    renderClips();
    toast("Αποθηκεύτηκε!");
  };
  recorder.start();
  $("rec-btn").classList.add("on");
  $("rec-btn").textContent = "■ Σταμάτα";
};

$("rec-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const cat = $("rec-cat").value;
  await Recordings.add(cat, file, file.name.replace(/\.[^.]+$/, "") || clipName(cat));
  renderClips();
  toast("Προστέθηκε!");
};

// ---------- εκκίνηση ----------

Recordings.load();
setMode("home");
renderDrawer();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
