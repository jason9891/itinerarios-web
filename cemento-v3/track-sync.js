/**
 * Baja del maestro el seguimiento del día (OCs, revisadas) + históricos y lo guarda en el navegador.
 * Se usa al INICIAR SEGUIMIENTO y tras aplicar SAP (el maestro cambió).
 */
import { API } from "./registry.js";
import { apiPostNetwork } from "./api-client.js";
import { buildTrack, putHist, newCtx, tractoNorm, pendingOps } from "./local-track-core.js";
import { replaceTrackCtx, loadTrackCtx } from "./session-store.js";

/** Históricos de todos los tractos en UNA llamada. Si el maestro aún no tiene esa función, se bajan por demanda. */
async function downloadHist(units) {
  const tractos = [...new Set(units.map((u) => tractoNorm(u.tracto || u.placa)).filter(Boolean))];
  if (!tractos.length) return {};
  try {
    const r = await apiPostNetwork(API.historicos, { tractos });
    return r?.por_tracto && typeof r.por_tracto === "object" ? r.por_tracto : null;
  } catch (e) {
    console.info("[cemento-v3] históricos por lote no disponibles; se bajan por demanda:", e?.message || e);
    return null;
  }
}

export async function downloadTrackFromMaster() {
  const boot = await apiPostNetwork(API.track, { action: "bootstrap" });
  if (!Array.isArray(boot?.units)) throw new Error("El maestro no devolvió el seguimiento del día");
  const track = buildTrack(boot);
  const ctx = newCtx(track, {});
  const hist = await downloadHist(track.units);
  if (hist) putHist(ctx, hist);
  await replaceTrackCtx(ctx.track, ctx.hist);
  return { placas: track.units.length, ocs: track.units.reduce((n, u) => n + u.ocs.length, 0), historicos: hist ? Object.keys(hist).length : 0, historicos_por_demanda: !hist };
}

/**
 * Vuelve a bajar del maestro (p. ej. tras SAP). Si hay cambios locales sin enviar, se niega:
 * primero hay que enviarlos (se evita pisar el trabajo del operador).
 */
export async function refreshTrackFromMaster() {
  const ctx = await loadTrackCtx();
  const n = ctx.track ? pendingOps(ctx).length : 0;
  if (n > 0) throw new Error(`Hay ${n} cambio(s) locales sin enviar al maestro. Envíelos antes de volver a cargar.`);
  return downloadTrackFromMaster();
}
