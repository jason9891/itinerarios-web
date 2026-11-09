/**
 * Configuración de QUELLAVECO.
 *
 * Esta versión es SOLO FRONTEND: no usa Supabase ni guarda histórico.
 * Cuando se conecte a Supabase se agregarán sus endpoints en registry.js.
 */

/**
 * FILTRO DE NEGOCIO — PENDIENTE DE DEFINIR.
 *
 * Un despacho del Excel SAP es de Quellaveco si cumple ALGUNA de estas reglas.
 * Cada regla compara el campo Cliente (obligatorio) y, si se indica, también Destino.
 * La comparación ignora tildes, mayúsculas y espacios repetidos (igual que Cerro Verde).
 *
 * Ejemplo con el formato de Cerro Verde:
 *   { cliente: "SOCIEDAD MINERA CERRO VERDE S.A.A." },
 *   { cliente: "CAL & CEMENTO SUR S.A.", destino: "ARE.ARE.YARABAMBA" },
 *
 * Mientras la lista esté vacía, el itinerario NO filtra: muestra todas las filas del Excel
 * y avisa en pantalla que el filtro no está definido.
 */
export const REGLAS_NEGOCIO = [
  // { cliente: "…", destino: "…" },
];

/** Columnas del Excel SAP (ZSDF017) que se leen, igual que en Cerro Verde. */
export const CAMPOS_SAP = [
  "Sociedad", "Centro", "Entrega", "Transporte", "Nro.Pedido", "Tipo pedido",
  "Doc.FI", "Doc.Sunat", "Cliente", "Destino", "Material", "Descripcion",
  "Cantidad", "UMV", "Lote", "Placa", "Guia", "Fecha", "Ingreso",
  "Fecha Salida", "Salida", "Tara", "Neto", "Prom.", "Orden Compra Cliente",
  "Peso Total", "Unidad Peso", "Precinto", "Bomba", "GRE-R", "Identif.Ext.1",
  "Denominación", "Id.Tracktransp",
];

/** Columnas mínimas para reconocer el formato del Excel. */
export const CAMPOS_REQUERIDOS = ["Entrega", "Placa", "Cliente"];

const ascii = (v) =>
  String(v ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");

/** ¿Ya se definió el filtro de negocio? */
export function filtroDefinido() {
  return REGLAS_NEGOCIO.length > 0;
}

/** ¿El despacho (cliente + destino) pertenece a Quellaveco? Sin reglas definidas, todo pasa. */
export function esDeNegocio(cliente, destino) {
  if (!filtroDefinido()) return true;
  const c = ascii(cliente);
  const d = ascii(destino);
  return REGLAS_NEGOCIO.some(
    (r) => ascii(r.cliente) === c && (!r.destino || ascii(r.destino) === d),
  );
}
