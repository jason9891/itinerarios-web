/**
 * Registry de módulos de CERRO VERDE.
 *
 * Independiente de Cemento. Agregar un módulo aquí no afecta a Cemento.
 * ?v= en imports: fuerza recarga tras deploys (Hosting cachea JS 1h).
 */
const V = "cv25proxy";

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

/** Endpoints exclusivos de Cerro Verde. */
export const API = {
  consulta:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-consulta",
  clocatorFirebase: "https://us-central1-itinerarios-2fa6f.cloudfunctions.net/cerroVerdeClocator",
  /** Temporal: mientras Firebase Functions (Blaze) no esté activo */
  clocatorSupabase: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-clocator",
  /** Preferir Firebase; el cliente puede hacer fallback */
  clocator:  "https://us-central1-itinerarios-2fa6f.cloudfunctions.net/cerroVerdeClocator",
  track:     "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-seguimiento",
  report:    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-reporte",
  sap:       "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-sap",
};
