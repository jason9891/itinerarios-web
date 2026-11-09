/**
 * Bootstrap CV + inicio limpio de turno.
 *
 * Flujo definido:
 * 1) INICIAR SEGUIMIENTO → borra caché local (excepto login Firebase)
 * 2) Carga maestro: lista, geocercas, resumen, pernoctes…
 * 3) SAP → nuevos despachos al PRINCIPAL (forceNetwork)
 * 4) Resto del turno en LOCAL (guardar/cerrar/revisada en cola)
 * 5) Subir avance / Excel → inyección ordenada al maestro (auditoría)
 *
 * Geocercas: snapshot al bootstrap; si cambian a mitad del turno,
 * el análisis usa las del snapshot (sin conflicto).
 */
import { auth } from "../shared/auth.js";
import { API, MULTI_CUENTA } from "./registry.js";
import { apiGet, apiPost } from "./api-client.js";
import { effectiveClocator } from "../shared/multi-cuenta.js";
import {
  setBootstrapPayload,
  loadSession,
  clearSession,
  isLocalFirst,
} from "./session-store.js";

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sin sesión");
  return u.getIdToken(true);
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn("[cv-bootstrap]", label, e?.message || e);
    return null;
  }
}

/** Claves localStorage propias de Cerro Verde (no toca auth Firebase). */
const CV_LS_PREFIXES = [
  "cv_",
  "cerro_verde",
  "cerro-verde",
];

function clearCvLocalStorage() {
  const kill = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (CV_LS_PREFIXES.some((p) => k.startsWith(p) || k.includes(p))) {
      kill.push(k);
    }
  }
  for (const k of kill) localStorage.removeItem(k);
  // sessionStorage del itinerario
  try {
    const sk = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith("cv_") || k.includes("cerro"))) sk.push(k);
    }
    for (const k of sk) sessionStorage.removeItem(k);
  } catch (_) {}
}

/** Borra IndexedDB de sesión / GPS / temporal CV. */
async function deleteCvDatabases() {
  const names = [
    "cerro-verde-session-v1",
    "cerro-verde-gps-temporal",
    "cerro-verde-temporal",
  ];
  for (const name of names) {
    try {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      });
    } catch (_) {}
  }
  try {
    await clearSession();
  } catch (_) {}
}

/**
 * Limpia todo el caché local de Cerro Verde excepto la sesión de login (Firebase Auth).
 */
export async function wipeLocalCerroVerde() {
  clearCvLocalStorage();
  await deleteCvDatabases();
  return { ok: true };
}

/**
 * INICIAR SEGUIMIENTO (turno limpio):
 * 1) wipe local
 * 2) reinicia contador revisadas en maestro (este usuario)
 * 3) bootstrap fresco desde principal
 */
export async function iniciarSeguimientoCv() {
  await wipeLocalCerroVerde();

  // Contador revisadas del usuario en maestro → 0
  await safe("reiniciar_revisadas", () =>
    apiPost(API.track, { action: "reiniciar_revisadas" }, { forceNetwork: true }),
  );

  const boot = await bootstrapCerroVerde({ note: "iniciar-seguimiento" });
  return {
    ...boot,
    wiped: true,
    revisadas_reiniciadas: true,
  };
}

/**
 * Ejecutar tras aplicar SAP o desde INICIAR SEGUIMIENTO.
 */
export async function bootstrapCerroVerde(opts = {}) {
  const user = auth.currentUser;
  await token();

  const resumen = await safe("resumen", () =>
    apiGet("resumen", { forceNetwork: true }),
  );
  const lista = await safe("lista", () =>
    apiPost(API.track, { action: "lista" }, { forceNetwork: true }),
  );

  let geocercas = [];
  let map_key = "";
  let mapCfg = await safe("map_config_principal", () =>
    apiPost(
      API.clocatorPrincipal || API.clocator,
      { action: "map_config" },
      { forceNetwork: true },
    ),
  );
  if (!mapCfg) {
    const cloOp = effectiveClocator(
      API.clocatorPrincipal || API.clocator,
      MULTI_CUENTA,
      user,
      "cerro-verde",
    );
    if (cloOp && cloOp !== (API.clocatorPrincipal || API.clocator)) {
      mapCfg = await safe("map_config_operador", () =>
        apiPost(cloOp, { action: "map_config" }, { forceNetwork: true }),
      );
    }
  }
  if (mapCfg) {
    geocercas = mapCfg.geocercas || mapCfg.fences || [];
    map_key = mapCfg.google_maps_api_key || mapCfg.maps_key || "";
  }

  const pernoctes_sin_registro = await safe("pernoctes", () =>
    apiPost(
      API.report,
      { action: "pernoctes_sin_registro" },
      { forceNetwork: true },
    ),
  );
  const paradas_estado = await safe("paradas_estado", () =>
    apiPost(API.report, { action: "paradas_estado" }, { forceNetwork: true }),
  );
  const reporte_preview = await safe("reporte_preview", () =>
    apiPost(API.report, { action: "reporte_preview" }, { forceNetwork: true }),
  );

  const session = await setBootstrapPayload({
    user_email: user?.email || "",
    user_uid: user?.uid || "",
    resumen,
    lista,
    geocercas,
    map_key,
    pernoctes_sin_registro,
    paradas_estado,
    reporte_preview,
    note: opts.note || "bootstrap-post-sap",
  });

  return {
    ok: true,
    id: session.id,
    localFirst: true,
    has_resumen: !!resumen,
    has_lista: !!lista,
    geocercas: geocercas.length,
    placas: (lista?.placas || []).length,
    revisadas: (lista?.placas || []).filter((p) => p.revisada).length,
    deltas: (session.deltas || []).length,
  };
}

export async function sessionStatus() {
  const s = await loadSession();
  return {
    active: !!s.active,
    localFirst: isLocalFirst(),
    bootstrapped_at: s.bootstrapped_at,
    consolidado_at: s.consolidado_at,
    deltas: (s.deltas || []).length,
    geocercas: (s.geocercas || []).length,
    user: s.user_email,
  };
}
