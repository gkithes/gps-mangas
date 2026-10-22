// GPS Μάγκας — πλοήγηση με ατάκες.
// Χάρτης: OpenStreetMap, διαδρομές: OSRM, αναζήτηση: Nominatim, φωνή: Web Speech (el-GR).

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

const ANNOUNCE_FAR_M = 250;   // "Σε 200 μέτρα..."
const ANNOUNCE_NEAR_M = 45;   // εδώ πέφτει η ατάκα
const OFF_ROUTE_M = 60;
const SPEEDING_KMH = 120;
const IDLE_SECONDS = 90;

const $ = (id) => document.getElementById(id);

const map = L.map("map", { zoomControl: false }).setView([37.9838, 23.7275], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const userMarker = L.circleMarker([0, 0], {
  radius: 9, color: "#fff", weight: 3, fillColor: "#2a7de1", fillOpacity: 1,
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
  simTimer: null,
  wakeLock: null,
  lastPicked: {},
};

// ---------- φωνή ----------

let greekVoice = null;
function loadVoice() {
  const voices = speechSynthesis.getVoices();
  greekVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("el")) || null;
}
if ("speechSynthesis" in window) {
  loadVoice();
  speechSynthesis.onvoiceschanged = loadVoice;
}

function speak(text, interrupt = false) {
  if (!("speechSynthesis" in window)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "el-GR";
  if (greekVoice) u.voice = greekVoice;
  u.rate = 1.0;
  speechSynthesis.speak(u);
}

// ---------- ατάκες ----------

function pick(category) {
  const lang = $("lang").value;
  const set = window.PHRASES[category] || { el: [] };
  let list;
  if (lang === "mix") list = [...(set.el || []), ...(set.pnt || [])];
  else list = set[lang] && set[lang].length ? set[lang] : set.el || [];
  if (!list.length) return "";
  let p;
  do {
    p = list[Math.floor(Math.random() * list.length)];
  } while (list.length > 1 && p === state.lastPicked[category]);
  state.lastPicked[category] = p;
  return p;
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

function category(step) {
  const t = step.type, m = step.modifier || "";
  if (t === "arrive") return "arrive";
  if (t.includes("roundabout") || t.includes("rotary")) return "roundabout";
  if (m === "uturn") return "uturn";
  if ((t === "on ramp" || t === "off ramp" || t === "merge") && window.PHRASES.highway.el.length) return "highway";
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

// ---------- αναζήτηση ----------

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("dest").value.trim();
  if (!q) return;
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
      const li = document.createElement("li");
      li.textContent = r.display_name;
      li.onclick = () => {
        $("results").innerHTML = "";
        $("dest").value = r.display_name.split(",")[0];
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
    loc: [s.maneuver.location[1], s.maneuver.location[0]],
  }));
  return { coords, steps, distance: r.distance, duration: r.duration };
}

function drawRoute() {
  if (routeLine) routeLine.remove();
  routeLine = L.polyline(state.route.coords, { color: "#e8a33d", weight: 7, opacity: 0.9 }).addTo(map);
}

function origin() {
  if (state.pos) return state.pos;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, speed: null, accuracy: 0 };
}

async function setDestination(dest) {
  state.dest = dest;
  if (destMarker) destMarker.remove();
  destMarker = L.marker([dest.lat, dest.lng]).addTo(map);
  try {
    state.route = await fetchRoute(origin(), dest);
  } catch {
    showBanner("Δεν βρήκα δρόμο", "Με βάρκα θα πας;", "");
    speak("Δεν βρήκα δρόμο. Με βάρκα θα πας;", true);
    return;
  }
  drawRoute();
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
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
  $("stop").hidden = false;
  requestWakeLock();
  const quip = pick("start");
  const total = fmtDist(state.route.distance);
  const mins = Math.round(state.route.duration / 60);
  showBanner(instruction(state.route.steps[state.next]), quip, `${total} · ~${mins} λεπτά`);
  speak(quip, true);
}

function stopNavigation() {
  state.navigating = false;
  stopSim();
  $("stop").hidden = true;
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
  const quip = pick("recalc");
  speak(quip, true);
  showBanner("Επανυπολογισμός…", quip, "");
  try {
    state.route = await fetchRoute(state.pos, state.dest);
    drawRoute();
    resetProgress();
  } catch {
    /* θα ξαναδοκιμάσει στην επόμενη απόκλιση */
  }
}

function showBanner(instr, quip, meta) {
  $("banner").hidden = false;
  $("instr").textContent = instr;
  $("quip").textContent = quip;
  $("meta").textContent = meta;
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

  map.setView(here, Math.max(map.getZoom(), 16), { animate: true });
  const now = Date.now();
  const kmh = pos.speed != null ? pos.speed * 3.6 : null;

  // ταχύτητα
  if (kmh != null && kmh > SPEEDING_KMH && now - state.lastSpeedWarn > 60000) {
    state.lastSpeedWarn = now;
    speak(pick("speeding"));
  }

  // ακινησία
  if (kmh != null && kmh < 3) {
    state.stillSince = state.stillSince || now;
    if (now - state.stillSince > IDLE_SECONDS * 1000 && now - state.lastIdleWarn > 120000) {
      state.lastIdleWarn = now;
      speak(pick("idle"));
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

  if (step.type === "arrive" && d < 30) {
    const quip = pick("arrive");
    showBanner(instr, quip, "");
    speak(quip, true);
    state.navigating = false;
    stopSim();
    return;
  }

  if (!state.announced.far && d < ANNOUNCE_FAR_M && d > ANNOUNCE_NEAR_M) {
    state.announced.far = true;
    if (step.type === "arrive") speak(`Σε ${fmtDist(d)} φτάνεις στον προορισμό`);
    else speak(`Σε ${fmtDist(d)}, ${instr.charAt(0).toLowerCase()}${instr.slice(1)}`);
  }

  if (!state.announced.near && d <= ANNOUNCE_NEAR_M && step.type !== "arrive") {
    state.announced.near = true;
    const quip = pick(category(step));
    showBanner(instr, quip, "");
    speak(quip, true);
  } else {
    $("instr").textContent = instr;
    $("meta").textContent = `σε ${fmtDist(d)}`;
  }

  // πέρασε τη στροφή
  if (d < 12 || (state.minDist < ANNOUNCE_NEAR_M && d > state.minDist + 15)) {
    state.next++;
    state.announced = { far: false, near: false };
    state.minDist = Infinity;
    const nxt = state.route.steps[state.next];
    if (nxt) {
      $("instr").textContent = instruction(nxt);
      $("quip").textContent = "";
    }
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
  if (!state.route) {
    speak("Πού να πάμε, ρε; Βάλε πρώτα προορισμό.", true);
    showBanner("Βάλε προορισμό", "Πού να πάμε, ρε;", "");
    return;
  }
  if (!state.navigating) startNavigation();
  const coords = state.route.coords;
  const SPEED = 14; // m/s ≈ 50 χλμ/ώρα
  let i = 0, along = 0;
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
