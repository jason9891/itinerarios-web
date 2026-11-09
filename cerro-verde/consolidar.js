/**
 * Reinyecta deltas locales al principal respetando el orden del turno:
 * 1) grupo_agregar (entrar por despacho nuevo)
 * 2) guardar (hitos / datos)
 * 3) cerrar (con datos + motivo)
 * 4) marcar_revisada / paradas
 * 5) otra_operacion / grupo_quitar (sacar del grupo al final)
 *
 * Cerrar no es solo un flag: siempre lleva `datos` + orden_carga/placa.
 * Si el id ya no está en DIARIO, el servidor fusiona en HISTORICO.
 */
import { auth } from "../shared/auth.js";
import { apiPostNetwork } from "./api-client.js";
import {
  loadSession,
  listDeltas,
  listMovimientos,
  markConsolidado,
  saveSession,
} from "./session-store.js";

const PRINCIPAL_FN = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

function toPrincipalUrl(url) {
  try {
    const u = new URL(url);
    const fn = u.pathname.split("/").pop();
    return `${PRINCIPAL_FN}/${fn}`;
  } catch {
    return url;
  }
}

function stripGps(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const { puntos_gps, puntos, track, geocercas, ...rest } = obj;
  return rest;
}

const ACTION_ORDER = {
  grupo_agregar: 10,
  guardar: 20,
  cerrar: 30,
  parada_validar: 35,
  marcar_revisada: 40,
  otra_operacion: 50,
  grupo_quitar: 60,
  reabrir_despacho: 15,
  reabrir_historico: 15,
};

function actionRank(body) {
  const a = String(body?.action || "").toLowerCase();
  return ACTION_ORDER[a] ?? 25;
}

function deltaKey(d) {
  const b = d.body || {};
  return [
    String(b.action || "").toLowerCase(),
    b.id ?? "",
    b.placa || b.tracto || "",
    b.orden_carga || "",
  ].join("|");
}

/** Última versión por clave; luego orden de negocio. */
function prepareDeltas(raw) {
  const map = new Map();
  for (const d of raw) {
    if (d.kind !== "apiPost" || !d.body) continue;
    if (String(d.url || "").includes("clocator")) continue;
    map.set(deltaKey(d), d);
  }
  return [...map.values()].sort((a, b) => {
    const ra = actionRank(a.body);
    const rb = actionRank(b.body);
    if (ra !== rb) return ra - rb;
    return String(a.ts || "").localeCompare(String(b.ts || ""));
  });
}

function classifyError(msg) {
  const m = String(msg || "").toLowerCase();
  if (/fuera del grupo_smcv|no está activa en grupo_smcv/.test(m)) {
    return {
      soft: true,
      reason: "out_of_group",
      label: "Unidad fuera de GRUPO_SMCV (revisar alta por SAP/despacho)",
    };
  }
  if (/máximo\s*80|maximum\s*80/.test(m)) {
    return { soft: true, reason: "limit_80", label: "Límite 80 filas del servidor" };
  }
  // "no encontrado" ya no es soft ciego: el server intenta HISTORICO
  return { soft: false, reason: "hard", label: msg };
}

export async function consolidarSesionCv({ includeSummary = true } = {}) {
  const s = await loadSession();
  const raw = await listDeltas();
  const movs = listMovimientos();
  const deltas = prepareDeltas(raw);
  const user = auth.currentUser;
  const results = [];

  for (const d of deltas) {
    try {
      const body = stripGps({ ...d.body });
      // Garantizar que cerrar/guardar no vayan vacíos de contexto
      if (
        (body.action === "cerrar" || body.action === "guardar") &&
        (!body.datos || !Object.keys(body.datos).length)
      ) {
        // intentar rellenar desde detalle local
        const det =
          s.detalle_by_placa?.[
            String(body.placa || "")
              .trim()
              .toUpperCase()
              .replace(/\s+/g, "")
          ];
        const oc = (det?.ocs || []).find((o) => String(o.id) === String(body.id));
        if (oc?.payload) {
          body.datos = { ...oc.payload };
          body.orden_carga = body.orden_carga || oc.orden_carga;
        }
      }
      const out = await apiPostNetwork(toPrincipalUrl(d.url), body);
      results.push({
        id: d.id,
        ok: true,
        action: body.action,
        out,
        merged_historico: !!out?.merged_into_historico,
      });
    } catch (e) {
      const msg = e.message || String(e);
      const cls = classifyError(msg);
      results.push({
        id: d.id,
        ok: cls.soft,
        soft: cls.soft,
        skipped: cls.soft,
        action: d.body?.action,
        reason: cls.reason,
        error: cls.label || msg,
      });
    }
  }

  if (includeSummary) {
    try {
      const token = await user.getIdToken(true);
      await fetch(`${PRINCIPAL_FN}/multi-cuenta-mensaje`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "enviar_resultados",
          origen: "cerro-verde-consolidar",
          session_id: s.id,
          user_email: user?.email || s.user_email,
          resumen: {
            deltas_raw: raw.length,
            deltas_ordered: deltas.length,
            movimientos: movs.length,
            libro: movs.slice(-50).map((m) => ({
              action: m.action,
              placa: m.placa,
              orden_carga: m.orden_carga,
              desde: m.desde,
              hasta: m.hasta,
            })),
            ok: results.filter((r) => r.ok && !r.soft).length,
            historico_merged: results.filter((r) => r.merged_historico).length,
            soft: results.filter((r) => r.soft).length,
            fail: results.filter((r) => !r.ok).length,
          },
          resultados: results.map((r) => ({
            id: r.id,
            ok: !!r.ok,
            soft: !!r.soft,
            action: r.action || "",
            reason: r.reason || "",
            merged_historico: !!r.merged_historico,
          })),
        }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);
    } catch (_) {}
  }

  const failed = results.filter((r) => !r.ok);
  const doneIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
  if (failed.length === 0) {
    await markConsolidado();
  } else {
    const s2 = await loadSession();
    s2.deltas = (s2.deltas || []).filter((d) => !doneIds.has(d.id));
    await saveSession(s2);
  }

  // Paso obligatorio: volcar sesion_web → staging/HISTÓRICO/grupo (maestro real)
  let flush = null;
  try {
    flush = await apiPostNetwork(`${PRINCIPAL_FN}/cerro-verde-seguimiento`, {
      action: "aplicar_maestro",
    });
  } catch (e) {
    flush = {
      ok: false,
      maestro_actualizado: false,
      mensaje: e.message || String(e),
      pendientes_sesion_web: -1,
    };
  }

  const maestroOk = !!(flush && flush.maestro_actualizado);
  const pendingCamino = Number(flush?.pendientes_sesion_web ?? (maestroOk ? 0 : 1));

  return {
    total: deltas.length,
    total_raw: raw.length,
    ok: results.filter((r) => r.ok && !r.soft).length,
    soft: results.filter((r) => r.soft).length,
    historico_merged: results.filter((r) => r.merged_historico).length,
    failed: failed.length,
    results,
    flush,
    maestro_actualizado: maestroOk,
    pendientes_sesion_web: pendingCamino,
    consolidado: failed.length === 0 && maestroOk,
    pending_left: failed.length + (maestroOk ? 0 : pendingCamino),
    mensaje:
      flush?.mensaje ||
      (maestroOk
        ? "Maestro actualizado"
        : "Cola local enviada pero el maestro aún tiene data en camino"),
  };
}
