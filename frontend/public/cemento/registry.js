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
const V = "fix-import-orden";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  sap:         () => import(`./modules/sap.js?v=${V}`),
  precarga:    () => import(`./modules/precarga.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  archivos:    () => import(`./modules/archivos.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
  admin:       () => import(`./modules/admin.js?v=${V}`),
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
