/**
 * Precarga de recorridos TURNO AMANECIDA (singleton).
 *
 * - 1ª vez (sin caché): 16:00 → ahora
 * - Siguiente: solo desde último `hasta` → ahora
 * - Si el caché tiene < FRESH_MS de antigüedad → NO consulta Comsatel
 * - Token Firebase una sola vez por lote
 * - unmount de UI NO detiene el motor
 */
import { queryClocator, clocatorEndpoint } from "../shared/clocator-client.js";
import { auth } from "../shared/auth.js";
import { cacheGPS, gpsKey, readGPS } from "./gps-cache.js";

const META_KEY = "tn_precarga_v1";
const TIMEOUT_MS = 40000;
const CONCURRENCY = 3;
/** No pedir de nuevo a Comsatel si el tramo ya se actualizó hace menos de esto */
const FRESH_MS = 3 * 60 * 1000;
/** Intervalo sugerido entre ticks de tramos nuevos (monitoreo puede llamar tick) */
export const TICK_MS = 5 * 60 * 1000;

let running = false;
let stopFlag = false;
let runId = null;
let progress = { done: 0, total: 0, current: "", skipped: 0, incremental: 0, full: 0 };
let lastTickAt = 0;

function formatPE(date) {
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
  const g = (t) => {
    let v = parts.find((p) => p.type === t)?.value || "00";
    if (t === "hour" && v === "24") v = "00";
    return String(v).padStart(2, "0");
  };
  // Obligatorio: dd/MM/yyyy HH:mm:ss (backend + CLocator Java)
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function assertFechaPE(s, label) {
  if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(String(s || ""))) {
    throw new Error(`Fecha inválida (${label}): ${s}`);
  }
  return s;
}

/** Fecha del turno YYYY-MM-DD en zona Lima */
export function fechaTurnoPE(val) {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(String(val).slice(0, 10))) {
    return String(val).slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value || "00";
  let y = Number(g("year"));
  let m = Number(g("month"));
  let d = Number(g("day"));
  const hourParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(hourParts.find((p) => p.type === "hour")?.value ?? 0);
  // Madrugada: el turno es el día calendario anterior
  if (h < 12) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function rangoBase(fechaTurno) {
  const [y, m, d] = fechaTurnoPE(fechaTurno).split("-").map(Number);
  const desde = new Date(y, m - 1, d, 16, 0, 0);
  const limite = new Date(y, m - 1, d + 1, 4, 0, 0);
  const ahora = new Date();
  const hasta = ahora > limite ? limite : ahora;
  return { desde, hasta, desdeStr: formatPE(desde), hastaStr: formatPE(hasta) };
}

function parsePE(str) {
  const m = String(str || "").match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return null;
  return new Date(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0),
  );
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
  // Si hubo muchos errores / pocos OK, hay que reintentar
  const ok = Number(m.ok || 0);
  const err = Number(m.error || 0);
  const total = Number(m.total || 0);
  if (total > 0 && ok < total * 0.5) return false;
  if (err > ok) return false;
  const age = Date.now() - new Date(m.finished_at).getTime();
  return Number.isFinite(age) && age >= 0 && age < FRESH_MS;
}

/** ¿Cuántas rutas tienen puntos en meta reciente? (orientativo) */
export function precargaResumen() {
  return loadMeta();
}

/**
 * @param {Array<{codigo:string,placa:string}>} unidades
 * @param {string} fechaTurno YYYY-MM-DD
 * @param {{ forceFull?: boolean, reason?: string }} opts
 */
export async function startPrecarga(unidades, fechaTurno, opts = {}) {
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
  assertFechaPE(desdeStr, "desde");
  assertFechaPE(hastaStr, "hasta");
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

        if (!opts.forceFull && cached?.puntos_gps && cached.hasta) {
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
            // Tramo nuevo: solo desde último hasta (1 min solape)
            if (lastHasta < hasta) {
              const solape = new Date(lastHasta.getTime() - 60 * 1000);
              fetchDesde = formatPE(solape > desde ? solape : desde);
              incremental = true;
            }
          }
        }

        if (!placa && !tracto) throw new Error("Sin placa ni código");
        assertFechaPE(fetchDesde, "fetchDesde");
        assertFechaPE(hastaStr, "hasta");
        // CLocator busca por placa; si no hay placa usar tracto solo como último recurso
        const data = await queryClocator({
          endpoint: clocatorEndpoint("cemento"),
          token,
          placa: placa || tracto,
          tracto: tracto || placa,
          desde: fetchDesde,
          hasta: hastaStr,
          includeMap: false,
          timeoutMs: TIMEOUT_MS,
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
  if (running) return null;
  if (Date.now() - lastTickAt < TICK_MS && loadMeta()?.completo) return null;
  return startPrecarga(unidades, fechaTurno, { reason: "tick" });
}
