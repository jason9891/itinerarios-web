/**
 * Multi-cuenta: GPS/rutas → Supabase del operador (si está configurado).
 * Sin config o MULTI_CUENTA.enabled=false → cuenta principal (dueño / turno).
 * Al consolidar: nunca enviar puntos_gps al principal.
 */
const TENANT_PREFIX = "abarrotes_tenant_v1:";

/**
 * Operador conocido (se aplica solo si el usuario NO guardó una configuración manual).
 * Rutas GPS → Supabase del operador; histórico/maestro → principal.
 */
const OPERADORES = {
  "satelitalaqprac@gmail.com": {
    label: "Operador prueba",
    supabaseUrl: "https://wvhwmgmrhpmapthxqbun.supabase.co",
  },
};

export function loadTenant(user) {
  try {
    const id = user?.uid || user?.email || "";
    if (!id) return emptyTenant();
    const raw = localStorage.getItem(TENANT_PREFIX + id);
    if (!raw) {
      const d = OPERADORES[String(user?.email || "").trim().toLowerCase()];
      return d ? { ...emptyTenant(), ...d } : emptyTenant();
    }
    const o = JSON.parse(raw);
    return {
      supabaseUrl: String(o.supabaseUrl || "").replace(/\/$/, ""),
      anonKey: String(o.anonKey || ""),
      clocatorUrl: String(o.clocatorUrl || "").replace(/\/$/, ""),
      label: String(o.label || ""),
    };
  } catch {
    return emptyTenant();
  }
}

function emptyTenant() {
  return { supabaseUrl: "", anonKey: "", clocatorUrl: "", label: "" };
}

export function saveTenant(user, cfg) {
  const id = user?.uid || user?.email || "";
  if (!id) throw new Error("Sin usuario para guardar tenant");
  const data = {
    supabaseUrl: String(cfg.supabaseUrl || "").trim().replace(/\/$/, ""),
    anonKey: String(cfg.anonKey || "").trim(),
    clocatorUrl: String(cfg.clocatorUrl || "").trim().replace(/\/$/, ""),
    label: String(cfg.label || "").trim(),
  };
  localStorage.setItem(TENANT_PREFIX + id, JSON.stringify(data));
  return data;
}

export function clearTenant(user) {
  const id = user?.uid || user?.email || "";
  if (id) localStorage.removeItem(TENANT_PREFIX + id);
}

export function resolveClocatorUrl(principalClocator, multiCfg = {}, tenant = {}) {
  if (!multiCfg?.enabled) return principalClocator;
  const op =
    tenant.clocatorUrl ||
    multiCfg.clocatorOperador ||
    (tenant.supabaseUrl
      ? `${String(tenant.supabaseUrl).replace(/\/$/, "")}/functions/v1/cemento-clocator`
      : "");
  return op || principalClocator;
}

/**
 * Endpoint GPS efectivo para la sesión actual.
 * @param {string} principalClocator URL del principal (siempre fallback)
 * @param {object} multiCfg MULTI_CUENTA del registry
 * @param {object|null} user auth.currentUser
 */
export function effectiveClocator(principalClocator, multiCfg, user) {
  if (!multiCfg?.enabled) return principalClocator;
  return resolveClocatorUrl(principalClocator, multiCfg, loadTenant(user));
}

export function principalOnlyPayload(data = {}) {
  const { puntos_gps, puntos, track, geocercas, ...rest } = data;
  return rest;
}

export function tenantSummary(user) {
  const t = loadTenant(user);
  if (t.clocatorUrl) {
    try {
      return new URL(t.clocatorUrl).host;
    } catch {
      return t.label || "operador";
    }
  }
  if (t.supabaseUrl) {
    try {
      return new URL(t.supabaseUrl).host.replace(".supabase.co", "");
    } catch {
      return t.label || "operador";
    }
  }
  return "principal";
}
