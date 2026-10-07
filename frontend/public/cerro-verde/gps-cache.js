/**
 * Caché temporal GPS de CERRO VERDE (IndexedDB).
 * Independiente de Cemento: otra base, otro store.
 */
const DB_NAME = "cerro-verde-gps-temporal";
const DB_VER = 1;
const STORE = "routes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

export async function clearGPS() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export function gpsKey(runId, tracto, placa) {
  return `${runId || "norun"}|${tracto}|${placa}`;
}


/** Compat: mismo store que cerro-verde-tracking.js (c.one("gps", placa)). */
const LEGACY_DB = "cerro-verde-temporal";
const LEGACY_STORE = "gps";

function openLegacyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains("sap")) db.createObjectStore("sap");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putLegacyGPS(placa, data) {
  const key = String(placa || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!key || !data) return;
  const db = await openLegacyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_STORE, "readwrite");
    tx.objectStore(LEGACY_STORE).put({ ...data, placa: key }, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function readLegacyGPS(placa) {
  const key = String(placa || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!key) return null;
  const db = await openLegacyDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LEGACY_STORE).objectStore(LEGACY_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
