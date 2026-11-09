/**
 * Registry CEMENTO V3 — flujo local-first (mismo contrato que CV, código propio).
 * No modifica el itinerario Cemento oficial.
 */
const V = "cem-v3-2";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  sap:         () => import(`./modules/sap.js?v=${V}`),
  precarga:    () => import(`./modules/precarga.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  archivos:    () => import(`./modules/archivos.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
  admin:       () => import(`./modules/admin.js?v=${V}`),
};

export const MULTI_CUENTA = {
  enabled: true,
  itinerary: "cemento-v3",
};

const PRINCIPAL = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

export const API = {
  consulta:  `${PRINCIPAL}/cemento-consulta`,
  clocator:  `${PRINCIPAL}/cemento-clocator`,
  clocatorPrincipal: `${PRINCIPAL}/cemento-clocator`,
  track:     `${PRINCIPAL}/cemento-seguimiento`,
  historicos: `${PRINCIPAL}/cemento-historicos`,
  report:    `${PRINCIPAL}/cemento-reporte`,
  sap:       `${PRINCIPAL}/cemento-sap`,
  admin:     `${PRINCIPAL}/cemento-admin`,
  montados:  `${PRINCIPAL}/cemento-montados`,
};

export const VERSION = V;
