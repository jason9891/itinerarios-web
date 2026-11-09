/**
 * Cliente HTTP exclusivo de CERRO VERDE.
 * Local-first: lecturas desde session-store; mutaciones encoladas hasta consolidar.
 */
import { auth } from "../shared/auth.js";
import { API, MULTI_CUENTA } from "./registry.js";
import {
  effectiveClocator,
  operatorFnUrl,
  isOperatorSession,
  loadTenant,
} from "../shared/multi-cuenta.js";
import {
  loadSession,
  isLocalFirst,
  enqueueDelta,
  isBusinessMutation,
  applyOptimisticMutation,
  applyDetalleOverlay,
  applyListaOverlay,
  cacheDetalleFromNetwork,
  sessionSnapshot,
} from "./session-store.js";


/** API de trabajo: operador si el login tiene tenant; si no principal. */
/**
 * Negocio (consulta/track/report/sap) → siempre PRINCIPAL (fuente de verdad + consolidado).
 * GPS/clocator → operador si el login tiene tenant (puntos fuera del principal).
 * Tras bootstrap localFirst, mutaciones de negocio se encolan y no pegan a red.
 */
export function workApi() {
  const user = auth.currentUser;
  const op = !!(MULTI_CUENTA.enabled && isOperatorSession(user, MULTI_CUENTA));
  return {
    consulta: API.consulta,
    track: API.track,
    report: API.report,
    sap: API.sap,
    clocator: op
      ? effectiveClocator(
          API.clocatorPrincipal || API.clocator,
          MULTI_CUENTA,
          user,
          "cerro-verde",
        )
      : API.clocatorPrincipal || API.clocator,
    isOperator: op,
    tenant: op ? loadTenant(user) : null,
  };
}

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(true);
}

async function rawPost(url, body, { signal, binary = false } = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (binary) {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      if (ct.includes("application/json")) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || d.message || `HTTP ${r.status}`);
      }
      const t = await r.text().catch(() => "");
      throw new Error(t.slice(0, 300) || `HTTP ${r.status}`);
    }
    if (ct.includes("application/json")) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || d.message || "Respuesta JSON inesperada al pedir Excel");
    }
    const name =
      (r.headers.get("content-disposition") || "").match(/filename="([^"]+)/)?.[1] ||
      "CERRO_VERDE.xlsx";
    return { blob: await r.blob(), name };
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
}

async function tryCacheRead(url, body) {
  if (!isLocalFirst()) return null;
  const s = await loadSession();
  const a = String(body?.action || "").toLowerCase();

  const u = String(url || "");
  if (u.includes("cerro-verde-seguimiento") || url === API.track) {
    if (a === "lista" && s.lista) {
      return applyListaOverlay({ ...s.lista, _from_cache: true });
    }
    if (a === "detalle") {
      const placa = String(body?.placa || body?.tracto || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      const bag = s.oc_local?.[placa];
      const hasLocal =
        bag &&
        ((bag.closedIds && bag.closedIds.length) ||
          bag.revisada ||
          (bag.patches && Object.keys(bag.patches).length));
      const det = s.detalle_by_placa?.[placa];
      // Solo servir caché si hay ediciones locales; si no, ir a red y re-merge
      if (det && hasLocal) {
        return applyDetalleOverlay({ ...det, _from_cache: true }, placa);
      }
    }
  }
  if (u.includes("cerro-verde-reporte") || url === API.report) {
    if (a === "reporte_preview" && s.reporte_preview)
      return { ...s.reporte_preview, _from_cache: true };
    if (a === "pernoctes_sin_registro" && s.pernoctes_sin_registro != null)
      return typeof s.pernoctes_sin_registro === "object"
        ? { ...s.pernoctes_sin_registro, _from_cache: true }
        : s.pernoctes_sin_registro;
    if (a === "paradas_estado" && s.paradas_estado != null)
      return typeof s.paradas_estado === "object"
        ? { ...s.paradas_estado, _from_cache: true }
        : s.paradas_estado;
  }
  if (a === "map_config" && (s.geocercas?.length || s.map_key)) {
    return {
      geocercas: s.geocercas || [],
      google_maps_api_key: s.map_key || "",
      _from_cache: true,
    };
  }
  return null;
}

export async function apiGet(path, opts = {}) {
  if (!opts.forceNetwork && isLocalFirst()) {
    const s = await loadSession();
    if (path === "resumen" && s.resumen) return { ...s.resumen, _from_cache: true };
  }
  const base = workApi().consulta;
  const r = await fetch(`${base}/${path}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export async function apiPost(url, body, opts = {}) {
  const { signal, binary = false, forceNetwork = false } = opts;

  // Lecturas desde caché
  if (!forceNetwork && !binary) {
    const cached = await tryCacheRead(url, body);
    if (cached) return cached;
  }

  // Mutaciones de negocio en local-first → cola (no principal)
  if (
    !forceNetwork &&
    !binary &&
    isLocalFirst() &&
    isBusinessMutation(url, body)
  ) {
    // Enriquecer guardar/cerrar con placa + orden_carga desde caché de detalle
    // para que el consolidado no dependa solo del id de DIARIO.
    let bodyEnriched = body;
    try {
      const act = String(body?.action || "").toLowerCase();
      if ((act === "guardar" || act === "cerrar") && body?.id != null) {
        const snap = sessionSnapshot();
        const detMap = snap?.detalle_by_placa || {};
        let placa = body.placa || "";
        let orden_carga = body.orden_carga || "";
        let datos = { ...(body.datos || {}) };
        for (const [pk, det] of Object.entries(detMap)) {
          const oc = (det.ocs || []).find((o) => String(o.id) === String(body.id));
          if (!oc) continue;
          placa = placa || pk || det.placa || "";
          orden_carga = orden_carga || oc.orden_carga || oc.entrega || "";
          // Fusionar payload ya editado en local para no mandar cierre vacío
          if (oc.payload && typeof oc.payload === "object") {
            for (const [k, v] of Object.entries(oc.payload)) {
              if (v != null && v !== "" && datos[k] == null) datos[k] = v;
            }
          }
          break;
        }
        bodyEnriched = {
          ...body,
          placa: placa || body.placa,
          orden_carga: orden_carga || body.orden_carga,
          datos,
          _local_snapshot: true,
        };
      }
    } catch (_) {
      bodyEnriched = body;
    }
    const n = await enqueueDelta({
      kind: "apiPost",
      url,
      body: bodyEnriched,
    });
    await applyOptimisticMutation(bodyEnriched);
    const a = String(body?.action || "").toLowerCase();
    const snap = sessionSnapshot();
    let extra = {};
    if (a === "cerrar" || a === "marcar_revisada" || a === "guardar") {
      // Inferir placa_revisada desde overlay
      let placaKey = String(body.placa || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      if (!placaKey && body.id != null && snap?.detalle_by_placa) {
        for (const [pk, det] of Object.entries(snap.detalle_by_placa)) {
          if ((det.ocs || []).some((o) => String(o.id) === String(body.id))) {
            placaKey = pk;
            break;
          }
        }
      }
      const bag = placaKey && snap?.oc_local?.[placaKey];
      const det = placaKey && snap?.detalle_by_placa?.[placaKey];
      const open = (det?.ocs || []).filter((o) => !o.preparado_cierre);
      const placa_revisada = !!(bag?.revisada || (det && open.length === 0));
      extra = {
        placa_revisada,
        revisada: placa_revisada,
        local_closed: a === "cerrar",
        message:
          a === "cerrar"
            ? placa_revisada
              ? "OC cerrada en sesión local. Placa completa (revisada)."
              : "OC cerrada en sesión local. Quedan despachos abiertos."
            : a === "marcar_revisada"
              ? "Placa marcada revisada en sesión local."
              : "Avance guardado en sesión local.",
      };
    }
    return {
      ok: true,
      queued: true,
      local: true,
      pending_deltas: n,
      message:
        extra.message ||
        "Guardado en sesión local. Se enviará a principal al finalizar el reporte.",
      ...extra,
    };
  }

  const out = await rawPost(url, body, { signal, binary });
  // Cachear detalle de red + overlays locales
  const act = String(body?.action || "").toLowerCase();
  if (act === "detalle" && out && !binary) {
    try {
      return await cacheDetalleFromNetwork(body.placa || body.tracto, out);
    } catch (_) {
      return applyDetalleOverlay(out, body.placa);
    }
  }
  if (act === "lista" && out && !binary) {
    try {
      const s = await loadSession();
      if (s.active) {
        s.lista = out;
        const { saveSession } = await import("./session-store.js");
        await saveSession(s);
      }
    } catch (_) {}
    return applyListaOverlay(out);
  }
  return out;
}

/** SAP Edge Function */
export function sapApi(body, opts) {
  // validar/aplicar siempre red (bootstrap después de aplicar)
  return apiPost(workApi().sap, body, { ...opts, forceNetwork: true });
}

/** Seguimiento */
export function trackApi(body, opts) {
  return apiPost(workApi().track, body, opts);
}

/** Expuesto para consolidar (replay forzado a red) */
export async function apiPostNetwork(url, body, opts = {}) {
  return rawPost(url, body, opts);
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function fechaPE(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function moduleHead(title, sub) {
  return `<header class="module-head"><div><p class="eyebrow">CERRO VERDE</p><h1>${esc(title)}</h1>${
    sub ? `<p class="muted">${esc(sub)}</p>` : ""
  }</div></header>`;
}

export function bufferToBase64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
