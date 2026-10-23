// Αναζήτηση: προτάσεις όσο γράφεις (πρώτα από το κινητό, μετά από το ίντερνετ),
// πάντα κοντά σου, και «βενζίνη κοντά μου» → η λίστα με τα κοντινά.

import { SERVERS, SEARCH } from "./config.js";
import { $, normalize, distTo } from "./util.js";
import { places } from "./store.js";
import { origin } from "./state.js";
import { placeRow } from "./ui.js";
import { shortDist } from "./format.js";
import { getJSON } from "./net.js";
import * as POI from "./poi.js";
import { previewDestination } from "./preview.js";
import { showNearby } from "./nearby.js";

// ---------- διακομιστές ----------

const B = SEARCH.NEAR_BOX;

// Πιο κοντινά πρώτα· αν υπάρχει κάτι κοντά, τα πολύ μακρινά (άλλη χώρα) πετιούνται.
function byDistance(list, from) {
  const withD = list.map((p) => ({ ...p, d: distTo(from, p) })).sort((a, b) => a.d - b.d);
  return withD.length && withD[0].d < 100000 ? withD.filter((p) => p.d < 500000) : withD;
}

function photonPlace(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const name = p.name || street || p.city || "Σημείο";
  const sub = [p.name ? street : "", p.city || p.county, p.state, p.country].filter((x) => x && x !== name).join(", ");
  return { lat, lng, name, sub };
}

async function photon(q, from, signal, limit = 8) {
  const run = async (bounded) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (from) {
      params.set("lat", from.lat.toFixed(4));
      params.set("lon", from.lng.toFixed(4));
      if (bounded) params.set("bbox", [from.lng - B, from.lat - B, from.lng + B, from.lat + B].map((x) => x.toFixed(4)).join(","));
    }
    const data = await getJSON(`${SERVERS.photon}?${params}`, { signal }, 6000);
    return (data.features || []).map(photonPlace);
  };
  let res = from ? await run(true) : [];
  if (res.length < 3) res = [...res, ...(await run(false))];
  return from ? byDistance(res, from) : res;
}

async function nominatim(q, from, signal) {
  const run = async (bounded) => {
    const params = new URLSearchParams({ q, format: "json", limit: "8" });
    if (from) {
      params.set("viewbox", [from.lng - B, from.lat + B, from.lng + B, from.lat - B].map((x) => x.toFixed(4)).join(","));
      if (bounded) params.set("bounded", "1");
    }
    const data = await getJSON(`${SERVERS.nominatim}?${params}`, { signal }, 8000);
    return data.map((r) => {
      const [first, ...rest] = r.display_name.split(",");
      return { lat: +r.lat, lng: +r.lon, name: first.trim(), sub: rest.join(",").trim() };
    });
  };
  let res = from ? await run(true) : [];
  if (!res.length) res = await run(false);
  return from ? byDistance(res, from) : res;
}

// ---------- «κοντά μου» ----------

const NEAR_WORDS = /\b(near me|nearby|near by|around me|close to me|closest|nearest)\b|κοντα μου|κοντινο|κοντινα|κοντινοτερ|εδω γυρω|πλησιεστερ/g;
const INTENTS = {
  fuel: ["gas", "fuel", "petrol", "βενζιν", "πρατηρι", "καυσιμ", "πετρελαι"],
  food: ["restaurant", "food", "eat", "pizza", "burger", "diner", "εστιατορ", "ταβερν", "φαγητ", "φαι", "σουβλακ", "πιτσ", "ψησταρι"],
  cafe: ["cafe", "coffee", "καφε", "καφετερ"],
  market: ["supermarket", "grocery", "market", "σουπερ", "μαρκετ", "παντοπωλ"],
  pharmacy: ["pharmacy", "drugstore", "φαρμακ"],
  parking: ["parking", "παρκιν", "σταθμευσ"],
  atm: ["atm", "bank", "αταμ", "τραπεζ"],
  ev: ["charging", "charger", "φορτισ"],
  hotel: ["hotel", "motel", "ξενοδοχ"],
  hospital: ["hospital", "clinic", "urgent care", "νοσοκομ", "κλινικ"],
  carwash: ["car wash", "πλυντηρ"],
  repair: ["mechanic", "repair", "tire", "tyre", "συνεργ", "βουλκαν", "λαστιχ"],
  wc: ["toilet", "restroom", "bathroom", "τουαλετ"],
};

// { key, strong }: strong = σίγουρα ζητάει «κοντά μου» («βενζίνη», «gas near me») → το «Πάμε» ανοίγει τη λίστα.
// Αλλιώς (π.χ. «Market Street») απλώς προτείνεται, και γίνεται κανονική αναζήτηση.
export function nearbyIntent(q) {
  const norm = normalize(q);
  const asked = norm.match(NEAR_WORDS) != null;
  const rest = norm.replace(NEAR_WORDS, " ").replace(/\b(stations?|a|the|any)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!rest) return null;
  const words = rest.split(" ").length;
  if (!asked && words > 2) return null;
  for (const [key, stems] of Object.entries(INTENTS)) {
    if (stems.some((st) => rest.startsWith(st) || rest.includes(" " + st))) return { key, strong: asked || words === 1 };
  }
  return null;
}

function openNearby(key) {
  $("dest").value = "";
  $("results").innerHTML = "";
  $("dest").blur();
  showNearby(key);
}

// ---------- λίστα αποτελεσμάτων ----------

// Άμεσα, από ό,τι υπάρχει ήδη στο κινητό: αγαπημένα, πρόσφατα, κοντινά μέρη.
function localMatches(q, from) {
  const norm = normalize(q);
  const out = [];
  const match = (p) => normalize(`${p.name} ${p.sub}`).includes(norm);
  for (const p of places.favorites()) if (match(p)) out.push(["★", p]);
  for (const p of places.history()) if (match(p)) out.push(["🕘", p]);
  if (from) for (const p of POI.findByName(norm, from, 5)) out.push([POI.CATS[p.cat][1], p]);
  return out.slice(0, 8);
}

function render(q, local, remote, { loading = false, header = "" } = {}) {
  const list = $("results");
  const from = origin();
  list.innerHTML = "";
  const head = (text) => {
    const li = document.createElement("li");
    li.className = "head";
    li.textContent = text;
    list.appendChild(li);
  };
  if (!from) head("📍 Δεν ξέρω πού είσαι — τα αποτελέσματα μπορεί να μην είναι κοντά σου");
  if (header) head(header);

  const intent = nearbyIntent(q);
  if (intent) {
    const [label, icon] = POI.CATS[intent.key];
    const li = placeRow(icon, `${label} κοντά σου`, "Όλα τα κοντινά, πιο κοντινά πρώτα", "");
    li.classList.add("intent");
    li.onclick = () => openNearby(intent.key);
    list.appendChild(li);
  }

  const seen = new Set();
  const add = (icon, p) => {
    const k = `${(+p.lat).toFixed(3)},${(+p.lng).toFixed(3)}|${normalize(p.name)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const li = placeRow(icon, p.name, p.sub, from ? shortDist(distTo(from, p)) : "");
    li.onclick = () => {
      $("dest").value = "";
      list.innerHTML = "";
      previewDestination(p);
    };
    list.appendChild(li);
  };
  for (const [icon, p] of local) add(icon, p);
  for (const p of remote) add("📍", p);

  if (loading) {
    const li = document.createElement("li");
    li.className = "loading";
    li.textContent = "Ψάχνω…";
    list.appendChild(li);
  } else if (!list.querySelector("li:not(.head)")) {
    list.innerHTML = "";
    head(`Δεν βρήκα «${q}». Γράψ' το σωστά, ρε!`);
  }
}

// ---------- πληκτρολόγηση & «Πάμε» ----------

let abort = null;
let timer = null;
let last = { q: "", remote: [] };

function cancel() {
  clearTimeout(timer);
  abort?.abort();
}

$("dest").addEventListener("input", () => {
  const q = $("dest").value.trim();
  cancel();
  if (q.length < 2) return void ($("results").innerHTML = "");
  const from = origin();
  const local = localMatches(q, from);
  render(q, local, [], { loading: true });
  timer = setTimeout(async () => {
    const ctrl = (abort = new AbortController());
    let remote = [];
    try {
      remote = await photon(q, from, ctrl.signal, 6);
    } catch {}
    if (ctrl.signal.aborted || $("dest").value.trim() !== q) return;
    last = { q, remote };
    render(q, local, remote);
  }, 250);
});

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("dest").value.trim();
  // η μπάρα αδειάζει εντελώς μόλις πατηθεί «Πάμε»
  $("dest").value = "";
  $("dest").blur();
  cancel();
  if (!q) return;
  const intent = nearbyIntent(q);
  if (intent?.strong) return openNearby(intent.key);

  const from = origin();
  const header = `Αποτελέσματα για «${q}»`;
  const local = localMatches(q, from);
  const have = last.q === q ? last.remote : []; // ό,τι βρήκαν ήδη οι προτάσεις, αμέσως
  render(q, local, have, { loading: true, header });
  const ctrl = (abort = new AbortController());
  let remote = [];
  try {
    remote = await nominatim(q, from, ctrl.signal);
  } catch {}
  if (!remote.length && !ctrl.signal.aborted) {
    try {
      remote = await photon(q, from, ctrl.signal);
    } catch {}
  }
  if (!ctrl.signal.aborted) render(q, local, [...have, ...remote], { header });
});
