/**
 * Consolidado de ABARROTES (sin DOM ni red).
 * Lee los DOS Excel que hoy se cruzan a mano y arma la lista única de viajes a seguir:
 *  · SAP (PROCESADOR_ABARROTES_AQP-LIM-SAP): una fila por orden de carga, origen Arequipa y Huachipa.
 *  · Programación TD Lima (hoja SATELITAL LIMA): unidades programadas desde Huachipa; solo MONITOREO.
 * Llave de cruce: placa del tracto normalizada (sin guion ni espacios).
 */
import { ascii, normPlaca } from "./api-client.js";

const clave = (h) => ascii(h).toLowerCase().replace(/[^a-z0-9]/g, "");
const texto = (v) => String(v ?? "").trim();
const vacio = (v) => !texto(v) || /^(-|\(en blanco\))$/i.test(texto(v));

/** Índice por nombre de columna normalizado (la primera aparición gana, p. ej. ORIGEN está dos veces en TD). */
function indice(cabecera) {
  const m = new Map();
  cabecera.forEach((h, i) => {
    const k = clave(h);
    if (k && !m.has(k)) m.set(k, i);
  });
  return m;
}

function col(idx, fila, ...nombres) {
  for (const n of nombres) {
    const i = idx.get(n);
    if (i != null && !vacio(fila[i])) return fila[i];
  }
  return "";
}

/** Date | serie Excel | texto (aaaa-mm-dd, dd/mm/aaaa[ hh:mm]) → Date o null. */
export function aFecha(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000));
  const s = texto(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[3].padStart(4, "20"), +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)));
  return null;
}

const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");

/** Busca la fila de cabecera (la que contiene todas las marcas) entre las primeras filas. */
export function hallarCabecera(aoa, marcas) {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const ks = new Set((aoa[i] || []).map(clave));
    if (marcas.every((m) => ks.has(m))) return i;
  }
  return -1;
}

/** ¿La hoja (matriz de filas) es el volcado SAP de órdenes de carga? */
export const esHojaSAP = (aoa) => hallarCabecera(aoa, ["ordcarga", "matricula"]) >= 0;
/** ¿La hoja es la programación TD de Lima? */
export const esHojaTD = (aoa) => hallarCabecera(aoa, ["placatracto", "destinoprogramacion"]) >= 0 || hallarCabecera(aoa, ["placatracto", "descrut"]) >= 0;

/**
 * Filas SAP → viajes. Excluye CONCLUIDO y, si diasMax>0, las creadas hace más de diasMax días.
 * @param {any[][]} aoa hoja completa como matriz
 */
export function leerSAP(aoa, { diasMax = 0, hoy = new Date() } = {}) {
  const h = hallarCabecera(aoa, ["ordcarga", "matricula"]);
  if (h < 0) throw new Error("No parece el Excel SAP de órdenes de carga (faltan «Ord Carga» y «Matrícula»)");
  const idx = indice(aoa[h]);
  const porOC = new Map();
  const descartes = [];
  let leidas = 0;
  for (const f of aoa.slice(h + 1)) {
    const oc = texto(col(idx, f, "ordcarga")).replace(/\.0+$/, "");
    if (!oc) continue;
    leidas++;
    const estado = texto(col(idx, f, "estado"));
    if (/CONCLUIDO/i.test(estado)) { descartes.push({ id: `OC:${oc}`, motivo: "OC CONCLUIDA" }); continue; }
    const tracto = normPlaca(col(idx, f, "matricula"));
    if (!tracto) { descartes.push({ id: `OC:${oc}`, motivo: "SIN PLACA DE TRACTO" }); continue; }
    const creado = aFecha(col(idx, f, "creadoel")) || aFecha(col(idx, f, "feciniree", "fecinireal", "fechacarga"));
    if (diasMax > 0 && creado && (hoy - creado) / 86400000 > diasMax) { descartes.push({ id: `OC:${oc}`, motivo: `CREADA HACE MÁS DE ${diasMax} DÍAS` }); continue; }
    const ruta = texto(col(idx, f, "descripcionruta"));
    const ce = texto(col(idx, f, "ce", "centro"));
    // El origen sale del texto de la ruta (AQP… / LIM…). Rutas que parten de otro punto (CUZ, TAC, PUN…) quedan en OTRO.
    const origen = /^AQP/i.test(ruta) ? "AREQUIPA" : /^LIM/i.test(ruta) ? "HUACHIPA" : "OTRO";
    porOC.set(oc, {
      id: `OC:${oc}`, fuente: "SAP", origen, punto_despacho: ce === "201" ? "AREQUIPA" : "HUACHIPA", oc, dt: "",
      equipo: texto(col(idx, f, "equipo")), tracto, carreta: normPlaca(col(idx, f, "placaacop1")),
      piloto: texto(col(idx, f, "nombrepiloto")), telefono: texto(col(idx, f, "telefono")),
      ruta, destino: texto(col(idx, f, "nombredestino")),
      cliente: texto(col(idx, f, "nombredecliente")),
      carga: texto(col(idx, f, "materialdeservicio")), presentacion: texto(col(idx, f, "tipopresentacion")),
      fecha: iso(creado), fecha_carga: iso(aFecha(col(idx, f, "feciniree", "fecinireal", "fechacarga"))),
      salida_prog: "", estado_sap: estado,
    });
  }
  return { viajes: [...porOC.values()], descartes, leidas };
}

/**
 * Filas de la programación TD → viajes. Si hay columna MONITOREO solo entran las «MONITOREO»
 * (las «FIN DE RUTA» ya terminaron).
 */
export function leerTD(aoa) {
  let h = hallarCabecera(aoa, ["placatracto", "destinoprogramacion"]);
  if (h < 0) h = hallarCabecera(aoa, ["placatracto", "descrut"]);
  if (h < 0) throw new Error("No parece la programación TD de Lima (falta «PLACA TRACTO»)");
  const idx = indice(aoa[h]);
  const tieneMon = idx.has("monitoreo");
  const viajes = [];
  const descartes = [];
  let leidas = 0;
  for (const f of aoa.slice(h + 1)) {
    const tracto = normPlaca(col(idx, f, "placatracto"));
    if (!tracto) continue;
    leidas++;
    if (tieneMon && !/^MONITOREO$/i.test(texto(col(idx, f, "monitoreo")))) { descartes.push({ id: tracto, motivo: "FIN DE RUTA" }); continue; }
    const origen = ascii(col(idx, f, "origen"));
    const destProg = texto(col(idx, f, "destinoprogramacion", "destinoreal"));
    const nombreOrigen = texto(col(idx, f, "origen"));
    const ruta = texto(col(idx, f, "descrut")) || `${origen === "HUACHIPA" ? "LIM Lima" : nombreOrigen} - ${destProg}`;
    const prog = aFecha(col(idx, f, "fechadeprogramacion"));
    const salida = aFecha(col(idx, f, "iniciofechayhorasalida"));
    const dt = texto(col(idx, f, "numerodt")).replace(/\.0+$/, "");
    viajes.push({
      id: dt ? `DT:${dt}` : `TD:${iso(prog)}:${tracto}`, fuente: "TD",
      origen: origen === "AREQUIPA" || origen === "HUACHIPA" ? origen : "OTRO", oc: "", dt,
      equipo: texto(col(idx, f, "codigotracto")), tracto, carreta: normPlaca(texto(col(idx, f, "placacarreta")).split(/[\s,]+/)[0]),
      piloto: texto(col(idx, f, "piloto")), telefono: texto(col(idx, f, "telefono")),
      ruta, destino: destProg, cliente: texto(col(idx, f, "cliente")),
      carga: texto(col(idx, f, "mercaderia")), presentacion: texto(col(idx, f, "tipodeunidad")),
      fecha: iso(prog), fecha_carga: iso(prog), salida_prog: salida ? salida.toISOString() : "", estado_sap: "",
    });
  }
  return { viajes, descartes, leidas };
}

/**
 * Une SAP y TD. Una unidad programada en TD que ya tiene OC de Huachipa en SAP (mismo tracto) se fusiona
 * en esa OC (aporta DT, salida programada, carga y piloto); si no tiene OC queda como viaje propio
 * («OC PENDIENTE»). Los id repetidos se quedan con el último.
 */
export function consolidar(sap = [], td = []) {
  const por = new Map(sap.map((v) => [v.id, v]));
  const sapLimaPorTracto = new Map();
  for (const v of sap) if (v.origen === "HUACHIPA") sapLimaPorTracto.set(v.tracto, v);
  let fusionados = 0;
  for (const t of td) {
    const o = sapLimaPorTracto.get(t.tracto);
    if (o) {
      o.fuente = "SAP+TD";
      o.dt = o.dt || t.dt;
      o.salida_prog = o.salida_prog || t.salida_prog;
      o.piloto = o.piloto || t.piloto;
      o.telefono = o.telefono || t.telefono;
      o.carga = o.carga || t.carga;
      fusionados++;
    } else {
      por.set(t.id, t);
    }
  }
  const viajes = [...por.values()].sort((a, b) => (a.origen + a.tracto).localeCompare(b.origen + b.tracto));
  return { viajes, fusionados };
}

/** Resumen de seguimiento: cuántos viajes ya se revisaron, tienen GPS consultado o no tienen nada. */
export function contadores(viajes, seg) {
  const c = { total: viajes.length, revisadas: 0, sin_seguimiento: 0, con_sugerencia: 0, sin_gps: 0, aqp: 0, lim: 0, otro: 0, tractos: new Set() };
  for (const v of viajes) {
    c.tractos.add(v.tracto);
    if (v.origen === "AREQUIPA") c.aqp++; else if (v.origen === "HUACHIPA") c.lim++; else c.otro++;
    const s = seg[v.id];
    if (s?.revisada) { c.revisadas++; continue; }
    c.sin_seguimiento++;
    if (s?.gps) c.con_sugerencia++; else c.sin_gps++;
  }
  c.tractos = c.tractos.size;
  return c;
}
