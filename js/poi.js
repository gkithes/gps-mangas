// Κοντινά μέρη (βενζίνη, φαγητό…), αποθηκευμένα στο κινητό.
// Για κάθε περιοχή κατεβάζουμε ΟΛΕΣ τις κατηγορίες μία φορά στο παρασκήνιο,
// ώστε κάθε κουμπί να δείχνει αποτελέσματα αμέσως.
// Όσο κατεβαίνει (ή αν οι διακομιστές Overpass δεν απαντούν), μια γρήγορη
// αναζήτηση στο Nominatim δίνει πρώτα αποτελέσματα σε ~1″.

import { SERVERS } from "./config.js";
import { getJSON } from "./net.js";
import { haversine, loadJSON, saveJSON, normalize } from "./util.js";

const KEY = "gps-mangas-poi";
const HALF = 5000;                 // μισό πλάτος του τετραγώνου κάθε περιοχής (μέτρα)
const REFRESH_DIST = 2500;         // ξανακατέβασμα όταν απομακρυνθείς τόσο από το κέντρο της
const MAX_AGE = 3 * 24 * 3600e3;   // ανανέωση κάθε 3 μέρες
const RETRY_AFTER = 60e3;          // μετά από αποτυχία, ξαναδοκιμή σε 1 λεπτό
const MAX_AREAS = 5;
const PER_CAT = 150;               // πόσα κρατάμε ανά κατηγορία και περιοχή
const SHOW_NEAR = 8000;            // όσο κατεβαίνει η περιοχή σου, μόνο μέρη μέσα σε αυτή την απόσταση
const SHOW_MAX = 25000;            // ποτέ δεν δείχνουμε μέρη πιο μακριά από αυτό (μέτρα)…
const SHOW_MAX_WIDE = 60000;       // …εκτός αν ψάξαμε επίτηδες πιο μακριά (εξοχή)
const FORGET_DIST = 150000;        // περιοχές πιο μακριά από εκεί που είσαι τώρα ξεχνιούνται

// key: [όνομα, εικονίδιο, φίλτρα Overpass, έλεγχος ετικετών, λέξη για Nominatim]
export const CATS = {
  fuel: ["Βενζίνη", "⛽", ['["amenity"="fuel"]'], (t) => t.amenity === "fuel", "fuel"],
  food: ["Φαγητό", "🍽", ['["amenity"~"^(restaurant|fast_food)$"]'], (t) => /^(restaurant|fast_food)$/.test(t.amenity), "restaurant"],
  cafe: ["Καφές", "☕", ['["amenity"="cafe"]'], (t) => t.amenity === "cafe", "cafe"],
  market: ["Σούπερ μάρκετ", "🛒", ['["shop"~"^(supermarket|convenience)$"]'], (t) => /^(supermarket|convenience)$/.test(t.shop), "supermarket"],
  pharmacy: ["Φαρμακείο", "💊", ['["amenity"="pharmacy"]'], (t) => t.amenity === "pharmacy", "pharmacy"],
  parking: ["Πάρκινγκ", "🅿️", ['["amenity"="parking"]["access"!~"^(private|no|customers)$"]'], (t) => t.amenity === "parking", "parking"],
  atm: ["ATM", "🏧", ['["amenity"~"^(atm|bank)$"]'], (t) => /^(atm|bank)$/.test(t.amenity), "atm"],
  ev: ["Φόρτιση EV", "🔌", ['["amenity"="charging_station"]'], (t) => t.amenity === "charging_station", "charging station"],
  hotel: ["Ξενοδοχείο", "🏨", ['["tourism"~"^(hotel|motel|guest_house)$"]'], (t) => /^(hotel|motel|guest_house)$/.test(t.tourism), "hotel"],
  hospital: ["Νοσοκομείο", "🏥", ['["amenity"~"^(hospital|clinic)$"]'], (t) => /^(hospital|clinic)$/.test(t.amenity), "hospital"],
  carwash: ["Πλυντήριο", "🧽", ['["amenity"="car_wash"]'], (t) => t.amenity === "car_wash", "car wash"],
  repair: ["Συνεργείο", "🔧", ['["shop"~"^(car_repair|tyres)$"]'], (t) => /^(car_repair|tyres)$/.test(t.shop), "car repair"],
  wc: ["Τουαλέτα", "🚻", ['["amenity"="toilets"]'], (t) => t.amenity === "toilets", "toilets"],
};

// Κάθε περιοχή: { lat, lng, ts, kind: "full" | "wide:<cat>" | "quick", items: [[cat, lat, lng, name, sub]] }
let areas = loadJSON(KEY, []).map((a) => ({ kind: a.kind || (a.partial ? (a.partial === "quick" ? "quick" : `wide:${a.partial}`) : "full"), ...a }));
let inflight = null;
let lastFail = 0;

function save() {
  if (!saveJSON(KEY, areas)) {
    areas = areas.slice(0, 1); // γέμισε η μνήμη: κράτα μόνο την πιο πρόσφατη
    saveJSON(KEY, areas);
  }
}

const d = (a, b) => haversine([a.lat, a.lng], [b.lat, b.lng]);
const near = (a, pos) => d(a, pos) < REFRESH_DIST;
const fresh = (a) => Date.now() - a.ts < MAX_AGE;

function describe(tags, name) {
  const bits = [];
  if (tags.brand && tags.brand !== name) bits.push(tags.brand);
  if (tags.cuisine) bits.push(tags.cuisine.split(";").slice(0, 2).join(", ").replace(/_/g, " "));
  if (tags.opening_hours) bits.push(tags.opening_hours === "24/7" ? "Ανοιχτό 24ω" : tags.opening_hours);
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  if (street) bits.push(street);
  return bits.join(" · ");
}

// Τετράγωνο γύρω από τη θέση: πολύ πιο ελαφρύ για τους διακομιστές από τον «κύκλο» (around).
function bbox(pos, half) {
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.cos((pos.lat * Math.PI) / 180));
  return [pos.lat - dLat, pos.lng - dLng, pos.lat + dLat, pos.lng + dLng].map((x) => x.toFixed(5)).join(",");
}

async function overpass(cats, pos, half) {
  const parts = cats.flatMap((c) => CATS[c][2]).map((f) => `nwr${f};`).join("");
  const q = `[out:json][timeout:20][bbox:${bbox(pos, half)}];(${parts});out center;`;
  const data = await getJSON(SERVERS.overpass, { method: "POST", body: new URLSearchParams({ data: q }) }, 15000);
  const items = [];
  for (const el of data.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    if (lat == null) continue;
    const cat = cats.find((c) => CATS[c][3](tags));
    if (!cat) continue;
    const name = tags.name || tags.brand || CATS[cat][0];
    items.push([cat, +lat.toFixed(6), +lng.toFixed(6), name, describe(tags, name)]);
  }
  return items;
}

// Κράτα τα πιο κοντινά στο κέντρο ανά κατηγορία, για να μη γεμίσει η μνήμη.
function trim(items, pos) {
  const byCat = {};
  for (const it of items) (byCat[it[0]] ||= []).push(it);
  return Object.values(byCat).flatMap((list) =>
    list
      .map((it) => [haversine([pos.lat, pos.lng], [it[1], it[2]]), it])
      .sort((a, b) => a[0] - b[0])
      .slice(0, PER_CAT)
      .map((x) => x[1])
  );
}

function addArea(kind, pos, items, replaceNearby = false) {
  const area = { kind, lat: pos.lat, lng: pos.lng, ts: Date.now(), items: trim(items, pos) };
  // ξεχνάμε τις περιοχές που είναι πολύ μακριά από εκεί που είσαι τώρα
  const others = areas.filter((a) => d(a, pos) < FORGET_DIST && !(replaceNearby && near(a, pos)));
  areas = [area, ...others].slice(0, MAX_AREAS * 3);
  save();
}

// Υπάρχει πλήρης και φρέσκια περιοχή εδώ;
export const isFresh = (pos) => areas.some((a) => a.kind === "full" && fresh(a) && near(a, pos));

// Έχουμε ήδη ψάξει πιο μακριά για αυτή την κατηγορία εδώ γύρω;
export const searchedWide = (cat, pos) => areas.some((a) => a.kind === `wide:${cat}` && fresh(a) && near(a, pos));

// Κατεβάζει όλη την περιοχή στο παρασκήνιο αν χρειάζεται.
export function refresh(pos, { force = false } = {}) {
  if (inflight) return inflight;
  if (!force && (isFresh(pos) || Date.now() - lastFail < RETRY_AFTER)) return Promise.resolve(false);
  const center = { lat: pos.lat, lng: pos.lng };
  inflight = overpass(Object.keys(CATS), center, HALF)
    .then((items) => {
      addArea("full", center, items, true);
      return true;
    })
    .catch((e) => {
      lastFail = Date.now();
      throw e;
    })
    .finally(() => (inflight = null));
  return inflight;
}

// Γρήγορη απάντηση από το Nominatim (~13 χλμ γύρω σου).
export async function quick(cat, pos) {
  const deg = 0.12;
  const params = new URLSearchParams({
    q: CATS[cat][4], format: "jsonv2", limit: "40", bounded: "1",
    viewbox: [pos.lng - deg, pos.lat + deg, pos.lng + deg, pos.lat - deg].map((x) => x.toFixed(4)).join(","),
  });
  const data = await getJSON(`${SERVERS.nominatim}?${params}`, {}, 8000);
  const items = [];
  for (const r of data || []) {
    if (!CATS[cat][3]({ [r.category]: r.type })) continue;
    const name = r.name || CATS[cat][0];
    const sub = (r.display_name || "").split(",").map((x) => x.trim()).filter((x) => x && x !== name).slice(0, 2).join(", ");
    items.push([cat, +(+r.lat).toFixed(6), +(+r.lon).toFixed(6), name, sub]);
  }
  if (items.length) addArea("quick", pos, items);
  return items.length;
}

// Λίγα αποτελέσματα (εξοχή): μία ευρύτερη αναζήτηση για την κατηγορία, και τη θυμόμαστε.
export async function searchWide(cat, pos) {
  let items = [];
  for (const half of [15000, 40000]) {
    items = await overpass([cat], pos, half);
    if (items.length >= 3) break;
  }
  addArea(`wide:${cat}`, pos, items); // και άδειο, για να μην ξαναψάχνει σε κάθε πάτημα
}

function unique(rows) {
  const seen = new Set();
  return rows.filter((it) => {
    const k = `${it[0]}|${it[1].toFixed(4)}|${it[2].toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const toPlace = (it, pos) => ({ cat: it[0], lat: it[1], lng: it[2], name: it[3], sub: it[4], dist: haversine([pos.lat, pos.lng], [it[1], it[2]]) });

// Άμεσα, από τη μνήμη του κινητού, πιο κοντινά πρώτα.
// Μόνο μέρη που είναι πραγματικά κοντά σου τώρα — όχι από περιοχές που πέρασες παλιότερα.
// strict: η περιοχή σου δεν έχει κατέβει ακόμα, οπότε μόνο τα πολύ κοντινά.
export function nearby(cat, pos, { limit = 25, strict = false } = {}) {
  const max = strict ? SHOW_NEAR : searchedWide(cat, pos) ? SHOW_MAX_WIDE : SHOW_MAX;
  const rows = unique(areas.filter((a) => d(a, pos) < max + 45000).flatMap((a) => a.items.filter((it) => it[0] === cat)));
  return rows
    .map((it) => toPlace(it, pos))
    .filter((p) => p.dist <= max)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

// Για τις προτάσεις όσο γράφεις: μέρη με όνομα που ταιριάζει.
export function findByName(norm, pos, limit = 5) {
  if (!norm) return [];
  const rows = unique(areas.filter((a) => d(a, pos) < SHOW_MAX + 45000).flatMap((a) => a.items.filter((it) => normalize(it[3]).includes(norm))));
  return rows
    .map((it) => toPlace(it, pos))
    .filter((p) => p.dist <= SHOW_MAX)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}
