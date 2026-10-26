// GPS με αυτόματη επανεκκίνηση, και «φύλακας» που κάθε 2″ ελέγχει ότι όλα δουλεύουν.

import { NAV } from "./config.js";
import { $, haversine, safe } from "./util.js";
import { state } from "./state.js";
import { setStatus, toast, openActions } from "./ui.js";
import { wakeAudio, stopSound } from "./voice.js";
import { reroute, reannounce, keepAwake } from "./nav.js";
import { t } from "./i18n.js";

const bootTime = Date.now();
let handler = () => {};
export const onPosition = (fn) => (handler = fn);

// Κάθε θέση περνάει από εδώ (GPS, προσομοίωση, τεστ). Ένα λάθος δεν σταματάει τίποτα.
export function feed(pos) {
  state.lastFix = Date.now();
  safe(() => handler(pos));
}

// Θέση που ξέρουμε ότι είναι τωρινή: αν η τελευταία είναι παλιά (ή δεν έχει έρθει ακόμα,
// π.χ. μόλις άνοιξες την εφαρμογή), ζητάμε καινούργια από το GPS πριν ψάξουμε.
export function freshPosition(maxAge = 30000, timeout = 8000) {
  if (state.pos && (state.simTimer || Date.now() - state.lastFix < maxAge)) return Promise.resolve(state.pos);
  if (!("geolocation" in navigator) || state.gpsDenied) return Promise.resolve(state.pos);
  return new Promise((resolve) => {
    const done = () => resolve(state.pos);
    const timer = setTimeout(done, timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        onFix(p);
        done();
      },
      () => {
        clearTimeout(timer);
        done();
      },
      { enableHighAccuracy: true, timeout, maximumAge: 5000 }
    );
  });
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
    toast(t("gps.denied"));
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
  toast(t("gps.finding"));
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
      html: `<p><b>${denied ? t("gps.helpDenied") : t("gps.helpNotFound")}</b></p>
      <p>${t("gps.helpSteps")}</p>
      ${denied ? "" : `<p>${t("gps.helpOutside")}</p>`}
      <p>${t("gps.helpRestart")}</p>`,
    },
    [{ label: t("gps.retry"), fn: requestLocation }]
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
    setStatus(t("gps.lost"));
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
