// Εκκίνηση: συνδέει όλα τα κομμάτια.

import { onError } from "./util.js";
import { applyStatic, t } from "./i18n.js";
import { lastPos, places } from "./store.js";
import { state } from "./state.js";
import { map, showUser, setMode, toast } from "./ui.js";
import { loadRecordings } from "./recordings.js";
import * as POI from "./poi.js";
import { guide } from "./nav.js";
import { onPosition, feed, startGps, renderLocate } from "./gps.js";
import { renderDrawer } from "./drawer.js";
import "./preview.js";
import "./nearby.js";
import "./search.js";
import "./settings-ui.js";

// Κάθε λάθος καταγράφεται, η εφαρμογή συνεχίζει.
let lastErrorToast = 0;
onError((e) => {
  console.error(e);
  if (Date.now() - lastErrorToast > 30000) {
    lastErrorToast = Date.now();
    toast(t("app.error"));
  }
});
window.addEventListener("error", (e) => console.error(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error(e.reason));

// Κάθε νέα θέση (από GPS, προσομοίωση ή τεστ).
onPosition((pos) => {
  const first = !state.pos;
  state.pos = pos;
  showUser(pos);
  if (first) {
    if (state.mode === "home") map.setView([pos.lat, pos.lng], 16);
    renderLocate();
  }
  lastPos.update(pos);
  if (state.navigating) guide(pos);
  else POI.refresh(pos).catch(() => {}); // κοντινά μέρη στο παρασκήνιο, για να είναι έτοιμα
});

applyStatic(); // κείμενα της σελίδας στη γλώσσα της εφαρμογής
loadRecordings();
setMode("home");
renderDrawer();
startGps();
// κοντινά για την τελευταία γνωστή θέση, πριν καν απαντήσει το GPS
if (lastPos.value) setTimeout(() => !state.pos && POI.refresh(lastPos.value).catch(() => {}), 1500);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Για τα αυτόματα τεστ.
window.GPSMangas = { feed, state, places };
