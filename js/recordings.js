// Οι δικές σου ηχογραφήσεις, αποθηκευμένες στο κινητό (IndexedDB).
// Κάθε clip: { id, category, name, blob, created }

const DB = "gps-mangas";
const STORE = "clips";
let dbPromise = null;
let cache = []; // όλα στη μνήμη, για άμεση επιλογή στην οδήγηση

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function loadRecordings() {
  try {
    cache = (await tx("readonly", (s) => s.getAll())) || [];
  } catch {
    cache = [];
  }
  return cache;
}

export async function addRecording(category, blob, name) {
  await tx("readwrite", (s) => s.add({ category, blob, name, created: Date.now() }));
  return loadRecordings();
}

export async function removeRecording(id) {
  await tx("readwrite", (s) => s.delete(id));
  return loadRecordings();
}

export const recordingsFor = (category) => cache.filter((c) => c.category === category);
