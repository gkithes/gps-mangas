// Εκκίνηση: συνδέει όλα τα κομμάτια.

import { $, onError, loadJSON, saveJSON } from "./util.js";
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

// Μέσα στο Safari η μπάρα του Safari κρύβει μέρος της οθόνης. Μόνο από το εικονίδιο
// της αρχικής οθόνης η εφαρμογή γεμίζει όλη την οθόνη — δείχνουμε πώς, μία φορά.
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches;
if (iOS && !standalone && !loadJSON("gps-mangas-install-tip-closed", false)) $("install-tip").hidden = false;
$("install-close").onclick = () => {
  $("install-tip").hidden = true;
  saveJSON("gps-mangas-install-tip-closed", true);
};
loadRecordings();
setMode("home");
renderDrawer();
startGps();
// κοντινά για την τελευταία γνωστή θέση, πριν καν απαντήσει το GPS
if (lastPos.value) setTimeout(() => !state.pos && POI.refresh(lastPos.value).catch(() => {}), 1500);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // Όταν έρθει νέα έκδοση, ξαναφόρτωσε αμέσως (όχι στη μέση μιας διαδρομής),
  // ώστε οι διορθώσεις να φτάνουν με το πρώτο άνοιγμα.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded || state.navigating) return;
    reloaded = true;
    location.reload();
  });
}

// Για τα αυτόματα τεστ.
window.GPSMangas = { feed, state, places };
