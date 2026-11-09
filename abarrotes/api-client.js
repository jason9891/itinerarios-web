/**
 * Utilidades de ABARROTES (sin red). Independiente de los demás itinerarios.
 */

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function moduleHead(title, sub, extra = "") {
  return `<div class="module-head"><div><p class="eyebrow">PRUEBA NO TOCAR</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</div>`;
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
  }).format(d);
}

/** Texto sin tildes, en mayúsculas y con espacios simples (para comparar). */
export const ascii = (v) =>
  String(v ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");

/** Clave de placa para cruzar despachos con GPS: mayúsculas, sin guiones ni espacios. */
export const normPlaca = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** AKU861 → AKU-861 (solo si tiene el formato 3 caracteres + 3 dígitos). */
export function formatPlaca(v) {
  const k = normPlaca(v);
  return /^[A-Z0-9]{3}\d{3}$/.test(k) ? `${k.slice(0, 3)}-${k.slice(3)}` : k;
}

/** «AKU-861 / BEP-123» → [tracto, carreta]. La primera placa es el tracto. */
export function separarPlacas(v) {
  const p = String(v ?? "")
    .toUpperCase()
    .split(/[\/\s,]+/)
    .map(normPlaca)
    .filter(Boolean);
  return [p[0] || "", p[1] || ""];
}

let xlsxLib = null;
/** Lector/escritor de Excel (SheetJS) cargado bajo demanda. */
export async function loadXlsx() {
  if (xlsxLib) return xlsxLib;
  xlsxLib = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return xlsxLib;
}

export function irA(ruta) {
  document.querySelector(`nav button[data-route="${ruta}"]`)?.click();
}
