// Οι δικές σου ηχογραφήσεις, αποθηκευμένες στο κινητό (IndexedDB).
// Κάθε clip: { id, category, name, blob, created }

window.Recordings = (() => {
  const DB = "gps-mangas", STORE = "clips";
  let dbPromise = null;
  let cache = []; // όλα τα clips στη μνήμη για γρήγορη επιλογή στην οδήγηση

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  async function load() {
    try {
      cache = (await tx("readonly", (s) => s.getAll())) || [];
    } catch {
      cache = [];
    }
    return cache;
  }

  async function add(category, blob, name) {
    await tx("readwrite", (s) => s.add({ category, blob, name, created: Date.now() }));
    return load();
  }

  async function remove(id) {
    await tx("readwrite", (s) => s.delete(id));
    return load();
  }

  const forCategory = (category) => cache.filter((c) => c.category === category);

  return { load, add, remove, forCategory };
})();
