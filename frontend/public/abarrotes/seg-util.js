/**
 * Utilidades del seguimiento de ABARROTES (sin DOM ni red): campos, fechas Lima y tiempos derivados.
 */
import { tiempoPromedio, TOLERANCIA } from "./maestros.js";

export const CAMPOS = [
  { k: "salida", etiqueta: "SALIDA ORIGEN (Gloria / Huachipa)", tipo: "fecha" },
  { k: "llegada", etiqueta: "LLEGADA DESTINO", tipo: "fecha" },
  { k: "inicio_retorno", etiqueta: "INICIO DE RETORNO", tipo: "fecha" },
  { k: "fin_retorno", etiqueta: "FIN DE RETORNO", tipo: "fecha" },
  { k: "ubicacion", etiqueta: "UBICACIÓN", tipo: "texto" },
  { k: "estado", etiqueta: "ESTADO", tipo: "estado" },
  { k: "carga_retorno", etiqueta: "CARGA DE RETORNO", tipo: "texto" },
  { k: "observaciones", etiqueta: "OBSERVACIONES", tipo: "texto" },
];

const p2 = (n) => String(n).padStart(2, "0");

/** ms (UTC) → «dd/mm/aa HH:mm:ss» en hora de Lima. */
export function msAInput(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const x = new Date(ms - 5 * 3600000); // Lima = UTC-5 todo el año
  return `${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${String(x.getUTCFullYear()).slice(-2)} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}:${p2(x.getUTCSeconds())}`;
}

/** ms (UTC) → «dd/mm/aaaa HH:mm:ss» (formato que exige CLocator). */
export function msAPE(ms) {
  const x = new Date(ms - 5 * 3600000);
  return `${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}:${p2(x.getUTCSeconds())}`;
}

/** «dd/mm/aa[aa] HH:mm[:ss]» (Lima) → ms UTC, o null. */
export function inputAMs(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return Date.UTC(y, +m[2] - 1, +m[1], +m[4] + 5, +m[5], +(m[6] || 0));
}

/** Campos de formulario (texto) a partir de una sugerencia de geo.sugerir(). */
export function camposDeSugerencia(s) {
  return {
    salida: msAInput(s.salida), llegada: msAInput(s.llegada),
    inicio_retorno: msAInput(s.inicio_retorno), fin_retorno: msAInput(s.fin_retorno),
    ubicacion: s.ubicacion || "", estado: s.estado || "",
  };
}

const dias = (a, b) => (a != null && b != null ? (b - a) / 86400000 : null);
export const fmtDias = (d) => (d == null ? "—" : d < 0 ? "—" : `${d.toFixed(2)} d`);

/** Tiempos derivados de lo que hay en el formulario (misma lógica que las fórmulas del Excel). */
export function derivados(campos, ruta, ahora = Date.now()) {
  const sal = inputAMs(campos.salida), lle = inputAMs(campos.llegada);
  const ini = inputAMs(campos.inicio_retorno), fin = inputAMs(campos.fin_retorno);
  const ida = dias(sal, lle), retorno = dias(ini, fin), total = dias(sal, fin);
  const prom = tiempoPromedio(ruta);
  const base = fin ?? ini ?? lle;
  return {
    ida, retorno, total, promedio: prom,
    exceso: ida != null && prom != null ? ida > prom * (1 + TOLERANCIA) : null,
    dias_parado: base != null ? Math.max(0, Math.floor((ahora - base) / 86400000)) : 0,
  };
}

/** Desde (ms) para consultar el GPS de un viaje: un día antes de su fecha, sin ir más atrás que `diasMax`. */
export function desdeConsulta(viaje, diasMax = 5, ahora = Date.now()) {
  const tope = ahora - diasMax * 86400000;
  const d = viaje.fecha_carga || viaje.fecha || "";
  const f = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00-05:00` : d); // fecha sola = medianoche de Lima
  const propio = Number.isFinite(f) ? f - 86400000 : tope;
  const x = new Date(Math.max(tope, propio) - 5 * 3600000);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 5, 0, 1); // 00:00:01 Lima
}

export const ENCABEZADOS_MONITOREO = [
  "ITEM", "ORIGEN", "OC", "DT", "FECHA CARGA", "CONDUCTOR", "CELULAR", "EQUIPO", "PLACA TRACTO", "PLACA CARRETA",
  "RUTA", "CARGA", "DESTINO", "CLIENTE", "TIPO DE UNIDAD", "F. SALIDA P. GLORIA/HUACHIPA", "FECHA LLEGADA DESTINO",
  "TIEMPO TOTAL DE IDA", "FECHA INICIO DE RETORNO", "FECHA FIN DE RETORNO", "TIEMPO TOTAL DE RETORNO",
  "TIEMPO TOTAL DE VIAJE", "CARGA DE RETORNO", "OBSERVACIONES", "DÍAS PARADO", "UBICACIÓN", "ESTADO", "SEGUIMIENTO",
];

const num = (d) => (d == null || d < 0 ? "-" : Math.round(d * 10000) / 10000);
const dash = (v) => (v === "" || v == null ? "-" : v);

/** Fila de la hoja MONITOREO del Excel de control, por viaje (misma estructura de columnas). */
export function filasMonitoreo(viajes, seg, ahora = Date.now()) {
  return viajes.map((v, i) => {
    const r = seg[v.id] || {};
    const c = r.campos || {};
    const d = derivados(c, v.ruta, ahora);
    return [
      i + 1, v.origen === "AREQUIPA" ? "AREQUIPA" : v.origen === "HUACHIPA" ? "HUACHIPA" : v.punto_despacho || "OTRO",
      v.oc, v.dt, v.fecha_carga || v.fecha, v.piloto, v.telefono, v.equipo, v.tracto, v.carreta,
      v.ruta, v.carga, v.destino, v.cliente, v.presentacion,
      dash(c.salida), dash(c.llegada), num(d.ida), dash(c.inicio_retorno), dash(c.fin_retorno), num(d.retorno), num(d.total),
      dash(c.carga_retorno), dash(c.observaciones), d.dias_parado, dash(c.ubicacion), dash(c.estado),
      r.revisada ? "REVISADA" : r.gps ? "SUGERIDA (SIN REVISAR)" : "SIN SEGUIMIENTO",
    ];
  });
}

/** Resumen ruta × estado → [{ ruta, total, porEstado:{estado:n} }] (como la tabla dinámica del Excel). */
export function resumenPorRuta(viajes, seg) {
  const m = new Map();
  for (const v of viajes) {
    const e = seg[v.id]?.campos?.estado || "SIN ESTADO";
    const x = m.get(v.ruta) || { ruta: v.ruta, total: 0, porEstado: {} };
    x.total++;
    x.porEstado[e] = (x.porEstado[e] || 0) + 1;
    m.set(v.ruta, x);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
