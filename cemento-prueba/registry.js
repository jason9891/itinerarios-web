/**
 * CEMENTO PRUEBA — misma UI que Cemento; datos en cuenta operador.
 * Mensaje multi-cuenta → cuenta PRINCIPAL.
 */
const V = "cp04";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  sap:         () => import(`./modules/sap.js?v=${V}`),
  precarga:    () => import(`./modules/precarga.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  archivos:    () => import(`./modules/archivos.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
  admin:       () => import(`./modules/admin.js?v=${V}`),
  mensaje:     () => import(`./modules/mensaje.js?v=${V}`),
  "analisis-local": () => import(`./modules/analisis-local.js?v=${V}`),
};

/** Cuenta OPERADOR (Itinerarios · wvhwmgmrhpmapthxqbun) */
export const API = {
  consulta:  "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-consulta",
  clocator:  "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-clocator",
  track:     "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-seguimiento",
  report:    "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-reporte",
  sap:       "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-sap",
  admin:     "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-admin",
  montados:  "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-montados",
  /** Solo el puente al principal */
  mensaje:   "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/multi-cuenta-mensaje",
};

export const PRINCIPAL = {
  url: "https://otvdwqbrqvxahyzfkhds.supabase.co",
  mensajeFn: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/multi-cuenta-mensaje",
};

export const OPERADOR = {
  url: "https://wvhwmgmrhpmapthxqbun.supabase.co",
  ref: "wvhwmgmrhpmapthxqbun",
};

export const CENTRAL = {
  clocatorFallback: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-clocator",
};
