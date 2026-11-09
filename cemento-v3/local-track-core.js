/**
 * Núcleo LOCAL del seguimiento CEMENTO V3 (sin dependencias del navegador → probado en Node).
 *
 * Replica en el navegador lo que hace la función `cemento-seguimiento` del maestro:
 *   lista · bootstrap · detalle · cerradas_por_tracto · guardar · cerrar · guardar_cerrada ·
 *   marcar_revisada · desmarcar_revisada
 * pero SIN escribir en el maestro. Lo que cambió se calcula al final (`pendingOps`) como una
 * lista de operaciones idempotentes, que `consolidar.js` envía una sola vez al terminar.
 *
 * Contexto `ctx`:
 *   ctx.track = { units, boot_revisadas, hist_edits, hist_loaded }
 *   ctx.hist  = { [tractoNorm]: [ {id, orden_carga, payload, original_payload, ...} ] }
 *   ctx.touched = Set("track" | "hist:<tractoNorm>")  ← qué hay que volver a guardar en IndexedDB
 */

/** clave del formulario → columna del DIARIO (igual que el maestro) */
export const MAP = {
  salida_planta: "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  llegada_destino: "FECHA LLEGADA A DESTINO",
  inicio_retorno: "FECHA INICIO DE RETORNO",
  fin_de_ciclo: "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  carga_retorno: "CARGA DE RETORNO",
  observaciones: "OBSERVACIONES",
  ubicacion: "UBICACIÓN",
  estado_fisico: "ESTADO",
};
const COL_TO_KEY = Object.fromEntries(Object.entries(MAP).map(([k, c]) => [c, k]));

export const LOCAL_ACTIONS = new Set([
  "lista",
  "bootstrap",
  "detalle",
  "cerradas_por_tracto",
  "guardar",
  "cerrar",
  "guardar_cerrada",
  "marcar_revisada",
  "desmarcar_revisada",
]);

export const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const tractoNorm = (v) => norm(v).replace(/^20R(?=\d)/, "R");
const plateOf = (p) => String(p?.["Placa Tracto"] || p?.TRACTO || "");
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const touch = (ctx, k) => ctx.touched?.add(k);

export function newCtx(track = null, hist = {}) {
  return { track, hist, touched: new Set() };
}

/** Arma el `track` local desde la respuesta `bootstrap` del maestro. */
export function buildTrack(bootResp) {
  const units = clone(bootResp?.units || []);
  const rev = [];
  for (const u of units) {
    u.revisada = !!u.revisada || (u.ocs || []).some((o) => o.borrador?.revisada === true);
    if (u.revisada) rev.push(norm(u.placa));
    for (const o of u.ocs || []) o.local = { dirty: false };
  }
  return { units, boot_revisadas: rev, hist_edits: {}, hist_loaded: [], built_at: new Date().toISOString() };
}

/** Marca como cargado un lote de históricos {tractoNorm: ocs[]} (respuesta del maestro). */
export function putHist(ctx, mapByTracto) {
  for (const [k0, ocs] of Object.entries(mapByTracto || {})) {
    const k = tractoNorm(k0);
    ctx.hist[k] = (ocs || []).map((o) => ({
      ...o,
      payload: { ...(o.payload || {}) },
      original_payload: { ...(o.original_payload || o.payload || {}) },
      historico: true,
    }));
    if (!ctx.track.hist_loaded.includes(k)) ctx.track.hist_loaded.push(k);
    touch(ctx, "hist:" + k);
  }
  touch(ctx, "track");
}

export const histLoaded = (ctx, tracto) => ctx.track.hist_loaded.includes(tractoNorm(tracto));

const isDraft = (o) => o.borrador && (o.borrador.accion === "CERRAR" || Object.keys(o.borrador.cambios || {}).length > 0);

function unitByPlate(ctx, placa) {
  const k = norm(placa);
  return ctx.track.units.find((u) => norm(u.placa) === k) || null;
}

function findOc(ctx, id) {
  for (const u of ctx.track.units) {
    const o = (u.ocs || []).find((x) => Number(x.id) === Number(id));
    if (o) return { u, o };
  }
  return null;
}

/** Misma lógica que `guardar`/`cerrar` del maestro (merge con borrador previo) pero local. */
function applyGuardar(ctx, b, action) {
  const id = Number(b.id);
  if (!Number.isInteger(id)) throw new Error("ID inválido");
  const f = findOc(ctx, id);
  if (!f) throw new Error("OC no encontrada en Diario");
  const { o } = f;
  const datos = b.datos || {};
  const changes = {};
  for (const [k, col] of Object.entries(MAP)) {
    if (!has(datos, k)) continue;
    const raw = datos[k];
    if (raw === null) {
      if (has(o.payload, col)) changes[col] = null;
      continue;
    }
    const value = String(raw).trim();
    if (!value) continue;
    if (String(o.payload?.[col] ?? "").trim() !== value) changes[col] = value;
  }
  const prev = o.borrador?.cambios && typeof o.borrador.cambios === "object" ? o.borrador.cambios : {};
  const merged = { ...prev, ...changes };
  o.borrador = {
    seguimiento_id: o.id,
    cambios: merged,
    accion: action === "cerrar" ? "CERRAR" : "GUARDAR",
    revisada: o.borrador?.revisada === true,
  };
  const next = { ...(o.payload || {}), ...merged };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete next[k];
  o.payload = next;
  o.local = { dirty: true };
  touch(ctx, "track");
  return {
    ok: true,
    accion: action === "cerrar" ? "CIERRE PREPARADO" : "GUARDADO LOCAL",
    cambios: Object.keys(merged).length,
    maestro: false,
    local: true,
  };
}

function applyRevisada(ctx, placa, value) {
  const key = norm(placa);
  if (!key) throw new Error("Placa inválida");
  const u = unitByPlate(ctx, placa);
  if (!u || !(u.ocs || []).length) {
    if (value) throw new Error("Unidad sin OCs abiertas");
    return { ok: true, revisada: false, placa, ocs: 0 };
  }
  for (const o of u.ocs) {
    o.borrador = {
      seguimiento_id: o.id,
      cambios: o.borrador?.cambios || {},
      accion: o.borrador?.accion || "GUARDAR",
      revisada: value,
    };
  }
  u.revisada = value;
  touch(ctx, "track");
  return { ok: true, revisada: value, placa, ocs: u.ocs.length, local: true };
}

function applyGuardarCerrada(ctx, b) {
  const id = Number(b.id);
  if (!Number.isInteger(id)) throw new Error("ID histórico inválido");
  let hit = null;
  for (const [k, list] of Object.entries(ctx.hist)) {
    const o = (list || []).find((x) => Number(x.id) === id);
    if (o) { hit = { k, o }; break; }
  }
  if (!hit) throw new Error("OC histórica no encontrada");
  const { k, o } = hit;
  if (String(o.payload?.["ESTADO OC"] || "").trim().toUpperCase() !== "CERRADA") {
    throw new Error("La OC seleccionada no está cerrada");
  }
  const changes = {};
  for (const [key, col] of Object.entries(MAP)) {
    if (!has(b.datos, key)) continue;
    const raw = b.datos[key];
    const value = raw === null ? null : String(raw).trim();
    const before = o.payload?.[col] ?? null;
    if (String(before ?? "") !== String(value ?? "")) changes[col] = value;
  }
  if (!Object.keys(changes).length) {
    return { ok: true, accion: "SIN CAMBIOS", cambios: 0, historico: true, cerrada: true };
  }
  const next = { ...(o.payload || {}), ...changes };
  next["ESTADO OC"] = o.payload?.["ESTADO OC"] || "CERRADA";
  o.payload = next;
  ctx.track.hist_edits[id] = k;
  touch(ctx, "hist:" + k);
  touch(ctx, "track");
  return { ok: true, accion: "HISTORICO ACTUALIZADO", cambios: Object.keys(changes).length, historico: true, cerrada: true, local: true };
}

/**
 * Atiende una acción del seguimiento SIN red.
 * @returns respuesta con la misma forma que el maestro, o lanza Error igual que él.
 * Lanza `Error` con `.needsHist = <tracto>` si pide un histórico que aún no se descargó.
 */
export function handleLocal(ctx, body = {}) {
  const action = String(body.action || "").toLowerCase();
  const T = ctx.track;
  if (!T) throw new Error("Sesión local sin datos de seguimiento. Use INICIAR SEGUIMIENTO.");

  if (action === "lista") {
    const placas = T.units.map((u) => ({
      placa: u.placa,
      tracto: u.tracto || "",
      conductor: u.conductor || "",
      ocs: (u.ocs || []).length,
      pendientes: (u.ocs || []).filter(isDraft).length,
      revisada: !!u.revisada,
    }));
    const borradores = T.units.reduce((n, u) => n + (u.ocs || []).filter(isDraft).length, 0);
    return {
      placas,
      total_ocs: T.units.reduce((n, u) => n + (u.ocs || []).length, 0),
      borradores,
      revisadas: placas.filter((p) => p.revisada).length,
      _local: true,
    };
  }

  if (action === "bootstrap") {
    const units = clone(T.units).map((u) => {
      for (const o of u.ocs || []) delete o.local;
      return u;
    });
    return {
      units,
      total_ocs: units.reduce((n, u) => n + (u.ocs || []).length, 0),
      total_placas: units.length,
      borradores: units.reduce((n, u) => n + (u.ocs || []).filter(isDraft).length, 0),
      revisadas: units.filter((u) => u.revisada).length,
      _local: true,
    };
  }

  if (action === "detalle") {
    const u = unitByPlate(ctx, body.placa);
    if (!u || !(u.ocs || []).length) throw new Error("Unidad sin OCs abiertas");
    const c = clone(u);
    for (const o of c.ocs) delete o.local;
    return {
      placa: c.placa,
      tracto: c.tracto,
      conductor: c.conductor,
      ocs: c.ocs,
      ultima_oc_cerrada: null,
      revisada: c.ocs.some((o) => o.borrador?.revisada === true),
      _local: true,
    };
  }

  if (action === "cerradas_por_tracto") {
    const key = tractoNorm(body.tracto);
    if (!key) throw new Error("Ingrese un tracto válido");
    if (!T.hist_loaded.includes(key)) {
      const e = new Error("Histórico del tracto aún no descargado");
      e.needsHist = body.tracto;
      throw e;
    }
    const ocs = clone(ctx.hist[key] || []);
    return { tracto: body.tracto, total: ocs.length, ocs, _local: true };
  }

  if (action === "guardar" || action === "cerrar") return applyGuardar(ctx, body, action);
  if (action === "guardar_cerrada") return applyGuardarCerrada(ctx, body);
  if (action === "marcar_revisada") return applyRevisada(ctx, body.placa, true);
  if (action === "desmarcar_revisada") return applyRevisada(ctx, body.placa, false);

  throw new Error("Acción local no soportada: " + action);
}

const colsToDatos = (cambios) => {
  const d = {};
  for (const [col, v] of Object.entries(cambios || {})) if (COL_TO_KEY[col]) d[COL_TO_KEY[col]] = v;
  return d;
};

/**
 * Lo que hay que mandar al maestro al terminar. Es el ESTADO FINAL (no un historial de clics):
 *  - una operación por OC editada/cerrada (guardar o cerrar, con todo lo acumulado),
 *  - revisadas: solo las placas cuyo estado final difiere del que bajó del maestro,
 *  - históricos editados: solo los campos que cambiaron respecto de lo descargado.
 * Todas son idempotentes en el maestro → reintentar no duplica nada.
 */
export function pendingOps(ctx) {
  const T = ctx.track;
  if (!T) return [];
  const ops = [];

  for (const u of T.units) {
    for (const o of u.ocs || []) {
      if (!o.local?.dirty || !o.borrador) continue;
      const cerrar = o.borrador.accion === "CERRAR";
      ops.push({
        id: `oc:${o.id}`,
        kind: cerrar ? "cerrar" : "guardar",
        body: { action: cerrar ? "cerrar" : "guardar", id: o.id, datos: colsToDatos(o.borrador.cambios) },
      });
    }
  }

  const bootSet = new Set(T.boot_revisadas || []);
  for (const u of T.units) {
    const k = norm(u.placa);
    const now = !!u.revisada;
    if (now && !bootSet.has(k)) ops.push({ id: `rev:${k}`, kind: "marcar_revisada", body: { action: "marcar_revisada", placa: u.placa } });
    if (!now && bootSet.has(k)) ops.push({ id: `rev:${k}`, kind: "desmarcar_revisada", body: { action: "desmarcar_revisada", placa: u.placa } });
  }

  for (const [idStr, k] of Object.entries(T.hist_edits || {})) {
    const o = (ctx.hist[k] || []).find((x) => String(x.id) === String(idStr));
    if (!o) continue;
    const datos = {};
    for (const [key, col] of Object.entries(MAP)) {
      const a = o.original_payload?.[col] ?? null;
      const b = o.payload?.[col] ?? null;
      if (String(a ?? "") !== String(b ?? "")) datos[key] = b;
    }
    if (Object.keys(datos).length) ops.push({ id: `hist:${idStr}`, kind: "guardar_cerrada", body: { action: "guardar_cerrada", id: Number(idStr), datos } });
  }
  return ops;
}

/** Llamar cuando el maestro aceptó una operación: deja de estar pendiente. */
export function markOpDone(ctx, op) {
  const T = ctx.track;
  if (!T) return;
  if (op.id.startsWith("oc:")) {
    const f = findOc(ctx, Number(op.id.slice(3)));
    if (f) f.o.local = { dirty: false };
  } else if (op.id.startsWith("rev:")) {
    const k = op.id.slice(4);
    const set = new Set(T.boot_revisadas || []);
    if (op.kind === "marcar_revisada") set.add(k); else set.delete(k);
    T.boot_revisadas = [...set];
  } else if (op.id.startsWith("hist:")) {
    const id = op.id.slice(5);
    const k = T.hist_edits?.[id];
    const o = (ctx.hist[k] || []).find((x) => String(x.id) === id);
    if (o) o.original_payload = { ...o.payload };
    delete T.hist_edits[id];
    if (k) touch(ctx, "hist:" + k);
  }
  touch(ctx, "track");
}
