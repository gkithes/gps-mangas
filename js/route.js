// Διαδρομές: λήψη από τον διακομιστή, προετοιμασία για γρήγορο εντοπισμό, κείμενα οδηγιών.

import { SERVERS } from "./config.js";
import { getJSON } from "./net.js";
import { haversine } from "./util.js";

export async function fetchRoutes(from, to, alternatives = true) {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? 3 : "false"}`;
  const data = await getJSON(SERVERS.route.map((base) => base + path), {}, 10000);
  if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.message || "no route");
  return data.routes.map(parseRoute).sort((a, b) => a.duration - b.duration);
}

function parseRoute(r) {
  const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const classes = new Set();
  let turns = 0;
  const steps = r.legs[0].steps.map((s) => {
    for (const it of s.intersections || []) for (const c of it.classes || []) classes.add(c);
    const t = s.maneuver.type;
    const m = s.maneuver.modifier || "";
    if (t !== "depart" && t !== "arrive" && (/left|right|uturn/.test(m) || t.includes("roundabout"))) turns++;
    return {
      type: t,
      modifier: s.maneuver.modifier,
      exit: s.maneuver.exit,
      name: s.name,
      loc: [s.maneuver.location[1], s.maneuver.location[0]],
    };
  });
  return prepare({
    coords,
    steps,
    distance: r.distance,
    duration: r.duration,
    via: r.legs[0].summary || "",
    toll: classes.has("toll"),
    motorway: classes.has("motorway"),
    ferry: classes.has("ferry"),
    turns,
  });
}

// Για κάθε σημείο και κάθε στροφή: πόσα μέτρα από την αρχή της διαδρομής («along»).
function prepare(r) {
  const c = r.coords;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine(c[i - 1], c[i]));
  let j = 0;
  for (const s of r.steps) {
    let best = Infinity;
    let bi = j;
    for (let k = j; k < c.length; k++) {
      const dist = haversine(c[k], s.loc);
      if (dist < best) {
        best = dist;
        bi = k;
        if (dist < 1) break;
      }
    }
    s.along = cum[bi];
    j = bi;
  }
  r.cum = cum;
  r.length = cum[cum.length - 1];
  r.seg = 0;
  return r;
}

// Πού βρίσκεσαι πάνω στη διαδρομή: μέτρα που έχεις κάνει (along) και απόσταση από τη γραμμή (off).
// Δεν χρειάζεται να περάσεις ακριβώς από τις στροφές — αντέχει GPS που «πετάει» 50+ μέτρα.
export function locate(r, p) {
  const c = r.coords;
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  const scan = (from, to) => {
    let best = { off: Infinity, seg: from, along: 0 };
    for (let i = from; i < to; i++) {
      const ax = (c[i][1] - p[1]) * kx, ay = (c[i][0] - p[0]) * ky;
      const bx = (c[i + 1][1] - p[1]) * kx, by = (c[i + 1][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, len2 ? -(ax * dx + ay * dy) / len2 : 0));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.off) best = { off, seg: i, along: r.cum[i] + t * (r.cum[i + 1] - r.cum[i]) };
    }
    return best;
  };
  const last = c.length - 1;
  // πρώτα κοντά στο σημείο που ήσουν (γρήγορο), αλλιώς σε όλη τη διαδρομή
  let res = scan(Math.max(0, r.seg - 20), Math.min(last, r.seg + 400));
  if (res.off > 40) {
    const all = scan(0, last);
    if (all.off < res.off - 5) res = all;
  }
  r.seg = res.seg;
  return res;
}

// ---------- κείμενα & εικονίδια ----------

const MOD = {
  left: "αριστερά",
  right: "δεξιά",
  "slight left": "ελαφρώς αριστερά",
  "slight right": "ελαφρώς δεξιά",
  "sharp left": "απότομα αριστερά",
  "sharp right": "απότομα δεξιά",
  straight: "ευθεία",
  uturn: "αναστροφή",
};

const ANGLE = { straight: 0, "slight right": 45, right: 90, "sharp right": 135, "slight left": -45, left: -90, "sharp left": -135 };

// Ποια κατηγορία ατάκας ταιριάζει σε μια στροφή.
export function quipCategory(step) {
  const t = step.type;
  const m = step.modifier || "";
  if (t === "arrive") return "arrive";
  if (t.includes("roundabout") || t.includes("rotary")) return "roundabout";
  if (m === "uturn") return "uturn";
  if (t === "on ramp" || t === "off ramp" || t === "merge") return "highway";
  if (m.includes("left")) return "left";
  if (m.includes("right")) return "right";
  return "straight";
}

export function instruction(step) {
  const m = MOD[step.modifier] || "";
  const onto = step.name ? `, προς ${step.name}` : "";
  switch (step.type) {
    case "arrive":
      return "Έφτασες στον προορισμό";
    case "roundabout":
    case "rotary":
      return step.exit ? `Στον κυκλικό κόμβο, πάρε την ${step.exit}η έξοδο${onto}` : `Μπες στον κυκλικό κόμβο${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Βγες από τον κυκλικό κόμβο${onto}`;
    case "on ramp":
      return `Μπες στη ράμπα ${m}${onto}`.trim();
    case "off ramp":
      return `Πάρε την έξοδο ${m}${onto}`.trim();
    case "merge":
      return `Μπες στην κυκλοφορία ${m}${onto}`.trim();
    default:
      if (step.modifier === "uturn") return "Κάνε αναστροφή";
      if (step.modifier === "straight") return `Συνέχισε ευθεία${onto}`;
      return `Στρίψε ${m}${onto}`;
  }
}

export function arrowSvg(step) {
  if (!step) return "";
  const s = 'fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"';
  if (step.type === "arrive") return `<path d="M14 42V8M14 9h20l-5 7 5 7H14" ${s}/>`;
  if (step.type.includes("roundabout") || step.type.includes("rotary"))
    return `<circle cx="24" cy="20" r="8" ${s}/><path d="M24 44V28M30 14l6-6M30 8h6v6" ${s}/>`;
  if (step.modifier === "uturn") return `<path d="M30 42V18a8 8 0 0 0-16 0v10M8 22l6 7 6-7" ${s}/>`;
  const a = ANGLE[step.modifier] || 0;
  return `<g transform="rotate(${a} 24 26)"><path d="M24 44V8M13 19L24 8l11 11" ${s}/></g>`;
}
