// GPS με αυτόματη επανεκκίνηση, και «φύλακας» που κάθε 2″ ελέγχει ότι όλα δουλεύουν.

import { NAV } from "./config.js";
import { $, haversine, safe } from "./util.js";
import { state } from "./state.js";
import { setStatus, toast, openActions } from "./ui.js";
import { wakeAudio, stopSound } from "./voice.js";
import { reroute, reannounce, keepAwake } from "./nav.js";

const bootTime = Date.now();
let handler = () => {};
export const onPosition = (fn) => (handler = fn);

// Κάθε θέση περνάει από εδώ (GPS, προσομοίωση, τεστ). Ένα λάθος δεν σταματάει τίποτα.
export function feed(pos) {
  safe(() => handler(pos));
}

let watchId = null;
let prevFix = null;

export function startGps() {
  if (!("geolocation" in navigator)) return;
  state.lastGpsRestart = Date.now();
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

function onFix(p) {
  if (state.simTimer) return; // η προσομοίωση έχει τον έλεγχο
  const now = Date.now();
  const { latitude: lat, longitude: lng, accuracy } = p.coords;
  let speed = p.coords.speed;
  // το iPhone δίνει -1 ή τίποτα όταν δεν ξέρει την ταχύτητα: τη βγάζουμε από τις δύο τελευταίες θέσεις
  if (speed == null || speed < 0 || Number.isNaN(speed)) {
    speed = null;
    if (prevFix && now - prevFix.t > 500 && now - prevFix.t < 10000) {
      speed = haversine([prevFix.lat, prevFix.lng], [lat, lng]) / ((now - prevFix.t) / 1000);
    }
  }
  prevFix = { lat, lng, t: now };
  state.lastFix = now;
  if (state.gpsLost) {
    state.gpsLost = false;
    setStatus("");
    reannounce();
  }
  feed({ lat, lng, speed, accuracy });
  renderLocate();
}

function onGpsError(e) {
  if (e.code === 1) {
    state.gpsDenied = true;
    toast("Δεν έχω άδεια τοποθεσίας — πάτα το κόκκινο κουμπί πάνω");
  }
  renderLocate(); // για τα υπόλοιπα (χάθηκε σήμα, timeout) ο φύλακας κάνει επανεκκίνηση
}

// ---------- κουμπί «Δεν ξέρω πού είσαι» ----------

export function renderLocate() {
  // στα πρώτα 4″ δίνουμε χρόνο στο GPS πριν δείξουμε το κόκκινο κουμπί
  const early = Date.now() - bootTime < 4000 && !state.gpsDenied;
  $("locate").hidden = !!state.pos || state.mode === "nav" || early;
}

// Ζητάει την τοποθεσία μετά από πάτημα — έτσι το iPhone δείχνει το παράθυρο άδειας.
export function requestLocation() {
  if (!("geolocation" in navigator)) return locationHelp(true);
  state.gpsDenied = false;
  toast("Ψάχνω πού είσαι…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      onFix(p);
      startGps();
    },
    (e) => !state.pos && locationHelp(e.code === 1),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function locationHelp(denied) {
  openActions(
    {
      html: `<p><b>${denied ? "Η εφαρμογή δεν έχει άδεια για την τοποθεσία σου." : "Δεν βρίσκω την τοποθεσία σου."}</b></p>
      <p>Στο iPhone: <b>Ρυθμίσεις → Απόρρητο & Ασφάλεια → Υπηρεσίες τοποθεσίας</b> (ανοιχτό) → <b>Ιστότοποι Safari</b> → «Κατά τη χρήση» και «Ακριβής τοποθεσία».</p>
      ${denied ? "" : "<p>Αν η άδεια είναι ήδη εντάξει, βγες σε ανοιχτό χώρο (μακριά από κτίρια) και ξαναδοκίμασε.</p>"}
      <p>Μετά κλείσε τελείως την εφαρμογή και άνοιξέ την ξανά.</p>`,
    },
    [{ label: "🔄  Δοκίμασε ξανά", fn: requestLocation }]
  );
}
$("locate").onclick = requestLocation;

// ---------- φύλακας ----------

function watchdog() {
  const now = Date.now();
  renderLocate();
  if (state.simTimer) return;

  // GPS σιωπηλό; επανεκκίνηση
  const silent = now - state.lastFix > NAV.GPS_LOST_MS;
  if (silent && !state.gpsDenied && now - state.lastGpsRestart > NAV.GPS_LOST_MS) startGps();
  if (!state.navigating) return;
  if (silent && !state.arrived && !state.gpsLost) {
    state.gpsLost = true;
    setStatus("Ψάχνω σήμα GPS…");
  }

  // εκτός διαδρομής και απέτυχε ο υπολογισμός; ξαναδοκίμασε
  if (state.offRoute && !state.rerouting && now - state.lastReroute > NAV.REROUTE_RETRY_MS) reroute();

  wakeAudio(); // ο ήχος «κοιμήθηκε»;
  keepAwake(true);
}
setInterval(() => safe(watchdog), 2000);

// Όταν ξαναγυρίσεις στην εφαρμογή (κλείδωμα οθόνης, άλλη εφαρμογή, κλήση): όλα ξανά, αμέσως.
function resume() {
  if (document.hidden) return;
  state.gpsDenied = false; // ίσως έδωσες άδεια στο μεταξύ
  startGps();
  wakeAudio();
  stopSound(); // ξεκολλάει τη φωνή αν είχε μείνει μισή φράση
  if (state.navigating) {
    keepAwake(true);
    reannounce();
  }
}
document.addEventListener("visibilitychange", resume);
window.addEventListener("pageshow", resume);
