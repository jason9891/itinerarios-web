/**
 * Registry de módulos de TURNO AMANECIDA.
 * Independiente de Cemento y Cerro Verde.
 *
 * Endpoints: Firebase Work propios (turnoAmanecida*), cero Supabase, cero CV.
 */
const V = "tn27";

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

/** Endpoints exclusivos Turno Amanecida (Work). */
export const API = {
  maestros: `${WORK}/turnoAmanecidaMaestros`,
  snapshot: `${WORK}/turnoAmanecidaSnapshot`,
  /** Proxy GPS propio TN */
  clocator: `${WORK}/turnoAmanecidaClocator`,
  /** Solo Maps key / config */
  config: `${WORK}/turnoAmanecidaConfig`,
};

export { WORK, V };
