const qs = require("./qs.json");
const small = '[out:json][timeout:25][bbox:41.99,-71.53,42.01,-71.50];nwr["amenity"="cafe"];out center 20;';
const T = (ms) => AbortSignal.timeout(ms);
(async () => {
  const servers = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.osm.jp/api/interpreter", "https://overpass.openstreetmap.ru/api/interpreter"];
  await Promise.all(servers.flatMap((s) => [["tiny", small], ["fast-cafe", qs[0]]].map(async ([name, q]) => {
    const t = Date.now();
    try {
      const r = await fetch(s, { signal: T(60000), method: "POST", body: new URLSearchParams({ data: q }) });
      const txt = await r.text(); let n = "-"; try { n = JSON.parse(txt).elements.length; } catch {}
      console.log(`OVERPASS ${s} ${name} HTTP ${r.status} ${Date.now() - t}ms elements=${n} ACAO=${r.headers.get("access-control-allow-origin")} ${n === "-" ? txt.slice(0, 120).replace(/\s+/g, " ") : ""}`);
    } catch (e) { console.log(`OVERPASS ${s} ${name} ERROR ${Date.now() - t}ms ${e.name}`); }
  })));
  const box = "-71.72,41.85,-71.31,42.15"; // ~10 mi around Woonsocket
  for (const [q, tag] of [["cafe", "amenity:cafe"], ["coffee", ""], ["cafe", ""], ["Dunkin", ""], ["Starbucks", ""], ["Cumberland Farms", ""], ["Honey Dew", ""], ["gas", "amenity:fuel"], ["restaurant", "amenity:restaurant"], ["pharmacy", "amenity:pharmacy"], ["supermarket", "shop:supermarket"]]) {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=42.0029&lon=-71.5148&limit=50&bbox=${box}${tag ? "&osm_tag=" + tag : ""}`;
    const t = Date.now();
    try {
      const r = await fetch(u, { signal: T(20000) }); const j = await r.json();
      const f = j.features || [];
      console.log(`PHOTON q="${q}" tag=${tag || "-"} HTTP ${r.status} ${Date.now() - t}ms n=${f.length} ACAO=${r.headers.get("access-control-allow-origin")} :: ${f.slice(0, 12).map((x) => `${x.properties.name}[${x.properties.osm_key}=${x.properties.osm_value}]`).join(", ")}`);
    } catch (e) { console.log(`PHOTON q="${q}" ERROR ${e.message}`); }
  }
})();
