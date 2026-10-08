/**
 * Precarga de recorridos TURNO AMANECIDA (singleton).
 * 1ª pasada: 16:00 del día del turno → ahora.
 * Siguientes: solo desde el último `hasta` cacheado → ahora (tramos nuevos).
 * unmount de UI NO detiene el motor.
 */
import { queryClocator, clocatorEndpoint } from "../shared/clocator-client.js";
import { auth } from "../shared/auth.js";
import { cacheGPS, gpsKey, readGPS } from "./gps-cache.js";

const META_KEY = "tn_precarga_v1";
const TIMEOUT_MS = 45000;
const CONCURRENCY = 2;

let running = false;
let stopFlag = false;
let runId = null;
let progress = { done: 0, total: 0, current: "" };

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
  const g = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function parseFechaTurno(val) {
  if (!val) {
    const now = new Date();
    if (now.getHours() < 12) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

function rangoBase(fechaTurno) {
  const [y, m, d] = parseFechaTurno(fechaTurno).split("-").map(Number);
  const desde = new Date(y, m - 1, d, 16, 0, 0);
  const limite = new Date(y, m - 1, d + 1, 4, 0, 0);
  const ahora = new Date();
  const hasta = ahora > limite ? limite : ahora;
  return { desde, hasta, desdeStr: formatPE(desde), hastaStr: formatPE(hasta) };
}

/** Parse dd/MM/yyyy HH:mm:ss → Date */
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

/**
 * @param {Array<{codigo:string,placa:string}>} unidades
 * @param {string} fechaTurno YYYY-MM-DD
 * @param {{ forceFull?: boolean }} opts
 */
export async function startPrecarga(unidades, fechaTurno, opts = {}) {
  if (running) return loadMeta();
  const list = (unidades || []).filter((u) => u.placa || u.codigo);
  if (!list.length) return null;

  running = true;
  stopFlag = false;
  const fecha = parseFechaTurno(fechaTurno);
  const prevMeta = loadMeta();
  // Mismo día de turno → reutilizar runId para seguir leyendo la misma caché
  if (prevMeta?.fecha === fecha && prevMeta?.id) {
    runId = prevMeta.id;
  } else {
    runId = `tn_${fecha}_${Date.now()}`;
  }

  const { desdeStr, hastaStr, desde, hasta } = rangoBase(fecha);
  progress = { done: 0, total: list.length, current: "" };

  const meta = {
    id: runId,
    fecha,
    desde: desdeStr,
    hasta: hastaStr,
    total: list.length,
    done: 0,
    ok: 0,
    error: 0,
    incremental: 0,
    full: 0,
    running: true,
    completo: false,
    started_at: new Date().toISOString(),
  };
  saveMeta(meta);

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

        if (!opts.forceFull && cached?.puntos_gps?.length && cached.hasta) {
          const lastHasta = parsePE(cached.hasta);
          // Solo pedir desde el último hasta (con 1 min de solape)
          if (lastHasta && lastHasta < hasta) {
            const solape = new Date(lastHasta.getTime() - 60 * 1000);
            const baseDesde = desde;
            fetchDesde = formatPE(solape > baseDesde ? solape : baseDesde);
            incremental = true;
          } else if (lastHasta && lastHasta >= hasta) {
            // Ya está al día — no consultar Comsatel
            meta.ok += 1;
            meta.done += 1;
            progress.done = meta.done;
            saveMeta({ ...meta });
            continue;
          }
        }

        const user = auth.currentUser;
        if (!user) throw new Error("Sin sesión");
        const token = await user.getIdToken(true);
        const data = await queryClocator({
          endpoint: clocatorEndpoint("cemento"),
          token,
          placa: placa || tracto,
          tracto,
          desde: fetchDesde,
          hasta: hastaStr,
          includeMap: false,
          timeoutMs: TIMEOUT_MS,
        });
        const nuevos = data.puntos_gps || data.puntos || [];
        const merged = incremental
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
        if (incremental) meta.incremental += 1;
        else meta.full += 1;
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
      saveMeta({ ...meta });
    }
  });

  await Promise.all(workers);
  meta.running = false;
  meta.completo = true;
  meta.finished_at = new Date().toISOString();
  running = false;
  saveMeta(meta);
  return meta;
}
