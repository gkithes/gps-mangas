// Αναζήτηση: προτάσεις όσο γράφεις (πρώτα από το κινητό, μετά από το ίντερνετ),
// πάντα κοντά σου, και «βενζίνη κοντά μου» → η λίστα με τα κοντινά.

import { SERVERS, SEARCH } from "./config.js";
import { $, normalize, distTo } from "./util.js";
import { places } from "./store.js";
import { origin } from "./state.js";
import { placeRow, listMessage } from "./ui.js";
import { shortDist } from "./format.js";
import { getJSON } from "./net.js";
import * as POI from "./poi.js";
import { previewDestination } from "./preview.js";
import { showNearby } from "./nearby.js";
import { freshPosition } from "./gps.js";
import { t } from "./i18n.js";

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
  const name = p.name || street || p.city || t("search.point");
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

// ---------- σύνδεσμοι από Apple Maps / Google Maps και συντεταγμένες ----------
//
// Το iPhone δεν επιτρέπει σε εφαρμογές να διαβάσουν το ιστορικό του Apple Maps.
// Μπορείς όμως να πατήσεις «Κοινοποίηση → Αντιγραφή» σε ένα μέρος στο Apple Maps
// και να επικολλήσεις τον σύνδεσμο εδώ: βγάζουμε το ακριβές σημείο από τον σύνδεσμο.

function coords(s) {
  const m = s && String(s).match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return null;
  return { lat: +m[1], lng: +m[2] };
}

// { lat, lng, name, sub } αν βρέθηκε σημείο, { query } αν βρέθηκε μόνο όνομα/διεύθυνση, αλλιώς null.
export function placeFromText(text) {
  const raw = coords(text);
  if (raw) return { ...raw, name: `${raw.lat.toFixed(5)}, ${raw.lng.toFixed(5)}`, sub: t("search.fromLink") };
  const link = text.match(/https?:\/\/\S+/)?.[0];
  if (!link) return null;
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const apple = /(^|\.)maps\.apple(\.com)?$/.test(u.hostname);
  const google = /(^|\.)google\./.test(u.hostname) || /(^|\.)goo\.gl$/.test(u.hostname);
  if (!apple && !google) return null;

  const p = u.searchParams;
  let c = coords(p.get("ll")) || coords(p.get("coordinate")) || coords(p.get("q")) || coords(p.get("query")) || coords(p.get("daddr")) || coords(p.get("sll"));
  if (!c) {
    const at = u.pathname.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) c = { lat: +at[1], lng: +at[2] };
  }
  const word = (v) => (v && !coords(v) ? v : "");
  const pathName = decodeURIComponent(u.pathname.match(/\/place\/([^/@]+)/)?.[1] || "").replace(/\+/g, " ");
  const address = p.get("address") || "";
  const label = text.replace(link, "").trim().split("\n")[0].trim(); // κείμενο που ήρθε μαζί με τον σύνδεσμο
  const name = p.get("name") || word(p.get("q")) || word(p.get("query")) || pathName || label || address.split(",")[0];
  if (c) return { lat: c.lat, lng: c.lng, name: name || t("search.fromLink"), sub: address || t("search.fromLink") };
  // σύντομος σύνδεσμος (maps.apple/p/…, maps.app.goo.gl/…): δεν ανοίγει από εδώ, ψάχνουμε το όνομα αν υπάρχει
  const query = [name, address && address !== name ? address : ""].filter(Boolean).join(", ");
  return query ? { query } : { query: "", short: true };
}

// ---------- «κοντά μου» ----------

// Λέξεις «κοντά μου» και κατηγορίες σε όλες τις γλώσσες της εφαρμογής (χωρίς τόνους, μικρά).
const NEAR_WORDS = new RegExp(
  [
    "\\b(near me|nearby|near by|around me|close to me|closest|nearest)\\b",
    "κοντα μου|κοντινο|κοντινα|κοντινοτερ|εδω γυρω|πλησιεστερ",
    "\\b(cerca de mi|cerca|cercano|mas cercano)\\b",
    "\\b(pres de moi|a proximite|le plus proche|autour de moi)\\b",
    "\\b(in der nahe|in meiner nahe|nachste|nachster|in der umgebung)\\b",
    "\\b(vicino a me|qui vicino|nelle vicinanze|piu vicino)\\b",
    "\\b(perto de mim|aqui perto|mais proximo|perto)\\b",
  ].join("|"),
  "g"
);
const INTENTS = {
  fuel: ["gas", "fuel", "petrol", "βενζιν", "πρατηρι", "καυσιμ", "πετρελαι", "gasolin", "essence", "carburant", "station service", "tankstell", "benzin", "distributore", "posto de", "combustivel", "bomba de"],
  food: ["restaurant", "food", "eat", "pizza", "burger", "diner", "εστιατορ", "ταβερν", "φαγητ", "φαι", "σουβλακ", "πιτσ", "ψησταρι", "restaurante", "comida", "comer", "manger", "essen", "ristorante", "mangiare", "trattoria", "pizzeria"],
  cafe: ["cafe", "coffee", "καφε", "καφετερ", "cafeteria", "kaffee", "caffe", "bar cafe", "pastelaria"],
  market: ["supermarket", "grocery", "market", "σουπερ", "μαρκετ", "παντοπωλ", "supermercado", "supermarche", "epicerie", "supermarkt", "supermercato", "alimentari", "mercearia"],
  pharmacy: ["pharmacy", "drugstore", "φαρμακ", "farmacia", "pharmacie", "apotheke"],
  parking: ["parking", "παρκιν", "σταθμευσ", "aparcamiento", "estacionamiento", "parkplatz", "parkhaus", "parcheggio", "estacionamento"],
  atm: ["atm", "bank", "αταμ", "τραπεζ", "cajero", "banco", "banque", "distributeur", "geldautomat", "bancomat", "multibanco"],
  ev: ["charging", "charger", "φορτισ", "carga electrica", "recharge", "borne", "ladestation", "ladesaule", "ricarica", "colonnina", "carregamento"],
  hotel: ["hotel", "motel", "ξενοδοχ", "albergo", "hostal", "pousada"],
  hospital: ["hospital", "clinic", "urgent care", "νοσοκομ", "κλινικ", "urgencias", "hopital", "urgences", "krankenhaus", "notaufnahme", "ospedale", "pronto soccorso", "urgencia"],
  carwash: ["car wash", "πλυντηρ", "lavado", "lavage auto", "waschanlage", "autowasche", "autolavaggio", "lavagem"],
  repair: ["mechanic", "repair", "tire", "tyre", "συνεργ", "βουλκαν", "λαστιχ", "taller", "mecanico", "garage", "werkstatt", "reifen", "officina", "gommista", "oficina", "pneus"],
  wc: ["toilet", "restroom", "bathroom", "τουαλετ", "bano", "aseo", "toilettes", "toilette", "wc", "bagno", "casa de banho", "banheiro"],
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
  if (!from) head(t("search.noLocation"));
  if (header) head(header);

  const intent = nearbyIntent(q);
  if (intent) {
    const icon = POI.CATS[intent.key][1];
    const li = placeRow(icon, t("near.title", { icon: "", label: POI.catLabel(intent.key) }).trim(), t("search.intentSub"), "");
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
    li.textContent = t("near.searching");
    list.appendChild(li);
  } else if (!list.querySelector("li:not(.head)")) {
    list.innerHTML = "";
    head(t("search.none", { q }));
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
  // επικόλλησες σύνδεσμο χάρτη ή συντεταγμένες: το σημείο αμέσως
  const link = placeFromText(q);
  if (link?.lat != null) return render(q, [["📍", link]], []);
  if (link?.short) return listMessage($("results"), t("search.shortLink"), "head");
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
  let q = $("dest").value.trim();
  // η μπάρα αδειάζει εντελώς μόλις πατηθεί «Πάμε»
  $("dest").value = "";
  $("dest").blur();
  cancel();
  if (!q) return;
  const link = placeFromText(q);
  if (link?.lat != null) return previewDestination(link);
  if (link?.short) return listMessage($("results"), t("search.shortLink"), "head");
  if (link?.query) q = link.query;
  const intent = nearbyIntent(q);
  if (intent?.strong) return openNearby(intent.key);

  await freshPosition(30000, 5000); // ψάχνουμε γύρω από το πού είσαι τώρα
  const from = origin();
  const header = t("search.results", { q });
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
