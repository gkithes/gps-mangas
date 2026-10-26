// Ό,τι μένει αποθηκευμένο στο κινητό: ρυθμίσεις, πρόσφατα, αγαπημένα, τελευταία θέση.
// (Τα ονόματα των κλειδιών μένουν ίδια με την προηγούμενη έκδοση, για να μη χαθεί τίποτα.)

import { loadJSON, saveJSON } from "./util.js";

// ---------- ρυθμίσεις ----------

const SETTINGS_KEY = "gps-mangas-settings";

export const DEFAULTS = {
  uiLang: "el",     // γλώσσα εφαρμογής: el | en | es | fr | de | it | pt | ar | auto
  style: "magkas",  // magkas (με ατάκες) | normal (κανονικό GPS, χωρίς ατάκες)
  units: "auto",    // auto | km | mi
  mapStyle: "map",  // map | satellite
  travel: "drive",  // drive | walk
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  mode: "both",     // both | quips | plain | mute
  lang: "el",       // el | pnt | mix
  chime: true,
  speedLimit: 120,  // πάντα σε χλμ/ώρα
  myAudio: "mix",   // mix | only | off
  drawerOpen: false,
  drawerTab: "history",
};

export const settings = { ...DEFAULTS, ...loadJSON(SETTINGS_KEY, {}) };
export const saveSettings = () => saveJSON(SETTINGS_KEY, settings);

// ---------- τελευταία γνωστή θέση ----------

const POS_KEY = "gps-mangas-last-pos";
let lastSaved = 0;

export const lastPos = {
  value: loadJSON(POS_KEY, null),
  update(pos) {
    this.value = { lat: pos.lat, lng: pos.lng };
    if (Date.now() - lastSaved > 30000) {
      lastSaved = Date.now();
      saveJSON(POS_KEY, this.value);
    }
  },
};

// ---------- πρόσφατα & αγαπημένα ----------

const PLACES_KEY = "gps-mangas-places";
const MAX_HISTORY = 30;
const data = { history: [], favorites: [], ...loadJSON(PLACES_KEY, {}) };
const savePlaces = () => saveJSON(PLACES_KEY, data);
const idOf = (p) => `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`;
const clean = (p) => ({ id: idOf(p), name: p.name, sub: p.sub || "", lat: +p.lat, lng: +p.lng, ts: Date.now() });

export const places = {
  history: () => data.history,
  favorites: () => data.favorites,
  isFavorite: (p) => data.favorites.some((f) => f.id === idOf(p)),

  addHistory(p) {
    const item = clean(p);
    data.history = [item, ...data.history.filter((h) => h.id !== item.id)].slice(0, MAX_HISTORY);
    savePlaces();
  },

  toggleFavorite(p) {
    const id = idOf(p);
    if (data.favorites.some((f) => f.id === id)) data.favorites = data.favorites.filter((f) => f.id !== id);
    else data.favorites = [clean(p), ...data.favorites];
    savePlaces();
    return places.isFavorite(p);
  },

  // Το όνομα αλλάζει και στις δύο λίστες, για να μη μπερδεύεται.
  rename(id, name) {
    for (const p of [...data.history, ...data.favorites]) if (p.id === id) p.name = name;
    savePlaces();
  },

  remove(list, id) {
    data[list] = data[list].filter((p) => p.id !== id);
    savePlaces();
  },

  clearHistory() {
    data.history = [];
    savePlaces();
  },
};
