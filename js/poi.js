// Κοντινά μέρη (βενζίνη, φαγητό…), αποθηκευμένα στο κινητό.
// Για κάθε περιοχή κατεβάζουμε ΟΛΕΣ τις κατηγορίες μία φορά στο παρασκήνιο,
// ώστε κάθε κουμπί να δείχνει αποτελέσματα αμέσως.
// Όσο κατεβαίνει (ή αν οι διακομιστές Overpass δεν απαντούν), μια γρήγορη
// αναζήτηση στο Nominatim δίνει πρώτα αποτελέσματα σε ~1″.

import { SERVERS } from "./config.js";
import { getJSON } from "./net.js";
import { haversine, loadJSON, saveJSON, normalize } from "./util.js";
import { t } from "./i18n.js";

const KEY = "gps-mangas-poi";
const HALF = 5000;                 // μισό πλάτος του τετραγώνου κάθε περιοχής (μέτρα)
const REFRESH_DIST = 2500;         // ξανακατέβασμα όταν απομακρυνθείς τόσο από το κέντρο της
const MAX_AGE = 3 * 24 * 3600e3;   // ανανέωση κάθε 3 μέρες
const SHOW_AGE = 30 * 24 * 3600e3; // …αλλά μέχρι να έρθουν τα νέα δείχνουμε και παλιότερα (τα μαγαζιά σπάνια αλλάζουν)
const FAST_HALF = 3000;            // γρήγορη αναζήτηση μίας κατηγορίας: τετράγωνο 6×6 χλμ
const RETRY_AFTER = 60e3;          // μετά από αποτυχία, ξαναδοκιμή σε 1 λεπτό
const MAX_AREAS = 5;
const PER_CAT = 150;               // πόσα κρατάμε ανά κατηγορία και περιοχή
const SHOW_NEAR = 8000;            // όσο κατεβαίνει η περιοχή σου, μόνο μέρη μέσα σε αυτή την απόσταση
const SHOW_MAX = 25000;            // ποτέ δεν δείχνουμε μέρη πιο μακριά από αυτό (μέτρα)…
const SHOW_MAX_WIDE = 60000;       // …εκτός αν ψάξαμε επίτηδες πιο μακριά (εξοχή)
const FORGET_DIST = 150000;        // περιοχές πιο μακριά από εκεί που είσαι τώρα ξεχνιούνται

// Καφέ = και τα «fast food» που είναι καφές/ντόνατς (Dunkin', Starbucks, Tim Hortons…):
// στον χάρτη τα περισσότερα είναι καταχωρημένα ως fast food, όχι ως café.
const COFFEE_BRANDS = /dunkin|starbucks|tim hortons|peet'?s|caribou|costa|gregorys|dutch bros|coffee|caf[eé]|espresso|donut|doughnut/i;
// …και τα βενζινάδικα / μίνι μάρκετ που είναι γνωστά για τον καφέ τους.
const COFFEE_STOPS = /cumberland farms|wawa|7-?eleven|7 eleven|sheetz|quiktrip|\bqt\b|kwik trip|casey'?s|royal farms|stewart'?s|honey dew|circle k|speedway|pret|tim hortons/i;
function isCoffee(t) {
  if (t.amenity === "cafe" || t.shop === "coffee") return true;
  if (t.amenity === "fuel" || t.shop === "convenience") return COFFEE_STOPS.test(`${t.brand || ""} ${t.name || ""}`);
  if (t.amenity !== "fast_food") return false;
  return /coffee|donut|doughnut/i.test(t.cuisine || "") || COFFEE_BRANDS.test(t.brand || t.name || "");
}

// Όνομα κατηγορίας στη γλώσσα της εφαρμογής.
export const catLabel = (cat) => t(`cat.${cat}`);

// key: [όνομα (ελληνικό· στην οθόνη μπαίνει το catLabel), εικονίδιο, φίλτρα Overpass, έλεγχος ετικετών, λέξη για Nominatim]
export const CATS = {
  fuel: ["Βενζίνη", "⛽", ['["amenity"="fuel"]'], (t) => t.amenity === "fuel", "fuel"],
  food: ["Φαγητό", "🍽", ['["amenity"~"^(restaurant|fast_food)$"]'], (t) => /^(restaurant|fast_food)$/.test(t.amenity), "restaurant"],
  // απλά φίλτρα στον διακομιστή (τα σύνθετα αργούν ή απορρίπτονται)· ποια fast food είναι καφές το κρίνει το κινητό
  cafe: ["Καφές", "☕", ['["amenity"="cafe"]', '["shop"="coffee"]', '["amenity"="fast_food"]', '["amenity"="fuel"]', '["shop"="convenience"]'], isCoffee, "cafe"],
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

// Αυτές δεν μπαίνουν στο κατέβασμα όλης της περιοχής (είναι πάρα πολλές και το κάνουν αργό)·
// έρχονται με τη γρήγορη αναζήτηση όταν πατήσεις το κουμπί τους.
const ON_DEMAND = new Set(["parking", "wc"]);
export const inFull = (cat) => !ON_DEMAND.has(cat);

// Κάθε περιοχή: { lat, lng, ts, kind: "full" | "wide:<cat>" | "quick", items: [[cat, lat, lng, name, sub]] }
// Αλλάζει όταν πρέπει να σβηστούν τα παλιά αποθηκευμένα (π.χ. μετά από διόρθωση).
const DATA_VERSION = 3; // 3: ο καφές περιλαμβάνει Dunkin'/Starbucks — ξανακατέβασμα
let areas = loadJSON(KEY, []).map((a) => ({ kind: a.kind || (a.partial ? (a.partial === "quick" ? "quick" : `wide:${a.partial}`) : "full"), ...a }));
if (loadJSON(`${KEY}-version`, 0) !== DATA_VERSION) {
  areas = [];
  saveJSON(KEY, areas);
  saveJSON(`${KEY}-version`, DATA_VERSION);
}

// Κουμπί στις ρυθμίσεις: σβήνει όλα τα αποθηκευμένα κοντινά μέρη.
export function clearAll() {
  areas = [];
  saveJSON(KEY, areas);
}
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
// παλιότερα από 3 μέρες μόνο αν είναι από το ίδιο σημείο που είσαι τώρα (όχι από εκεί που ήσουν)
const showable = (a, pos) => fresh(a) || (Date.now() - a.ts < SHOW_AGE && near(a, pos));

function describe(tags, name) {
  const bits = [];
  if (tags.brand && tags.brand !== name) bits.push(tags.brand);
  if (tags.cuisine) bits.push(tags.cuisine.split(";").slice(0, 2).join(", ").replace(/_/g, " "));
  if (tags.opening_hours) bits.push(tags.opening_hours === "24/7" ? t("poi.open24") : tags.opening_hours);
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

// Ρωτάμε τον πρώτο διακομιστή· αν αργεί, και τον επόμενο ταυτόχρονα (κερδίζει ο πιο γρήγορος).
async function overpass(cats, pos, half, { limit = "", hedge = 4000, timeout = 15000 } = {}) {
  const parts = cats.flatMap((c) => CATS[c][2]).map((f) => `nwr${f};`).join("");
  const q = `[out:json][timeout:20][bbox:${bbox(pos, half)}];(${parts});out center ${limit};`;
  const data = await getJSON(SERVERS.overpass, { method: "POST", body: new URLSearchParams({ data: q }) }, timeout, hedge);
  const items = [];
  for (const el of data.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    if (lat == null) continue;
    // ένα μέρος μπορεί να ανήκει σε πολλές κατηγορίες (π.χ. Dunkin' = καφές ΚΑΙ φαγητό)
    for (const cat of cats.filter((c) => CATS[c][3](tags))) {
      const name = tags.name || tags.brand || catLabel(cat);
      items.push([cat, +lat.toFixed(6), +lng.toFixed(6), name, describe(tags, name)]);
    }
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
  inflight = overpass(Object.keys(CATS).filter(inFull), center, HALF)
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

// Γρήγορη απάντηση σε ~1″: μόνο αυτή η κατηγορία, μόνο κοντά σου — μικρό αίτημα, απαντάει αμέσως.
export async function fast(cat, pos) {
  const ask = () => overpass([cat], pos, FAST_HALF, { limit: 400, hedge: 800, timeout: 8000 });
  // αν όλοι οι διακομιστές είναι απασχολημένοι (συμβαίνει αμέσως μετά το άνοιγμα), μία ακόμα προσπάθεια σε 1,5″
  const items = await ask().catch(() => new Promise((r) => setTimeout(r, 1500)).then(ask));
  if (items.length) addArea("quick", pos, items);
  return items.length;
}

// Γρήγορη απάντηση από το Nominatim (~13 χλμ γύρω σου).
export async function quick(cat, pos) {
  const deg = 0.12;
  const params = new URLSearchParams({
    q: CATS[cat][4], format: "jsonv2", limit: "40", bounded: "1",
    viewbox: [pos.lng - deg, pos.lat + deg, pos.lng + deg, pos.lat - deg].map((x) => x.toFixed(4)).join(","),
  });
  let data = await getJSON(`${SERVERS.nominatim}?${params}`, {}, 8000);
  if (cat === "cafe") {
    // ο καφές στην Αμερική είναι κυρίως αλυσίδες καταχωρημένες ως fast food
    for (const q of ["Dunkin", "coffee", "Starbucks"]) {
      params.set("q", q);
      try {
        data = [...(data || []), ...((await getJSON(`${SERVERS.nominatim}?${params}`, {}, 8000)) || [])];
      } catch {}
    }
  }
  const items = [];
  for (const r of data || []) {
    if (!CATS[cat][3]({ [r.category]: r.type, name: r.name })) continue;
    const name = r.name || catLabel(cat);
    const sub = (r.display_name || "").split(",").map((x) => x.trim()).filter((x) => x && x !== name).slice(0, 2).join(", ");
    items.push([cat, +(+r.lat).toFixed(6), +(+r.lon).toFixed(6), name, sub]);
  }
  if (items.length) addArea("quick", pos, items);
  return items.length;
}

// Λίγα αποτελέσματα: μία ευρύτερη αναζήτηση για την κατηγορία (~6 μίλια, μετά ~15), και τη θυμόμαστε.
export const ENOUGH = 12;
export async function searchWide(cat, pos) {
  let items = [];
  for (const half of [10000, 25000]) {
    items = await overpass([cat], pos, half, { hedge: 3000 });
    if (items.length >= ENOUGH) break;
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
  // (η ευρύτερη αναζήτηση έγινε από εδώ που είσαι τώρα, οπότε μετράει πάντα)
  const max = searchedWide(cat, pos) ? SHOW_MAX_WIDE : strict ? SHOW_NEAR : SHOW_MAX;
  // μόνο από περιοχές κοντά σου (τα παλιότερα από 3 μέρες ανανεώνονται στο παρασκήνιο)
  const rows = unique(areas.filter((a) => showable(a, pos) && d(a, pos) < max + 45000).flatMap((a) => a.items.filter((it) => it[0] === cat)));
  const kept = [];
  for (const p of rows.map((it) => toPlace(it, pos)).filter((p) => p.dist <= max).sort((a, b) => a.dist - b.dist)) {
    // το ίδιο μαγαζί δύο φορές (π.χ. βενζινάδικο + μίνι μάρκετ στο ίδιο σημείο)
    if (kept.some((k) => normalize(k.name) === normalize(p.name) && haversine([k.lat, k.lng], [p.lat, p.lng]) < 80)) continue;
    kept.push(p);
    if (kept.length >= limit) break;
  }
  return kept;
}

// Για τις προτάσεις όσο γράφεις: μέρη με όνομα που ταιριάζει.
export function findByName(norm, pos, limit = 5) {
  if (!norm) return [];
  const rows = unique(areas.filter((a) => showable(a, pos) && d(a, pos) < SHOW_MAX + 45000).flatMap((a) => a.items.filter((it) => normalize(it[3]).includes(norm))));
  return rows
    .map((it) => toPlace(it, pos))
    .filter((p) => p.dist <= SHOW_MAX)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}
