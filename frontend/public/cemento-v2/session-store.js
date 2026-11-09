/**
 * Sesión local-first CEMENTO V2.
 * Storage propio (no comparte claves con Cerro Verde ni Cemento oficial).
 */
const DB = "cemento-v2-session-v1";
const VER = 1;
const STORE = "session";
const KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(KEY);
    r.onsuccess = () => {
      db.close();
      resolve(r.result || null);
    };
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
}

function emptySession(extra = {}) {
  return {
    id: crypto.randomUUID?.() || `cemv2-${Date.now()}`,
    active: false,
    localFirst: false,
    bootstrapped_at: null,
    user_email: "",
    user_uid: "",
    resumen: null,
    lista: null,
    geocercas: [],
    map_key: "",
    reporte_preview: null,
    detalle_by_placa: {},
    oc_local: {},
    movimientos: [],
    deltas: [],
    consolidado_at: null,
    ...extra,
  };
}

let mem = null;

export async function loadSession() {
  if (mem) return mem;
  mem = (await idbGet()) || emptySession();
  return mem;
}

export async function saveSession(s) {
  mem = s;
  await idbPut(s);
  return s;
}

export function sessionSnapshot() {
  return mem;
}

export function isLocalFirst() {
  return !!(mem && mem.active && mem.localFirst);
}

export async function clearSession() {
  mem = emptySession();
  await idbPut(mem);
  return mem;
}

export async function enqueueDelta(entry) {
  const s = await loadSession();
  s.deltas = s.deltas || [];
  s.deltas.push({
    id: crypto.randomUUID?.() || `d-${Date.now()}`,
    ts: new Date().toISOString(),
    ...entry,
  });
  await saveSession(s);
  return s.deltas.length;
}

export async function listDeltas() {
  const s = await loadSession();
  return s.deltas || [];
}

export async function setBootstrapPayload(payload) {
  const s = await loadSession();
  Object.assign(s, payload, {
    active: true,
    localFirst: true,
    bootstrapped_at: new Date().toISOString(),
    deltas: [],
    movimientos: [],
    oc_local: {},
    detalle_by_placa: {},
  });
  await saveSession(s);
  return s;
}

export async function markConsolidado() {
  const s = await loadSession();
  s.consolidado_at = new Date().toISOString();
  s.deltas = [];
  s.movimientos = [];
  await saveSession(s);
  return s;
}

export function listMovimientos() {
  const s = sessionSnapshot();
  return Array.isArray(s?.movimientos) ? [...s.movimientos] : [];
}

export function isBusinessMutation(url, body = {}) {
  const a = String(body.action || "").toLowerCase();
  if (!a) return false;
  // Lecturas → red o caché, no cola
  if (
    ["lista", "detalle", "map_config", "reporte_preview", "resumen"].includes(a)
  ) {
    return false;
  }
  // SAP aplicar siempre red (lo fuerza el módulo)
  if (String(url || "").includes("cemento-sap")) return false;
  // Mutaciones de seguimiento / reporte de negocio
  if (
    String(url || "").includes("cemento-seguimiento") ||
    String(url || "").includes("cemento-reporte") ||
    String(url || "").includes("cemento-montados")
  ) {
    // Hitos / cierre / parcial / consolidar → SIEMPRE red (maestro).
    // Si se encolan solo en IndexedDB, una auditoría ve DIARIO vacío.
    if (
      a === "guardar" ||
      a === "cerrar" ||
      a === "guardar_parcial" ||
      a === "guardar_cerrada" ||
      a === "consolidar" ||
      a === "desmarcar_revisada"
    ) {
      return false;
    }
    // marcar_revisada puede ir en cola + optimista (contadores UI); se empuja al consolidar sesión
    return a === "marcar_revisada" || a === "reabrir" || a === "parada_validar" || a === "sincronizar";
  }
  return false;
}

function normPlaca(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export async function applyOptimisticMutation(body = {}) {
  const s = await loadSession();
  if (!s.active) return s;
  const a = String(body.action || "").toLowerCase();
  s.movimientos = s.movimientos || [];
  const placa = normPlaca(body.placa || body.tracto || "");
  let desde = "DIARIO";
  let hasta = "DIARIO_EDITADO";
  if (a === "cerrar") {
    desde = "DIARIO";
    hasta = "HISTORICO_CERRADO";
  } else if (a === "marcar_revisada") {
    desde = "LISTA";
    hasta = "REVISADA";
  }
  s.movimientos.push({
    id: crypto.randomUUID?.() || `m-${Date.now()}`,
    ts: new Date().toISOString(),
    action: a,
    placa,
    id_oc: body.id ?? null,
    desde,
    hasta,
    datos: body.datos || {},
  });
  if (a === "marcar_revisada" && placa && s.lista?.placas) {
    for (const r of s.lista.placas) {
      if (normPlaca(r.placa) === placa) r.revisada = true;
    }
  }
  await saveSession(s);
  return s;
}
