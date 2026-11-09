/**
 * Registry de módulos de CEMENTO.
 */
const V = "cem-tenant-auto-01";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  sap:         () => import(`./modules/sap.js?v=${V}`),
  precarga:    () => import(`./modules/precarga.js?v=${V}`),
  despachos:   () => import(`./modules/despachos.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  archivos:    () => import(`./modules/archivos.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
  admin:       () => import(`./modules/admin.js?v=${V}`),
};

export const MULTI_CUENTA = {
  // Apagado: el proyecto "operador prueba" (wvhwmgmrhpmapthxqbun) ya no resuelve (ERR_NAME_NOT_RESOLVED).
  // Con false, Cemento usa siempre el Supabase principal (otvdwqbrqvxahyzfkhds).
  enabled: false,
  itinerary: "cemento",
};

const PRINCIPAL = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

export const API = {
  consulta:  `${PRINCIPAL}/cemento-consulta`,
  clocator:  `${PRINCIPAL}/cemento-clocator`,
  clocatorPrincipal: `${PRINCIPAL}/cemento-clocator`,
  track:     `${PRINCIPAL}/cemento-seguimiento`,
  report:    `${PRINCIPAL}/cemento-reporte`,
  sap:       `${PRINCIPAL}/cemento-sap`,
  admin:     `${PRINCIPAL}/cemento-admin`,
  montados:  `${PRINCIPAL}/cemento-montados`,
};
