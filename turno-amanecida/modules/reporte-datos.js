/**
 * Datos del REPORTE de Turno Amanecida (mismo formato que base_pernocta_*.xlsx del desktop).
 * Módulo puro (sin DOM) para poder probarlo.
 */
export const ENCABEZADOS = [
  "FECHA", "CÓDIGO EXTERNO", "CÓDIGO ACOPLE", "TIPO DE ACOPLE", "GESTOR", "OPERADOR", "MERCADERÍA", "RUTA",
  "STATUS", "RIESGO", "PUNTO AUTORIZADO SI/NO", "PUNTO DE PERNOCTE", "TIPO DE LUGAR", "COBERTURA GPS SI/NO",
  "LATITUD", "LONGITUD", "OBSERVACIONES",
];

export const STATUS_OPCIONES = ["TRANSITO CARGADO", "TRANSITO VACIO", "ESTACIONADO CARGADO", "ESTACIONADO VACIO"];

const v = (x) => (x == null ? "" : x);

/** "2026-10-06" → "06/10/2026" */
export function fechaDDMMYYYY(fecha) {
  const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(fecha || "");
}

/**
 * Una fila por unidad de la base del turno.
 * - Clasificada en Monitoreo → valores guardados (los "-" se conservan, como en el desktop).
 * - Sin clasificar y GPS en ROJO (no reporta) → relleno automático "GPS PERDIDO" como el desktop.
 * - Sin clasificar y reportando → columnas de clasificación vacías.
 */
export function filasReporte(unidades, clasificaciones, fechaTurno) {
  const fecha = fechaDDMMYYYY(fechaTurno);
  return (unidades || []).map((u) => {
    const s = (clasificaciones || {})[u.codigo];
    const clasificada = !!s?.timestamp_clasificacion;
    const rojo = String(u.color_html || "").toUpperCase() === "ROJO";
    let status = "", riesgo = "", aut = "", pernocte = "", lugar = "", cob = "", obs = "";
    if (clasificada) {
      status = v(s.status); riesgo = v(s.riesgo); aut = v(s.punto_autorizado);
      pernocte = v(s.punto_pernocte); lugar = v(s.tipo_lugar); cob = v(s.cobertura_gps); obs = v(s.observaciones);
    } else if (rojo) {
      const ubic = String(u.ruta || "").trim();
      const tp = String(u.t_parada || "").trim();
      status = "-"; riesgo = "●"; aut = "-"; pernocte = "-"; lugar = "-"; cob = "NO";
      const ur = u.ultimo_reporte ? ` · ÚLTIMO REPORTE ${u.ultimo_reporte}` : "";
      obs = (ubic ? `${ubic} - ${tp}` : `GPS PERDIDO - ${tp}`) + ur;
    }
    const ruta = clasificada && s.ruta ? s.ruta : v(u.ruta);
    const ed = (k) => (clasificada && s[k] !== undefined ? v(s[k]) : v(u[k])); // lo corregido a mano manda sobre la OC
    return [
      fecha, v(u.codigo), ed("acoplado"), ed("tipo_acople"), ed("gestor"), ed("piloto"), ed("mercaderia"), ruta,
      status, riesgo, aut, pernocte, lugar, cob,
      u.lat ?? "", u.lng ?? "", obs,
    ];
  });
}

export function resumen(unidades, clasificaciones) {
  let calificadas = 0, revisar = 0, pendientes = 0;
  for (const u of unidades || []) {
    const s = (clasificaciones || {})[u.codigo];
    if (!s?.timestamp_clasificacion) { pendientes++; continue; }
    if (s.observaciones === "NO VA" || s.status === "NO VA") revisar++;
    else calificadas++;
  }
  return { total: (unidades || []).length, calificadas, revisar, pendientes };
}
