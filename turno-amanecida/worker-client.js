/**
 * Cliente del Worker de Cloudflare (clocator-proxy) para TURNO AMANECIDA.
 * TODO el módulo habla solo con el Worker: snapshot, rutas, clave de mapas, acoples y
 * geocercas. No hay ninguna llamada a Supabase.
 *
 * Formato de ruta del Worker: p = [[tUnixSeg, lat, lng], ...]. Aquí se convierte al
 * formato histórico del módulo ({lat, lng, fecha "dd/MM/yyyy HH:mm:ss" Lima}).
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";
import { ACTIVO, MENSAJE } from "./kill-switch.js";
import { formatLima } from "./tiempo-lima.js";

const LS_GEO = "tn_geocercas_v1";
const LS_KEY = "tn_maps_key_v1";
const LS_URL = "tn_worker_url";
const MAX_LOTE = 4; // unidades por petición (una sola sesión de CLocator)
const LOTE_MS = 80; // ventana para agrupar peticiones simultáneas

export function workerUrl() {
  try {
    return localStorage.getItem(LS_URL) || API.worker;
  } catch {
    return API.worker;
  }
}

export async function workerPost(body, { timeoutMs = 60000 } = {}) {
  if (!ACTIVO) throw new Error(MENSAJE);
  const user = auth.currentUser;
  if (!user) throw new Error("No hay sesión activa");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(workerUrl(), {
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

// ───────── clave de Google Maps ─────────
export async function obtenerMapsKey() {
  try {
    const k = localStorage.getItem(LS_KEY);
    if (k) return k;
  } catch { /* ignore */ }
  const d = await workerPost({ action: "config" });
  const key = d.google_maps_api_key || "";
  if (!key) throw new Error("Falta el secreto GOOGLE_MAPS_API_KEY en el Worker de Cloudflare");
  try { localStorage.setItem(LS_KEY, key); } catch { /* ignore */ }
  return key;
}

// ───────── geocercas _TN y filtro de zona (en el navegador) ─────────
let geoMem = null;
async function geocercas() {
  if (geoMem) return geoMem;
  try {
    const c = JSON.parse(localStorage.getItem(LS_GEO) || "null");
    if (c && c["Filtro_Macro_Sur_TN"]) return (geoMem = c);
  } catch { /* ignore */ }
  const d = await workerPost({ action: "geocercas" });
  if (!d.geocercas?.["Filtro_Macro_Sur_TN"]) throw new Error("El Worker no devolvió las geocercas _TN");
  try { localStorage.setItem(LS_GEO, JSON.stringify(d.geocercas)); } catch { /* ignore */ }
  return (geoMem = d.geocercas);
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** null = fuera del macro sur; "Transito" = macro y fuera de toda planta; otro = nombre de planta. */
function zonaDe(geo, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!pointInRing(lng, lat, geo["Filtro_Macro_Sur_TN"])) return null;
  for (const [name, ring] of Object.entries(geo)) {
    if (name !== "Filtro_Macro_Sur_TN" && pointInRing(lng, lat, ring)) return name;
  }
  return "Transito";
}

const CLASE = { AMARILLO: "fila-amarillo-opaco", GRIS: "fila-gris", VERDE: "fila-verde-opaco", ROJO: "fila-rojo-opaco" };
const REPORTE = { VERDE: "REPORTA", ROJO: "NO_REPORTA", GRIS: "NO_REPORTA_LARGO", AMARILLO: "ALERTA_REPORTE" };

/**
 * Posiciones actuales de las unidades 20-R- en tránsito del sur (fuera de plantas).
 * Mismo formato que devolvía la antigua función de snapshot.
 */
export async function obtenerSnapshot() {
  const [snap, geo] = await Promise.all([workerPost({ action: "snapshot" }), geocercas()]);
  const seen = new Set();
  const unidades = [];
  let enPlanta = 0, fueraMacro = 0, sinCoord = 0;
  for (const [placa, codigo, tParada, lat, lng, color] of snap.filas || []) {
    if (lat == null || lng == null) { sinCoord++; continue; }
    const zona = zonaDe(geo, lat, lng);
    if (zona == null) { fueraMacro++; continue; }
    if (zona !== "Transito") { enPlanta++; continue; }
    const key = String(placa || "").toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unidades.push({
      placa, codigo, t_parada: tParada, lat, lng,
      clase_html: CLASE[color] || "", color_html: color || "SIN_COLOR",
      reporte_gps: REPORTE[color] || "SIN_DATOS", zona: "Transito",
    });
  }
  return {
    ok: true,
    generado_en: snap.generado_en,
    stats: { filas_tabla: snap.filas_tabla, con_coord: snap.con_coord, con_20r: (snap.filas || []).length, sin_coord: sinCoord, fuera_macro: fueraMacro, en_planta: enPlanta, unidades_finales: unidades.length },
    unidades,
  };
}

// ───────── rutas (agrupadas en lotes de hasta 4 unidades) ─────────
const pend = [];
let timer = null;

function aLegacy(r) {
  const pts = (r.p || []).map(([t, lat, lng]) => ({ lat, lng, fecha: formatLima(t * 1000) }));
  return {
    ok: true,
    puntos: pts.length,
    total_original: r.total_original,
    puntos_gps: pts,
    ultimo: pts.length ? pts[pts.length - 1] : null,
    ultimo_monitoreo: r.ultimo_monitoreo || null,
    sin_movimiento: pts.length < 2,
  };
}

async function despachar() {
  timer = null;
  while (pend.length) {
    const lote = pend.splice(0, MAX_LOTE);
    workerPost({
      action: "rutas",
      unidades: lote.map((x) => ({ placa: x.placa, tracto: x.tracto, desde: x.desde, hasta: x.hasta })),
    })
      .then((d) => {
        lote.forEach((x, i) => {
          const r = d.resultados?.[i];
          if (r?.ok) x.ok(aLegacy(r));
          else x.fail(new Error(r?.error || "Sin resultado para la unidad"));
        });
      })
      .catch((e) => lote.forEach((x) => x.fail(e)));
  }
}

/** Ruta de una unidad (se agrupa con otras peticiones simultáneas en un solo login de CLocator). */
export function rutaWorker({ placa, tracto, desde, hasta }) {
  return new Promise((ok, fail) => {
    pend.push({ placa, tracto, desde, hasta, ok, fail });
    if (pend.length >= MAX_LOTE) {
      clearTimeout(timer);
      despachar();
    } else if (!timer) {
      timer = setTimeout(despachar, LOTE_MS);
    }
  });
}

// ───────── catálogo de acoples (KV del Worker) ─────────
const aFilas = (arr) => (arr || []).map(([codigo, carroceria, gestor]) => ({ codigo, carroceria, gestor }));

/** Catálogo inicial (1.808 acoples) servido como archivo estático de Firebase: 0 consultas a Supabase. */
async function acoplesSemilla() {
  const r = await fetch(new URL("./acoples-seed.json?v=1", import.meta.url));
  if (!r.ok) throw new Error(`Semilla de acoples HTTP ${r.status}`);
  return r.json();
}

/**
 * Catálogo de acoples. Si el KV del Worker está vacío (primera vez) o no está configurado,
 * se usa la semilla estática y, cuando es posible, se guarda en el KV para los demás usuarios.
 */
export async function acoplesListar() {
  let d = null;
  try {
    d = await workerPost({ action: "acoples_listar" });
  } catch (e) {
    console.warn("[TN] KV de acoples no disponible, uso la semilla:", e?.message || e);
  }
  if (d?.filas?.length) return { filas: aFilas(d.filas), actualizado_en: d.actualizado_en || null };
  const semilla = await acoplesSemilla();
  if (d) {
    try { await workerPost({ action: "acoples_guardar", filas: semilla }); } catch (e) { console.warn("[TN] no se pudo sembrar el KV:", e?.message || e); }
  }
  return { filas: aFilas(semilla), actualizado_en: null };
}

export async function acoplesGuardar(filas) {
  return workerPost({
    action: "acoples_guardar",
    filas: (filas || []).map((r) => [r.codigo, r.carroceria || "", r.gestor || ""]),
  });
}
