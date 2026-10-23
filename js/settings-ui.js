// Η οθόνη ρυθμίσεων: μονάδες, φωνή, ήχος, δικές σου ηχογραφήσεις.

import { QUIP_CATEGORIES } from "./config.js";
import { $ } from "./util.js";
import { settings, saveSettings } from "./store.js";
import { state } from "./state.js";
import { toast } from "./ui.js";
import { speedLabel } from "./format.js";
import { voices, isGreek, onVoicesChanged, quip, playClip } from "./voice.js";
import { recordingsFor, addRecording, removeRecording } from "./recordings.js";
import { renderMute, toggleMute } from "./nav.js";
import { renderDrawer } from "./drawer.js";
import { renderCards } from "./preview.js";

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
  const greek = all.filter(isGreek);
  sel.innerHTML = '<option value="">Αυτόματα (ελληνική)</option>';
  for (const [label, list] of [["Ελληνικές", greek], ["Άλλες γλώσσες", all.filter((v) => !isGreek(v))]]) {
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const v of list) g.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    sel.appendChild(g);
  }
  showVoice();
  if (sel.value !== settings.voiceURI) sel.value = "";
  $("voice-hint").hidden = greek.length > 1;
});

$("test-voice").onclick = () => {
  const muted = settings.mode === "mute";
  if (muted) settings.mode = "both";
  quip("right", "Στρίψε δεξιά");
  if (muted) settings.mode = "mute";
};

// ---------- δικές σου ηχογραφήσεις ----------

for (const [key, label] of Object.entries(QUIP_CATEGORIES)) $("rec-cat").appendChild(new Option(label, key));
$("rec-cat").onchange = renderClips;

function renderClips() {
  const cat = $("rec-cat").value;
  const list = $("rec-list");
  const clips = recordingsFor(cat);
  list.innerHTML = clips.length ? "" : '<li class="empty">Καμία ηχογράφηση ακόμα</li>';
  for (const c of clips) {
    const li = document.createElement("li");
    const play = Object.assign(document.createElement("button"), { className: "icon-btn", textContent: "▶", onclick: () => playClip(c) });
    const name = Object.assign(document.createElement("span"), { textContent: c.name });
    const del = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "✕",
      onclick: async () => {
        if (!confirm("Να σβηστεί αυτή η ηχογράφηση;")) return;
        await removeRecording(c.id);
        renderClips();
      },
    });
    del.setAttribute("aria-label", "Διαγραφή");
    li.append(play, name, del);
    list.appendChild(li);
  }
}

const clipName = (cat) => `${QUIP_CATEGORIES[cat]} #${recordingsFor(cat).length + 1}`;

let recorder = null;
$("rec-btn").onclick = async () => {
  if (recorder?.state === "recording") return recorder.stop();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast("Το κινητό δεν υποστηρίζει ηχογράφηση εδώ.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast("Χρειάζομαι άδεια για το μικρόφωνο.");
  }
  const type = ["audio/mp4", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const cat = $("rec-cat").value;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    $("rec-btn").classList.remove("on");
    $("rec-btn").textContent = "● Ηχογράφηση";
    if (!chunks.length) return;
    await addRecording(cat, new Blob(chunks, { type: recorder.mimeType || type }), clipName(cat));
    renderClips();
    toast("Αποθηκεύτηκε!");
  };
  recorder.start();
  $("rec-btn").classList.add("on");
  $("rec-btn").textContent = "■ Σταμάτα";
};

$("rec-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const cat = $("rec-cat").value;
  await addRecording(cat, file, file.name.replace(/\.[^.]+$/, "") || clipName(cat));
  renderClips();
  toast("Προστέθηκε!");
};
