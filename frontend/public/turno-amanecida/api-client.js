/**
 * Cliente HTTP exclusivo de TURNO AMANECIDA.
 */
import { acoplesListar, acoplesGuardar } from "./worker-client.js?v=tn30";

/** Compatibilidad: las acciones de maestros ahora van al Worker (KV), no a Supabase. */
export async function maestrosApi(body) {
  const a = body?.action;
  if (a === "listar_acoples") {
    const r = await acoplesListar();
    return { ok: true, ...r };
  }
  if (a === "guardar_acoples") return acoplesGuardar(body.filas);
  if (a === "estado") {
    const r = await acoplesListar();
    return { ok: true, acoples: { filas: r.filas.length, actualizado_en: r.actualizado_en } };
  }
  throw new Error(`Acción no disponible: ${a}`);
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function moduleHead(title, sub, extra = "") {
  return `<div class="module-head"><div><p class="eyebrow">TURNO AMANECIDA</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</div>`;
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
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}
