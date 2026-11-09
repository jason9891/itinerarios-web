/**
 * Lógica pura del CHECK LIST DE SEGUIMIENTO (sin DOM ni red).
 * Cada itinerario tiene 3 espacios: 1 (el más antiguo), 2 y 3 (el nuevo, en blanco al inicio).
 * Al REGISTRAR: lo que hay en el 3 pasa al 2, lo del 2 pasa al 1 (lo del 1 sale) y el 3 queda en blanco.
 */
export const ITINERARIOS = [
  { id: "cemento", nombre: "Cemento" },
  { id: "cerro-verde", nombre: "Cerro Verde" },
  { id: "turno-amanecida", nombre: "Turno Amanecida" },
  { id: "quellaveco", nombre: "Quellaveco" },
  { id: "abarrotes", nombre: "Abarrotes" },
];

export const vacio = () => ({ quien: "", fecha: "", hora: "", donde: "" });
export const filaNueva = () => ({ e1: null, e2: null, borrador: vacio() });

/** ¿Se puede registrar? Devuelve el texto del problema o "". */
export function problema(b) {
  if (!String(b?.quien || "").trim()) return "Falta quién hizo el seguimiento.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.fecha || ""))) return "Falta la fecha.";
  if (!/^\d{2}:\d{2}$/.test(String(b?.hora || ""))) return "Falta la hora.";
  return "";
}

/** Corrimiento: 3→2, 2→1, 3 en blanco. No muta la fila recibida. */
export function registrar(fila, ahoraISO = new Date().toISOString()) {
  const p = problema(fila.borrador);
  if (p) throw new Error(p);
  const b = fila.borrador;
  const nuevo = { quien: b.quien.trim(), fecha: b.fecha, hora: b.hora, donde: String(b.donde || "").trim(), registrado_en: ahoraISO };
  return { e1: fila.e2 ?? null, e2: nuevo, borrador: { ...vacio(), quien: "" } };
}

/** Texto «dd/mm/aaaa hh:mm» de un espacio. */
export function fechaHora(e) {
  if (!e?.fecha) return "";
  const [y, m, d] = e.fecha.split("-");
  return `${d}/${m}/${y} ${e.hora || ""}`.trim();
}

/** Fecha y hora actuales en Lima (UTC-5) como {fecha:'aaaa-mm-dd', hora:'hh:mm'}. */
export function ahoraLima(ms = Date.now()) {
  const x = new Date(ms - 5 * 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return { fecha: `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`, hora: `${p(x.getUTCHours())}:${p(x.getUTCMinutes())}` };
}
