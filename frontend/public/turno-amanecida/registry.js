/**
 * Registry de módulos de TURNO AMANECIDA.
 * Independiente de Cemento y Cerro Verde.
 */
const V = "tn20";

export const modules = {
  home:          () => import(`./modules/home.js?v=${V}`),
  maestros:      () => import(`./modules/maestros.js?v=${V}`),
  base:          () => import(`./modules/base.js?v=${V}`),
  monitoreo:     () => import(`./modules/monitoreo.js?v=${V}`),
  clasificacion: () => import(`./modules/clasificacion.js?v=${V}`),
  historico:     () => import(`./modules/historico.js?v=${V}`),
  reporte:       () => import(`./modules/reporte.js?v=${V}`),
};

/** Endpoints exclusivos de Turno Amanecida. */
export const API = {
  maestros: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/turno-amanecida-maestros",
  snapshot: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/turno-amanecida-snapshot",
};
