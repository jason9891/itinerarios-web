/**
 * Configuración Supabase por usuario (itinerario PRUEBA).
 * Primera prueba: se guarda en localStorage ligada al uid/email de Firebase.
 * Más adelante puede vivir en app_usuarios del PRINCIPAL.
 */

const PREFIX = "prueba_tenant_v1:";

function keyFor(user) {
  const id = user?.uid || user?.email || "anon";
  return PREFIX + id;
}

/**
 * @returns {{ supabaseUrl: string, anonKey: string, clocatorUrl: string, label: string }}
 */
export function loadTenant(user) {
  try {
    const raw = localStorage.getItem(keyFor(user));
    if (!raw) return empty();
    const o = JSON.parse(raw);
    return {
      supabaseUrl: String(o.supabaseUrl || "").replace(/\/$/, ""),
      anonKey: String(o.anonKey || ""),
      clocatorUrl: String(o.clocatorUrl || "").replace(/\/$/, ""),
      label: String(o.label || ""),
    };
  } catch {
    return empty();
  }
}

function empty() {
  return { supabaseUrl: "", anonKey: "", clocatorUrl: "", label: "" };
}

export function saveTenant(user, cfg) {
  const data = {
    supabaseUrl: String(cfg.supabaseUrl || "").trim().replace(/\/$/, ""),
    anonKey: String(cfg.anonKey || "").trim(),
    clocatorUrl: String(cfg.clocatorUrl || "").trim().replace(/\/$/, ""),
    label: String(cfg.label || "").trim(),
  };
  localStorage.setItem(keyFor(user), JSON.stringify(data));
  return data;
}

export function clearTenant(user) {
  localStorage.removeItem(keyFor(user));
}

/** URL efectiva del clocator del operador. */
export function resolveClocatorUrl(cfg) {
  if (cfg.clocatorUrl) return cfg.clocatorUrl;
  if (cfg.supabaseUrl) {
    return `${cfg.supabaseUrl}/functions/v1/prueba-clocator`;
  }
  return "";
}

export function tenantSummary(cfg) {
  if (!cfg?.supabaseUrl && !cfg?.clocatorUrl) return "SIN PROYECTO";
  try {
    if (cfg.clocatorUrl) {
      const u = new URL(cfg.clocatorUrl);
      return u.host;
    }
    const u = new URL(cfg.supabaseUrl);
    return u.host.replace(".supabase.co", "");
  } catch {
    return cfg.label || "CONFIGURADO";
  }
}
