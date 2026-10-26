// Η οθόνη ρυθμίσεων: μονάδες, φωνή, ήχος, δικές σου ηχογραφήσεις.

import { QUIP_KEYS } from "./config.js";
import { LANGS, lang, t } from "./i18n.js";
import { $ } from "./util.js";
import { settings, saveSettings } from "./store.js";
import { state } from "./state.js";
import { toast } from "./ui.js";
import { speedLabel } from "./format.js";
import { voices, speaks, onVoicesChanged, quip, playClip, quipLangs } from "./voice.js";
import { recordingsFor, addRecording, removeRecording } from "./recordings.js";
import { renderMute, toggleMute } from "./nav.js";
import { renderDrawer } from "./drawer.js";
import { renderCards } from "./preview.js";
import { clearAll as clearNearby } from "./poi.js";

$("clear-poi").onclick = () => {
  clearNearby();
  toast(t("poi.cleared"));
};

$("open-settings").onclick = () => {
  $("settings").hidden = false;
  renderClips();
};
$("close-settings").onclick = () => ($("settings").hidden = true);
$("settings").onclick = (e) => e.target === $("settings") && ($("settings").hidden = true);

// Συνδέει ένα πεδίο της οθόνης με μια ρύθμιση. Επιστρέφει συνάρτηση που ξαναδείχνει την τιμή.
function bind(id, key, { output, format = (v) => v, parse = (v) => v, onChange } = {}) {
  const el = $(id);
  const box = el.type === "checkbox";
  const show = () => {
    if (box) el.checked = settings[key];
    else el.value = settings[key];
    if (output) $(output).textContent = format(settings[key]);
  };
  show();
  el.addEventListener(box || el.tagName === "SELECT" ? "change" : "input", () => {
    settings[key] = box ? el.checked : parse(el.value);
    if (output) $(output).textContent = format(settings[key]);
    saveSettings();
    onChange?.();
  });
  return show;
}

// ---------- γλώσσες ----------

// Γλώσσα εφαρμογής: η σελίδα ξαναφορτώνει, ώστε όλα να εμφανιστούν στη νέα γλώσσα.
for (const [code, { name }] of Object.entries(LANGS)) $("s-uilang").appendChild(new Option(name, code));
// Γλώσσα ατάκων: όλες οι γλώσσες + Ποντιακά + Ελληνικά/Ποντιακά ανάμικτα.
for (const code of quipLangs()) {
  const label = code === "pnt" ? t("quip.pnt") : code === "mix" ? t("quip.mix") : LANGS[code]?.name || code;
  $("s-lang").appendChild(new Option(label, code));
}
bind("s-uilang", "uiLang", {
  onChange: () => {
    // οι ατάκες ακολουθούν τη νέα γλώσσα (τα Ποντιακά μένουν αν γύρισες στα Ελληνικά)
    const greekish = ["el", "pnt", "mix"].includes(settings.lang);
    if (!(settings.uiLang === "el" && greekish)) settings.lang = quipLangs().includes(settings.uiLang) ? settings.uiLang : "en";
    saveSettings();
    location.reload();
  },
});

const showSpeed = bind("s-speed", "speedLimit", { output: "o-speed", parse: Number, format: speedLabel });
bind("s-units", "units", {
  onChange: () => {
    showSpeed();
    renderDrawer();
    if (state.mode === "preview") renderCards();
  },
});
bind("s-rate", "rate", { output: "o-rate", parse: Number, format: (v) => v.toFixed(1) + "×" });
bind("s-pitch", "pitch", { output: "o-pitch", parse: Number, format: (v) => v.toFixed(1) });
bind("s-volume", "volume", { output: "o-volume", parse: Number, format: (v) => Math.round(v * 100) + "%" });
const showMode = bind("s-mode", "mode", { onChange: renderMute });
bind("s-lang", "lang");
bind("s-chime", "chime");
bind("s-myaudio", "myAudio");
renderMute();

$("mute").onclick = () => {
  toggleMute();
  saveSettings();
  showMode();
};

// ---------- φωνές ----------

const showVoice = bind("s-voice", "voiceURI");
onVoicesChanged(() => {
  const sel = $("s-voice");
  const all = voices();
  const mine = all.filter((v) => speaks(v, lang()));
  sel.innerHTML = "";
  sel.appendChild(new Option(t("voice.auto"), ""));
  for (const [label, list] of [[t("voice.match"), mine], [t("voice.other"), all.filter((v) => !speaks(v, lang()))]]) {
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const v of list) g.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    sel.appendChild(g);
  }
  showVoice();
  if (sel.value !== settings.voiceURI) sel.value = "";
  $("voice-hint").hidden = mine.length > 1;
});

$("test-voice").onclick = () => {
  const muted = settings.mode === "mute";
  if (muted) settings.mode = "both";
  quip("right", t("say.test"));
  if (muted) settings.mode = "mute";
};

// ---------- δικές σου ηχογραφήσεις ----------

for (const key of QUIP_KEYS) $("rec-cat").appendChild(new Option(t(`qc.${key}`), key));
$("rec-cat").onchange = renderClips;

function renderClips() {
  const cat = $("rec-cat").value;
  const list = $("rec-list");
  const clips = recordingsFor(cat);
  list.innerHTML = "";
  if (!clips.length) list.appendChild(Object.assign(document.createElement("li"), { className: "empty", textContent: t("rec.none") }));
  for (const c of clips) {
    const li = document.createElement("li");
    const play = Object.assign(document.createElement("button"), { className: "icon-btn", textContent: "▶", onclick: () => playClip(c) });
    const name = Object.assign(document.createElement("span"), { textContent: c.name });
    const del = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "✕",
      onclick: async () => {
        if (!confirm(t("rec.confirmDelete"))) return;
        await removeRecording(c.id);
        renderClips();
      },
    });
    del.setAttribute("aria-label", t("aria.delete"));
    li.append(play, name, del);
    list.appendChild(li);
  }
}

const clipName = (cat) => `${t(`qc.${cat}`)} #${recordingsFor(cat).length + 1}`;

let recorder = null;
$("rec-btn").onclick = async () => {
  if (recorder?.state === "recording") return recorder.stop();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast(t("rec.unsupported"));
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast(t("rec.mic"));
  }
  const type = ["audio/mp4", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const cat = $("rec-cat").value;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    $("rec-btn").classList.remove("on");
    $("rec-btn").textContent = t("rec.record");
    if (!chunks.length) return;
    await addRecording(cat, new Blob(chunks, { type: recorder.mimeType || type }), clipName(cat));
    renderClips();
    toast(t("rec.saved"));
  };
  recorder.start();
  $("rec-btn").classList.add("on");
  $("rec-btn").textContent = t("rec.stop");
};

$("rec-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const cat = $("rec-cat").value;
  await addRecording(cat, file, file.name.replace(/\.[^.]+$/, "") || clipName(cat));
  renderClips();
  toast(t("rec.added"));
};
