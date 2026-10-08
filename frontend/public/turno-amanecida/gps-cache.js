/** Caché GPS temporal para TURNO AMANECIDA (IndexedDB). */
const DB_NAME = "turno-amanecida-gps";
const DB_VER = 1;
const STORE = "routes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function gpsKey(runId, codigo, placa) {
  return `${runId || "tn"}|${String(codigo || "").toUpperCase()}|${String(placa || "").toUpperCase()}`;
}

export async function cacheGPS(data, key) {
  if (!data || !key) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...data, cached_at: Date.now() }, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function readGPS(key) {
  if (!key) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
