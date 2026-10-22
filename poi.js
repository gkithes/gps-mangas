// Κοντινά μέρη (βενζίνη, φαγητό…) αποθηκευμένα τοπικά στο κινητό.
// Μια φορά για κάθε περιοχή κατεβάζουμε ΟΛΕΣ τις κατηγορίες στο παρασκήνιο,
// ώστε το πάτημα ενός κουμπιού να δείχνει αποτελέσματα αμέσως, χωρίς αναμονή.

window.POI = (() => {
  const SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  const KEY = "gps-mangas-poi";
  const RADIUS = 5000;                 // μισό πλάτος του τετραγώνου κάθε περιοχής (μέτρα)
  const REFRESH_DIST = 2500;           // ξανακατέβασμα όταν απομακρυνθείς τόσο από το κέντρο της
  const MAX_AGE = 3 * 24 * 3600e3;     // ανανέωση κάθε 3 μέρες
  const RETRY_AFTER = 60e3;            // μετά από αποτυχία, ξαναδοκιμή σε 1 λεπτό
  const MAX_AREAS = 5;
  const PER_CAT = 150;                 // πόσα κρατάμε ανά κατηγορία και περιοχή

  // [όνομα, εικονίδιο, φίλτρα Overpass, έλεγχος ετικετών]
  const CATS = {
    fuel: ["Βενζίνη", "⛽", ['["amenity"="fuel"]'], (t) => t.amenity === "fuel"],
    food: ["Φαγητό", "🍽", ['["amenity"~"^(restaurant|fast_food)$"]'], (t) => /^(restaurant|fast_food)$/.test(t.amenity)],
    cafe: ["Καφές", "☕", ['["amenity"="cafe"]'], (t) => t.amenity === "cafe"],
    market: ["Σούπερ μάρκετ", "🛒", ['["shop"~"^(supermarket|convenience)$"]'], (t) => /^(supermarket|convenience)$/.test(t.shop)],
    pharmacy: ["Φαρμακείο", "💊", ['["amenity"="pharmacy"]'], (t) => t.amenity === "pharmacy"],
    parking: ["Πάρκινγκ", "🅿️", ['["amenity"="parking"]["access"!~"^(private|no|customers)$"]'], (t) => t.amenity === "parking"],
    atm: ["ATM", "🏧", ['["amenity"~"^(atm|bank)$"]'], (t) => /^(atm|bank)$/.test(t.amenity)],
    ev: ["Φόρτιση EV", "🔌", ['["amenity"="charging_station"]'], (t) => t.amenity === "charging_station"],
    hotel: ["Ξενοδοχείο", "🏨", ['["tourism"~"^(hotel|motel|guest_house)$"]'], (t) => /^(hotel|motel|guest_house)$/.test(t.tourism)],
    hospital: ["Νοσοκομείο", "🏥", ['["amenity"~"^(hospital|clinic)$"]'], (t) => /^(hospital|clinic)$/.test(t.amenity)],
    carwash: ["Πλυντήριο", "🧽", ['["amenity"="car_wash"]'], (t) => t.amenity === "car_wash"],
    repair: ["Συνεργείο", "🔧", ['["shop"~"^(car_repair|tyres)$"]'], (t) => /^(car_repair|tyres)$/.test(t.shop)],
    wc: ["Τουαλέτα", "🚻", ['["amenity"="toilets"]'], (t) => t.amenity === "toilets"],
  };

  // Κάθε περιοχή: { lat, lng, r, ts, items: [[cat, lat, lng, name, sub], ...] }
  let areas = [];
  try {
    areas = JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {}
  let inflight = null;
  let lastFail = 0;

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(areas));
    } catch {
      // γέμισε η μνήμη: κράτα μόνο την πιο πρόσφατη περιοχή
      areas = areas.slice(0, 1);
      try { localStorage.setItem(KEY, JSON.stringify(areas)); } catch {}
    }
  };

  function dist(a, b) {
    const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function describe(tags, name) {
    const bits = [];
    if (tags.brand && tags.brand !== name) bits.push(tags.brand);
    if (tags.cuisine) bits.push(tags.cuisine.split(";").slice(0, 2).join(", ").replace(/_/g, " "));
    if (tags.opening_hours) bits.push(tags.opening_hours === "24/7" ? "Ανοιχτό 24ω" : tags.opening_hours);
    const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    if (street) bits.push(street);
    return bits.join(" · ");
  }

  // Τετράγωνο γύρω από τη θέση: πολύ πιο ελαφρύ για τον διακομιστή από τον «κύκλο» (around).
  function bbox(pos, radius) {
    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.cos((pos.lat * Math.PI) / 180));
    return [pos.lat - dLat, pos.lng - dLng, pos.lat + dLat, pos.lng + dLng].map((x) => x.toFixed(5)).join(",");
  }

  async function query(cats, pos, radius) {
    const parts = cats.flatMap((c) => CATS[c][2]).map((f) => `nwr${f};`).join("");
    const q = `[out:json][timeout:20][bbox:${bbox(pos, radius)}];(${parts});out center;`;
    const data = await Net.json(SERVERS, { method: "POST", body: new URLSearchParams({ data: q }) }, 15000);
    const items = [];
    for (const el of data.elements || []) {
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
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
    for (const it of items) (byCat[it[0]] = byCat[it[0]] || []).push(it);
    return Object.values(byCat).flatMap((list) =>
      list.map((it) => [dist([pos.lat, pos.lng], [it[1], it[2]]), it]).sort((a, b) => a[0] - b[0]).slice(0, PER_CAT).map((x) => x[1])
    );
  }

  function covering(pos, maxAge = MAX_AGE) {
    const now = Date.now();
    return areas.find((a) => !a.partial && now - a.ts < maxAge && dist([a.lat, a.lng], [pos.lat, pos.lng]) < REFRESH_DIST);
  }

  // Κατεβάζει την περιοχή στο παρασκήνιο αν χρειάζεται. Επιστρέφει true αν ήρθαν νέα δεδομένα.
  function refresh(pos, { force = false } = {}) {
    if (inflight) return inflight;
    if (!force && covering(pos)) return Promise.resolve(false);
    if (!force && Date.now() - lastFail < RETRY_AFTER) return Promise.resolve(false);
    const center = { lat: pos.lat, lng: pos.lng };
    inflight = query(Object.keys(CATS), center, RADIUS)
      .then((items) => {
        const area = { lat: center.lat, lng: center.lng, r: RADIUS, ts: Date.now(), items: trim(items, center) };
        areas = [area, ...areas.filter((a) => dist([a.lat, a.lng], [center.lat, center.lng]) > REFRESH_DIST)].slice(0, MAX_AREAS);
        save();
        return true;
      })
      .catch((e) => {
        lastFail = Date.now();
        throw e;
      })
      .finally(() => (inflight = null));
    return inflight;
  }

  // Ζωντανή αναζήτηση μίας κατηγορίας σε μεγαλύτερη απόσταση (εξοχή, λίγα αποτελέσματα).
  async function liveSearch(cat, pos) {
    let items = [];
    let radius = 15000;
    for (radius of [15000, 40000]) {
      items = await query([cat], pos, radius);
      if (items.length >= 3) break;
    }
    // αποθηκεύεται ακόμα κι αν είναι άδειο, για να μην ξαναψάχνουμε σε κάθε πάτημα
    areas = [{ lat: pos.lat, lng: pos.lng, r: radius, ts: Date.now(), partial: cat, items: trim(items, pos) }, ...areas].slice(0, MAX_AREAS + 4);
    save();
    return nearby(cat, pos);
  }

  // Γρήγορη απάντηση (~1″) από το Nominatim όσο κατεβαίνει η πλήρης περιοχή,
  // ή εναλλακτική όταν οι διακομιστές Overpass δεν απαντούν.
  const KEYWORDS = {
    fuel: "fuel", food: "restaurant", cafe: "cafe", market: "supermarket", pharmacy: "pharmacy",
    parking: "parking", atm: "atm", ev: "charging station", hotel: "hotel", hospital: "hospital",
    carwash: "car wash", repair: "car repair", wc: "toilets",
  };
  async function quick(cat, pos) {
    const d = 0.12; // ~13 χλμ
    const params = new URLSearchParams({
      q: KEYWORDS[cat], format: "jsonv2", limit: "40", bounded: "1",
      viewbox: [pos.lng - d, pos.lat + d, pos.lng + d, pos.lat - d].map((x) => x.toFixed(4)).join(","),
    });
    const data = await Net.json(`https://nominatim.openstreetmap.org/search?${params}`, {}, 8000);
    const items = [];
    for (const r of data || []) {
      const tags = { [r.category]: r.type };
      if (!CATS[cat][3](tags)) continue;
      const parts = (r.display_name || "").split(",").map((x) => x.trim());
      const name = r.name || CATS[cat][0];
      const sub = parts.filter((x) => x && x !== name).slice(0, 2).join(", ");
      items.push([cat, +(+r.lat).toFixed(6), +(+r.lon).toFixed(6), name, sub]);
    }
    if (items.length) {
      areas = [...areas, { lat: pos.lat, lng: pos.lng, r: 13000, ts: Date.now(), partial: "quick", items }].slice(-(MAX_AREAS + 6));
      save();
    }
    return items.length;
  }

  // Έχουμε ήδη ψάξει μακρύτερα για αυτή την κατηγορία εδώ γύρω;
  function searchedWide(cat, pos) {
    const now = Date.now();
    return areas.some((a) => a.partial === cat && now - a.ts < MAX_AGE && dist([a.lat, a.lng], [pos.lat, pos.lng]) < REFRESH_DIST);
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

  const toPlace = (it, pos) => ({ cat: it[0], lat: it[1], lng: it[2], name: it[3], sub: it[4], dist: dist([pos.lat, pos.lng], [it[1], it[2]]) });

  // Άμεσα, από τη μνήμη του κινητού.
  function nearby(cat, pos, limit = 25) {
    const rows = unique(areas.flatMap((a) => a.items.filter((it) => it[0] === cat)));
    return rows.map((it) => toPlace(it, pos)).sort((a, b) => a.dist - b.dist).slice(0, limit);
  }

  // Για τις προτάσεις της αναζήτησης: μέρη με όνομα που ταιριάζει.
  function find(norm, pos, limit = 5) {
    if (!norm) return [];
    const rows = unique(areas.flatMap((a) => a.items.filter((it) => normalize(it[3]).includes(norm))));
    return rows.map((it) => toPlace(it, pos)).sort((a, b) => a.dist - b.dist).slice(0, limit);
  }

  function normalize(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
  }

  return {
    CATS,
    refresh,
    liveSearch,
    searchedWide,
    quick,
    nearby,
    find,
    normalize,
    hasData: (pos) => !!covering(pos, Infinity),
    isFresh: (pos) => !!covering(pos),
    busy: () => !!inflight,
  };
})();
