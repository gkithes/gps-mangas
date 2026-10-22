// GPS Μάγκας — πλοήγηση με ατάκες.
// Χάρτης: OpenStreetMap, διαδρομές: OSRM, αναζήτηση: Photon/Nominatim, κοντινά μέρη: Overpass (τοπική μνήμη),
// φωνή: Web Speech (el-GR).

const OSRM = [
  "https://router.project-osrm.org/route/v1/driving/",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";

const OFF_ROUTE_M = 60;       // πόσο μακριά από τη γραμμή = εκτός διαδρομής
const PASSED_M = 8;           // πόσο μετά τη στροφή θεωρείται «περασμένη»
const IDLE_SECONDS = 90;
const GPS_LOST_MS = 10000;    // χωρίς θέση τόσο χρόνο = χάθηκε το σήμα
const REROUTE_RETRY_MS = 5000;

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
const bootTime = Date.now();

// Το iPhone να μη μεγεθύνει τη σελίδα με τσίμπημα (ο χάρτης ζουμάρει κανονικά).
document.addEventListener("gesturestart", (e) => e.preventDefault());

// ---------- ασφάλεια: ένα λάθος δεν σταματάει ποτέ την πλοήγηση ----------

let lastErrorToast = 0;
function reportError(e) {
  console.error(e);
  if (Date.now() - lastErrorToast > 30000 && typeof toast === "function") {
    lastErrorToast = Date.now();
    toast("Κάτι στράβωσε, αλλά συνεχίζω.");
  }
}
function safe(fn) {
  try {
    return fn();
  } catch (e) {
    reportError(e);
  }
}
window.addEventListener("error", (e) => reportError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

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

// Τελευταία γνωστή θέση, για να ανοίγει η εφαρμογή αμέσως εκεί που είσαι.
let lastKnown = null;
try {
  lastKnown = JSON.parse(localStorage.getItem("gps-mangas-last-pos") || "null");
} catch {}

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

const startView = lastKnown ? [lastKnown.lat, lastKnown.lng] : [37.9838, 23.7275];
const map = L.map("map", { zoomControl: false, attributionControl: false }).setView(startView, lastKnown ? 15 : 13);
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
  lastFix: 0,         // πότε ήρθε η τελευταία θέση από το GPS
  lastGpsRestart: 0,
  gpsLost: false,
  dest: null,         // { lat, lng, name, sub }
  routes: [],         // εναλλακτικές διαδρομές στην προεπισκόπηση
  selected: 0,
  route: null,        // η διαδρομή της πλοήγησης
  next: 0,            // index of the next maneuver in route.steps
  announced: {},      // τι έχει ειπωθεί για την τρέχουσα στροφή
  offCount: 0,
  offRoute: false,
  rerouting: false,
  recalcSpoken: false,
  lastReroute: 0,
  lastSpeedWarn: 0,
  stillSince: null,
  lastIdleWarn: 0,
  navigating: false,
  arrived: false,
  follow: true,
  simTimer: null,
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

function setStatus(text) {
  $("status").textContent = text || "";
  $("status").hidden = !text;
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
  if (typeof renderLocate === "function") renderLocate();
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
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
  document.removeEventListener("pointerdown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);

function chime() {
  if (!settings.chime || !audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
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

// Δική μας ουρά ομιλίας: δίνουμε στη φωνή του κινητού μία φράση τη φορά και
// την παρακολουθούμε. Αν «κολλήσει» (συμβαίνει στο iPhone), την ξεκολλάμε αμέσως
// και ξαναλέμε τη φράση, ώστε να μη χαθεί καμία οδηγία.
const speech = { queue: [], job: null, eventsWork: false };

function stopSound() {
  speech.queue.length = 0;
  if (speech.job) {
    clearTimeout(speech.job.timer);
    speech.job = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  player.pause();
}

function speak(text, interrupt = false) {
  if (settings.mode === "mute" || !text || !("speechSynthesis" in window)) return;
  if (interrupt) stopSound();
  speech.queue.push({ text, tries: 0 });
  // στο iPhone, μια φράση αμέσως μετά το cancel() χάνεται — μικρή αναμονή
  setTimeout(pumpSpeech, interrupt ? 120 : 0);
}

function pumpSpeech() {
  if (speech.job || !speech.queue.length) return;
  // μην μιλάμε πάνω από δική σου ηχογράφηση
  if (!player.paused && !player.ended && player.dataset.url) return void setTimeout(pumpSpeech, 300);
  const item = speech.queue.shift();
  const job = { item, started: false, timer: null };
  speech.job = job;

  const finish = () => {
    if (speech.job !== job) return;
    clearTimeout(job.timer);
    speech.job = null;
    pumpSpeech();
  };
  const stuck = () => {
    if (speech.job !== job) return;
    // Μιλάει ήδη (απλώς δεν ειδοποίησε); άφησέ τη να τελειώσει, με όριο χρόνου.
    if (!job.started && speechSynthesis.speaking && !job.waited) {
      job.waited = true;
      job.timer = setTimeout(stuck, Math.max(8000, (item.text.length * 140) / settings.rate));
      return;
    }
    speechSynthesis.cancel();
    speech.job = null;
    // ξαναλέμε τη φράση μόνο αν η φωνή του κινητού ειδοποιεί κανονικά (αλλιώς θα την ακούγαμε διπλή)
    if (!job.started && !job.waited && speech.eventsWork && item.tries < 2) {
      item.tries++;
      speech.queue.unshift(item); // ξαναπροσπάθησε την ίδια φράση
    }
    setTimeout(pumpSpeech, 150);
  };

  try {
    speechSynthesis.resume(); // ξεκολλάει τη φωνή μετά από κλήση, Siri κ.λπ.
  } catch {}
  chime();
  const u = new SpeechSynthesisUtterance(item.text);
  const v = currentVoice();
  u.lang = v ? v.lang : "el-GR";
  if (v) u.voice = v;
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  u.volume = settings.volume;
  u.onstart = () => {
    job.started = true;
    speech.eventsWork = true;
    clearTimeout(job.timer);
    job.timer = setTimeout(stuck, Math.max(8000, (item.text.length * 140) / settings.rate));
  };
  u.onend = finish;
  u.onerror = finish;
  job.timer = setTimeout(stuck, 4000); // δεν ξεκίνησε σε 4″ = κόλλησε
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

// Ετοιμάζει τη διαδρομή για γρήγορο εντοπισμό: απόσταση από την αρχή σε κάθε σημείο
// και σε κάθε στροφή («πόσα μέτρα της διαδρομής έχουν γίνει»).
function prepareRoute(r) {
  const c = r.coords;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine(c[i - 1], c[i]));
  let j = 0;
  for (const s of r.steps) {
    let best = Infinity, bi = j;
    for (let k = j; k < c.length; k++) {
      const d = haversine(c[k], s.loc);
      if (d < best) {
        best = d;
        bi = k;
        if (d < 1) break;
      }
    }
    s.along = cum[bi];
    j = bi;
  }
  r.cum = cum;
  r.length = cum[cum.length - 1];
  r.seg = 0;
  return r;
}

// Πού βρίσκεσαι πάνω στη διαδρομή: πόσα μέτρα έχεις κάνει (along) και πόσο μακριά είσαι από τη γραμμή (off).
function locate(r, p) {
  const c = r.coords;
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  const scan = (from, to) => {
    let best = { off: Infinity, seg: from, along: 0 };
    for (let i = from; i < to; i++) {
      const ax = (c[i][1] - p[1]) * kx, ay = (c[i][0] - p[0]) * ky;
      const bx = (c[i + 1][1] - p[1]) * kx, by = (c[i + 1][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.off) best = { off, seg: i, along: r.cum[i] + t * (r.cum[i + 1] - r.cum[i]) };
    }
    return best;
  };
  const last = c.length - 1;
  // πρώτα κοντά στο σημείο που ήσουν (γρήγορο), αλλιώς σε όλη τη διαδρομή
  let res = scan(Math.max(0, r.seg - 20), Math.min(last, r.seg + 400));
  if (res.off > 40) {
    const all = scan(0, last);
    if (all.off < res.off - 5) res = all;
  }
  r.seg = res.seg;
  return res;
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

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

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

// Η θέση σου για αναζητήσεις: η τωρινή από το GPS, αλλιώς η τελευταία γνωστή.
// Ποτέ το κέντρο του χάρτη — αλλιώς ψάχνει στην άλλη άκρη του κόσμου.
function origin() {
  return state.pos || lastKnown || null;
}

function renderLocate() {
  // στα πρώτα 4″ δίνουμε χρόνο στο GPS πριν δείξουμε το κόκκινο κουμπί
  const early = Date.now() - bootTime < 4000 && !state.gpsDenied;
  $("locate").hidden = !!state.pos || state.mode === "nav" || early;
}

// Ζητάει την τοποθεσία μετά από πάτημα (έτσι το iPhone δείχνει το παράθυρο άδειας).
function requestLocation() {
  if (!("geolocation" in navigator)) return locationHelp();
  state.gpsDenied = false;
  toast("Ψάχνω πού είσαι…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      onFix(p);
      startGps();
    },
    (e) => {
      if (state.pos) return; // στο μεταξύ ήρθε θέση από το άλλο κανάλι
      locationHelp(e.code === 1);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function locationHelp(denied = true) {
  $("actions-title").innerHTML = `<p><b>${denied ? "Η εφαρμογή δεν έχει άδεια για την τοποθεσία σου." : "Δεν βρίσκω την τοποθεσία σου."}</b></p>
    <p>Στο iPhone: <b>Ρυθμίσεις → Απόρρητο & Ασφάλεια → Υπηρεσίες τοποθεσίας</b> (ανοιχτό) → <b>Ιστότοποι Safari</b> → «Κατά τη χρήση» και «Ακριβής τοποθεσία».</p>
    ${denied ? "" : "<p>Αν η άδεια είναι ήδη εντάξει, βγες σε ανοιχτό χώρο (μακριά από κτίρια) και ξαναδοκίμασε.</p>"}
    <p>Μετά κλείσε τελείως την εφαρμογή και άνοιξέ την ξανά.</p>`;
  const box = $("actions-buttons");
  box.innerHTML = "";
  const b = document.createElement("button");
  b.className = "pill";
  b.textContent = "🔄  Δοκίμασε ξανά";
  b.onclick = () => {
    $("actions").hidden = true;
    requestLocation();
  };
  box.appendChild(b);
  $("actions").hidden = false;
}
$("locate").onclick = requestLocation;

// Αν δεν ξέρουμε καθόλου πού είσαι, το λέμε αντί να ψάξουμε λάθος μέρος.
function needLocation(where) {
  if (origin()) return false;
  where.innerHTML = '<li class="empty">📍 Δεν ξέρω πού είσαι. Πάτα το κόκκινο κουμπί για να ενεργοποιήσεις την τοποθεσία.</li>';
  renderLocate();
  return true;
}

function placeRow(icon, name, sub, right) {
  const li = document.createElement("li");
  li.innerHTML = `<div class="badge">${icon}</div>
    <div class="body"><div class="name">${escapeHtml(name)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</div>
    ${right ? `<div class="right">${escapeHtml(right)}</div>` : ""}`;
  return li;
}

function photonToPlace(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city || "Σημείο";
  const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "", p.city || p.county, p.state, p.country]
    .filter((x) => x && x !== name)
    .join(", ");
  return { lat, lng, name, sub };
}

const NEAR_BOX = 0.6; // ~65 χλμ γύρω σου: εκεί ψάχνουμε πρώτα

// Πιο κοντινά πρώτα· αν υπάρχει κάτι κοντά, τα πολύ μακρινά (άλλη χώρα) πετιούνται.
function byDistance(list, from) {
  const withD = list.map((p) => ({ ...p, d: haversine([from.lat, from.lng], [p.lat, p.lng]) })).sort((a, b) => a.d - b.d);
  if (withD.length && withD[0].d < 100000) return withD.filter((p) => p.d < 500000);
  return withD;
}

async function searchPhoton(q, from, signal, limit = 8) {
  const run = async (bounded) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (from) {
      params.set("lat", from.lat.toFixed(4));
      params.set("lon", from.lng.toFixed(4));
      if (bounded) params.set("bbox", [from.lng - NEAR_BOX, from.lat - NEAR_BOX, from.lng + NEAR_BOX, from.lat + NEAR_BOX].map((x) => x.toFixed(4)).join(","));
    }
    const data = await Net.json(`${PHOTON}?${params}`, { signal }, 6000);
    return (data.features || []).map(photonToPlace);
  };
  let res = from ? await run(true) : [];
  if (res.length < 3) res = [...res, ...(await run(false))];
  return from ? byDistance(res, from) : res;
}

async function searchNominatim(q, from, signal) {
  const run = async (bounded) => {
    const params = new URLSearchParams({ q, format: "json", limit: "8" });
    if (from) {
      params.set("viewbox", [from.lng - NEAR_BOX, from.lat + NEAR_BOX, from.lng + NEAR_BOX, from.lat - NEAR_BOX].map((x) => x.toFixed(4)).join(","));
      if (bounded) params.set("bounded", "1");
    }
    const data = await Net.json(`${NOMINATIM}?${params}`, { signal }, 8000);
    return data.map((r) => {
      const [first, ...rest] = r.display_name.split(",");
      return { lat: +r.lat, lng: +r.lon, name: first.trim(), sub: rest.join(",").trim() };
    });
  };
  let res = from ? await run(true) : [];
  if (!res.length) res = await run(false);
  return from ? byDistance(res, from) : res;
}

// «βενζίνη», «gas near me», «φαρμακείο κοντά μου»… → ανοίγει τα κοντινά της κατηγορίας.
const NEAR_WORDS = /\b(near me|nearby|near by|around me|close to me|closest|nearest)\b|κοντα μου|κοντινο|κοντινα|κοντινοτερ|εδω γυρω|πλησιεστερ/g;
const INTENTS = {
  fuel: ["gas", "fuel", "petrol", "βενζιν", "πρατηρι", "καυσιμ", "πετρελαι"],
  food: ["restaurant", "food", "eat", "pizza", "burger", "diner", "εστιατορ", "ταβερν", "φαγητ", "φαι", "σουβλακ", "πιτσ", "ψησταρι"],
  cafe: ["cafe", "coffee", "καφε", "καφετερ"],
  market: ["supermarket", "grocery", "market", "σουπερ", "μαρκετ", "παντοπωλ"],
  pharmacy: ["pharmacy", "drugstore", "φαρμακ"],
  parking: ["parking", "παρκιν", "σταθμευσ"],
  atm: ["atm", "bank", "αταμ", "τραπεζ"],
  ev: ["charging", "charger", "φορτισ"],
  hotel: ["hotel", "motel", "ξενοδοχ"],
  hospital: ["hospital", "clinic", "urgent care", "νοσοκομ", "κλινικ"],
  carwash: ["car wash", "πλυντηρ"],
  repair: ["mechanic", "repair", "tire", "tyre", "συνεργ", "βουλκαν", "λαστιχ"],
  wc: ["toilet", "restroom", "bathroom", "τουαλετ"],
};
// Επιστρέφει { key, strong }: strong = σίγουρα ζητάει «κοντά μου» (π.χ. «βενζίνη», «gas near me»),
// οπότε το «Πάμε» ανοίγει κατευθείαν τη λίστα· αλλιώς (π.χ. «Market Street») απλώς προτείνεται.
function nearbyIntent(q) {
  const norm = POI.normalize(q);
  const asked = NEAR_WORDS.test(norm);
  NEAR_WORDS.lastIndex = 0;
  const rest = norm.replace(NEAR_WORDS, " ").replace(/\b(stations?|a|the|any)\b/g, " ").replace(/\s+/g, " ").trim();
  NEAR_WORDS.lastIndex = 0;
  if (!rest) return null;
  const words = rest.split(" ").length;
  if (!asked && words > 2) return null;
  for (const [key, stems] of Object.entries(INTENTS)) {
    if (stems.some((st) => rest.startsWith(st) || rest.includes(" " + st))) return { key, strong: asked || words === 1 };
  }
  return null;
}

function openNearby(key) {
  $("dest").value = "";
  $("results").innerHTML = "";
  $("dest").blur();
  showNearby(key, document.querySelector(`.chip[data-key="${key}"]`));
}

// Άμεσες προτάσεις από ό,τι υπάρχει ήδη στο κινητό: αγαπημένα, πρόσφατα, κοντινά μέρη.
function localSuggestions(q, from) {
  const norm = POI.normalize(q);
  if (!from) from = { lat: 0, lng: 0 };
  const out = [];
  const seen = new Set();
  const add = (icon, p) => {
    const k = `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ icon, place: p });
  };
  for (const p of Places.favorites()) if (POI.normalize(p.name + " " + p.sub).includes(norm)) add("★", p);
  for (const p of Places.history()) if (POI.normalize(p.name + " " + p.sub).includes(norm)) add("🕘", p);
  for (const p of POI.find(norm, from, 5)) add(POI.CATS[p.cat][1], p);
  return out.slice(0, 8);
}

let suggestAbort = null;
let suggestTimer = null;
let lastSuggest = { q: "", remote: [] };

function renderResults(q, local, remote, { loading = false, header = "" } = {}) {
  const list = $("results");
  const from = origin();
  list.innerHTML = "";
  if (!from) {
    const h = document.createElement("li");
    h.className = "head";
    h.textContent = "📍 Δεν ξέρω πού είσαι — τα αποτελέσματα μπορεί να μην είναι κοντά σου";
    list.appendChild(h);
  }
  if (header) {
    const h = document.createElement("li");
    h.className = "head";
    h.textContent = header;
    list.appendChild(h);
  }
  const seen = new Set();
  const addRow = (icon, place) => {
    const k = `${(+place.lat).toFixed(3)},${(+place.lng).toFixed(3)}|${POI.normalize(place.name)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const li = placeRow(icon, place.name, place.sub, from ? fmtShort(haversine([from.lat, from.lng], [place.lat, place.lng])) : "");
    li.onclick = () => {
      $("dest").value = "";
      list.innerHTML = "";
      previewDestination(place);
    };
    list.appendChild(li);
  };
  const intent = nearbyIntent(q);
  if (intent) {
    const [label, icon] = POI.CATS[intent.key];
    const li = placeRow(icon, `${label} κοντά σου`, "Όλα τα κοντινά, πιο κοντινά πρώτα", "");
    li.classList.add("intent");
    li.onclick = () => openNearby(intent.key);
    list.appendChild(li);
  }
  for (const s of local) addRow(s.icon, s.place);
  for (const p of remote) addRow("📍", p);
  if (loading) {
    const li = document.createElement("li");
    li.className = "loading";
    li.textContent = "Ψάχνω…";
    list.appendChild(li);
  } else if (!list.querySelector("li:not(.head)")) {
    list.innerHTML = "";
    list.innerHTML = `<li class="empty">Δεν βρήκα «${escapeHtml(q)}». Γράψ' το σωστά, ρε!</li>`;
  }
}

// Προτάσεις όσο γράφεις: τα τοπικά αμέσως, τα υπόλοιπα από το ίντερνετ σε λίγο.
$("dest").addEventListener("input", () => {
  const q = $("dest").value.trim();
  clearTimeout(suggestTimer);
  if (suggestAbort) suggestAbort.abort();
  if (q.length < 2) {
    $("results").innerHTML = "";
    return;
  }
  const from = origin();
  const local = localSuggestions(q, from);
  renderResults(q, local, [], { loading: true });
  suggestTimer = setTimeout(async () => {
    const ctrl = (suggestAbort = new AbortController());
    try {
      const remote = await searchPhoton(q, from, ctrl.signal, 6);
      if (ctrl.signal.aborted || $("dest").value.trim() !== q) return;
      lastSuggest = { q, remote };
      renderResults(q, local, remote);
    } catch {
      if (!ctrl.signal.aborted && $("dest").value.trim() === q) renderResults(q, local, []);
    }
  }, 250);
});

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("dest").value.trim();
  // Η μπάρα αδειάζει εντελώς μόλις πατηθεί «Πάμε».
  $("dest").value = "";
  $("dest").blur();
  clearTimeout(suggestTimer);
  if (suggestAbort) suggestAbort.abort();
  if (!q) return;
  const intent = nearbyIntent(q);
  if (intent && intent.strong) return openNearby(intent.key); // «βενζίνη κοντά μου» → κατευθείαν η λίστα
  const from = origin();
  const header = `Αποτελέσματα για «${q}»`;
  const local = localSuggestions(q, from);
  // ό,τι βρήκαν ήδη οι προτάσεις φαίνεται αμέσως
  const have = lastSuggest.q === q ? lastSuggest.remote : [];
  renderResults(q, local, have, { loading: true, header });
  const ctrl = (suggestAbort = new AbortController());
  let remote = [];
  try {
    remote = await searchNominatim(q, from, ctrl.signal);
  } catch {}
  if (!remote.length && !ctrl.signal.aborted) {
    try {
      remote = await searchPhoton(q, from, ctrl.signal);
    } catch {}
  }
  if (ctrl.signal.aborted) return;
  renderResults(q, local, [...have, ...remote], { header });
});

// ---------- κοντινά μέρη (κάτω μπάρα) ----------

for (const [key, [label, icon]] of Object.entries(POI.CATS)) {
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.key = key;
  b.innerHTML = `<span>${icon}</span>${label}`;
  b.onclick = () => showNearby(key, b);
  $("ribbon").appendChild(b);
}

function renderNearby(key, items, loading) {
  const [label, icon] = POI.CATS[key];
  const list = $("places-list");
  const from = origin();
  list.innerHTML = "";
  if (loading) {
    const li = document.createElement("li");
    li.className = "loading";
    li.textContent = items.length ? "Ανανέωση…" : "Ψάχνω…";
    list.appendChild(li);
  }
  poiLayer.clearLayers();
  if (!items.length) {
    if (!loading) list.innerHTML = '<li class="empty">Τίποτα εδώ γύρω. Έρημος, ρε!</li>';
    return;
  }
  const poiIcon = L.divIcon({ className: "poi-pin", html: `<div>${icon}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  for (const p of items) {
    const li = placeRow(icon, p.name || label, p.sub, fmtShort(p.dist));
    li.onclick = () => previewDestination(p);
    list.appendChild(li);
    L.marker([p.lat, p.lng], { icon: poiIcon }).on("click", () => previewDestination(p)).addTo(poiLayer);
  }
  const bounds = L.latLngBounds(items.slice(0, 8).map((p) => [p.lat, p.lng])).extend([from.lat, from.lng]);
  map.fitBounds(bounds, fitPadding());
}

async function showNearby(key, chip) {
  const [label, icon] = POI.CATS[key];
  setMode("places");
  chip.classList.add("on");
  chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  $("places-title").textContent = `${icon} ${label} κοντά σου`;
  const from = origin();
  if (needLocation($("places-list"))) return;
  const stillHere = () => state.mode === "places" && chip.classList.contains("on");

  // 1) αμέσως ό,τι έχουμε στο κινητό
  let items = POI.nearby(key, from);
  const fresh = POI.isFresh(from);
  const wideDone = items.length >= 3 || POI.searchedWide(key, from);
  renderNearby(key, items, !fresh || !wideDone);
  if (fresh && wideDone) return;

  // 2) γρήγορη απάντηση σε ~1″ όσο κατεβαίνει ολόκληρη η περιοχή
  let quickDone = Promise.resolve();
  if (!fresh) {
    quickDone = POI.quick(key, from)
      .then(() => {
        if (stillHere() && !POI.isFresh(from)) renderNearby(key, POI.nearby(key, from), true);
      })
      .catch(() => {});
  }

  // 3) ανανέωση της περιοχής, 4) αν είναι ακόμα λίγα, ψάξε πιο μακριά
  try {
    if (!fresh) await POI.refresh(from, { force: true });
    if (!stillHere()) return;
    items = POI.nearby(key, from);
    if (items.length < 3 && !POI.searchedWide(key, from)) {
      renderNearby(key, items, true);
      items = await POI.liveSearch(key, from);
    }
  } catch {
    await quickDone;
    if (!stillHere()) return;
    items = POI.nearby(key, from);
    if (!items.length) {
      $("places-list").innerHTML = '<li class="empty">Δεν απαντάει ο χάρτης. Δοκίμασε ξανά σε λίγο.</li>';
      return;
    }
  }
  if (stillHere()) renderNearby(key, items, false);
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
  return prepareRoute({
    coords, steps,
    distance: r.distance,
    duration: r.duration,
    via: r.legs[0].summary || "",
    toll: classes.has("toll"),
    motorway: classes.has("motorway"),
    ferry: classes.has("ferry"),
    turns,
  });
}

async function fetchRoutes(from, to, alternatives = true) {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? 3 : "false"}`;
  const data = await Net.json(OSRM.map((base) => base + path), {}, 10000);
  if (data.code !== "Ok" || !data.routes.length) throw new Error(data.message || "no route");
  return data.routes.map(parseRoute).sort((a, b) => a.duration - b.duration);
}

// Δείχνει τις εναλλακτικές διαδρομές στον χάρτη για να διαλέξεις.
async function previewDestination(dest) {
  state.dest = { lat: +dest.lat, lng: +dest.lng, name: dest.name, sub: dest.sub || "" };
  $("results").innerHTML = "";
  setMode("preview");
  $("preview-title").textContent = state.dest.name;
  $("preview-sub").textContent = state.dest.sub;
  renderFavButton();
  $("route-list").innerHTML = '<li class="loading">Βρίσκω διαδρομές…</li>';
  $("go").disabled = true;
  routeLayer.clearLayers();
  if (destMarker) destMarker.remove();
  destMarker = L.marker([state.dest.lat, state.dest.lng], { icon: destIcon }).addTo(map);
  const want = state.dest;
  if (!state.pos && !lastKnown) {
    $("route-list").innerHTML = '<li class="empty">📍 Χρειάζομαι την τοποθεσία σου για να βρω διαδρομή. Πάτα «Δεν ξέρω πού είσαι» πάνω.</li>';
    renderLocate();
    return;
  }

  let routes;
  try {
    routes = await fetchRoutes(origin(), state.dest);
  } catch {
    if (state.mode !== "preview" || state.dest !== want) return;
    $("route-list").innerHTML = '<li class="empty">Δεν βρήκα δρόμο. Με βάρκα θα πας;</li>';
    return;
  }
  if (state.mode !== "preview" || state.dest !== want) return;
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
    const line = L.polyline(r.coords, { color: sel ? "#3d8bfd" : "#8e99a8", weight: 7, opacity: sel ? 1 : 0.85 });
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

function setNavRoute(r) {
  state.route = r;
  state.next = -1; // θα οριστεί στην πρώτη θέση
  state.announced = {};
  state.offCount = 0;
  state.offRoute = false;
  state.recalcSpoken = false;
  state.arrived = false;
  drawNavRoute();
}

function startNavigation() {
  setMode("nav");
  state.navigating = true;
  state.follow = true;
  setNavRoute(state.route);
  setStatus("");
  keepAwake(true);
  const first = state.route.steps[1] || state.route.steps[0];
  showStep(first, first.along, quip("start", "Ξεκινάμε"));
  updateTrip(0);
  if (state.pos) {
    map.setView([state.pos.lat, state.pos.lng], 17);
    guide(state.pos); // αμέσως η πρώτη οδηγία, χωρίς να περιμένουμε το επόμενο GPS
  }
}

function stopNavigation() {
  state.navigating = false;
  stopSim();
  setMode("home");
  setStatus("");
  state.route = null;
  renderDrawer();
  keepAwake(false);
}
$("stop").onclick = () => {
  stopNavigation();
  speak("Άντε, γεια.", true);
};

// Νέα διαδρομή όταν βγεις από τον δρόμο. Αν αποτύχει, ο φύλακας ξαναδοκιμάζει κάθε 5″.
async function reroute() {
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
    setNavRoute(r);
    setStatus("");
    guide(state.pos);
  } catch {
    setStatus("Δεν απαντάει ο χάρτης — ξαναδοκιμάζω…");
  } finally {
    state.rerouting = false;
  }
}

function showStep(step, dist, quipText) {
  $("arrow").innerHTML = arrowSvg(step);
  $("dist").textContent = dist != null ? fmtShort(dist) : "";
  $("instr").textContent = step ? instruction(step) : "";
  if (quipText !== undefined) $("quip").textContent = quipText;
}

function updateTrip(along) {
  const r = state.route;
  const rest = Math.max(0, r.length - along);
  const secs = r.length ? (rest / r.length) * r.duration : 0;
  $("eta-min").textContent = Math.max(rest > 0 ? 1 : 0, Math.round(secs / 60));
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
  if (first) renderLocate();
  saveLastPos(pos);
  if (!state.navigating) POI.refresh(pos).catch(() => {}); // κοντινά μέρη στο παρασκήνιο
  if (state.navigating && state.route) safe(() => guide(pos));
}

let lastPosSave = 0;
function saveLastPos(pos) {
  if (Date.now() - lastPosSave < 30000) return;
  lastPosSave = Date.now();
  try {
    localStorage.setItem("gps-mangas-last-pos", JSON.stringify({ lat: pos.lat, lng: pos.lng }));
  } catch {}
}

// Η καρδιά της πλοήγησης: βρίσκει πού είσαι πάνω στη διαδρομή και ποια είναι η επόμενη στροφή.
// Δεν χρειάζεται να περάσεις ακριβώς από το σημείο της στροφής — ακόμα κι αν το GPS
// «πετάει» 50+ μέτρα δίπλα ή χάσει μερικές θέσεις, η επόμενη οδηγία βγαίνει σωστά.
function guide(pos) {
  const route = state.route;
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
    state.stillSince = state.stillSince || now;
    if (now - state.stillSince > IDLE_SECONDS * 1000 && now - state.lastIdleWarn > 120000) {
      state.lastIdleWarn = now;
      if (settings.mode !== "plain") quip("idle", "", false);
    }
  } else {
    state.stillSince = null;
  }

  // εκτός διαδρομής;
  const loc = locate(route, here);
  if (loc.off > OFF_ROUTE_M && (pos.accuracy || 0) < 60) {
    if (++state.offCount >= 3) {
      state.offRoute = true;
      if (now - state.lastReroute > REROUTE_RETRY_MS) reroute();
      return;
    }
  } else {
    state.offCount = 0;
    if (state.offRoute) {
      // γύρισες μόνος σου στη διαδρομή
      state.offRoute = false;
      state.recalcSpoken = false;
      setStatus("");
    }
  }
  if (state.offRoute) return;

  const along = loc.along;
  updateTrip(along);

  // επόμενη στροφή = η πρώτη που δεν έχεις περάσει ακόμα
  const steps = route.steps;
  let idx = steps.findIndex((s, i) => i > 0 && s.along > along + PASSED_M);
  if (idx < 0) idx = steps.length - 1;
  // Μια στροφή που πέρασες δεν ξαναγυρίζει επειδή «πήδηξε» το GPS·
  // μόνο αν όντως γύρισες πίσω πάνω από 60 μ.
  if (state.next > 0 && idx < state.next && along > steps[state.next - 1].along - 60) idx = state.next;
  if (idx !== state.next) {
    if (state.next >= 0) $("quip").textContent = ""; // νέα στροφή: σβήσε την παλιά ατάκα
    state.next = idx;
    state.announced = {};
  }
  const step = steps[idx];
  const d = Math.max(0, step.along - along);
  const instr = instruction(step);

  // άφιξη
  if (step.type === "arrive" && (d < 25 || haversine(here, step.loc) < 30)) {
    if (!state.arrived) {
      state.arrived = true;
      showStep(step, null, quip("arrive", "Έφτασες στον προορισμό"));
      setStatus("");
      stopSim();
    }
    return;
  }

  // αποστάσεις ανάλογα με την ταχύτητα: στην εθνική ειδοποιεί νωρίτερα
  const v = pos.speed != null && pos.speed > 1 ? pos.speed : 13;
  const farDist = Math.min(800, Math.max(200, v * 15));
  const nearDist = Math.min(120, Math.max(40, v * 3.5));
  const a = state.announced;

  // μόλις φανεί νέα στροφή μακριά: «Συνέχισε για 2 χλμ και μετά…» — για να ξέρεις ότι σε ακούει
  if (!a.intro) {
    a.intro = true;
    if (d > farDist + 150 && settings.mode !== "quips") {
      const then = step.type === "arrive" ? "φτάνεις στον προορισμό" : lowerFirst(instr);
      speak(`Συνέχισε για ${fmtDist(d)}, και μετά ${then}`);
    }
  }

  if (!a.far && d <= farDist && d > nearDist) {
    a.far = true;
    if (settings.mode !== "quips") {
      if (step.type === "arrive") speak(`Σε ${fmtDist(d)} φτάνεις στον προορισμό`);
      else speak(`Σε ${fmtDist(d)}, ${lowerFirst(instr)}`);
    }
  }

  if (!a.near && d <= nearDist && step.type !== "arrive") {
    a.near = true;
    a.far = true;
    showStep(step, d, quip(category(step), instr));
  } else {
    showStep(step, d);
  }
}

// ---------- GPS με αυτόματη επανεκκίνηση ----------

let watchId = null;
let prevFix = null;

function startGps() {
  if (!("geolocation" in navigator)) return;
  state.lastGpsRestart = Date.now();
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
}

function onFix(p) {
  if (state.simTimer) return; // η προσομοίωση έχει τον έλεγχο
  const now = Date.now();
  let speed = p.coords.speed;
  // το iPhone δίνει -1 ή τίποτα όταν δεν ξέρει την ταχύτητα: τη βγάζουμε από τις δύο τελευταίες θέσεις
  if (speed == null || speed < 0 || Number.isNaN(speed)) {
    speed = null;
    if (prevFix && now - prevFix.t > 500 && now - prevFix.t < 10000) {
      speed = haversine([prevFix.lat, prevFix.lng], [p.coords.latitude, p.coords.longitude]) / ((now - prevFix.t) / 1000);
    }
  }
  prevFix = { lat: p.coords.latitude, lng: p.coords.longitude, t: now };
  state.lastFix = now;
  if (state.gpsLost) {
    state.gpsLost = false;
    setStatus("");
    if (state.navigating) state.announced = {}; // ξαναπές την τρέχουσα οδηγία
  }
  safe(() =>
    onPosition({ lat: p.coords.latitude, lng: p.coords.longitude, speed, accuracy: p.coords.accuracy })
  );
}

function onGpsError(e) {
  if (e.code === 1) {
    state.gpsDenied = true;
    toast("Δεν έχω άδεια τοποθεσίας — πάτα το κόκκινο κουμπί πάνω");
  }
  renderLocate();
  // για τα υπόλοιπα (χάθηκε σήμα, timeout) ο φύλακας κάνει επανεκκίνηση
}

// ---------- φύλακας: κάθε 2″ ελέγχει ότι όλα δουλεύουν και διορθώνει αμέσως ----------

function watchdog() {
  const now = Date.now();
  if (state.simTimer) return;

  // GPS σιωπηλό; επανεκκίνηση
  if (!state.gpsDenied && now - state.lastFix > GPS_LOST_MS && now - state.lastGpsRestart > GPS_LOST_MS) startGps();
  if (state.navigating && !state.arrived && now - state.lastFix > GPS_LOST_MS && !state.gpsLost) {
    state.gpsLost = true;
    setStatus("Ψάχνω σήμα GPS…");
  }

  if (!state.navigating) return;

  // εκτός διαδρομής και απέτυχε ο υπολογισμός; ξαναδοκίμασε
  if (state.offRoute && !state.rerouting && now - state.lastReroute > REROUTE_RETRY_MS) reroute();

  // ο ήχος «κοιμήθηκε»;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

  // η οθόνη να μένει ανοιχτή
  keepAwake(true);
}
setInterval(() => safe(watchdog), 2000);

// Όταν ξαναγυρίσεις στην εφαρμογή (κλείδωμα οθόνης, άλλη εφαρμογή, κλήση): όλα από την αρχή, αμέσως.
function resumeApp() {
  if (document.hidden) return;
  state.gpsDenied = false; // ίσως έδωσες άδεια στο μεταξύ
  startGps();
  if (audioCtx) audioCtx.resume().catch(() => {});
  stopSound(); // ξεκολλάει τη φωνή αν είχε μείνει μισή φράση
  if (state.navigating) {
    keepAwake(true);
    state.announced = {}; // θα ξαναπεί πού πάμε με την επόμενη θέση
    if (state.pos && !state.simTimer) safe(() => guide(state.pos));
  }
}
document.addEventListener("visibilitychange", resumeApp);
window.addEventListener("pageshow", resumeApp);
window.addEventListener("focus", resumeApp);

// ---------- η οθόνη να μη σβήνει στην πλοήγηση ----------

const noSleep = window.NoSleep ? new NoSleep() : null;
function keepAwake(on) {
  if (!noSleep) return;
  try {
    if (on && !noSleep.isEnabled) Promise.resolve(noSleep.enable()).catch(() => {});
    if (!on && noSleep.isEnabled) noSleep.disable();
  } catch {}
}
// το iPhone επιτρέπει το «ξύπνημα» μόνο μετά από άγγιγμα — ξαναπροσπαθούμε σε κάθε άγγιγμα
document.addEventListener("pointerdown", () => state.navigating && keepAwake(true));

// ---------- προσομοίωση ----------

function stopSim() {
  clearInterval(state.simTimer);
  state.simTimer = null;
  $("sim").textContent = "Προσομοίωση";
}

$("sim").onclick = () => {
  if (state.simTimer) return stopSim();
  if (!state.route) return toast("Βάλε πρώτα προορισμό.");
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
setTimeout(renderLocate, 4000); // αν σε 4″ δεν έχει έρθει θέση, δείξε το κουμπί
renderDrawer();
startGps();
// κοντινά μέρη για την τελευταία γνωστή θέση, πριν καν απαντήσει το GPS
if (lastKnown) setTimeout(() => !state.pos && POI.refresh(lastKnown).catch(() => {}), 1500);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
