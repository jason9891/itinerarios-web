/**
 * Precarga de recorridos TURNO AMANECIDA (singleton).
 *
 * - 1ª vez (sin caché): 16:00 → ahora
 * - Siguiente: solo desde último `hasta` → ahora
 * - Si el caché tiene < FRESH_MS de antigüedad → NO consulta Comsatel
 * - Token Firebase una sola vez por lote
 * - unmount de UI NO detiene el motor
 */
import { rutaWorker } from "./worker-client.js?v=tn30";
import { auth } from "../shared/auth.js";
import { cacheGPS, gpsKey, readGPS } from "./gps-cache.js";
import { ACTIVO } from "./kill-switch.js";

const META_KEY = "tn_precarga_v1";
const CONCURRENCY = 12; // peticiones simultáneas; el cliente las agrupa en lotes de 4 (3 sesiones paralelas)
/** No pedir de nuevo a Comsatel si el tramo ya se actualizó hace menos de esto */
const FRESH_MS = 3 * 60 * 1000;
/** Intervalo sugerido entre ticks de tramos nuevos (monitoreo puede llamar tick) */
export const TICK_MS = 15 * 60 * 1000;
/** Unidad quieta (posición actual ≈ último punto en caché) y caché < esto → no consultar */
const STATIONARY_MAX_AGE_MS = 60 * 60 * 1000;
const STATIONARY_M = 60;

let running = false;
let stopFlag = false;
let runId = null;
let progress = { done: 0, total: 0, current: "", skipped: 0, incremental: 0, full: 0 };
let lastTickAt = 0;

import { fechaTurnoLima, formatLima, ventanaTurno, parseLimaStr } from "./tiempo-lima.js";

function formatPE(date) {
  return formatLima(date instanceof Date ? date.getTime() : Number(date));
}

/** Fecha del turno YYYY-MM-DD en zona Lima */
export function fechaTurnoPE(val) {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(String(val).slice(0, 10))) {
    return String(val).slice(0, 10);
  }
  return fechaTurnoLima();
}

function rangoBase(fechaTurno) {
  const v = ventanaTurno(fechaTurnoPE(fechaTurno));
  const desde = new Date(v.inicio);
  const limite = new Date(v.fin);
  const ahora = new Date();
  const hasta = ahora > limite ? limite : ahora;
  return { desde, hasta, desdeStr: formatPE(desde), hastaStr: formatPE(hasta) };
}

function parsePE(str) {
  const ms = parseLimaStr(str);
  return ms == null ? null : new Date(ms);
}

function haversineM(a, b, c, d) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (c - a) * rad, dLng = (d - b) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** ¿La unidad sigue donde terminó su caché? (evita consultas inútiles = egress) */
function sigueQuieta(u, cached, hasta, lastHasta) {
  if (u.lat == null || u.lng == null || !cached?.puntos_gps?.length) return false;
  if (hasta.getTime() - lastHasta.getTime() > STATIONARY_MAX_AGE_MS) return false;
  let last = null, lastT = -1;
  for (const p of cached.puntos_gps) {
    const t = parsePE(p.fecha || "")?.getTime() ?? -1;
    if (t >= lastT) { lastT = t; last = p; }
  }
  const la = Number(last?.lat ?? last?.latitud), lo = Number(last?.lng ?? last?.lon ?? last?.longitud);
  if (![la, lo, Number(u.lat), Number(u.lng)].every(Number.isFinite)) return false;
  return haversineM(la, lo, Number(u.lat), Number(u.lng)) <= STATIONARY_M;
}

function puntoKey(p) {
  const lat = p.lat ?? p.latitud;
  const lng = p.lng ?? p.lon ?? p.longitud;
  const f = p.fecha || p.fechaFinToString || p.fechaInicioToString || "";
  return `${f}|${lat}|${lng}`;
}

function mergePuntos(prev, next) {
  const map = new Map();
  for (const p of prev || []) map.set(puntoKey(p), p);
  for (const p of next || []) map.set(puntoKey(p), p);
  return Array.from(map.values());
}

function saveMeta(m) {
  localStorage.setItem(META_KEY, JSON.stringify(m));
  try {
    window.dispatchEvent(new CustomEvent("turno-amanecida:precarga", { detail: m }));
  } catch {
    /* ignore */
  }
}

export function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "null");
  } catch {
    return null;
  }
}

export function getProgress() {
  return { ...progress, running };
}

export function stopPrecarga() {
  stopFlag = true;
}

/**
 * VENTANA DE CARGA DE RUTAS (hora de Lima): solo de 21:00 a 04:00.
 * De 04:00 a 21:00 NO se carga ninguna ruta (ni precarga, ni ciclo, ni clic en el mapa),
 * aunque la pestaña haya quedado abierta con el seguimiento corriendo.
 */
export const VENTANA_RUTAS = { desde_h: 21, hasta_h: 4 };
export function horaLima(ms = Date.now()) {
  return new Date(ms - 5 * 3600000).getUTCHours(); // Lima = UTC-5 todo el año
}
export function fueraDeVentanaRutas(ms = Date.now()) {
  const h = horaLima(ms);
  return h >= VENTANA_RUTAS.hasta_h && h < VENTANA_RUTAS.desde_h;
}
/** Corte automático: si se pasa de las 04:00 con un lote en curso, se frena en el siguiente punto de control. */
setInterval(() => {
  if (fueraDeVentanaRutas()) {
    if (running) stopFlag = true;
    try { window.dispatchEvent(new CustomEvent("turno-amanecida:ventana-cerrada")); } catch { /* ignore */ }
  }
}, 30 * 1000);

const DETENIDO_KEY = "tn_detenido_v1";
/** ¿Está detenida la alimentación de rutas? Manual (botón / reporte / todo validado) o fuera de la ventana 21:00–04:00. */
export function isDetenido(fechaTurno) {
  if (fueraDeVentanaRutas()) return true;
  return detenidoManual(fechaTurno);
}
export function detenidoManual(fechaTurno) {
  try {
    return localStorage.getItem(DETENIDO_KEY) === fechaTurnoPE(fechaTurno);
  } catch {
    return false;
  }
}
export function setDetenido(fechaTurno, valor) {
  try {
    if (valor) localStorage.setItem(DETENIDO_KEY, fechaTurnoPE(fechaTurno));
    else localStorage.removeItem(DETENIDO_KEY);
  } catch { /* ignore */ }
  if (valor) stopFlag = true;
}

export function currentRunId() {
  return runId || loadMeta()?.id || null;
}

export function isRunning() {
  return running;
}

/**
 * ¿Conviene no relanzar precarga al entrar a Monitoreo?
 * true si el último lote del mismo día terminó hace < FRESH_MS
 */
export function cacheIsFresh(fechaTurno) {
  const m = loadMeta();
  const fecha = fechaTurnoPE(fechaTurno);
  if (!m?.completo || m.fecha !== fecha || !m.finished_at) return false;
  const age = Date.now() - new Date(m.finished_at).getTime();
  return Number.isFinite(age) && age >= 0 && age < FRESH_MS;
}

/**
 * @param {Array<{codigo:string,placa:string}>} unidades
 * @param {string} fechaTurno YYYY-MM-DD
 * @param {{ forceFull?: boolean, reason?: string }} opts
 */
export async function startPrecarga(unidades, fechaTurno, opts = {}) {
  if (!ACTIVO) return null;
  if (fueraDeVentanaRutas()) return null; // 04:00–21:00: no se cargan rutas, ni con «base» ni con «reanudar»
  if (opts.reason === "base" || opts.reason === "reanudar") setDetenido(fechaTurno, false);
  else if (isDetenido(fechaTurno)) return null;
  if (running) return loadMeta();
  const list = (unidades || []).filter((u) => u.placa || u.codigo);
  if (!list.length) return null;

  running = true;
  stopFlag = false;
  const fecha = fechaTurnoPE(fechaTurno);
  const prevMeta = loadMeta();
  if (prevMeta?.fecha === fecha && prevMeta?.id) {
    runId = prevMeta.id;
  } else {
    runId = `tn_${fecha}`;
  }

  const { desdeStr, hastaStr, desde, hasta } = rangoBase(fecha);
  progress = {
    done: 0,
    total: list.length,
    current: "",
    skipped: 0,
    incremental: 0,
    full: 0,
  };

  const meta = {
    id: runId,
    fecha,
    desde: desdeStr,
    hasta: hastaStr,
    total: list.length,
    done: 0,
    ok: 0,
    error: 0,
    skipped: 0,
    incremental: 0,
    full: 0,
    running: true,
    completo: false,
    reason: opts.reason || "manual",
    started_at: new Date().toISOString(),
  };
  saveMeta(meta);
  lastTickAt = Date.now();

  // Un solo token por lote
  let token = null;
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Sin sesión");
    token = await user.getIdToken(false);
  } catch (e) {
    meta.running = false;
    meta.error = list.length;
    meta.completo = true;
    meta.finished_at = new Date().toISOString();
    running = false;
    saveMeta(meta);
    return meta;
  }

  const queue = [...list];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !stopFlag) {
      const u = queue.shift();
      if (!u) break;
      const placa = String(u.placa || "").trim().toUpperCase();
      const tracto = String(u.codigo || "").trim().toUpperCase();
      progress.current = tracto || placa;
      const key = gpsKey(runId, tracto, placa);

      try {
        const cached = await readGPS(key);
        let fetchDesde = desdeStr;
        let incremental = false;

        if (!opts.forceFull && cached?.ok && cached?.puntos_gps && cached.hasta) {
          const lastHasta = parsePE(cached.hasta);
          if (lastHasta) {
            const age = hasta.getTime() - lastHasta.getTime();
            // Caché fresco → no llamar Comsatel
            if (age <= FRESH_MS) {
              meta.skipped += 1;
              progress.skipped = meta.skipped;
              meta.ok += 1;
              meta.done += 1;
              progress.done = meta.done;
              saveMeta({ ...meta });
              continue;
            }
            // Unidad quieta con caché reciente → no gastar egress
            if (!opts.forceFull && sigueQuieta(u, cached, hasta, lastHasta)) {
              meta.skipped += 1;
              progress.skipped = meta.skipped;
              meta.ok += 1;
              meta.done += 1;
              progress.done = meta.done;
              continue;
            }
            // Tramo nuevo: solo desde último hasta (1 min solape)
            if (lastHasta < hasta) {
              const solape = new Date(lastHasta.getTime() - 60 * 1000);
              fetchDesde = formatPE(solape > desde ? solape : desde);
              incremental = true;
            }
          }
        }

        if (fueraDeVentanaRutas()) throw new Error("Fuera de la ventana de rutas (21:00–04:00)");
        const data = await rutaWorker({
          placa: placa || tracto,
          tracto,
          desde: fetchDesde,
          hasta: hastaStr,
        });
        const nuevos = data.puntos_gps || data.puntos || [];
        const merged =
          incremental && cached?.puntos_gps?.length
            ? mergePuntos(cached.puntos_gps, nuevos)
            : nuevos;

        await cacheGPS(
          {
            placa,
            tracto,
            desde: cached?.desde || desdeStr,
            hasta: hastaStr,
            puntos_gps: merged,
            ok: true,
            incremental,
          },
          key,
        );
        meta.ok += 1;
        if (incremental) {
          meta.incremental += 1;
          progress.incremental = meta.incremental;
        } else {
          meta.full += 1;
          progress.full = meta.full;
        }
      } catch (e) {
        meta.error += 1;
        try {
          const cached = await readGPS(key);
          if (!cached) {
            await cacheGPS(
              {
                placa,
                tracto,
                desde: desdeStr,
                hasta: hastaStr,
                puntos_gps: [],
                ok: false,
                error: String(e.message || e),
              },
              key,
            );
          }
        } catch {
          /* ignore */
        }
      }
      meta.done += 1;
      progress.done = meta.done;
      // Evento cada 5 unidades para no saturar UI
      if (meta.done % 5 === 0 || meta.done === meta.total) saveMeta({ ...meta });
    }
  });

  await Promise.all(workers);
  meta.running = false;
  meta.completo = true;
  meta.finished_at = new Date().toISOString();
  meta.skipped = progress.skipped;
  running = false;
  saveMeta(meta);
  return meta;
}

/**
 * Tick de tramos nuevos: solo si pasó TICK_MS desde el último lote.
 * Pensado para llamarse en el poll de monitoreo.
 */
export async function tickPrecargaSiToca(unidades, fechaTurno) {
  if (!ACTIVO) return null;
  if (running || isDetenido(fechaTurno)) return null;
  if (Date.now() - lastTickAt < TICK_MS && loadMeta()?.completo) return null;
  return startPrecarga(unidades, fechaTurno, { reason: "tick" });
}

/**
 * Garantiza la ruta de UNA unidad en caché (prioridad: clic en el mapa).
 * - Con caché válido (ok) y fresco → lo devuelve sin consultar (unidad sin puntos incluida).
 * - Sin caché / con error / vencido → consulta 16:00→ahora (incremental si hay caché) y guarda.
 * @returns {Promise<{puntos_gps:Array, ok:boolean, desde_cache:boolean, error?:string}>}
 */
export async function asegurarRuta(u, fechaTurno) {
  if (!ACTIVO) return { puntos_gps: [], ok: false, desde_cache: false, error: "Módulo en pausa" };
  const fecha = fechaTurnoPE(fechaTurno);
  const rid = currentRunId() && loadMeta()?.fecha === fecha ? currentRunId() : `tn_${fecha}`;
  const placa = String(u.placa || "").trim().toUpperCase();
  const tracto = String(u.codigo || "").trim().toUpperCase();
  const key = gpsKey(rid, tracto, placa);
  const { desde, hasta, desdeStr, hastaStr } = rangoBase(fecha);
  const cached = await readGPS(key);
  if (isDetenido(fecha)) {
    return {
      puntos_gps: cached?.puntos_gps || [],
      ok: !!cached?.ok,
      desde_cache: true,
      error: cached?.ok ? undefined : "Alimentación de rutas detenida",
    };
  }
  let fetchDesde = desdeStr;
  let incremental = false;
  if (cached?.ok && cached.hasta) {
    const last = parsePE(cached.hasta);
    if (last) {
      if (hasta.getTime() - last.getTime() <= FRESH_MS) {
        return { puntos_gps: cached.puntos_gps || [], ok: true, desde_cache: true };
      }
      const solape = new Date(last.getTime() - 60 * 1000);
      fetchDesde = formatPE(solape > desde ? solape : desde);
      incremental = true;
    }
  }
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Sin sesión");
    const token = await user.getIdToken(false);
    if (fueraDeVentanaRutas()) throw new Error("Fuera de la ventana de rutas (21:00–04:00)");
        const data = await rutaWorker({
          placa: placa || tracto,
      tracto,
      desde: fetchDesde,
      hasta: hastaStr,
        });
    const nuevos = data.puntos_gps || data.puntos || [];
    const merged = incremental ? mergePuntos(cached?.puntos_gps, nuevos) : nuevos;
    await cacheGPS(
      { placa, tracto, desde: cached?.desde || desdeStr, hasta: hastaStr, puntos_gps: merged, ok: true, incremental },
      key,
    );
    return { puntos_gps: merged, ok: true, desde_cache: false };
  } catch (e) {
    return { puntos_gps: cached?.puntos_gps || [], ok: false, desde_cache: !!cached, error: String(e.message || e) };
  }
}
