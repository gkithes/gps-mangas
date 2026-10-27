// Η κατάσταση της εφαρμογής, σε ένα μέρος.

import { lastPos } from "./store.js";

export const state = {
  mode: "home",        // home | places | preview | nav
  pos: null,           // { lat, lng, speed (m/s) | null, accuracy } — τωρινή θέση από το GPS
  follow: true,        // ο χάρτης ακολουθεί τη θέση σου

  // GPS
  lastFix: 0,
  lastGpsRestart: 0,
  gpsLost: false,
  gpsDenied: false,

  // επιλογή διαδρομής
  dest: null,          // { lat, lng, name, sub }
  routes: [],
  selected: 0,

  // πλοήγηση
  navigating: false,
  route: null,
  next: -1,            // ποια στροφή είναι η επόμενη (index στο route.steps)
  announced: {},       // τι έχει ειπωθεί για αυτή τη στροφή: intro / far / near
  offCount: 0,
  offRoute: false,
  rerouting: false,
  recalcSpoken: false,
  lastReroute: 0,
  reroutes: 0,         // νέες διαδρομές στη σειρά χωρίς να ξαναμπείς σε διαδρομή (για αραιότερες επαναλήψεις)
  graceUntil: 0,       // μέχρι πότε η νέα διαδρομή δεν κρίνεται «εκτός»
  graceFrom: null,
  heading: null,       // προς τα πού πας (μοίρες), για νέα διαδρομή προς τη σωστή κατεύθυνση
  headingAt: 0,
  lastSpeedWarn: 0,
  stillSince: null,
  lastIdleWarn: 0,
  arrived: false,
  simTimer: null,
};

// Η θέση σου για αναζητήσεις: η τωρινή από το GPS, αλλιώς η τελευταία γνωστή.
// Ποτέ το κέντρο του χάρτη — αλλιώς ψάχνει στην άλλη άκρη του κόσμου.
export const origin = () => state.pos || lastPos.value || null;
