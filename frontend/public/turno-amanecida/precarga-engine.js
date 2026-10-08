/**
 * Precarga de recorridos TURNO AMANECIDA (singleton).
 * Rango: 16:00 del día del turno → ahora (tope 04:00 día siguiente).
 * Trazo se parte en monitoreo: azul ≤22:00 · rojo >22:00.
 * unmount de UI NO detiene el motor.
 */
import { queryClocator, clocatorEndpoint } from "../shared/clocator-client.js";
import { auth } from "../shared/auth.js";
import { cacheGPS, gpsKey } from "./gps-cache.js";

const META_KEY = "tn_precarga_v1";
const TIMEOUT_MS = 55000;
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

function rango(fechaTurno) {
  const [y, m, d] = parseFechaTurno(fechaTurno).split("-").map(Number);
  const desde = new Date(y, m - 1, d, 16, 0, 0);
  const limite = new Date(y, m - 1, d + 1, 4, 0, 0);
  const ahora = new Date();
  const hasta = ahora > limite ? limite : ahora;
  return { desde: formatPE(desde), hasta: formatPE(hasta) };
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
 * @param {Array<{codigo:string,placa:string}>} unidades
 * @param {string} fechaTurno YYYY-MM-DD
 */
export async function startPrecarga(unidades, fechaTurno) {
  if (running) return loadMeta();
  const list = (unidades || []).filter((u) => u.placa || u.codigo);
  if (!list.length) return null;

  running = true;
  stopFlag = false;
  runId = `tn_${parseFechaTurno(fechaTurno)}_${Date.now()}`;
  const { desde, hasta } = rango(fechaTurno);
  progress = { done: 0, total: list.length, current: "" };

  const meta = {
    id: runId,
    fecha: parseFechaTurno(fechaTurno),
    desde,
    hasta,
    total: list.length,
    done: 0,
    ok: 0,
    error: 0,
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
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Sin sesión");
        const token = await user.getIdToken(true);
        const data = await queryClocator({
          endpoint: clocatorEndpoint("cemento"),
          token,
          placa: placa || tracto,
          tracto,
          desde,
          hasta,
          includeMap: false,
          timeoutMs: TIMEOUT_MS,
        });
        const puntos = data.puntos_gps || data.puntos || [];
        await cacheGPS(
          {
            placa,
            tracto,
            desde,
            hasta,
            puntos_gps: puntos,
            ok: true,
          },
          gpsKey(runId, tracto, placa),
        );
        meta.ok += 1;
      } catch (e) {
        meta.error += 1;
        try {
          await cacheGPS(
            {
              placa,
              tracto,
              desde,
              hasta,
              puntos_gps: [],
              ok: false,
              error: String(e.message || e),
            },
            gpsKey(runId, tracto, placa),
          );
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

export function currentRunId() {
  return runId || loadMeta()?.id || null;
}
