// GPS Μάγκας — πλοήγηση με ατάκες.
// Χάρτης: OpenStreetMap, διαδρομές: OSRM, αναζήτηση: Nominatim, φωνή: Web Speech (el-GR).

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

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

const $ = (id) => document.getElementById(id);

// ---------- ρυθμίσεις ----------

const DEFAULTS = {
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  mode: "both",     // both | quips | plain | mute
  lang: "el",       // el | pnt | mix
  chime: true,
  speedLimit: 120,
  myAudio: "mix",   // mix | only | off
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

// ---------- χάρτης ----------

const map = L.map("map", { zoomControl: false }).setView([37.9838, 23.7275], 13);
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
let routeLine = null;

const state = {
  pos: null,          // { lat, lng, speed (m/s) | null, accuracy }
  dest: null,         // { lat, lng, name }
  route: null,        // { coords: [[lat,lng]], steps: [...] }
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
  if (!state.navigating && !state.pos) return;
  state.follow = false;
  $("recenter").hidden = false;
});
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

function fmtDist(m) {
  if (m >= 1000) return (m / 1000).toFixed(1).replace(".", ",") + " χλμ";
  return Math.round(m / 10) * 10 + " μέτρα";
}

function fmtShort(m) {
  if (m >= 1000) return (m / 1000).toFixed(1).replace(".", ",") + " χλμ";
  return Math.round(m / 10) * 10 + " μ";
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
  if (!q) return;
  $("dest").blur();
  const params = new URLSearchParams({ q, format: "json", limit: "6", "accept-language": "el" });
  if (state.pos) {
    const d = 1.5;
    params.set("viewbox", [state.pos.lng - d, state.pos.lat + d, state.pos.lng + d, state.pos.lat - d].join(","));
  }
  $("results").innerHTML = "<li>Ψάχνω...</li>";
  try {
    const res = await fetch(`${NOMINATIM}?${params}`);
    const data = await res.json();
    $("results").innerHTML = "";
    if (!data.length) {
      $("results").innerHTML = "<li>Δεν το βρήκα. Γράψε το σωστά, ρε!</li>";
      return;
    }
    for (const r of data) {
      const [first, ...rest] = r.display_name.split(",");
      const li = document.createElement("li");
      li.textContent = first;
      const small = document.createElement("small");
      small.textContent = rest.join(",").trim();
      li.appendChild(small);
      li.onclick = () => {
        $("results").innerHTML = "";
        $("dest").value = first;
        setDestination({ lat: +r.lat, lng: +r.lon, name: r.display_name });
      };
      $("results").appendChild(li);
    }
  } catch {
    $("results").innerHTML = "<li>Δεν έχει ίντερνετ; Ούτε κι εγώ.</li>";
  }
});

// ---------- διαδρομή ----------

async function fetchRoute(from, to) {
  const url = `${OSRM}${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes.length) throw new Error(data.message || "no route");
  const r = data.routes[0];
  const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const steps = r.legs[0].steps.map((s) => ({
    type: s.maneuver.type,
    modifier: s.maneuver.modifier,
    exit: s.maneuver.exit,
    name: s.name,
    distance: s.distance || 0,
    loc: [s.maneuver.location[1], s.maneuver.location[0]],
  }));
  return { coords, steps, distance: r.distance, duration: r.duration };
}

function drawRoute() {
  if (routeLine) routeLine.remove();
  routeLine = L.layerGroup([
    L.polyline(state.route.coords, { color: "#0b3d91", weight: 10, opacity: 0.9 }),
    L.polyline(state.route.coords, { color: "#3d8bfd", weight: 6, opacity: 1 }),
  ]).addTo(map);
}

function origin() {
  if (state.pos) return state.pos;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, speed: null, accuracy: 0 };
}

async function setDestination(dest) {
  state.dest = dest;
  if (destMarker) destMarker.remove();
  destMarker = L.marker([dest.lat, dest.lng], { icon: destIcon }).addTo(map);
  try {
    state.route = await fetchRoute(origin(), dest);
  } catch {
    toast("Δεν βρήκα δρόμο. Με βάρκα θα πας;");
    speak("Δεν βρήκα δρόμο. Με βάρκα θα πας;", true);
    return;
  }
  drawRoute();
  map.fitBounds(L.latLngBounds(state.route.coords), { padding: [60, 60] });
  startNavigation();
}

function resetProgress() {
  state.next = 1;
  state.announced = { far: false, near: false };
  state.minDist = Infinity;
  state.offCount = 0;
}

function startNavigation() {
  resetProgress();
  state.navigating = true;
  state.follow = true;
  document.body.classList.add("navigating");
  $("navbar").hidden = false;
  requestWakeLock();
  const step = state.route.steps[state.next];
  const d = state.pos ? haversine([state.pos.lat, state.pos.lng], step.loc) : state.route.steps[0].distance;
  showStep(step, d, quip("start", "Ξεκινάμε"));
  updateTrip(d);
}

function stopNavigation() {
  state.navigating = false;
  stopSim();
  document.body.classList.remove("navigating");
  $("navbar").hidden = true;
  $("banner").hidden = true;
  if (routeLine) routeLine.remove();
  if (destMarker) destMarker.remove();
  routeLine = destMarker = null;
  state.route = null;
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
    state.route = await fetchRoute(state.pos, state.dest);
    drawRoute();
    resetProgress();
  } catch {
    /* θα ξαναδοκιμάσει στην επόμενη απόκλιση */
  }
}

function showStep(step, dist, quipText) {
  $("banner").hidden = false;
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
  const arrive = new Date(Date.now() + secs * 1000);
  $("eta-min").textContent = Math.max(1, Math.round(secs / 60));
  $("eta-km").textContent = fmtShort(rest);
  $("eta-clock").textContent = arrive.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
}

// ---------- κάθε νέα θέση ----------

function onPosition(pos) {
  state.pos = pos;
  const here = [pos.lat, pos.lng];
  userMarker.setLatLng(here);
  if (!map.hasLayer(userMarker)) {
    userMarker.addTo(map);
    if (!state.navigating) map.setView(here, 16);
  }
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

function bindSetting(id, key, { output, format = (v) => v, parse = (v) => v } = {}) {
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
    if (key === "mode") {
      renderMute();
      if (settings.mode !== "mute") modeBeforeMute = settings.mode;
    }
  });
}

bindSetting("s-voice", "voiceURI");
bindSetting("s-rate", "rate", { output: "o-rate", parse: Number, format: (v) => v.toFixed(1) + "×" });
bindSetting("s-pitch", "pitch", { output: "o-pitch", parse: Number, format: (v) => v.toFixed(1) });
bindSetting("s-volume", "volume", { output: "o-volume", parse: Number, format: (v) => Math.round(v * 100) + "%" });
bindSetting("s-mode", "mode");
bindSetting("s-lang", "lang");
bindSetting("s-chime", "chime");
bindSetting("s-speed", "speedLimit", { output: "o-speed", parse: Number, format: (v) => v + " χλμ/ώρα" });
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

Recordings.load();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
