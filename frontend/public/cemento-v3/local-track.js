/**
 * Seguimiento LOCAL (V3): atiende en el navegador las acciones que antes iban al maestro.
 * La lógica pura está en local-track-core.js; aquí solo se conecta con IndexedDB.
 */
import { loadTrackCtx, saveTrackCtx } from "./session-store.js";
import { handleLocal, putHist, tractoNorm, pendingOps, LOCAL_ACTIONS } from "./local-track-core.js";

export { LOCAL_ACTIONS, pendingOps };

export async function hasLocalTrack() {
  const c = await loadTrackCtx();
  return !!c.track;
}

export async function countPendingOps() {
  const c = await loadTrackCtx();
  return pendingOps(c).length;
}

/**
 * @param {object} body  cuerpo igual al que se enviaba al maestro
 * @param {(tracto:string)=>Promise<any[]>} fetchHist  baja del maestro el histórico de UN tracto (solo si falta)
 */
export async function localTrackCall(body, fetchHist) {
  const ctx = await loadTrackCtx();
  let res;
  try {
    res = handleLocal(ctx, body);
  } catch (e) {
    if (!e?.needsHist || !fetchHist) throw e;
    const ocs = await fetchHist(e.needsHist);
    putHist(ctx, { [tractoNorm(e.needsHist)]: ocs });
    res = handleLocal(ctx, body);
  }
  await saveTrackCtx(ctx);
  return res;
}
