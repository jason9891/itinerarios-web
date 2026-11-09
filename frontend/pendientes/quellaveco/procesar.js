/**
 * Lógica pura de QUELLAVECO (sin DOM ni red): procesa el Excel SAP de despachos y arma el reporte.
 * Mismas reglas operativas que Cerro Verde:
 *  1) filtro de negocio (config.js);
 *  2) la PRIMERA placa es el tracto y define el seguimiento; la carreta no bloquea;
 *  3) entrega no vacía;
 *  4) deduplicar por ENTREGA (queda la última fila).
 */
import { CAMPOS_SAP, CAMPOS_REQUERIDOS, esDeNegocio, filtroDefinido } from "./config.js";
import { separarPlacas, formatPlaca } from "./api-client.js";

const texto = (v) => String(v ?? "").trim();
const clave = (v) => texto(v).replace(/\.0+$/, "");

/** Campos que se conservan de cada despacho (el resto se descarta para ahorrar memoria). */
const CAMPOS_GUARDAR = [
  "Entrega", "Transporte", "Cliente", "Destino", "Material", "Descripcion", "Cantidad", "UMV",
  "Placa", "Guia", "Fecha", "Ingreso", "Fecha Salida", "Salida", "Neto",
];

function limpiar(r) {
  return Object.fromEntries(CAMPOS_SAP.map((f) => [f, texto(r?.[f])]));
}

/** Devuelve la lista de columnas obligatorias que faltan en el Excel (vacía = formato válido). */
export function columnasFaltantes(rows) {
  const cols = new Set();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r || {})) cols.add(k);
  return CAMPOS_REQUERIDOS.filter((c) => !cols.has(c));
}

/**
 * @param {object[]} rows filas del Excel (cabeceras ya recortadas)
 * @returns {{ despachos: object[], descartes: {entrega:string, motivo:string}[], resumen: object }}
 */
export function procesarFilas(rows) {
  const descartes = [];
  const porEntrega = new Map();
  let duplicadas = 0;

  for (const raw of rows) {
    const s = limpiar(raw);
    const entrega = clave(s.Entrega);
    if (!entrega) {
      descartes.push({ entrega: "—", motivo: "ENTREGA VACÍA" });
      continue;
    }
    if (!esDeNegocio(s.Cliente, s.Destino)) {
      descartes.push({ entrega, motivo: "FUERA DEL NEGOCIO QUELLAVECO" });
      continue;
    }
    const [tracto, carreta] = separarPlacas(s.Placa);
    if (!tracto) {
      descartes.push({ entrega, motivo: "PLACA TRACTO INCOMPLETA" });
      continue;
    }
    if (porEntrega.has(entrega)) duplicadas++;
    const d = Object.fromEntries(CAMPOS_GUARDAR.map((f) => [f, s[f]]));
    porEntrega.set(entrega, { ...d, Entrega: entrega, tracto, carreta });
  }

  const despachos = [...porEntrega.values()];
  return {
    despachos,
    descartes,
    resumen: {
      leidas: rows.length,
      en_alcance: despachos.length,
      descartadas: descartes.length,
      duplicadas,
      tractos: new Set(despachos.map((d) => d.tracto)).size,
      filtro_definido: filtroDefinido(),
    },
  };
}

/** Descartes agrupados por motivo → [{ motivo, cantidad, entregas:[…] }], de mayor a menor. */
export function agruparDescartes(descartes) {
  const por = new Map();
  for (const d of descartes || []) {
    if (!por.has(d.motivo)) por.set(d.motivo, []);
    por.get(d.motivo).push(d.entrega);
  }
  return [...por.entries()]
    .map(([motivo, entregas]) => ({ motivo, cantidad: entregas.length, entregas }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

export const ENCABEZADOS_REPORTE = [
  "ENTREGA", "FECHA", "CLIENTE", "DESTINO", "MATERIAL", "DESCRIPCIÓN", "NETO", "GUÍA",
  "FECHA SALIDA", "SALIDA", "TRACTO", "CARRETA", "CÓDIGO CLOCATOR", "LATITUD", "LONGITUD",
  "T. PARADA", "REPORTE GPS",
];

/**
 * Una fila por despacho. Si hay posiciones (Map placa normalizada → posición), se agregan las columnas GPS.
 * @param {object[]} despachos
 * @param {Map<string, object> | null} porPlaca
 */
export function filasReporte(despachos, porPlaca) {
  return (despachos || []).map((d) => {
    const p = porPlaca?.get(d.tracto) || null;
    return [
      d.Entrega, d.Fecha, d.Cliente, d.Destino, d.Material, d.Descripcion, d.Neto, d.Guia,
      d["Fecha Salida"], d.Salida, formatPlaca(d.tracto), formatPlaca(d.carreta),
      p?.codigo ?? "", p?.lat ?? "", p?.lng ?? "", p?.t_parada ?? "", p ? p.reporte : porPlaca ? "SIN POSICIÓN" : "",
    ];
  });
}
