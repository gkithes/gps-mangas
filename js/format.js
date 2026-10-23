// Αποστάσεις, χρόνοι, ώρες — σε χιλιόμετρα ή μίλια ανάλογα με τη ρύθμιση.

import { settings } from "./store.js";

export function useMiles() {
  if (settings.units === "mi") return true;
  if (settings.units === "km") return false;
  return /^(en-(US|LR|GB)|my)/i.test(navigator.language || "");
}

// Για τη φωνή: «350 μέτρα», «1,2 χιλιόμετρα», «0,3 μίλια».
export function spokenDist(m) {
  if (useMiles()) {
    if (m < 160) return Math.round((m * 3.281) / 50) * 50 + " πόδια";
    return (m / 1609.34).toFixed(1).replace(".", ",") + " μίλια";
  }
  if (m >= 1000) return (m / 1000).toFixed(1).replace(".", ",") + " χιλιόμετρα";
  return Math.round(m / 10) * 10 + " μέτρα";
}

// Για την οθόνη: «350 μ», «1,2 χλμ», «0.3 mi».
export function shortDist(m) {
  if (useMiles()) {
    if (m < 160) return Math.round((m * 3.281) / 10) * 10 + " ft";
    const mi = m / 1609.34;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
  }
  if (m >= 1000) return (m < 10000 ? (m / 1000).toFixed(1).replace(".", ",") : Math.round(m / 1000)) + " χλμ";
  return Math.round(m / 10) * 10 + " μ";
}

export function duration(secs) {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} λεπ.`;
  return `${Math.floor(mins / 60)} ώρ. ${mins % 60} λεπ.`;
}

export function clockIn(secs) {
  return new Date(Date.now() + secs * 1000).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
}

export const speedLabel = (kmh) => (useMiles() ? `${Math.round(kmh * 0.621)} mph` : `${kmh} χλμ/ώρα`);
