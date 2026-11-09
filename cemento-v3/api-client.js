/**
 * Cliente HTTP CEMENTO V3 — local-first.
 * Mutaciones de negocio → cola IndexedDB; lecturas → red o caché de sesión.
 * SAP / GPS / forceNetwork → siempre red al maestro (o clocator).
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";
import {
  isLocalFirst,
  isBusinessMutation,
  enqueueDelta,
  applyOptimisticMutation,
  loadSession,
  sessionSnapshot,
} from "./session-store.js";
import { LOCAL_ACTIONS, hasLocalTrack, localTrackCall } from "./local-track.js";

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(true);
}

export async function apiGet(path, { forceNetwork = false } = {}) {
  if (!forceNetwork && isLocalFirst()) {
    const s = await loadSession();
    if (path === "resumen" && s.resumen) return s.resumen;
  }
  const r = await fetch(`${API.consulta}/${path}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/** POST directo a red (consolidar / bootstrap / SAP). */
export async function apiPostNetwork(url, body, { signal, binary = false, token: tk } = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tk || (await token())}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (binary) {
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    const name =
      (r.headers.get("content-disposition") || "").match(/filename="([^"]+)/)?.[1] ||
      "descarga.xlsx";
    return { blob: await r.blob(), name };
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
}

export async function apiPost(
  url,
  body,
  { signal, binary = false, forceNetwork = false } = {},
) {
  // V3: seguimiento (lista/bootstrap/detalle/guardar/cerrar/revisadas/históricos) se atiende en el navegador.
  // El maestro solo interviene al bajar los datos (inicio) y al enviar el resultado (fin).
  if (
    !forceNetwork &&
    !binary &&
    url === API.track &&
    LOCAL_ACTIONS.has(String(body?.action || "").toLowerCase()) &&
    isLocalFirst() &&
    (await hasLocalTrack())
  ) {
    return localTrackCall(body, async (tracto) => {
      const d = await apiPostNetwork(API.track, { action: "cerradas_por_tracto", tracto });
      return Array.isArray(d?.ocs) ? d.ocs : [];
    });
  }

  // Cola local-first
  if (
    !forceNetwork &&
    !binary &&
    isLocalFirst() &&
    isBusinessMutation(url, body)
  ) {
    await enqueueDelta({ kind: "apiPost", url, body });
    await applyOptimisticMutation(body);
    return {
      ok: true,
      _queued_local: true,
      action: body?.action,
      mensaje: "Guardado en cola local (Cemento V3)",
    };
  }

  // Caché lista/detalle
  if (!forceNetwork && !binary && isLocalFirst()) {
    const a = String(body?.action || "").toLowerCase();
    const s = sessionSnapshot() || (await loadSession());
    if (a === "lista" && s?.lista) return { ...s.lista, _from_cache: true };
  }

  return apiPostNetwork(url, body, { signal, binary });
}

export function sapApi(body, opts = {}) {
  // SAP siempre al maestro
  return apiPost(API.sap, body, { ...opts, forceNetwork: true });
}

/** Guías de montados → siempre maestro (auditoría / diario). */
export function montadosApi(body, opts = {}) {
  return apiPost(API.montados, body, { ...opts, forceNetwork: true });
}

export function trackApi(body, opts = {}) {
  return apiPost(API.track, body, opts);
}

export function reportApi(body, opts = {}) {
  return apiPost(API.report, body, opts);
}

export function workApi() {
  return API;
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function fechaPE(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima" });
  } catch {
    return String(iso);
  }
}

export function moduleHead(title, sub) {
  return `<p class="eyebrow">CEMENTO V3</p><h1>${esc(title)}</h1>${
    sub ? `<p class="muted">${esc(sub)}</p>` : ""
  }`;
}
