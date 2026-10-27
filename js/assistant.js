// Ο βοηθός: πατάς το 🎙, μιλάς, απαντάει με φωνή — και οι οδηγίες συνεχίζουν.
//
// Χωρίς τίποτα άλλο καταλαβαίνει εντολές: «καφές κοντά μου», «πήγαινέ με στην Ερμού 10»,
// «πόση ώρα μένει», «πού είμαι», «ξαναπές», «σταμάτα». Αν βάλεις δικό σου κλειδί Claude
// (Ρυθμίσεις → Βοηθός), μιλάς για ό,τι θες, και το Claude κάνει τις ίδιες ενέργειες μόνο του.
// Το κλειδί μένει μόνο σε αυτό το κινητό και πηγαίνει απευθείας στο api.anthropic.com.

import { $ } from "./util.js";
import { settings, places } from "./store.js";
import { state, origin } from "./state.js";
import { spokenDist, clockIn, useMiles } from "./format.js";
import { t, lang, locale, isNormalGps } from "./i18n.js";
import { holdSpeech, sayAndWait, isSpeaking, stopSound } from "./voice.js";
import { tripInfo, startNavigation, stopNavigation, reannounce, toggleMute } from "./nav.js";
import { previewDestination } from "./preview.js";
import { showNearby } from "./nearby.js";
import { searchPlaces, nearbyIntent } from "./search.js";
import { getJSON } from "./net.js";
import { SERVERS } from "./config.js";
import * as POI from "./poi.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const panel = $("assistant");
const log = $("as-log");
let rec = null;          // η αναγνώριση φωνής που ακούει τώρα
let session = null;      // { cut: διέκοψε οδηγία; } όσο είναι ανοιχτή η κουβέντα
let lastPlaces = [];     // τα τελευταία μέρη που είπε (για «πήγαινέ με στο πρώτο»)

// ---------- οθόνη ----------

function setState(text) {
  $("as-state").textContent = text;
}
function bubble(who, text) {
  const li = document.createElement("li");
  li.className = who;
  li.textContent = text;
  log.appendChild(li);
  while (log.children.length > 12) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  return li;
}
function open() {
  if (!session) {
    session = { cut: state.navigating && isSpeaking() };
    holdSpeech(true);
  }
  panel.hidden = false;
  $("mic").classList.add("on");
}
function close() {
  stopListening();
  panel.hidden = true;
  $("mic").classList.remove("on");
  if (!session) return;
  const cut = session.cut;
  session = null;
  holdSpeech(false);
  if (cut) reannounce(); // κόψαμε οδηγία για να σε ακούσουμε: την ξαναλέμε
}

// ---------- μικρόφωνο ----------

function stopListening() {
  if (!rec) return;
  const r = rec;
  rec = null;
  try {
    r.abort();
  } catch {}
}

function listen() {
  open();
  $("as-talk").hidden = !Recognition;
  if (!Recognition) {
    setState(t("as.noMic"));
    $("as-input").focus();
    return;
  }
  stopListening();
  stopSound(); // σταματάει ό,τι μιλάει, για να μην ακούσει τον εαυτό του
  const r = (rec = new Recognition());
  r.lang = locale();
  r.interimResults = true;
  r.maxAlternatives = 1;
  let heard = "";
  let live = null;
  setState(t("as.listening"));
  $("mic").classList.add("listening");
  $("as-talk").classList.add("listening");
  r.onresult = (e) => {
    heard = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
    (live ||= bubble("me", "")).textContent = heard;
  };
  r.onerror = (e) => {
    if (rec !== r) return;
    if (e.error === "not-allowed" || e.error === "service-not-allowed") setState(t("as.micDenied"));
  };
  r.onend = () => {
    $("mic").classList.remove("listening");
    $("as-talk").classList.remove("listening");
    if (rec !== r) return;
    rec = null;
    if (heard) handle(heard, live);
    else if ($("as-state").textContent === t("as.listening")) setState(t("as.tapToTalk"));
  };
  try {
    r.start();
  } catch {
    setState(t("as.noMic"));
  }
}

$("mic").onclick = $("as-talk").onclick = () => {
  if (rec) return stopListening();
  listen();
};
$("as-close").onclick = close;
$("as-form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("as-input").value.trim();
  if (!text) return;
  $("as-input").value = "";
  open();
  handle(text);
};

// ---------- κουβέντα ----------

const BYE = /^(bye|goodbye|thanks?,? (that'?s all|bye)|that'?s all|stop listening|nothing|never ?mind|άντε γεια|γεια|τίποτα|ευχαριστώ,? τίποτα|τέλος|adiós|gracias,? nada|au revoir|rien|tschüss|nichts|ciao|niente|tchau|nada|خلص|باي)\.?$/i;

async function handle(text, mine) {
  if (!mine) bubble("me", text);
  if (BYE.test(text.trim())) {
    await reply(t("as.bye"));
    return close();
  }
  setState(t("as.thinking"));
  let answer;
  try {
    answer = (await quickCommand(text)) ?? (settings.aiKey ? await askClaude(text) : await offlineCommand(text));
  } catch (e) {
    answer = e.userMessage || t("ai.error");
  }
  if (!session) return; // το έκλεισες στο μεταξύ
  await reply(answer);
  // σε κουβέντα: ακούει ξανά μόνο του μετά την απάντηση
  if (session && settings.aiConvo && Recognition && !panel.hidden) listen();
  else if (session) setState(t("as.tapToTalk"));
}

async function reply(text) {
  if (!text) return;
  bubble("bot", text);
  setState("");
  await sayAndWait(text);
}

// ---------- ενέργειες (ίδιες για τις εντολές και για το Claude) ----------

const ACTIONS = {
  async find_nearby({ category }) {
    const key = POI.CATS[category] ? category : "cafe";
    await showNearby(key);
    const from = origin();
    if (!from) return { error: "location unknown" };
    lastPlaces = POI.nearby(key, from).slice(0, 5);
    return { category: POI.catLabel(key), places: lastPlaces.map((p) => ({ name: p.name, distance: spokenDist(p.dist), address: p.sub || "" })) };
  },

  async navigate_to({ query }) {
    const from = origin();
    if (!from) return { error: "location unknown" };
    const q = (query || "").trim();
    // «το πρώτο», «το δεύτερο» ή όνομα από τη λίστα που μόλις είπε
    const ord = q.match(/\b(first|1st|one|πρώτο|second|2nd|two|δεύτερο|third|3rd|three|τρίτο)\b/i)?.[1]?.toLowerCase();
    const idx = ord ? (/^(first|1st|one|πρώτο)$/.test(ord) ? 0 : /^(second|2nd|two|δεύτερο)$/.test(ord) ? 1 : 2) : -1;
    let dest = idx >= 0 ? lastPlaces[idx] : lastPlaces.find((p) => q && p.name.toLowerCase().includes(q.toLowerCase()));
    if (!dest) dest = (await searchPlaces(q, from))[0];
    if (!dest) return { error: `nothing found for "${q}"` };
    if (state.navigating) stopNavigation();
    await previewDestination(dest);
    if (!state.routes.length) return { error: `no route to ${dest.name}` };
    places.addHistory(state.dest);
    const r = state.routes[0];
    startNavigation(r);
    return { destination: dest.name, address: dest.sub || "", distance: spokenDist(r.length), minutes: Math.round(r.duration / 60), arrival: clockIn(r.duration) };
  },

  async trip_status() {
    const info = tripInfo();
    if (!info) return { navigating: false };
    return { navigating: true, destination: info.dest?.name, remaining: spokenDist(info.rest), minutes: Math.max(1, Math.round(info.secs / 60)), arrival: clockIn(info.secs), next_direction: info.next, next_direction_in: spokenDist(info.nextIn) };
  },

  async where_am_i() {
    const p = origin();
    if (!p) return { error: "location unknown" };
    return { address: await addressAt(p), latitude: +p.lat.toFixed(5), longitude: +p.lng.toFixed(5), speed: state.pos?.speed != null ? Math.round(state.pos.speed * (useMiles() ? 2.237 : 3.6)) + (useMiles() ? " mph" : " km/h") : null };
  },

  async stop_navigation() {
    if (!state.navigating) return { navigating: false };
    stopNavigation();
    return { stopped: true };
  },

  async repeat_direction() {
    if (!state.navigating) return { navigating: false };
    const info = tripInfo();
    return { next_direction: info.next, in: spokenDist(info.nextIn) };
  },

  async set_voice_guidance({ on }) {
    if ((settings.mode !== "mute") !== on) toggleMute();
    return { voice_guidance: on ? "on" : "off" };
  },
};

// Διεύθυνση από συντεταγμένες: Esri (ξέρει αριθμούς σπιτιών), αλλιώς Photon.
async function addressAt(p) {
  try {
    const u = `${SERVERS.arcgisReverse}?location=${p.lng},${p.lat}&f=json&langCode=${lang()}`;
    const a = (await getJSON(u, {}, 5000)).address;
    if (a?.LongLabel || a?.Match_addr) return a.LongLabel || a.Match_addr;
  } catch {}
  try {
    const f = (await getJSON(`${SERVERS.photonReverse}?lat=${p.lat}&lon=${p.lng}`, {}, 5000)).features?.[0]?.properties || {};
    return [[f.housenumber, f.street].filter(Boolean).join(" ") || f.name, f.city || f.district, f.state].filter(Boolean).join(", ");
  } catch {}
  return "";
}

// ---------- εντολές χωρίς Claude ----------

const R = {
  stop: /^(stop|end|cancel|quit) (the )?(navigation|route|directions|guidance)\b|^(σταμάτα|ακύρωσε|τέλος) (την )?(πλοήγηση|διαδρομή)|^(detén|para|cancela) (la )?(navegación|ruta)|^(arrête|annule) (la )?(navigation|guidage)|^(navigation|route) (beenden|stoppen)|^(ferma|annulla) (la )?(navigazione)|^(parar|cancelar) (a )?(navegação)|وقّف الملاحة|وقف الطريق/i,
  repeat: /\b(repeat|say (that|it) again|what('?s| is) (the )?next( turn)?|next direction)\b|ξαναπές|επανάλαβε|επόμενη (στροφή|οδηγία)|repite|répète|wiederhol|ripeti|repete|عيد/i,
  eta: /\bhow (long|far|much longer)\b|\b(eta|arrival|when (will|do) (we|i) (get|arrive))\b|πόση ώρα|πόσο (μένει|απέχει|ακόμα)|πότε φτάνουμε|cuánto falta|combien de temps|wie lange noch|quanto manca|quanto falta|قديش باقي/i,
  where: /\bwhere am i\b|\bwhere are we\b|πού (είμαι|είμαστε|βρίσκομαι)|dónde estoy|où suis-je|wo bin ich|dove sono|onde estou|وين أنا/i,
  mute: /^(mute|be quiet|quiet|silence|shut up)\b|^(σκάσε|σιωπή|σίγαση|βούλωσ)|^(silencio|cállate)|^(silence|tais-toi)|^(ruhe|stumm)|^(silenzio|zitto)|^(silêncio|cala)|^(اسكت|سكوت)/i,
  unmute: /^(unmute|talk again|voice on|speak again)\b|^(μίλα|φωνή) ?(ξανά)?$|άνοιξε τη φωνή|^(habla|activa la voz)|^(parle|réactive)|^(sprich|ton an)|^(parla|attiva)|^(fala|liga a voz)|^(احكي)/i,
  go: /^(?:please\s+)?(?:navigate|take me|drive me|bring me|get me|go|directions|route me|let'?s go)\s+(?:to\s+(?:the\s+)?)?(.+)$|^(?:πήγαινέ με|πάμε|οδήγησέ με|πάρε με|δρομολόγιο)\s+(?:για\s+)?(?:στο|στη|στην|στον|στα|στις|σε|προς)?\s*(.+)$|^(?:llévame|vamos|ir)\s+(?:a|al|a la)\s+(.+)$|^(?:emmène-moi|allons|aller)\s+(?:à|au|à la|chez)\s+(.+)$|^(?:bring mich|fahr|navigiere)\s+(?:zu|zum|zur|nach)\s+(.+)$|^(?:portami|andiamo|vai)\s+(?:a|al|alla|in)\s+(.+)$|^(?:leva-me|vamos|ir)\s+(?:a|ao|à|para)\s+(.+)$|^(?:خدني|وصلني|روح)\s+(?:ع|على|لعند)?\s*(.+)$/i,
};

// Σύντομες εντολές που γίνονται αμέσως, με ή χωρίς Claude.
async function quickCommand(text) {
  const s = text.trim();
  if (R.stop.test(s)) return state.navigating ? (stopNavigation(), t("as.stopped")) : t("as.notNav");
  if (R.mute.test(s)) {
    if (settings.mode !== "mute") toggleMute();
    return t("as.muted");
  }
  if (R.unmute.test(s)) {
    if (settings.mode === "mute") toggleMute();
    return t("as.unmuted");
  }
  if (R.repeat.test(s) && state.navigating) {
    const i = tripInfo();
    return t("as.next", { d: spokenDist(i.nextIn), next: i.next });
  }
  if (R.eta.test(s)) return tripText();
  return null;
}

function tripText() {
  const i = tripInfo();
  if (!i) return t("as.notNav");
  return t("as.trip", { d: spokenDist(i.rest), m: Math.max(1, Math.round(i.secs / 60)), clock: clockIn(i.secs), next: i.next });
}

// Χωρίς Claude: κοντινά, «πήγαινέ με…», «πού είμαι», αλλιώς βοήθεια.
async function offlineCommand(text) {
  const s = text.trim().replace(/[.!?]+$/, "");
  if (R.where.test(s)) {
    const r = await ACTIONS.where_am_i();
    return r.address ? t("as.here", { place: r.address }) : t("as.hereUnknown");
  }
  const intent = nearbyIntent(s);
  if (intent) return placesText(await ACTIONS.find_nearby({ category: intent.key }));
  const m = s.match(R.go);
  const target = m && m.slice(1).find(Boolean);
  if (target) return goText(await ACTIONS.navigate_to({ query: target }), target);
  return t("as.help");
}

function placesText(r) {
  if (!r.places?.length) return t("as.none", { label: r.category || "" });
  const list = r.places.slice(0, 3).map((p) => `${p.name}, ${p.distance}`).join("; ");
  return t("as.found", { label: r.category, list });
}
function goText(r, q) {
  if (r.error) return t("as.notFound", { q });
  return t("as.going", { name: r.destination, d: r.distance, m: r.minutes });
}

// ---------- Claude ----------

let client = null;
let clientKey = "";
let history = [];
let lastTurn = 0;

async function claude() {
  if (client && clientKey === settings.aiKey) return client;
  const { default: Anthropic } = await import("../vendor/anthropic/anthropic-sdk.js");
  client = new Anthropic({ apiKey: settings.aiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 30000 });
  client.Anthropic = Anthropic;
  clientKey = settings.aiKey;
  return client;
}

const TOOLS = [
  { name: "find_nearby", description: "Find places of a category near the user's current location and show them on the map. Returns the closest ones with spoken distances.", input_schema: { type: "object", properties: { category: { type: "string", enum: Object.keys(POI.CATS), description: "fuel=gas station, food=restaurants/fast food, cafe=coffee, market=supermarket/convenience, pharmacy, parking, atm=ATM/bank, ev=EV charging, hotel, hospital, carwash, repair=car repair/tires, wc=restrooms" } }, required: ["category"], additionalProperties: false } },
  { name: "navigate_to", description: "Start turn-by-turn navigation to a place: a street address, a business or place name, or one of the places just found (by name, or 'first'/'second'/'third').", input_schema: { type: "object", properties: { query: { type: "string", description: "Address, place name, or 'first'/'second'/'third' from the last list." } }, required: ["query"], additionalProperties: false } },
  { name: "trip_status", description: "Remaining distance and time, arrival time, and the next direction of the current navigation.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "where_am_i", description: "The user's current street address and speed.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "stop_navigation", description: "End the current navigation.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "repeat_direction", description: "The next direction of the current navigation, to repeat it to the user.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "set_voice_guidance", description: "Turn the spoken navigation directions on or off.", input_schema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"], additionalProperties: false } },
].map((tool) => ({ ...tool, strict: true }));

const LANG_NAMES = { el: "Greek", en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ar: "Lebanese Arabic" };

function systemPrompt() {
  const pontic = ["pnt", "mix"].includes(settings.lang);
  const persona = isNormalGps()
    ? "You are the voice assistant of a navigation app. Be polite, warm and to the point."
    : "You are \"GPS Mangas\", the voice of a navigation app known for its cheeky Greek wise-guy (μάγκας) personality: streetwise, teasing, funny, with salty language when it fits. Keep the attitude, but never insult people's identity, and never encourage unsafe driving." +
      (pontic ? " When you speak Greek, sprinkle in Pontic Greek words and expressions." : "");
  return [
    persona,
    "The user is usually driving and hears your replies through the car speakers. Reply in one to three short spoken sentences: no lists, no markdown, no emoji, no URLs. Never ask the user to read or type anything while driving.",
    `Reply in ${LANG_NAMES[lang()] || "English"} unless the user speaks to you in another language; then use theirs. Use ${useMiles() ? "miles and feet" : "kilometers and meters"}.`,
    "Use the tools to find places, start or stop navigation, check the trip, or tell the user where they are; don't guess addresses, distances or times. After finding places, mention the closest two or three with their distances and offer to take the user there. Anything else, just talk.",
    "Each user message starts with an [App status] note from the app with the current time, location and navigation state; it is not said by the user.",
  ].join("\n\n");
}

function statusNote() {
  const p = origin();
  const i = tripInfo();
  const bits = [`time ${new Date().toLocaleString(locale(), { weekday: "long", hour: "2-digit", minute: "2-digit" })}`];
  bits.push(p ? `location ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${state.pos ? "" : " (last known)"}` : "location unknown");
  if (state.pos?.speed != null) bits.push(`speed ${Math.round(state.pos.speed * (useMiles() ? 2.237 : 3.6))} ${useMiles() ? "mph" : "km/h"}`);
  bits.push(i ? `navigating to ${i.dest?.name || "a destination"}: ${spokenDist(i.rest)} and ${Math.max(1, Math.round(i.secs / 60))} min left, next: ${i.next} in ${spokenDist(i.nextIn)}` : "not navigating");
  return `[App status: ${bits.join("; ")}]`;
}

async function askClaude(text) {
  const c = await claude();
  const A = c.Anthropic;
  // νέα κουβέντα μετά από 10′ σιωπής, ή όταν μακρύνει πολύ (δεν «κόβουμε» την παλιά — ξεκινάμε καθαρά)
  if (Date.now() - lastTurn > 10 * 60e3 || history.length > 40) history = [];
  lastTurn = Date.now();
  const turn = [...history, { role: "user", content: [{ type: "text", text: statusNote() }, { type: "text", text }] }];
  const model = settings.aiModel || "claude-opus-5-5";
  const fallback = model !== "claude-haiku-5-5"; // ο Haiku δεν έχει εφεδρικό μοντέλο στον διακομιστή

  for (let round = 0; round < 6; round++) {
    let res;
    try {
      res = await c.beta.messages.create({
        model,
        max_tokens: 4000,
        output_config: { effort: "low" }, // γρήγορες, σύντομες απαντήσεις για το αυτοκίνητο
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        system: systemPrompt(),
        tools: TOOLS,
        messages: turn,
      });
    } catch (e) {
      throw Object.assign(new Error("claude"), { userMessage: claudeError(e, A) });
    }
    turn.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "refusal") {
      history = []; // μια κουβέντα που απορρίφθηκε δεν συνεχίζεται
      return t("ai.refused");
    }
    if (res.stop_reason === "pause_turn") continue;
    const calls = res.content.filter((b) => b.type === "tool_use");
    const said = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    if (res.stop_reason !== "tool_use" || !calls.length) {
      history = turn;
      return said || "…";
    }
    if (said) bubble("bot", said);
    const results = [];
    for (const call of calls) {
      let out;
      try {
        out = ACTIONS[call.name] ? await ACTIONS[call.name](call.input || {}) : { error: "unknown tool" };
      } catch (e) {
        out = { error: String(e?.message || e) };
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) });
    }
    turn.push({ role: "user", content: results });
  }
  history = [];
  return t("ai.error");
}

function claudeError(e, A) {
  if (e instanceof A.AuthenticationError || e instanceof A.PermissionDeniedError) return t("ai.badKey");
  if (e instanceof A.RateLimitError || e instanceof A.InternalServerError) return t("ai.busy");
  if (e instanceof A.APIConnectionError) return t("ai.offline");
  if (e instanceof A.BadRequestError && /credit|billing|balance/i.test(e.message)) return t("ai.noCredit");
  return t("ai.error");
}

// Για τα τεστ.
export const _assistant = { handle, ACTIONS, quickCommand, offlineCommand, open, close };
