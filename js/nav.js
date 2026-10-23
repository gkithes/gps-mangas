// Η πλοήγηση: πού είσαι πάνω στη διαδρομή, ποια στροφή έρχεται, τι λέει και πότε.

import { NAV } from "./config.js";
import { $, haversine, lowerFirst, safe } from "./util.js";
import { settings } from "./store.js";
import { state } from "./state.js";
import { map, layers, setMode, setStatus, toast } from "./ui.js";
import { spokenDist, shortDist, clockIn } from "./format.js";
import { fetchRoutes, locate, instruction, quipCategory, arrowSvg } from "./route.js";
import { speak, quip, stopSound } from "./voice.js";
import { feed } from "./gps.js";

// ---------- εμφάνιση ----------

function drawRoute() {
  layers.route.clearLayers();
  L.polyline(state.route.coords, { color: "#0b3d91", weight: 10, opacity: 0.9 }).addTo(layers.route);
  L.polyline(state.route.coords, { color: "#3d8bfd", weight: 6, opacity: 1 }).addTo(layers.route);
}

function showStep(step, dist, quipText) {
  $("arrow").innerHTML = arrowSvg(step);
  $("dist").textContent = dist != null ? shortDist(dist) : "";
  $("instr").textContent = step ? instruction(step) : "";
  if (quipText !== undefined) $("quip").textContent = quipText;
}

// «Μετά: ↱ Στρίψε δεξιά σε 300 μ» και η λίστα με όλες τις επόμενες στροφές.
let stepsOpen = false;

function showUpcoming(along) {
  const steps = state.route.steps;
  const idx = Math.max(1, state.next);
  const cur = steps[idx];
  const nxt = steps[idx + 1];
  const then = !!nxt && cur.type !== "arrive";
  $("then").hidden = !then;
  if (then) {
    $("then-arrow").innerHTML = arrowSvg(nxt);
    $("then-instr").textContent = instruction(nxt);
    $("then-dist").textContent = shortDist(Math.max(0, nxt.along - cur.along));
  }
  if (stepsOpen) renderSteps(along, idx);
}

function renderSteps(along, idx) {
  const ul = $("steps-list");
  ul.innerHTML = "";
  state.route.steps.slice(idx).forEach((s, i) => {
    const li = document.createElement("li");
    if (i === 0) li.className = "current";
    li.innerHTML = `<div class="badge"><svg viewBox="0 0 48 48">${arrowSvg(s)}</svg></div>
      <div class="body"><div class="name"></div></div><div class="right"></div>`;
    li.querySelector(".name").textContent = instruction(s);
    li.querySelector(".right").textContent = shortDist(Math.max(0, s.along - along));
    ul.appendChild(li);
  });
  $("steps").style.top = `${$("banner").getBoundingClientRect().bottom + 8}px`;
}

function setStepsOpen(open) {
  stepsOpen = open && state.navigating;
  $("steps").hidden = !stepsOpen;
  $("steps-toggle").classList.toggle("open", stepsOpen);
  if (stepsOpen) renderSteps(lastAlong, Math.max(1, state.next));
}
$("steps-toggle").onclick = () => setStepsOpen(!stepsOpen);
$("steps").onclick = () => setStepsOpen(false);

let lastAlong = 0;

function showTrip(along) {
  const r = state.route;
  const rest = Math.max(0, r.length - along);
  const secs = r.length ? (rest / r.length) * r.duration : 0;
  $("eta-min").textContent = Math.max(rest > 0 ? 1 : 0, Math.round(secs / 60));
  $("eta-km").textContent = shortDist(rest);
  $("eta-clock").textContent = clockIn(secs);
}

// ---------- έναρξη / τέλος ----------

function useRoute(r) {
  Object.assign(state, { route: r, next: -1, announced: {}, offCount: 0, offRoute: false, recalcSpoken: false, arrived: false });
  drawRoute();
}

export function startNavigation(route) {
  setMode("nav");
  state.navigating = true;
  state.follow = true;
  useRoute(route);
  setStatus("");
  keepAwake(true);
  const first = route.steps[1] || route.steps[0];
  showStep(first, first.along, quip("start", "Ξεκινάμε"));
  showTrip(0);
  lastAlong = 0;
  showUpcoming(0);
  if (state.pos) {
    map.setView([state.pos.lat, state.pos.lng], 17);
    guide(state.pos); // αμέσως η πρώτη οδηγία, χωρίς να περιμένουμε το επόμενο GPS
  }
}

export function stopNavigation() {
  state.navigating = false;
  setStepsOpen(false);
  stopSim();
  state.route = null;
  setStatus("");
  keepAwake(false);
  setMode("home");
}

// ---------- νέα διαδρομή όταν βγεις από τον δρόμο ----------

// Αν αποτύχει, ο φύλακας (gps.js) ξαναδοκιμάζει κάθε λίγα δευτερόλεπτα.
export async function reroute() {
  if (state.rerouting || !state.dest || !state.pos || !state.navigating) return;
  state.rerouting = true;
  state.lastReroute = Date.now();
  if (!state.recalcSpoken) {
    state.recalcSpoken = true;
    showStep(null, null, quip("recalc", "Επανυπολογισμός διαδρομής"));
    $("instr").textContent = "Επανυπολογισμός…";
  }
  setStatus("Βρίσκω νέα διαδρομή…");
  try {
    const [r] = await fetchRoutes(state.pos, state.dest, false);
    if (!state.navigating) return;
    useRoute(r);
    setStatus("");
    guide(state.pos);
  } catch {
    setStatus("Δεν απαντάει ο χάρτης — ξαναδοκιμάζω…");
  } finally {
    state.rerouting = false;
  }
}

// ---------- κάθε νέα θέση στην πλοήγηση ----------

export function guide(pos) {
  const route = state.route;
  if (!route || !state.navigating) return;
  const here = [pos.lat, pos.lng];
  if (state.follow) map.panTo(here, { animate: true });
  const now = Date.now();
  const kmh = pos.speed != null ? pos.speed * 3.6 : null;

  // ταχύτητα
  if (kmh != null && kmh > settings.speedLimit && now - state.lastSpeedWarn > 60000) {
    state.lastSpeedWarn = now;
    quip("speeding", "Προσοχή, υπερβολική ταχύτητα", false);
  }

  // ακινησία
  if (kmh != null && kmh < 3) {
    state.stillSince ||= now;
    if (now - state.stillSince > NAV.IDLE_S * 1000 && now - state.lastIdleWarn > 120000) {
      state.lastIdleWarn = now;
      if (settings.mode !== "plain") quip("idle", "", false);
    }
  } else {
    state.stillSince = null;
  }

  // εκτός διαδρομής;
  const loc = locate(route, here);
  if (loc.off > NAV.OFF_ROUTE_M && (pos.accuracy || 0) < 60) {
    if (++state.offCount >= NAV.OFF_ROUTE_FIXES) {
      state.offRoute = true;
      if (now - state.lastReroute > NAV.REROUTE_RETRY_MS) reroute();
      return;
    }
  } else {
    state.offCount = 0;
    if (state.offRoute) {
      // γύρισες μόνος σου στη διαδρομή
      Object.assign(state, { offRoute: false, recalcSpoken: false });
      setStatus("");
    }
  }
  if (state.offRoute) return;

  const along = loc.along;
  showTrip(along);

  // επόμενη στροφή = η πρώτη που δεν έχεις περάσει
  const steps = route.steps;
  let idx = steps.findIndex((s, i) => i > 0 && s.along > along + NAV.PASSED_M);
  if (idx < 0) idx = steps.length - 1;
  // μια στροφή που πέρασες δεν ξαναγυρίζει επειδή «πήδηξε» το GPS — μόνο αν όντως γύρισες πίσω
  if (state.next > 0 && idx < state.next && along > steps[state.next - 1].along - NAV.BACKTRACK_M) idx = state.next;
  if (idx !== state.next) {
    if (state.next >= 0) $("quip").textContent = ""; // νέα στροφή: σβήσε την παλιά ατάκα
    state.next = idx;
    state.announced = {};
  }
  const step = steps[idx];
  const d = Math.max(0, step.along - along);
  const instr = instruction(step);
  lastAlong = along;
  showUpcoming(along);

  // άφιξη
  if (step.type === "arrive" && (d < NAV.ARRIVE_M || haversine(here, step.loc) < 30)) {
    if (!state.arrived) {
      state.arrived = true;
      showStep(step, null, quip("arrive", "Έφτασες στον προορισμό"));
      setStatus("");
      stopSim();
    }
    return;
  }

  // πόσο νωρίς ειδοποιεί: στην εθνική νωρίτερα
  const v = pos.speed != null && pos.speed > 1 ? pos.speed : 13;
  const farDist = Math.min(800, Math.max(200, v * 15));
  const nearDist = Math.min(120, Math.max(40, v * 3.5));
  const a = state.announced;

  // μόλις φανεί νέα στροφή μακριά: «Συνέχισε για 2 χλμ και μετά…» — για να ξέρεις ότι σε ακούει
  if (!a.intro) {
    a.intro = true;
    if (d > farDist + 150 && settings.mode !== "quips") {
      const then = step.type === "arrive" ? "φτάνεις στον προορισμό" : lowerFirst(instr);
      speak(`Συνέχισε για ${spokenDist(d)}, και μετά ${then}`);
    }
  }

  if (!a.far && d <= farDist && d > nearDist) {
    a.far = true;
    if (settings.mode !== "quips") {
      speak(step.type === "arrive" ? `Σε ${spokenDist(d)} φτάνεις στον προορισμό` : `Σε ${spokenDist(d)}, ${lowerFirst(instr)}`);
    }
  }

  if (!a.near && d <= nearDist && step.type !== "arrive") {
    a.near = a.far = true;
    showStep(step, d, quip(quipCategory(step), instr));
  } else {
    showStep(step, d);
  }
}

// Ξαναλέει την τρέχουσα οδηγία (π.χ. όταν γυρίσεις στην εφαρμογή ή ξαναβρεθεί το GPS).
export function reannounce() {
  if (!state.navigating) return;
  state.announced = {};
  if (state.pos && !state.simTimer) safe(() => guide(state.pos));
}

// ---------- η οθόνη να μη σβήνει ----------

const noSleep = window.NoSleep ? new window.NoSleep() : null;
export function keepAwake(on) {
  if (!noSleep) return;
  try {
    if (on && !noSleep.isEnabled) Promise.resolve(noSleep.enable()).catch(() => {});
    if (!on && noSleep.isEnabled) noSleep.disable();
  } catch {}
}
// το iPhone επιτρέπει το «ξύπνημα» μόνο μετά από άγγιγμα — ξαναπροσπαθούμε σε κάθε άγγιγμα
document.addEventListener("pointerdown", () => state.navigating && keepAwake(true));

// ---------- προσομοίωση ----------

export function stopSim() {
  clearInterval(state.simTimer);
  state.simTimer = null;
  $("sim").textContent = "Προσομοίωση";
}

function toggleSim() {
  if (state.simTimer) return stopSim();
  if (!state.route) return toast("Βάλε πρώτα προορισμό.");
  const coords = state.route.coords;
  const SPEED = 14; // m/s ≈ 50 χλμ/ώρα
  let i = 0;
  let along = 0;
  state.follow = true;
  $("sim").textContent = "Παύση";
  state.simTimer = setInterval(() => {
    let move = SPEED;
    while (i < coords.length - 1) {
      const seg = haversine(coords[i], coords[i + 1]);
      if (along + move < seg) {
        along += move;
        break;
      }
      move -= seg - along;
      along = 0;
      i++;
    }
    if (i >= coords.length - 1) {
      const last = coords[coords.length - 1];
      feed({ lat: last[0], lng: last[1], speed: 0, accuracy: 5 });
      return stopSim();
    }
    const [a, b] = [coords[i], coords[i + 1]];
    const t = along / (haversine(a, b) || 1);
    feed({ lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, speed: SPEED, accuracy: 5 });
  }, 1000);
}

// ---------- κουμπιά της κάτω μπάρας ----------

$("sim").onclick = toggleSim;
$("stop").onclick = () => {
  stopNavigation();
  speak("Άντε, γεια.", true);
};

const SPEAKER_ON = '<svg class="ico" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
const SPEAKER_OFF = '<svg class="ico" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>';
let modeBeforeMute = settings.mode === "mute" ? "both" : settings.mode;

export function renderMute() {
  const muted = settings.mode === "mute";
  $("mute").innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
  $("mute").classList.toggle("off", muted);
  if (!muted) modeBeforeMute = settings.mode;
}

export function toggleMute() {
  if (settings.mode === "mute") settings.mode = modeBeforeMute;
  else {
    modeBeforeMute = settings.mode;
    settings.mode = "mute";
    stopSound();
  }
  renderMute();
  toast(settings.mode === "mute" ? "Σίγαση" : "Ήχος ανοιχτός");
}
