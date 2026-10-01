/**
 * Registry de módulos de CERRO VERDE.
 *
 * Independiente de Cemento. Agregar un módulo aquí no afecta a Cemento.
 */
export const modules = {
  home:        () => import("./modules/home.js"),
  sap:         () => import("./modules/sap.js"),
  precarga:    () => import("./modules/precarga.js"),
  seguimiento: () => import("./modules/seguimiento.js"),
  grupo:       () => import("./modules/grupo.js"),
  paradas:     () => import("./modules/paradas.js"),
  archivos:    () => import("./modules/archivos.js"),
  reporte:     () => import("./modules/reporte.js"),
};

/** Endpoints exclusivos de Cerro Verde. */
export const API = {
  consulta:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-consulta",
  clocator:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-clocator",
  track:     "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-seguimiento",
  report:    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-reporte",
  sap:       "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-sap",
};
