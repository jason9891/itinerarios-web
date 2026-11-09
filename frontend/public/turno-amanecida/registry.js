/**
 * Registry de módulos de TURNO AMANECIDA.
 * Independiente de Cemento y Cerro Verde.
 */
const V = "tn37";

export const modules = {
  home:          () => import(`./modules/home.js?v=${V}`),
  maestros:      () => import(`./modules/maestros.js?v=${V}`),
  base:          () => import(`./modules/base.js?v=${V}`),
  monitoreo:     () => import(`./modules/monitoreo.js?v=${V}`),
  reporte:       () => import(`./modules/reporte.js?v=${V}`),
};

/** Turno Amanecida habla SOLO con el Worker de Cloudflare (sin Supabase). */
export const API = {
  worker: "https://clocator-proxy.jasontupayachihurtado.workers.dev/",
};
