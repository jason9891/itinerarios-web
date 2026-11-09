/**
 * Sesión local-first CERRO VERDE.
 * Bootstrap (1× desde principal) → trabajo en caché → consolidar al finalizar reporte.
 * GPS no pasa por aquí (precarga / effectiveClocator → operador o principal).
 */
const DB = "cerro-verde-v2-session-v1";
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
    id: crypto.randomUUID?.() || `cv-${Date.now()}`,
    active: false,
    localFirst: false,
    bootstrapped_at: null,
    user_email: "",
    user_uid: "",
    resumen: null,
    lista: null,
    geocercas: [],
    map_key: "",
    pernoctes_sin_registro: null,
    paradas_estado: null,
    reporte_preview: null,
    detalle_by_placa: {},
    oc_local: {},
    /** Libro del turno: desde → hasta → datos (consolidado no adivina destino) */
    movimientos: [],
    deltas: [],
    consolidado_at: null,
    ...extra,
  };
}

/** Memoria de proceso para lecturas síncronas rápidas */
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

/**
 * Encola mutación de negocio (no GPS). No toca principal hasta flush.
 */
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

export async function patchSession(partial = {}) {
  const s = await loadSession();
  if (!s) return null;
  const next = { ...s, ...partial, updated_at: new Date().toISOString() };
  // null keys = delete from session so tryCacheRead misses
  for (const [k, v] of Object.entries(partial)) {
    if (v == null) delete next[k];
  }
  await saveSession(next);
  return next;
}

export async function setBootstrapPayload(payload) {
  const s = await loadSession();
  Object.assign(s, payload, {
    active: true,
    localFirst: true,
    bootstrapped_at: new Date().toISOString(),
  });
  await saveSession(s);
  return s;
}

export async function updateCachedLista(lista) {
  const s = await loadSession();
  s.lista = lista;
  await saveSession(s);
  return s;
}

export async function updateCachedResumen(resumen) {
  const s = await loadSession();
  s.resumen = resumen;
  await saveSession(s);
  return s;
}

export async function markConsolidado() {
  const s = await loadSession();
  s.consolidado_at = new Date().toISOString();
  s.deltas = [];
  s.movimientos = [];
  // Mantener caché de lectura; localFirst sigue hasta clear explícito
  await saveSession(s);
  return s;
}

/** Movimientos del turno (dónde estaba → dónde quedó → data). */
export function listMovimientos() {
  const s = sessionSnapshot();
  return Array.isArray(s?.movimientos) ? [...s.movimientos] : [];
}

/** Acciones de solo lectura que pueden resolverse desde caché */
export function isReadAction(body = {}) {
  const a = String(body.action || "").toLowerCase();
  return (
    !a ||
    a === "lista" ||
    a === "reporte_preview" ||
    a === "pernoctes_sin_registro" ||
    a === "paradas_estado" ||
    a === "map_config" ||
    a === "excel" // excel se genera al final; no cachear como mutación
  );
}

/** Mutaciones de negocio que deben encolarse en local-first */
export function isBusinessMutation(url, body = {}) {
  const a = String(body.action || "").toLowerCase();
  if (!a) return false;
  if (String(url || "").includes("clocator")) return false;
  // LECTURAS: no encolar (si se encolan, seguimiento sin OCs/placa)
  const READS = new Set([
    "lista", "detalle", "health", "estado", "map_config",
    "reporte_preview", "pernoctes_sin_registro", "paradas_estado",
    "cerradas_por_placa", "excel", "grupo_buscar",
  ]);
  if (READS.has(a)) return false;
  const WRITES = new Set([
    "guardar", "cerrar", "consolidar", "marcar_revisada", "otra_operacion",
    "reabrir_despacho", "reabrir_historico", "parada_validar",
    "grupo_agregar", "grupo_quitar", "pernocte_registrar",
    "validar_pernoctes_lote", "actualizar_llegada_smcv",
    "reabrir_pernocte_sin_gps", "reporte_actualizar_lote",
    "actualizar_corte", "aplicar_archivo", "validar_archivo", "reanalyze",
  ]);
  if (WRITES.has(a)) return true;
  return false;
}


function normPlaca(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function ensureOcLocal(s, placa) {
  s.oc_local = s.oc_local || {};
  const k = normPlaca(placa);
  if (!k) return null;
  if (!s.oc_local[k]) {
    s.oc_local[k] = {
      closedIds: [],
      revisada: false,
      patches: {},
      motivos: {},
    };
  }
  return { key: k, bag: s.oc_local[k] };
}

/** Aplica cierres/guardados locales sobre un detalle de servidor o caché. */
export function applyDetalleOverlay(detalle, placa) {
  if (!detalle || typeof detalle !== "object") return detalle;
  const s = sessionSnapshot();
  if (!s?.oc_local) return detalle;
  const k = normPlaca(placa || detalle.placa || detalle.tracto);
  const bag = s.oc_local[k];
  if (!bag) return detalle;
  const closed = new Set((bag.closedIds || []).map(String));
  const ocs = (detalle.ocs || []).map((o) => {
    const id = String(o.id ?? "");
    let next = { ...o };
    if (closed.has(id)) {
      next.preparado_cierre = true;
      next._local_closed = true;
      if (bag.motivos?.[id]) next.motivo_cierre = bag.motivos[id];
    }
    if (bag.patches?.[id] && typeof bag.patches[id] === "object") {
      next.payload = { ...(next.payload || {}), ...bag.patches[id] };
      next._local_saved = true;
    }
    return next;
  });
  const open = ocs.filter((o) => !o.preparado_cierre);
  // NO marcar revisada solo por open.length===0 (sin OCs en respuesta ≠ revisada).
  // Solo si el operador cerró en local y ya no quedan abiertas, o flag explícito.
  const revisada = !!(
    bag.revisada ||
    detalle.revisada ||
    (closed.size > 0 && open.length === 0)
  );

  // Botón "RESOLVER N DESPACHO(S) ANTERIOR(ES)"
  let revision =
    detalle.revision && typeof detalle.revision === "object"
      ? { ...detalle.revision }
      : { unresolved_previous: [] };

  const prev = Array.isArray(revision.unresolved_previous)
    ? revision.unresolved_previous
    : [];
  const filtered = prev.filter((item) => {
    if (item == null || typeof item !== "object") return false;
    const id = String(item.id ?? item.oc_id ?? item.orden_id ?? "");
    if (id && closed.has(id)) return false;
    if (id && ocs.some((o) => String(o.id) === id && o.preparado_cierre)) {
      return false;
    }
    // match por orden_carga si el server no manda id numérico
    const oc = String(item.orden_carga ?? item.entrega ?? "");
    if (oc) {
      const hit = ocs.find(
        (o) =>
          String(o.orden_carga || "") === oc ||
          String(o.entrega || "") === oc,
      );
      if (hit && (hit.preparado_cierre || closed.has(String(hit.id)))) {
        return false;
      }
    }
    return true;
  });

  revision = {
    ...revision,
    unresolved_previous: revisada ? [] : filtered,
    unresolved_count: revisada ? 0 : filtered.length,
  };

  for (let i = 0; i < ocs.length; i++) {
    if (ocs[i]._local_closed || closed.has(String(ocs[i].id ?? ""))) {
      ocs[i] = {
        ...ocs[i],
        preparado_cierre: true,
        requiere_cierre_por_despacho_posterior: false,
      };
    }
  }

  return {
    ...detalle,
    ocs,
    revisada,
    revision,
    _from_local_overlay: true,
  };
}

export function applyListaOverlay(lista) {
  if (!lista || typeof lista !== "object") return lista;
  const s = sessionSnapshot();
  if (!s?.oc_local) return lista;
  const rows = lista.placas || lista.registros || lista.unidades;
  if (!Array.isArray(rows)) return lista;
  const mapped = rows.map((r) => {
    const k = normPlaca(r.placa || r.tracto);
    const bag = s.oc_local[k];
    if (!bag) return r;
    const closedN = (bag.closedIds || []).length;
    let abiertos = Number(r.despachos_abiertos ?? r.ocs ?? 0);
    if (closedN > 0) abiertos = Math.max(0, abiertos - closedN);
    if (bag.revisada) abiertos = 0;
    return {
      ...r,
      revisada: !!(r.revisada || bag.revisada),
      despachos_abiertos: abiertos,
      ocs: abiertos,
      _local_track: true,
    };
  });
  const out = { ...lista };
  if (lista.placas) out.placas = mapped;
  else if (lista.registros) out.registros = mapped;
  else if (lista.unidades) out.unidades = mapped;
  return out;
}


/** Aplica en caché local mutaciones frecuentes (p. ej. pernoctes) para que la UI no "pierda" el guardado. */
export async function applyOptimisticMutation(body = {}) {
  const s = await loadSession();
  const a = String(body.action || "").toLowerCase();
  if (!s.active) return s;

  if (a === "pernocte_registrar" || a === "validar_pernoctes_lote" || a === "actualizar_llegada_smcv" || a === "reabrir_pernocte_sin_gps") {
    // Marcar items tocados en listas cacheadas
    const ids = [];
    if (body.id) ids.push(body.id);
    if (Array.isArray(body.ids)) ids.push(...body.ids);
    if (Array.isArray(body.filas)) {
      for (const f of body.filas) if (f?.id) ids.push(f.id);
    }
    const touch = (bag) => {
      if (!bag || typeof bag !== "object") return bag;
      const rows = bag.registros || bag.items || bag.rows || bag.data;
      if (Array.isArray(rows) && ids.length) {
        for (const r of rows) {
          if (ids.includes(r.id) || ids.includes(r.placa)) {
            r._local_saved = true;
            r._local_action = a;
            if (a === "pernocte_registrar") {
              r.tiene_pernocte = true;
              r.sin_registro = false;
              if (body.lugar) r.lugar_pernocte = body.lugar;
            }
            if (a === "validar_pernoctes_lote") {
              r.validado = true;
              r.pernocte_validado = true;
            }
          }
        }
      }
      return bag;
    };
    s.pernoctes_sin_registro = touch(s.pernoctes_sin_registro);
    s.paradas_estado = touch(s.paradas_estado);
    // Si registró, quitar de lista sin registro cuando hay array simple
    if (a === "pernocte_registrar" && Array.isArray(s.pernoctes_sin_registro)) {
      s.pernoctes_sin_registro = s.pernoctes_sin_registro.filter(
        (r) => !ids.includes(r.id) && !ids.includes(r.placa)
      );
    } else if (a === "pernocte_registrar" && s.pernoctes_sin_registro?.registros) {
      s.pernoctes_sin_registro.registros = s.pernoctes_sin_registro.registros.filter(
        (r) => !ids.includes(r.id) && !ids.includes(r.placa)
      );
    }
  }

  if (a === "reporte_actualizar_lote" && Array.isArray(body.filas) && s.reporte_preview) {
    s.reporte_preview = { ...s.reporte_preview, _local_dirty: true };
  }

  // --- Seguimiento: cerrar / guardar / marcar revisada (sensación local inmediata) ---
  if (a === "cerrar" || a === "guardar" || a === "marcar_revisada") {
    s.detalle_by_placa = s.detalle_by_placa || {};
    const placa =
      body.placa ||
      body.tracto ||
      (s.detalle_by_placa &&
        Object.entries(s.detalle_by_placa).find(([, d]) =>
          (d.ocs || []).some((o) => String(o.id) === String(body.id)),
        )?.[0]);
    // localizar placa desde detalle cache por id de OC
    let placaKey = normPlaca(placa);
    if (!placaKey && body.id != null) {
      for (const [pk, det] of Object.entries(s.detalle_by_placa)) {
        if ((det.ocs || []).some((o) => String(o.id) === String(body.id))) {
          placaKey = pk;
          break;
        }
      }
    }
    const loc = placaKey ? ensureOcLocal(s, placaKey) : null;

    if (a === "cerrar" && loc && body.id != null) {
      const id = String(body.id);
      if (!loc.bag.closedIds.includes(id)) loc.bag.closedIds.push(id);
      if (body.motivo_cierre) loc.bag.motivos[id] = body.motivo_cierre;
      // actualizar detalle cache
      const det = s.detalle_by_placa[loc.key];
      if (det?.ocs) {
        det.ocs = det.ocs.map((o) =>
          String(o.id) === id
            ? {
                ...o,
                preparado_cierre: true,
                _local_closed: true,
                motivo_cierre: body.motivo_cierre || o.motivo_cierre,
                payload: body.datos ? { ...(o.payload || {}), ...body.datos } : o.payload,
              }
            : o,
        );
        const open = det.ocs.filter((o) => !o.preparado_cierre);
        if (!open.length) {
          det.revisada = true;
          loc.bag.revisada = true;
        }
        if (det.revision && Array.isArray(det.revision.unresolved_previous)) {
          det.revision = {
            ...det.revision,
            unresolved_previous: det.revision.unresolved_previous.filter(
              (item) => String(item?.id ?? item?.oc_id ?? "") !== id
            ),
          };
          det.revision.unresolved_count = det.revision.unresolved_previous.length;
        }
        if (det.revisada && det.revision) {
          det.revision.unresolved_previous = [];
          det.revision.unresolved_count = 0;
        }
        s.detalle_by_placa[loc.key] = det;
      } else if (loc) {
        // sin detalle aún: al menos cuenta cierre
        loc.bag.closedIds = loc.bag.closedIds;
      }
    }

    if (a === "guardar" && loc && body.id != null) {
      const id = String(body.id);
      loc.bag.patches[id] = {
        ...(loc.bag.patches[id] || {}),
        ...(body.datos || {}),
      };
      const det = s.detalle_by_placa[loc.key];
      if (det?.ocs) {
        det.ocs = det.ocs.map((o) =>
          String(o.id) === id
            ? {
                ...o,
                payload: { ...(o.payload || {}), ...(body.datos || {}) },
                _local_saved: true,
              }
            : o,
        );
        s.detalle_by_placa[loc.key] = det;
      }
    }

    if (a === "marcar_revisada" && loc) {
      loc.bag.revisada = true;
      const det = s.detalle_by_placa[loc.key];
      if (det) {
        det.revisada = true;
        s.detalle_by_placa[loc.key] = det;
      }
    }

    // lista: contadores revisadas / abiertos
    if (s.lista && loc) {
      const rows = s.lista.placas || s.lista.registros || s.lista.unidades;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (normPlaca(r.placa || r.tracto) !== loc.key) continue;
          if (a === "marcar_revisada" || loc.bag.revisada) {
            r.revisada = true;
            r.despachos_abiertos = 0;
            r.ocs = 0;
          } else if (a === "cerrar") {
            const n = Number(r.despachos_abiertos ?? r.ocs ?? 1);
            r.despachos_abiertos = Math.max(0, n - 1);
            r.ocs = r.despachos_abiertos;
            if (r.despachos_abiertos === 0) r.revisada = true;
          }
        }
      }
    }

    // Libro del turno: desde → hasta → data (para consolidar sin adivinar)
    s.movimientos = s.movimientos || [];
    const detM = loc ? s.detalle_by_placa?.[loc.key] : null;
    const ocM = detM?.ocs?.find((o) => String(o.id) === String(body.id));
    const mapHasta = {
      cerrar: "HISTORICO_CERRADO",
      guardar: "DIARIO_EDITADO",
      marcar_revisada: "REVISADA",
    };
    s.movimientos.push({
      id: crypto.randomUUID?.() || `m-${Date.now()}`,
      ts: new Date().toISOString(),
      action: a,
      seguimiento_id: body.id ?? null,
      placa: loc?.key || normPlaca(body.placa) || "",
      orden_carga: body.orden_carga || ocM?.orden_carga || "",
      desde: a === "marcar_revisada" ? "GRUPO_SMCV" : "DIARIO",
      hasta: mapHasta[a] || "LOCAL",
      datos: body.datos || (ocM?.payload ? { ...ocM.payload } : {}),
      motivo_cierre: body.motivo_cierre || null,
    });
  }

  if (a === "grupo_agregar" || a === "grupo_quitar" || a === "otra_operacion") {
    s.movimientos = s.movimientos || [];
    s.movimientos.push({
      id: crypto.randomUUID?.() || `m-${Date.now()}`,
      ts: new Date().toISOString(),
      action: a,
      placa: normPlaca(body.placa || body.tracto || ""),
      orden_carga: body.orden_carga || "",
      desde: a === "grupo_agregar" ? "FUERA_O_SAP" : "GRUPO_SMCV",
      hasta: a === "grupo_agregar" ? "GRUPO_SMCV" : "FUERA_GRUPO",
      datos: { ...(body.datos || body) },
      motivo: body.motivo || body.reason || null,
    });
  }

  await saveSession(s);
  return s;
}

/** Guarda detalle de servidor y re-aplica overlays locales. */
export async function cacheDetalleFromNetwork(placa, detalle) {
  const s = await loadSession();
  if (!s.active) return detalle;
  s.detalle_by_placa = s.detalle_by_placa || {};
  const k = normPlaca(placa || detalle?.placa);
  if (!k) return detalle;
  const merged = applyDetalleOverlay({ ...detalle, placa: detalle?.placa || placa }, k);
  s.detalle_by_placa[k] = merged;
  await saveSession(s);
  return merged;
}

