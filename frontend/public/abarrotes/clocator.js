/**
 * Consultas a CLocator de ABARROTES.
 *
 * Misma estructura que CEMENTO (copiada, NO compartida): endpoint efectivo = Supabase del operador
 * (Mi Supabase) o principal; token Firebase; queryClocator() con fallback al principal.
 * Rutas → operador. Maestro / histórico → principal (pendiente de definir).
 */
import { auth } from "./propio/auth.js";
import { queryClocator } from "./propio/clocator-client.js";
import { effectiveClocator } from "./propio/multi-cuenta.js";
import { API, MULTI_CUENTA } from "./registry.js";
import { normPlaca } from "./api-client.js";

const pad = (n) => String(n).padStart(2, "0");

/** Fecha/hora Lima en el formato que exige CLocator: dd/mm/aaaa HH:mm:ss */
export function formatPE(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

/** Hoy 00:00:01 hora Lima. */
export function inicioDeHoyPE() {
  return formatPE().slice(0, 10) + " 00:00:01";
}

/** «04/10/26 15:30[:00]» o «04/10/2026 15:30:00» → «04/10/2026 15:30:00». "" si no es válido. */
export function aFormatoPE(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  return `${pad(m[1])}/${pad(m[2])}/${y} ${pad(m[4])}:${m[5]}:${pad(m[6] || 0)}`;
}

/** dd/mm/aaaa HH:mm:ss (Lima) → Date */
export function peADate(s) {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 5, +m[5], +(m[6] || 0))) : null;
}

function endpoint() {
  return effectiveClocator(API.clocatorPrincipal || API.clocator, MULTI_CUENTA, auth.currentUser);
}

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(false);
}

/** Clave de Google Maps (misma acción map_config que usa Cemento). */
export async function obtenerMapsKey() {
  const r = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action: "map_config" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `CLocator HTTP ${r.status}`);
  if (!d.google_maps_api_key) throw new Error("CLocator no devolvió la clave de Google Maps");
  return d.google_maps_api_key;
}

/** Estado del GPS según la antigüedad del último punto (umbrales provisionales). */
function estadoGps(fecha, ahora) {
  const d = peADate(fecha);
  if (!d) return { color: "GRIS", reporte: "SIN REPORTE PROLONGADO", minutos: null };
  const min = Math.max(0, Math.round((ahora - d) / 60000));
  if (min <= 30) return { color: "VERDE", reporte: "REPORTA", minutos: min };
  if (min <= 120) return { color: "AMARILLO", reporte: "ALERTA GPS", minutos: min };
  if (min <= 1440) return { color: "ROJO", reporte: "NO REPORTA", minutos: min };
  return { color: "GRIS", reporte: "SIN REPORTE PROLONGADO", minutos: min };
}

/** Consulta una unidad: último punto del rango. Nunca lanza; devuelve { error } si falla. */
export async function consultarUnidad(tracto, desde, hasta, signal) {
  try {
    const data = await queryClocator({
      endpoint: endpoint(),
      fallbackEndpoint: API.clocatorPrincipal || API.clocator,
      token: await token(),
      placa: tracto,
      tracto,
      desde,
      hasta,
      includeMap: false,
      signal,
    });
    const u = data.ultimo || null;
    const ahora = peADate(hasta) || new Date();
    const est = estadoGps(u?.fecha, ahora);
    return {
      placa: tracto,
      codigo: "",
      lat: u?.lat ?? null,
      lng: u?.lng ?? null,
      fecha: u?.fecha || "",
      puntos: data.puntos ?? 0,
      ubicacion: data.analisis?.ubicacion_red || "",
      t_parada: est.minutos != null && est.color !== "VERDE" ? `${est.minutos} min sin reportar` : "",
      color: u ? est.color : "GRIS",
      reporte: u ? est.reporte : "SIN POSICIÓN",
    };
  } catch (e) {
    return { placa: tracto, lat: null, lng: null, color: "GRIS", reporte: "SIN POSICIÓN", error: String(e?.message || e) };
  }
}

/**
 * Consulta varias unidades con concurrencia limitada.
 * @returns {Promise<{ generado_en:string, total:number, desde:string, hasta:string, errores:number, porPlaca: Map<string, object> }>}
 */
export async function consultarUnidades(tractos, { desde, hasta, onProgreso, signal, concurrencia = 4 } = {}) {
  const lista = [...new Set(tractos.map(normPlaca).filter(Boolean))];
  const porPlaca = new Map();
  let i = 0, hechas = 0, errores = 0;
  async function worker() {
    while (i < lista.length && !signal?.aborted) {
      const t = lista[i++];
      const r = await consultarUnidad(t, desde, hasta, signal);
      if (r.error) errores++;
      porPlaca.set(t, r);
      onProgreso?.(++hechas, lista.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, lista.length) }, worker));
  return { generado_en: new Date().toISOString(), total: lista.length, desde, hasta, errores, porPlaca };
}

/**
 * Puntos GPS de una respuesta de CLocator, sea cual sea el origen:
 *  · extractor del operador → { p: [[tSeg, lat, lng], …] }
 *  · función principal      → { puntos_gps: [{ lat, lng, fecha }] }
 * @returns {{ puntos:{t:number,lat:number,lng:number}[], ultimo_monitoreo:object|null, sin_movimiento:boolean, via:string }}
 */
export function puntosDe(data) {
  let pts = [];
  if (Array.isArray(data?.p)) {
    pts = data.p.map((a) => ({ t: Number(a[0]) * 1000, lat: Number(a[1]), lng: Number(a[2]) }));
  } else if (Array.isArray(data?.puntos_gps)) {
    pts = data.puntos_gps.map((q) => ({ t: peADate(q.fecha)?.getTime(), lat: Number(q.lat), lng: Number(q.lng) }));
  }
  pts = pts.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.lat) && Number.isFinite(x.lng)).sort((a, b) => a.t - b.t);
  return {
    puntos: pts,
    ultimo_monitoreo: data?.ultimo_monitoreo || data?.ultimo || null,
    sin_movimiento: !!data?.sin_movimiento,
    via: data?.proxy_fallback === "supabase" ? "principal" : "operador",
  };
}

/** Recorrido de un tracto entre dos fechas (formato PE). Lanza si CLocator falla. */
export async function consultarPuntos(tracto, desde, hasta, signal) {
  const data = await queryClocator({
    endpoint: endpoint(),
    fallbackEndpoint: API.clocatorPrincipal || API.clocator,
    token: await token(),
    placa: tracto,
    tracto,
    desde,
    hasta,
    includeMap: false,
    signal,
  });
  return puntosDe(data);
}
