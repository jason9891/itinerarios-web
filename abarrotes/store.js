/**
 * Almacén de ABARROTES: solo vive en ESTA pestaña (sessionStorage + memoria).
 * - carga: viajes consolidados de los dos Excel (se suben en cada turno).
 * - seguimiento: lo que se fue llenando/revisando por viaje (id → registro).
 * Cuando se conecte Supabase se cambiará por lectura inicial + envío final.
 */
const K_CARGA = "ab_carga_v2";
const K_SEG = "ab_seg_v2";
let carga = null;
let seg = null;

const leer = (k) => {
  try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; }
};
const escribir = (k, v) => {
  try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio: queda en memoria */ }
};

/** @returns {{ cargado_en:string, sap:object|null, td:object|null, viajes:object[], fusionados:number } | null} */
export const leerCarga = () => (carga ||= leer(K_CARGA));
export function guardarCarga(c) { carga = c; escribir(K_CARGA, c); }
export function borrarCarga() { carga = null; seg = null; sessionStorage.removeItem(K_CARGA); sessionStorage.removeItem(K_SEG); }

/** Mapa id → registro de seguimiento. */
export const leerSeguimiento = () => (seg ||= leer(K_SEG) || {});
export function guardarRegistro(id, reg) {
  const s = leerSeguimiento();
  s[id] = { ...(s[id] || {}), ...reg, actualizado: new Date().toISOString() };
  escribir(K_SEG, s);
  return s[id];
}
export function borrarRegistro(id) {
  const s = leerSeguimiento();
  delete s[id];
  escribir(K_SEG, s);
}
