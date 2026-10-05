/**
 * Registry de módulos de CEMENTO.
 *
 * REGLA: para agregar un módulo nuevo a Cemento:
 *   1. Crear frontend/public/cemento/modules/<id>.js
 *   2. Agregar UNA línea aquí.
 *   3. Agregar el botón data-route="<id>" en cemento.html
 *
 * No tocar cerro-verde/ ni shared/ (salvo que sea infraestructura común).
 * No importar desde módulos de Cerro Verde.
 */
export const modules = {
  home:        () => import("./modules/home.js"),
  sap:         () => import("./modules/sap.js"),
  precarga:    () => import("./modules/precarga.js"),
  seguimiento: () => import("./modules/seguimiento.js"),
  archivos:    () => import("./modules/archivos.js"),
  reporte:     () => import("./modules/reporte.js"),
  admin:       () => import("./modules/admin.js"),
};

/** Endpoints exclusivos de Cemento (Cerro Verde tiene los suyos). */
export const API = {
  consulta:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-consulta",
  clocator:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-clocator",
  track:     "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-seguimiento",
  report:    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-reporte",
  sap:       "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-sap",
  admin:     "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-admin",
  montados:  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-montados",
};
