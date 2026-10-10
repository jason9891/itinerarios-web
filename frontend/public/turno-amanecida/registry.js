/**
 * Registry de módulos de TURNO AMANECIDA.
 * Independiente de Cemento y Cerro Verde.
 *
 * Endpoints: Firebase Cloud Functions (Work) — sin Supabase.
 */
const V = "tn25";

/** Base Work / Firebase Functions del proyecto itinerarios-2fa6f */
const WORK = "https://us-central1-itinerarios-2fa6f.cloudfunctions.net";

export const modules = {
  home:          () => import(`./modules/home.js?v=${V}`),
  maestros:      () => import(`./modules/maestros.js?v=${V}`),
  base:          () => import(`./modules/base.js?v=${V}`),
  monitoreo:     () => import(`./modules/monitoreo.js?v=${V}`),
  clasificacion: () => import(`./modules/clasificacion.js?v=${V}`),
  historico:     () => import(`./modules/historico.js?v=${V}`),
  reporte:       () => import(`./modules/reporte.js?v=${V}`),
};

/** Endpoints exclusivos de Turno Amanecida (Firebase Work, cero Supabase). */
export const API = {
  maestros: `${WORK}/turnoAmanecidaMaestros`,
  snapshot: `${WORK}/turnoAmanecidaSnapshot`,
  /** Proxy CLocator ya en Firebase (mismo backend Comsatel) */
  clocator: `${WORK}/cerroVerdeClocator`,
};

export { WORK, V };
