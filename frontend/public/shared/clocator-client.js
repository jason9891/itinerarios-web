/**
 * Cliente CLocator unificado para todos los itinerarios.
 *
 * REGLA DE LA PLATAFORMA:
 * - No reinventar la consulta a CLocator en cada módulo o mapa.
 * - Todos los itinerarios deben usar esta función (o un thin wrapper).
 * - El endpoint específico (cemento-clocator / cerro-verde-clocator / futuro)
 *   se pasa como parámetro; la forma de llamar, timeouts, reintentos y
 *   formato de respuesta es el mismo.
 *
 * Uso:
 *   import { queryClocator } from "/shared/clocator-client.js";
 *
 *   const result = await queryClocator({
 *     endpoint: "https://..../functions/v1/cemento-clocator",
 *     token: await auth.currentUser.getIdToken(),
 *     placa: "AKU-861",
 *     tracto: "20-R-752",
 *     desde: "2026-09-20T00:00:00",
 *     hasta: "2026-09-21T00:00:00",
 *     includeMap: false,
 *     signal: abortController.signal,
 *   });
 */

const DEFAULT_TIMEOUT_MS = 55_000;

/**
 * Consulta estandarizada a cualquier Edge Function *-clocator.
 * @param {object} opts
 * @param {string} opts.endpoint   URL completa de la function (cemento-clocator, cerro-verde-clocator, etc.)
 * @param {string} opts.token      Firebase ID token (Bearer)
 * @param {string} opts.placa
 * @param {string} [opts.tracto]
 * @param {string} [opts.desde]    ISO o datetime local (America/Lima)
 * @param {string} [opts.hasta]
 * @param {boolean} [opts.includeMap=false]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<object>}
 */
export async function queryClocator({
  endpoint,
  token,
  placa,
  tracto = "",
  desde = "",
  hasta = "",
  includeMap = false,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!endpoint) throw new Error("queryClocator: falta endpoint");
  if (!token) throw new Error("queryClocator: falta token de autenticación");
  if (!placa) throw new Error("queryClocator: falta placa");

  const controller = signal ? null : new AbortController();
  const effectiveSignal = signal || controller.signal;
  let timer = null;

  if (!signal && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const body = {
      placa: String(placa).trim().toUpperCase(),
      tracto: String(tracto || "").trim().toUpperCase(),
      include_map: !!includeMap,
    };
    if (desde) body.desde = desde;
    if (hasta) body.hasta = hasta;

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || data.message || `CLocator HTTP ${r.status}`);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Helper de conveniencia: construye el endpoint a partir del nombre del itinerario.
 * Mantiene la convención actual de Supabase.
 */
export function clocatorEndpoint(itinerarySlug) {
  const base = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";
  const map = {
    cemento: `${base}/cemento-clocator`,
    "cerro-verde": `${base}/cerro-verde-clocator`,
    // Futuros itinerarios se agregan aquí una sola vez
  };
  const url = map[itinerarySlug];
  if (!url) throw new Error(`No hay endpoint CLocator definido para: ${itinerarySlug}`);
  return url;
}
