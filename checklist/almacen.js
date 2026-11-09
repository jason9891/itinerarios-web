/**
 * Almacén del check list. Hoy: localStorage de ESTE navegador (por usuario).
 * Cambiar a un almacén compartido solo requiere reemplazar leer()/guardar().
 */
import { ITINERARIOS, filaNueva } from "./logica.js";

const key = (uid) => `chk_seguimiento_v1:${uid || "anon"}`;

export function leer(uid) {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(key(uid)) || "{}") || {}; } catch { raw = {}; }
  const out = {};
  for (const it of ITINERARIOS) out[it.id] = { ...filaNueva(), ...(raw[it.id] || {}) };
  return out;
}

export function guardar(uid, datos) {
  try { localStorage.setItem(key(uid), JSON.stringify(datos)); return true; } catch { return false; }
}
