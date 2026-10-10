/**
 * Resolución de endpoints multi-cuenta.
 * No cambia producción hasta que MULTI_CUENTA.enabled === true en el registry del itinerario.
 *
 * Uso futuro:
 *   import { resolveClocatorUrl } from "../shared/multi-cuenta.js";
 *   const url = resolveClocatorUrl(API.clocator, MULTI_CUENTA, tenantConfig);
 */
export function resolveClocatorUrl(principalClocator, multiCfg = {}, tenant = {}) {
  if (!multiCfg?.enabled) return principalClocator;
  const op =
    tenant.clocatorUrl ||
    multiCfg.clocatorOperador ||
    (tenant.supabaseUrl
      ? `${String(tenant.supabaseUrl).replace(/\/$/, "")}/functions/v1/clocator`
      : "");
  return op || principalClocator; // fallback: dueño / sin config → principal
}

export function principalOnlyPayload(data = {}) {
  // Nunca incluir puntos GPS al consolidar en principal
  const { puntos_gps, puntos, track, geocercas, ...rest } = data;
  return rest;
}
