/**
 * Cliente de solo lectura del Worker de Cloudflare (clocator-proxy) para QUELLAVECO.
 * Se usa únicamente para: posiciones actuales (snapshot) y la clave de Google Maps.
 * No hay ninguna llamada a Supabase.
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";
import { normPlaca } from "./api-client.js";

const LS_KEY = "qv_maps_key_v1";

async function workerPost(body, { timeoutMs = 60000 } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("No hay sesión activa");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API.worker, {
      method: "POST",
      headers: { Authorization: `Bearer ${await user.getIdToken(false)}`, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `Worker HTTP ${r.status}`);
    return d;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("El Worker tardó demasiado en responder");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function obtenerMapsKey() {
  try {
    const k = localStorage.getItem(LS_KEY);
    if (k) return k;
  } catch {
    /* ignore */
  }
  const d = await workerPost({ action: "config" });
  const key = d.google_maps_api_key || "";
  if (!key) throw new Error("Falta el secreto GOOGLE_MAPS_API_KEY en el Worker de Cloudflare");
  try {
    localStorage.setItem(LS_KEY, key);
  } catch {
    /* ignore */
  }
  return key;
}

const REPORTE = {
  VERDE: "REPORTA",
  AMARILLO: "ALERTA GPS",
  ROJO: "NO REPORTA",
  GRIS: "SIN REPORTE PROLONGADO",
};

/**
 * Posiciones actuales de las unidades 20-R- que ve CLocator.
 * @returns {Promise<{ generado_en:string, total:number, porPlaca: Map<string, object> }>}
 */
export async function obtenerPosiciones() {
  const snap = await workerPost({ action: "snapshot" });
  const porPlaca = new Map();
  for (const [placa, codigo, tParada, lat, lng, color] of snap.filas || []) {
    const k = normPlaca(placa);
    if (!k || porPlaca.has(k)) continue;
    porPlaca.set(k, {
      placa,
      codigo,
      t_parada: tParada || "",
      lat: lat ?? null,
      lng: lng ?? null,
      color: color || "SIN_COLOR",
      reporte: REPORTE[color] || "SIN DATOS",
    });
  }
  return { generado_en: snap.generado_en || new Date().toISOString(), total: porPlaca.size, porPlaca };
}
