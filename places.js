// Πρόσφατοι προορισμοί και αγαπημένα, αποθηκευμένα στο κινητό.
// Κάθε μέρος: { id, name, sub, lat, lng, ts }

window.Places = (() => {
  const KEY = "gps-mangas-places";
  const MAX_HISTORY = 30;
  let data = { history: [], favorites: [] };
  try {
    data = { ...data, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {}

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  };

  const idOf = (p) => `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`;
  const clean = (p) => ({ id: idOf(p), name: p.name, sub: p.sub || "", lat: +p.lat, lng: +p.lng, ts: Date.now() });

  return {
    history: () => data.history,
    favorites: () => data.favorites,
    isFavorite: (p) => data.favorites.some((f) => f.id === idOf(p)),

    addHistory(p) {
      const item = clean(p);
      data.history = [item, ...data.history.filter((h) => h.id !== item.id)].slice(0, MAX_HISTORY);
      save();
    },

    toggleFavorite(p) {
      const id = idOf(p);
      if (data.favorites.some((f) => f.id === id)) data.favorites = data.favorites.filter((f) => f.id !== id);
      else data.favorites = [clean(p), ...data.favorites];
      save();
      return this.isFavorite(p);
    },

    rename(list, id, name) {
      for (const p of data[list]) if (p.id === id) p.name = name;
      // ίδιο όνομα και στην άλλη λίστα, για να μη μπερδεύεται
      for (const p of data[list === "history" ? "favorites" : "history"]) if (p.id === id) p.name = name;
      save();
    },

    remove(list, id) {
      data[list] = data[list].filter((p) => p.id !== id);
      save();
    },

    clearHistory() {
      data.history = [];
      save();
    },
  };
})();
