// Μικρά βοηθητικά που χρησιμοποιούνται παντού.

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Απόσταση σε μέτρα ανάμεσα σε δύο σημεία [lat, lng].
export function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const distTo = (from, p) => haversine([from.lat, from.lng], [p.lat, p.lng]);

// Για συγκρίσεις κειμένου: χωρίς τόνους, μικρά, τελικό ς = σ.
export function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    // Αραβικά: χωρίς φωνήεντα/τατουίλ, ενιαίο άλεφ, ة→ه, ى→ي
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

export const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Αποθήκευση στο κινητό που δεν «σκάει» ποτέ (ιδιωτική περιήγηση, γεμάτη μνήμη).
export function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Ένα λάθος σε ένα κομμάτι δεν σταματάει ποτέ την υπόλοιπη εφαρμογή.
let errorHandler = (e) => console.error(e);
export const onError = (fn) => (errorHandler = fn);
export function safe(fn) {
  try {
    return fn();
  } catch (e) {
    errorHandler(e);
  }
}
export const report = (e) => errorHandler(e);
