const T = (ms) => AbortSignal.timeout(ms);
const near = { lat: 42.0029, lon: -71.5148 };
const show = async (label, url, pick) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { signal: T(15000), headers: { Origin: "https://gkithes.github.io", Referer: "https://gkithes.github.io/gps-mangas/" } });
    const txt = await r.text(); let out;
    try { out = pick(JSON.parse(txt)); } catch (e) { out = "NOT JSON: " + txt.slice(0, 120).replace(/\s+/g, " "); }
    console.log(`${label} HTTP ${r.status} ${Date.now() - t}ms ACAO=${r.headers.get("access-control-allow-origin")} :: ${out}`);
  } catch (e) { console.log(`${label} ERROR ${e.message}`); }
};
const ph = (j) => (j.features || []).slice(0, 5).map((f) => { const p = f.properties; return `${p.housenumber || ""} ${p.name || p.street || ""} [${p.osm_value}] ${p.city || p.district || ""} ${p.state || ""} @${f.geometry.coordinates.map((x) => x.toFixed(4))}`; }).join(" | ") || "(none)";
const arc = (j) => (j.candidates || []).slice(0, 4).map((c) => `${c.address} score=${c.score} @${c.location.y.toFixed(4)},${c.location.x.toFixed(4)}`).join(" | ") || JSON.stringify(j).slice(0, 150);
(async () => {
  for (const q of ["16 sprague hill rd Chepachet", "16 Sprague Hill Road, Chepachet, RI", "sprague hill rd chepachet", "Sprague Hill Road Glocester", "16 sprague hill"]) {
    await show(`PHOTON "${q}"`, `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${near.lat}&lon=${near.lon}&limit=5`, ph);
    await new Promise((r) => setTimeout(r, 400));
  }
  for (const q of ["16 sprague hill rd Chepachet", "16 sprague hill"]) {
    await show(`ARCGIS find "${q}"`, `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(q)}&f=json&maxLocations=4&location=${near.lon},${near.lat}&outFields=Match_addr`, arc);
    await show(`ARCGIS suggest "${q}"`, `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?text=${encodeURIComponent(q)}&f=json&maxSuggestions=5&location=${near.lon},${near.lat}`, (j) => (j.suggestions || []).map((s) => s.text).join(" | ") || JSON.stringify(j).slice(0, 150));
  }
  await show(`CENSUS`, `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent("16 Sprague Hill Rd, Chepachet, RI")}&benchmark=Public_AR_Current&format=json`, (j) => (j.result?.addressMatches || []).map((m) => `${m.matchedAddress} @${m.coordinates.y},${m.coordinates.x}`).join(" | ") || "(none)");
})();
