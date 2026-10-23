// Ήχος: φωνή του κινητού, «ντινγκ», δικές σου ηχογραφήσεις, επιλογή ατάκας.
//
// Η φωνή του iPhone μερικές φορές «κολλάει» ή χάνει φράσεις. Γι' αυτό έχουμε δική μας
// ουρά: δίνουμε μία φράση τη φορά, την παρακολουθούμε, και αν κολλήσει την ξεκολλάμε
// και την ξαναλέμε — ώστε να μη χαθεί καμία οδηγία.

import { PHRASES } from "./phrases.js";
import { QUIP_CATEGORIES } from "./config.js";
import { settings } from "./store.js";
import { recordingsFor } from "./recordings.js";

let audioCtx = null;
const player = new Audio();
player.playsInline = true;
const hasSpeech = "speechSynthesis" in window;

// Το iPhone παίζει ήχο μόνο αφού αγγίξεις κάτι: ξεκλείδωμα με το πρώτο άγγιγμα.
function unlock() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {}
  player.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  player.play().catch(() => {});
  if (hasSpeech) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
  document.removeEventListener("pointerdown", unlock);
}
document.addEventListener("pointerdown", unlock);

export function wakeAudio() {
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
}

function chime() {
  if (!settings.chime || !audioCtx) return;
  wakeAudio();
  const t = audioCtx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.12);
    g.gain.linearRampToValueAtTime(0.25 * settings.volume, t + i * 0.12 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(t + i * 0.12);
    o.stop(t + i * 0.12 + 0.3);
  });
}

// ---------- φωνές ----------

export const voices = () => (hasSpeech ? speechSynthesis.getVoices() : []);
export const isGreek = (v) => v.lang?.toLowerCase().startsWith("el");
export function onVoicesChanged(fn) {
  if (!hasSpeech) return;
  fn();
  speechSynthesis.onvoiceschanged = fn;
}
const currentVoice = () => voices().find((v) => v.voiceURI === settings.voiceURI) || voices().find(isGreek) || null;

// ---------- ουρά ομιλίας ----------

const speech = { queue: [], job: null, eventsWork: false };

export function stopSound() {
  speech.queue.length = 0;
  if (speech.job) clearTimeout(speech.job.timer);
  speech.job = null;
  if (hasSpeech) speechSynthesis.cancel();
  player.pause();
}

export function speak(text, interrupt = false) {
  if (settings.mode === "mute" || !text || !hasSpeech) return;
  if (interrupt) stopSound();
  speech.queue.push({ text, tries: 0 });
  // στο iPhone, μια φράση αμέσως μετά το cancel() χάνεται — μικρή αναμονή
  setTimeout(pump, interrupt ? 120 : 0);
}

const longWait = (text) => Math.max(8000, (text.length * 140) / settings.rate);

function pump() {
  if (speech.job || !speech.queue.length) return;
  // μην μιλάμε πάνω από δική σου ηχογράφηση
  if (!player.paused && !player.ended && player.dataset.url) return void setTimeout(pump, 300);
  const item = speech.queue.shift();
  const job = { item, started: false, waited: false, timer: null };
  speech.job = job;

  const finish = () => {
    if (speech.job !== job) return;
    clearTimeout(job.timer);
    speech.job = null;
    pump();
  };
  const stuck = () => {
    if (speech.job !== job) return;
    // μιλάει ήδη, απλώς δεν ειδοποίησε: άφησέ τη να τελειώσει
    if (!job.started && !job.waited && speechSynthesis.speaking) {
      job.waited = true;
      job.timer = setTimeout(stuck, longWait(item.text));
      return;
    }
    speechSynthesis.cancel();
    speech.job = null;
    // ξαναλέμε τη φράση μόνο αν η φωνή ειδοποιεί κανονικά (αλλιώς θα ακουγόταν διπλή)
    if (!job.started && !job.waited && speech.eventsWork && item.tries < 2) {
      item.tries++;
      speech.queue.unshift(item);
    }
    setTimeout(pump, 150);
  };

  try {
    speechSynthesis.resume(); // ξεκολλάει τη φωνή μετά από κλήση, Siri κ.λπ.
  } catch {}
  chime();
  const u = new SpeechSynthesisUtterance(item.text);
  const v = currentVoice();
  u.lang = v ? v.lang : "el-GR";
  if (v) u.voice = v;
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  u.volume = settings.volume;
  u.onstart = () => {
    job.started = true;
    speech.eventsWork = true;
    clearTimeout(job.timer);
    job.timer = setTimeout(stuck, longWait(item.text));
  };
  u.onend = finish;
  u.onerror = finish;
  job.timer = setTimeout(stuck, 4000); // δεν ξεκίνησε σε 4″ = κόλλησε
  speechSynthesis.speak(u);
}

// ---------- ηχογραφήσεις ----------

export function playClip(clip, interrupt = true) {
  if (settings.mode === "mute") return;
  if (interrupt) stopSound();
  chime();
  if (player.dataset.url) URL.revokeObjectURL(player.dataset.url);
  const url = URL.createObjectURL(clip.blob);
  player.dataset.url = url;
  player.src = url;
  player.volume = settings.volume;
  setTimeout(() => player.play().catch(() => {}), settings.chime ? 350 : 0);
}

// ---------- ατάκες ----------

const lastPicked = {};

// Γραπτή ατάκα (τη διαβάζει η φωνή) ή δική σου ηχογράφηση.
function pick(category) {
  const set = PHRASES[category] || { el: [] };
  const texts =
    settings.lang === "mix" ? [...(set.el || []), ...(set.pnt || [])] : set[settings.lang]?.length ? set[settings.lang] : set.el || [];
  const clips = settings.myAudio === "off" ? [] : recordingsFor(category);
  const pool =
    settings.myAudio === "only" && clips.length
      ? clips.map((clip) => ({ clip }))
      : [...texts.map((text) => ({ text })), ...clips.map((clip) => ({ clip }))];
  if (!pool.length) return { text: "" };
  let p;
  do {
    p = pool[Math.floor(Math.random() * pool.length)];
  } while (pool.length > 1 && (p.text || p.clip.id) === lastPicked[category]);
  lastPicked[category] = p.text || p.clip.id;
  return p;
}

// Λέει την ατάκα της κατηγορίας (στο «σοβαρό» μόνο την κανονική οδηγία).
// Επιστρέφει το κείμενο για την κάρτα.
export function quip(category, plainText, interrupt = true) {
  if (settings.mode === "plain") {
    if (plainText) speak(plainText, interrupt);
    return "";
  }
  const p = pick(category);
  if (p.clip) {
    playClip(p.clip, interrupt);
    return "🎙 " + (p.clip.name || QUIP_CATEGORIES[category]);
  }
  speak(p.text, interrupt);
  return p.text;
}
