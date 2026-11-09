/**
 * Bootstrap CEMENTO V3 + inicio limpio de turno.
 * Flujo: wipe local → datos maestro → SAP al maestro → trabajo local → cierre.
 * Sin pernoctes (no aplica a Cemento).
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";
import { apiGet, apiPost } from "./api-client.js";
import {
  setBootstrapPayload,
  loadSession,
  clearSession,
  isLocalFirst,
} from "./session-store.js";
import { downloadTrackFromMaster } from "./track-sync.js";
import { countPendingOps } from "./local-track.js";

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn("[cem-v3-bootstrap]", label, e?.message || e);
    return null;
  }
}

const LS_EXACT = [
  "cemento_v3_precarga_v1",
  "cemento_v3_rango_desde",
  "cemento_v3_tracking_split",
];
const LS_PREFIXES = ["cem_v3_", "cemento_v3", "cemento-v3"];

function clearLocalStorage() {
  const kill = new Set(LS_EXACT);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (LS_PREFIXES.some((p) => k.startsWith(p) || k.includes("cem_v3") || k.includes("cemento_v3"))) {
      kill.add(k);
    }
  }
  for (const k of kill) {
    try { localStorage.removeItem(k); } catch (_) {}
  }
}

async function deleteDatabases() {
  // session + GPS real de precarga/seguimiento (antes solo se borraba cemento-v3-gps, nombre incorrecto)
  for (const name of ["cemento-v3-session-v1", "cemento-v3-gps", "cemento-v3-gps-temporal"]) {
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

export async function wipeLocalCementoV2() {
  clearLocalStorage();
  await deleteDatabases();
  // Detener motor de precarga en memoria si el módulo lo expone
  try {
    const eng = await import("./precarga-engine.js?v=cem-v3-2");
    if (typeof eng.resetPreload === "function") eng.resetPreload();
    else if (typeof eng.clearMeta === "function") eng.clearMeta();
  } catch (_) {}
  return { ok: true };
}

export async function bootstrapCementoV2(opts = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión");

  const resumen = await safe("resumen", () =>
    apiGet("resumen", { forceNetwork: true }),
  );
  const lista = await safe("lista", () =>
    apiPost(API.track, { action: "lista" }, { forceNetwork: true }),
  );

  let geocercas = [];
  let map_key = "";
  // SIEMPRE cartografía CEMENTO del maestro (API.clocator principal).
  // No usar clocator del operador: ahí pueden faltar geocercas o haber otro set.
  const mapCfg = await apiPost(
    API.clocatorPrincipal || API.clocator,
    { action: "map_config" },
    { forceNetwork: true },
  );
  if (mapCfg) {
    const raw = Array.isArray(mapCfg.geocercas)
      ? mapCfg.geocercas
      : Array.isArray(mapCfg.fences)
        ? mapCfg.fences
        : Array.isArray(mapCfg.objetos)
          ? mapCfg.objetos
          : [];
    const tramos = Array.isArray(mapCfg.geocerca_tramo) ? mapCfg.geocerca_tramo : [];
    const take = (arr, kinds) =>
      (arr || []).filter((g) => {
        if (!g) return false;
        const k = String(g.kind || "geocerca");
        if (kinds && !kinds.includes(k)) return false;
        return !!(g.geometry || g.ring || g.coordinates);
      });
    // Análisis: geocercas de planta/obra + tramos de red
    geocercas = [...take(raw, ["geocerca", ""]), ...take(tramos, ["geocerca_tramo", "geocerca"])];
    if (!geocercas.length && raw.length) geocercas = raw;
    // Normalizar name (algunas publicaciones usan nombre)
    geocercas = geocercas.map((g) => ({
      ...g,
      name: g.name || g.nombre || g.originalName || g.id || "",
      kind: g.kind || "geocerca",
    }));
    map_key = mapCfg.google_maps_api_key || mapCfg.maps_key || "";
    const names = geocercas.map((g) => String(g.name || "").toUpperCase());
    const hasYura = names.some((n) => n.includes("YURA"));
    if (geocercas.length < 5) {
      throw new Error(
        `Cartografía CEMENTO incompleta (${geocercas.length} geocercas). Reintente INICIAR SEGUIMIENTO.`,
      );
    }
    if (!hasYura) {
      console.warn("[cemento-v3] map_config sin PLANTA YURA", names.slice(0, 12));
      // No bloquear sesión: el operador puede seguir; el panel mostrará el conteo real
    }
    console.info(
      `[cemento-v3] geocercas CEMENTO: ${geocercas.length} · YURA=sí · origen=${mapCfg.origen || "map_config"}`,
    );
  } else {
    throw new Error("No se pudo cargar map_config CEMENTO del maestro");
  }

  const reporte_preview = await safe("reporte_preview", () =>
    apiPost(API.report, { action: "reporte_preview" }, { forceNetwork: true }),
  );

  // Reinicio revisadas del usuario si el backend lo soporta
  await safe("reiniciar_revisadas", () =>
    apiPost(
      API.track,
      { action: "reiniciar_revisadas" },
      { forceNetwork: true },
    ),
  );

  const session = await setBootstrapPayload({
    user_email: user.email || "",
    user_uid: user.uid || "",
    resumen,
    lista,
    geocercas,
    map_key,
    reporte_preview,
    note: opts.note || "bootstrap-iniciar",
  });

  // INICIO (maestro): OCs del día, revisadas e históricos → navegador. De aquí en adelante el
  // seguimiento se trabaja local; el maestro vuelve a intervenir recién al terminar.
  const trk = await downloadTrackFromMaster().catch((e) => {
    throw new Error("No se pudo bajar el seguimiento del maestro: " + (e?.message || e));
  });

  return {
    ok: true,
    id: session.id,
    localFirst: true,
    geocercas: geocercas.length,
    placas: trk.placas || (lista?.placas || lista?.unidades || []).length,
    ocs: trk.ocs,
    historicos: trk.historicos,
    historicos_por_demanda: trk.historicos_por_demanda,
    revisadas: (lista?.placas || []).filter((p) => p.revisada).length,
    deltas: 0,
  };
}

export async function iniciarSeguimientoCemV2() {
  // No borrar trabajo que aún no llegó al maestro.
  const sin = (await loadSession().then((x) => (x.deltas || []).length).catch(() => 0)) + (await countPendingOps().catch(() => 0));
  if (sin > 0) {
    throw new Error(
      `Hay ${sin} cambio(s) locales sin enviar al maestro. Use ENVIAR CAMBIOS AL MAESTRO (o FINALIZAR REPORTE) antes de iniciar un nuevo seguimiento.`,
    );
  }
  await wipeLocalCementoV2();
  return bootstrapCementoV2({ note: "iniciar-seguimiento" });
}

export async function sessionStatus() {
  const s = await loadSession();
  return {
    active: !!s.active,
    localFirst: isLocalFirst(),
    bootstrapped_at: s.bootstrapped_at,
    consolidado_at: s.consolidado_at,
    deltas: (s.deltas || []).length + (await countPendingOps().catch(() => 0)),
    geocercas: Array.isArray(s.geocercas) ? s.geocercas.length : 0,
    user: s.user_email,
  };
}
