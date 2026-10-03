/**
 * Motor de precarga de CEMENTO (singleton por pestaña).
 *
 * Vive fuera de modules/precarga.js para que la descarga GPS
 * continúe en segundo plano mientras el operador trabaja en Seguimiento.
 *
 * Contrato de datos (solo lectura para otros módulos):
 *   getMeta() → { id, desde, hasta, resultados: { [placaNorm]: { estado, puntos, visitas, mensaje? } }, completo }
 *   isRunning() → boolean
 *   getStatus(placa) → resultado | null
 *
 * Eventos de bus (runtime.bus):
 *   cemento:precarga-unit   { placa, tracto, estado, puntos, visitas }
 *   cemento:precarga-batch  { completo, done, ok, errors, total, running }
 *   cemento:precarga-progress { running, done, total, currentPlaca? }
 */
import { API } from "./registry.js";
import { queryClocator } from "../shared/clocator-client.js";
import { auth } from "../shared/auth.js";

const STORAGE_KEY = "cemento_precarga_v1";
const TIMEOUT_MS = 120000;
const DONE_STATES = new Set(["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS", "ERROR FINAL"]);

let runtimeRef = null;
let running = false;
let stopFlag = false;
let controller = null;
let currentPlaca = null;
/** @type {Array<{placa:string,tracto:string}>} */
let unitsSnapshot = [];

export function nplate(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function formatPE(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

export function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveMeta(m) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  try {
    runtimeRef?.state?.set("precarga.meta", {
      id: m?.id,
      desde: m?.desde,
      hasta: m?.hasta,
      completo: m?.completo,
      total: m?.total,
      running,
    });
  } catch (_) {}
}

export function clearMeta() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isRunning() {
  return running;
}

export function getCurrentPlaca() {
  return currentPlaca;
}

export function getStatus(placa) {
  const m = loadMeta();
  if (!m?.resultados) return null;
  return m.resultados[nplate(placa)] || null;
}

export function counts(meta, total) {
  const vals = Object.values(meta?.resultados || {});
  const done = vals.filter((x) => DONE_STATES.has(x.estado)).length;
  const errors = vals.filter((x) => x.estado === "ERROR FINAL").length;
  const ok = vals.filter((x) =>
    ["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS"].includes(x.estado),
  ).length;
  const ready = ok; // listas para trabajar en seguimiento
  return { done, errors, ok, ready, total: total ?? meta?.total ?? 0 };
}

export function isReadyForSeguimiento(placa) {
  const s = getStatus(placa)?.estado;
  return s === "COMPLETO" || s === "SIN MOVIMIENTO" || s === "SIN PUNTOS";
}

export function bindRuntime(runtime) {
  runtimeRef = runtime;
}

function emit(event, payload) {
  try {
    runtimeRef?.bus?.emit(event, payload);
  } catch (_) {}
}

function classifyResult(data) {
  const puntos = data?.puntos_gps?.length ?? data?.puntos ?? 0;
  const visitas = data?.analisis?.visitas_confirmadas?.length ?? 0;
  if (!puntos) return { estado: "SIN PUNTOS", puntos: 0, visitas: 0 };
  if (puntos < 2) return { estado: "SIN MOVIMIENTO", puntos, visitas };
  return { estado: "COMPLETO", puntos, visitas };
}

export function normalizeDesde(v) {
  const s = String(v || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(s) ? s + ":00" : s;
}

export function resolveDesde() {
  const saved = localStorage.getItem("cemento_rango_desde");
  if (saved && /^\d{2}\/\d{2}\/\d{4}/.test(saved)) {
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(saved)) return saved + ":00";
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(saved)) return saved;
  }
  return formatPE(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

export function resolveHasta() {
  return formatPE(new Date());
}

/**
 * Inicia o reanuda precarga en segundo plano.
 * @param {Array<{placa:string,tracto:string}>} units
 * @param {{ desde?: string, forceNew?: boolean }} [opts]
 */
export async function startPreload(units, opts = {}) {
  if (running) throw new Error("Ya hay una precarga en curso");
  if (!units?.length) throw new Error("No hay unidades para precargar");
  if (!auth.currentUser) throw new Error("No hay sesión activa");

  const desde = normalizeDesde(opts.desde) || resolveDesde();
  const hasta = resolveHasta();
  unitsSnapshot = units.map((u) => ({
    placa: String(u.placa || u.tracto || "").trim(),
    tracto: String(u.tracto || u.placa || "").trim(),
  }));

  let meta = loadMeta();
  const corteCambio = meta && meta.desde && meta.desde !== desde;
  if (opts.forceNew || corteCambio || !meta || meta.completo || !meta.id) {
    meta = {
      id: crypto.randomUUID(),
      desde,
      hasta,
      total: unitsSnapshot.length,
      completo: false,
      resultados: corteCambio || opts.forceNew ? {} : meta?.resultados || {},
      intentos: corteCambio || opts.forceNew ? {} : meta?.intentos || {},
      started_at: Date.now(),
    };
    if (corteCambio || opts.forceNew) {
      meta.resultados = {};
      meta.intentos = {};
    }
  } else {
    meta.hasta = hasta;
    meta.desde = meta.desde || desde;
    meta.total = unitsSnapshot.length;
    meta.resultados ||= {};
    meta.intentos ||= {};
  }
  localStorage.setItem("cemento_rango_desde", meta.desde);
  saveMeta(meta);

  running = true;
  stopFlag = false;
  emit("cemento:precarga-progress", {
    running: true,
    done: counts(meta).done,
    total: unitsSnapshot.length,
  });

  const token = await auth.currentUser.getIdToken(true);

  const process = async (list, second) => {
    for (const u of list) {
      if (stopFlag) break;
      const k = nplate(u.placa);
      const prev = meta.resultados[k]?.estado;
      if (DONE_STATES.has(prev) && prev !== "ERROR FINAL") continue;
      if (second && prev === "ERROR FINAL") continue;

      currentPlaca = u.placa;
      meta.resultados[k] = {
        estado: second ? "SEGUNDO INTENTO" : "PROCESANDO",
        puntos: meta.resultados[k]?.puntos,
        visitas: meta.resultados[k]?.visitas,
      };
      saveMeta(meta);
      emit("cemento:precarga-unit", { placa: u.placa, tracto: u.tracto, ...meta.resultados[k] });
      emit("cemento:precarga-progress", {
        running: true,
        done: counts(meta).done,
        total: unitsSnapshot.length,
        currentPlaca: u.placa,
      });

      controller = new AbortController();
      const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);
      try {
        const data = await queryClocator({
          endpoint: API.clocator,
          token,
          placa: u.placa,
          tracto: u.tracto,
          desde: meta.desde,
          hasta: meta.hasta,
          includeMap: false,
          signal: controller.signal,
        });
        clearTimeout(timer);
        meta.intentos[k] = (meta.intentos[k] || 0) + 1;
        meta.resultados[k] = classifyResult(data);
        emit("cemento:precarga-unit", { placa: u.placa, tracto: u.tracto, ...meta.resultados[k] });
      } catch (e) {
        clearTimeout(timer);
        meta.intentos[k] = (meta.intentos[k] || 0) + 1;
        if (stopFlag) {
          meta.resultados[k] = { estado: "PENDIENTE", mensaje: "Detenido por el operador" };
          saveMeta(meta);
          emit("cemento:precarga-unit", { placa: u.placa, tracto: u.tracto, ...meta.resultados[k] });
          break;
        }
        const msg = controller?.signal?.aborted
          ? "Tiempo de respuesta agotado"
          : String(e.message || e);
        if (!second && (meta.intentos[k] || 0) <= 1) {
          meta.resultados[k] = { estado: "REINTENTO", mensaje: msg };
        } else {
          meta.resultados[k] = { estado: "ERROR FINAL", mensaje: msg };
        }
        emit("cemento:precarga-unit", { placa: u.placa, tracto: u.tracto, ...meta.resultados[k] });
      } finally {
        controller = null;
        currentPlaca = null;
        saveMeta(meta);
        emit("cemento:precarga-progress", {
          running: true,
          done: counts(meta).done,
          total: unitsSnapshot.length,
        });
      }
    }
  };

  try {
    const first = unitsSnapshot.filter((u) => {
      const s = meta.resultados[nplate(u.placa)]?.estado;
      return !DONE_STATES.has(s);
    });
    await process(first, false);
    if (!stopFlag) {
      const retry = unitsSnapshot.filter(
        (u) => meta.resultados[nplate(u.placa)]?.estado === "REINTENTO",
      );
      await process(retry, true);
    }
    meta.completo =
      !stopFlag &&
      unitsSnapshot.every((u) =>
        DONE_STATES.has(meta.resultados[nplate(u.placa)]?.estado),
      );
  } finally {
    running = false;
    currentPlaca = null;
    saveMeta(meta);
    const c = counts(meta, unitsSnapshot.length);
    emit("cemento:precarga-batch", {
      completo: meta.completo,
      running: false,
      ...c,
    });
    emit("cemento:precarga-progress", {
      running: false,
      done: c.done,
      total: unitsSnapshot.length,
    });
  }

  return meta;
}

export function stopPreload() {
  stopFlag = true;
  try {
    controller?.abort("operator");
  } catch (_) {}
}

export { DONE_STATES, STORAGE_KEY };
