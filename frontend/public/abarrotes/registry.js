/**
 * Registry de módulos de ABARROTES.
 * Independiente de Cemento, Cerro Verde y Turno Amanecida.
 * ?v= en los imports: fuerza recarga tras deploys (Hosting cachea JS 1 h).
 */
const V = "ab3";

export const modules = {
  home:        () => import(`./modules/home.js?v=${V}`),
  despachos:   () => import(`./modules/despachos.js?v=${V}`),
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  reporte:     () => import(`./modules/reporte.js?v=${V}`),
  tenant:      () => import(`./modules/tenant.js?v=${V}`),
};

/**
 * Misma estructura de consulta que CEMENTO (copiada, no compartida):
 * - Rutas GPS → CLocator del Supabase del OPERADOR (Mi Supabase). Sin configuración → principal.
 * - Maestro / histórico → siempre PRINCIPAL (endpoints propios de Abarrotes: pendientes de crear).
 */
export const MULTI_CUENTA = { enabled: true };

const PRINCIPAL = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

export const API = {
  /** CLocator principal (fallback y dueño). Hoy se reutiliza la función desplegada de Cemento. */
  clocator: `${PRINCIPAL}/cemento-clocator`,
  clocatorPrincipal: `${PRINCIPAL}/cemento-clocator`,
};
