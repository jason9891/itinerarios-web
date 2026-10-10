/**
 * Registry de módulos de TURNO AMANECIDA.
 * Independiente de Cemento y Cerro Verde.
 *
 * Backend: Cloudflare Worker clocator-proxy (Work) — secretos y deploy ya operativos.
 * NO apuntar a Firebase Functions ni a Supabase desde este itinerario.
 */
const V = "tn30";

/** Cloudflare Worker — clocator-proxy (producción TN) */
const WORK = "https://clocator-proxy.jasontupayachihurtado.workers.dev";

export const modules = {
  home:          () => import(`./modules/home.js?v=${V}`),
  maestros:      () => import(`./modules/maestros.js?v=${V}`),
  base:          () => import(`./modules/base.js?v=${V}`),
  monitoreo:     () => import(`./modules/monitoreo.js?v=${V}`),
  clasificacion: () => import(`./modules/clasificacion.js?v=${V}`),
  historico:     () => import(`./modules/historico.js?v=${V}`),
  reporte:       () => import(`./modules/reporte.js?v=${V}`),
};

/**
 * Todos los servicios TN pasan por el mismo Worker.
 * El body { action: "..." } discrimina snapshot / maestros / map_config / GPS.
 */
export const API = {
  maestros: WORK,
  snapshot: WORK,
  clocator: WORK,
  config: WORK,
};

export { WORK, V };
