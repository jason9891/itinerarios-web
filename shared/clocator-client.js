/**
 * Cliente CLocator unificado para todos los itinerarios.
 *
 * REGLA DE LA PLATAFORMA:
 * - No reinventar la consulta a CLocator en cada módulo o mapa.
 * - Todos los itinerarios deben usar esta función (o un thin wrapper).
 * - El endpoint específico se pasa como parámetro.
 *
 * Proxy Firebase (sin egress Supabase) + fallback opcional a Supabase
 * mientras el proyecto no esté en plan Blaze / function no desplegada.
 */

const DEFAULT_TIMEOUT_MS = 55_000;

/**
 * @param {object} opts
 * @param {string} opts.endpoint
 * @param {string} [opts.fallbackEndpoint]  Si el primary falla (red / 404 / 5xx), reintenta aquí
 * @param {string} opts.token
 * @param {string} opts.placa
 * @param {string} [opts.tracto]
 * @param {string} [opts.desde]
 * @param {string} [opts.hasta]
 * @param {boolean} [opts.includeMap=false]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs]
 */
export async function queryClocator({
  endpoint,
  fallbackEndpoint = "",
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

  const body = {
    placa: String(placa).trim().toUpperCase(),
    tracto: String(tracto || "").trim().toUpperCase(),
    include_map: !!includeMap,
  };
  if (desde) body.desde = desde;
  if (hasta) body.hasta = hasta;

  async function once(url) {
    const controller = signal ? null : new AbortController();
    const effectiveSignal = signal || controller.signal;
    let timer = null;
    if (!signal && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
      const r = await fetch(url, {
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
        const err = new Error(data.error || data.message || `CLocator HTTP ${r.status}`);
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  try {
    return await once(endpoint);
  } catch (e) {
    const st = e?.status;
    const msg = String(e?.message || e);
    const canFallback =
      fallbackEndpoint &&
      fallbackEndpoint !== endpoint &&
      (st === 404 ||
        st === 501 ||
        st === 502 ||
        st === 503 ||
        st === 500 ||
        /Failed to fetch|NetworkError|abort|Load failed|not found|NOT_FOUND/i.test(msg));
    if (!canFallback) throw e;
    console.warn("[clocator] primary falló, usando fallback Supabase:", msg);
    const data = await once(fallbackEndpoint);
    data.proxy_fallback = "supabase";
    return data;
  }
}

/**
 * Helper de conveniencia (legacy Supabase). Preferir API.clocator del registry.
 */
export function clocatorEndpoint(itinerarySlug) {
  const base = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";
  const map = {
    cemento: `${base}/cemento-clocator`,
    "cerro-verde": `${base}/cerro-verde-clocator`,
  };
  const url = map[itinerarySlug];
  if (!url) throw new Error(`No hay endpoint CLocator definido para: ${itinerarySlug}`);
  return url;
}
