/**
 * Registry de módulos de CERRO VERDE.
 * Sin módulo MI SUPABASE: el destino sale del email de login (TENANT_DIRECTORY).
 */
const V = "cv-restaurado-4";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  sap:         () => import(`./modules/sap.js?v=${V}`),
  precarga:    () => import(`./modules/precarga.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  grupo:       () => import(`./modules/grupo.js?v=${V}`),
  paradas:     () => import(`./modules/paradas.js?v=${V}`),
  archivos:    () => import(`./modules/archivos.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
};

/**
 * Multi-cuenta ON.
 * Usuario en TENANT_DIRECTORY (email login) → su proyecto Supabase.
 * GPS y funciones de trabajo resueltas en runtime (ver api-client / workApi).
 * Consolidado final → siempre PRINCIPAL (otvdwqbrqvxahyzfkhds).
 */
export const MULTI_CUENTA = {
  enabled: true,
  itinerary: "cerro-verde",
};

const PRINCIPAL = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

/** Endpoints PRINCIPAL (consolidado / dueño / fallback sin tenant) */
export const API = {
  consulta:  `${PRINCIPAL}/cerro-verde-consulta`,
  clocator:  `${PRINCIPAL}/cerro-verde-clocator`,
  clocatorPrincipal: `${PRINCIPAL}/cerro-verde-clocator`,
  clocatorSupabase: `${PRINCIPAL}/cerro-verde-clocator`,
  clocatorFirebase: "https://us-central1-itinerarios-2fa6f.cloudfunctions.net/cerroVerdeClocator",
  track:     `${PRINCIPAL}/cerro-verde-seguimiento`,
  report:    `${PRINCIPAL}/cerro-verde-reporte`,
  sap:       `${PRINCIPAL}/cerro-verde-sap`,
};
