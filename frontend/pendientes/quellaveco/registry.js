/**
 * Registry de módulos de QUELLAVECO.
 * Independiente de Cemento, Cerro Verde y Turno Amanecida.
 * ?v= en los imports: fuerza recarga tras deploys (Hosting cachea JS 1 h).
 */
const V = "qv1";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  despachos:   () => import(`./modules/despachos.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
};

/**
 * Quellaveco todavía NO usa Supabase. Para leer posiciones GPS usa el mismo Worker de
 * Cloudflare (solo lectura) que Turno Amanecida.
 * Al conectar Supabase, agregar aquí los endpoints propios (consulta, sap, seguimiento, reporte).
 */
export const API = {
  worker: "https://clocator-proxy.jasontupayachihurtado.workers.dev/",
};
