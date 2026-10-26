// Αποστάσεις, χρόνοι, ώρες — σε χιλιόμετρα ή μίλια ανάλογα με τη ρύθμιση.

import { settings } from "./store.js";
import { t, locale, usesComma } from "./i18n.js";

const num = (x, digits = 1) => {
  const s = x.toFixed(digits);
  return usesComma() ? s.replace(".", ",") : s;
};

export function useMiles() {
  if (settings.units === "mi") return true;
  if (settings.units === "km") return false;
  return /^(en-(US|LR|GB)|my)/i.test(navigator.language || "");
}

// Για τη φωνή: «350 μέτρα», «1,2 χιλιόμετρα», «2 χιλιόμετρα», «1 μίλι».
function spokenBig(x, one, many) {
  const r = Math.round(x * 10) / 10;
  if (r === 1) return t(one);
  return `${Number.isInteger(r) ? r : num(r)} ${t(many)}`;
}
export function spokenDist(m) {
  if (useMiles()) {
    if (m < 160) return `${Math.round((m * 3.281) / 50) * 50} ${t("u.ft")}`;
    return spokenBig(m / 1609.34, "u.mi1", "u.mi");
  }
  if (m >= 1000) return spokenBig(m / 1000, "u.km1", "u.km");
  return `${Math.round(m / 10) * 10} ${t("u.m")}`;
}

// Για την οθόνη: «350 μ», «1,2 χλμ», «0.3 mi».
export function shortDist(m) {
  if (useMiles()) {
    if (m < 160) return `${Math.round((m * 3.281) / 10) * 10} ft`;
    const mi = m / 1609.34;
    return `${mi < 10 ? num(mi) : Math.round(mi)} mi`;
  }
  if (m >= 1000) return `${m < 10000 ? num(m / 1000) : Math.round(m / 1000)} ${t("u.kmShort")}`;
  return `${Math.round(m / 10) * 10} ${t("u.mShort")}`;
}

export function duration(secs) {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} ${t("u.min")}`;
  return `${Math.floor(mins / 60)} ${t("u.h")} ${mins % 60} ${t("u.min")}`;
}

export function clockIn(secs) {
  return new Date(Date.now() + secs * 1000).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
}

export const speedLabel = (kmh) => (useMiles() ? `${Math.round(kmh * 0.621)} mph` : `${kmh} ${t("u.kmh")}`);
