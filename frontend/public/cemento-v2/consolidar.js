/**
 * Reinyecta deltas locales de Cemento V2 al Supabase maestro.
 * No envía GPS / puntos de ruta.
 */
import { auth } from "../shared/auth.js";
import { apiPostNetwork } from "./api-client.js";
import {
  loadSession,
  listDeltas,
  markConsolidado,
  saveSession,
} from "./session-store.js";

const PRINCIPAL = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1";

function toPrincipalUrl(url) {
  try {
    const u = new URL(url);
    const fn = u.pathname.split("/").pop();
    return `${PRINCIPAL}/${fn}`;
  } catch {
    return url;
  }
}

function stripGps(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const { puntos_gps, puntos, track, geocercas, ...rest } = obj;
  return rest;
}

const ORDER = {
  guardar: 20,
  cerrar: 30,
  marcar_revisada: 40,
};

function prepare(raw) {
  const map = new Map();
  for (const d of raw) {
    if (d.kind !== "apiPost" || !d.body) continue;
    if (String(d.url || "").includes("clocator")) continue;
    const k = `${d.body.action}|${d.body.id}|${d.body.placa || ""}`;
    map.set(k, d);
  }
  return [...map.values()].sort((a, b) => {
    const ra = ORDER[String(a.body?.action || "").toLowerCase()] ?? 25;
    const rb = ORDER[String(b.body?.action || "").toLowerCase()] ?? 25;
    return ra - rb;
  });
}

export async function consolidarSesionCemV2({ includeSummary = true } = {}) {
  const s = await loadSession();
  const raw = await listDeltas();
  const deltas = prepare(raw);
  const user = auth.currentUser;
  const results = [];

  for (const d of deltas) {
    try {
      const body = stripGps({ ...d.body });
      const out = await apiPostNetwork(toPrincipalUrl(d.url), body);
      results.push({ id: d.id, ok: true, action: body.action, out });
    } catch (e) {
      results.push({
        id: d.id,
        ok: false,
        action: d.body?.action,
        error: e.message || String(e),
      });
    }
  }

  if (includeSummary && user) {
    try {
      const token = await user.getIdToken(true);
      await fetch(`${PRINCIPAL}/multi-cuenta-mensaje`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "enviar_resultados",
          origen: "cemento-v2-consolidar",
          session_id: s.id,
          user_email: user.email || s.user_email,
          resumen: {
            deltas: deltas.length,
            ok: results.filter((r) => r.ok).length,
            fail: results.filter((r) => !r.ok).length,
          },
        }),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null);
    } catch (_) {}
  }

  const failed = results.filter((r) => !r.ok);
  const done = new Set(results.filter((r) => r.ok).map((r) => r.id));
  if (failed.length === 0) {
    await markConsolidado();
  } else {
    const s2 = await loadSession();
    s2.deltas = (s2.deltas || []).filter((d) => !done.has(d.id));
    await saveSession(s2);
  }

  return {
    total: deltas.length,
    ok: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
    consolidado: failed.length === 0,
    pending_left: failed.length,
  };
}
