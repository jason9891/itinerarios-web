/**
 * Multi-cuenta por usuario Firebase.
 *
 * 1) Directorio por email (cuenta → proyecto Supabase operador)
 * 2) Sin match → principal (dueño)
 *    (localStorage solo legado; no hay UI de URL)
 *
 * GPS y trabajo de rutas → operador.
 * Consolidado final → siempre principal (no puntos_gps).
 */
const TENANT_PREFIX = "itinerarios_tenant_v1:";

/** Proyecto PRINCIPAL (dueño / maestros / consolidado) */
export const PRINCIPAL = {
  ref: "otvdwqbrqvxahyzfkhds",
  url: "https://otvdwqbrqvxahyzfkhds.supabase.co",
};

/**
 * Mapa email (minúsculas) → proyecto operador.
 * Ampliar aquí cada compañero con su proyecto Supabase.
 */
export const TENANT_DIRECTORY = {
  // Cuenta de prueba / operador ya validada (Cemento: rutas GPS por este clocator)
  "satelitalaqprac@gmail.com": {
    label: "Operador prueba",
    ref: "wvhwmgmrhpmapthxqbun",
    supabaseUrl: "https://wvhwmgmrhpmapthxqbun.supabase.co",
    // Function real en ese proyecto (cerro-verde-clocator aún no desplegada ahí)
    clocatorUrl:
      "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/cemento-clocator",
  },
};

function emptyTenant() {
  return {
    supabaseUrl: "",
    anonKey: "",
    clocatorUrl: "",
    label: "",
    ref: "",
    source: "none",
  };
}

function normEmail(user) {
  return String(user?.email || "")
    .trim()
    .toLowerCase();
}

export function loadTenant(user) {
  const email = normEmail(user);
  const fromDir = email && TENANT_DIRECTORY[email] ? { ...TENANT_DIRECTORY[email] } : null;

  // Override manual (MI SUPABASE) tiene prioridad si existe
  try {
    const id = user?.uid || user?.email || "";
    if (id) {
      const raw = localStorage.getItem(TENANT_PREFIX + id);
      if (raw) {
        const o = JSON.parse(raw);
        const manual = {
          supabaseUrl: String(o.supabaseUrl || "").replace(/\/$/, ""),
          anonKey: String(o.anonKey || ""),
          clocatorUrl: String(o.clocatorUrl || "").replace(/\/$/, ""),
          label: String(o.label || "") || fromDir?.label || "",
          ref: String(o.ref || "") || fromDir?.ref || "",
          source: "localStorage",
        };
        if (manual.supabaseUrl || manual.clocatorUrl) return manual;
      }
    }
  } catch {
    /* ignore */
  }

  if (fromDir?.supabaseUrl) {
    return {
      supabaseUrl: String(fromDir.supabaseUrl).replace(/\/$/, ""),
      anonKey: String(fromDir.anonKey || ""),
      clocatorUrl: String(fromDir.clocatorUrl || "").replace(/\/$/, ""),
      label: String(fromDir.label || ""),
      ref: String(fromDir.ref || ""),
      source: "directory",
    };
  }

  return emptyTenant();
}

export function saveTenant(user, cfg) {
  const id = user?.uid || user?.email || "";
  if (!id) throw new Error("Sin usuario para guardar tenant");
  const data = {
    supabaseUrl: String(cfg.supabaseUrl || "").trim().replace(/\/$/, ""),
    anonKey: String(cfg.anonKey || "").trim(),
    clocatorUrl: String(cfg.clocatorUrl || "").trim().replace(/\/$/, ""),
    label: String(cfg.label || "").trim(),
    ref: String(cfg.ref || "").trim(),
  };
  localStorage.setItem(TENANT_PREFIX + id, JSON.stringify(data));
  return data;
}

export function clearTenant(user) {
  const id = user?.uid || user?.email || "";
  if (id) localStorage.removeItem(TENANT_PREFIX + id);
}

/** Nombre de función clocator por itinerario */
/**
 * Function CLocator en proyectos OPERADOR.
 * En pruebas solo estaba desplegado cemento-clocator en wvhwmg…;
 * sirve para GPS de cualquier itinerario (misma consulta Comsatel).
 * Si más adelante despliegas cerro-verde-clocator en el operador, puedes
 * fijar clocatorUrl explícito en TENANT_DIRECTORY.
 */
export function clocatorFnName(itinerary) {
  const s = String(itinerary || "").toLowerCase();
  // Proxy GPS compartido en cuenta operador (validado en pruebas Cemento)
  if (s.includes("cerro") || s.includes("cemento") || s.includes("prueba")) {
    return "cemento-clocator";
  }
  return "cemento-clocator";
}

/**
 * URL clocator del operador (o principal si no hay tenant).
 * @param {string} principalClocator
 * @param {object} multiCfg  MULTI_CUENTA del registry
 * @param {object|null} user
 * @param {string} [itinerary] cemento | cerro-verde
 */
export function resolveClocatorUrl(
  principalClocator,
  multiCfg = {},
  tenant = {},
  itinerary = "",
) {
  if (!multiCfg?.enabled) return principalClocator;
  if (tenant.clocatorUrl) return tenant.clocatorUrl;
  if (multiCfg.clocatorOperador) return multiCfg.clocatorOperador;
  if (tenant.supabaseUrl) {
    const fn = clocatorFnName(itinerary || multiCfg.itinerary || "");
    return `${String(tenant.supabaseUrl).replace(/\/$/, "")}/functions/v1/${fn}`;
  }
  return principalClocator;
}

export function effectiveClocator(
  principalClocator,
  multiCfg,
  user,
  itinerary = "",
) {
  if (!multiCfg?.enabled) return principalClocator;
  const tenant = loadTenant(user);
  return resolveClocatorUrl(
    principalClocator,
    multiCfg,
    tenant,
    itinerary || multiCfg.itinerary || "",
  );
}

/**
 * Endpoints de trabajo (operador) vs principal.
 * Si el usuario tiene tenant → base = su Supabase.
 * Si no → principal.
 */
export function effectiveBaseUrl(user, multiCfg = {}) {
  if (!multiCfg?.enabled) return PRINCIPAL.url;
  const t = loadTenant(user);
  if (t.supabaseUrl) return t.supabaseUrl.replace(/\/$/, "");
  return PRINCIPAL.url;
}

export function operatorFnUrl(user, multiCfg, fnName) {
  const base = effectiveBaseUrl(user, multiCfg);
  return `${base}/functions/v1/${fnName}`;
}

export function isOperatorSession(user, multiCfg = {}) {
  if (!multiCfg?.enabled) return false;
  const t = loadTenant(user);
  return !!(t.supabaseUrl || t.clocatorUrl);
}

export function principalOnlyPayload(data = {}) {
  const { puntos_gps, puntos, track, geocercas, ...rest } = data;
  return rest;
}

export function tenantSummary(user) {
  const t = loadTenant(user);
  if (t.supabaseUrl) {
    try {
      const host = new URL(t.supabaseUrl).host.replace(".supabase.co", "");
      return `${host}${t.source === "directory" ? " (auto)" : " (manual)"}`;
    } catch {
      return t.label || "operador";
    }
  }
  if (t.clocatorUrl) {
    try {
      return new URL(t.clocatorUrl).host;
    } catch {
      return t.label || "operador";
    }
  }
  return "principal";
}
