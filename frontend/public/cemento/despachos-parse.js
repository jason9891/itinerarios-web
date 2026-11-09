/**
 * CEMENTO · seguimiento por DESPACHOS (sin DOM ni red).
 *
 * Fuentes:
 *  · DESPACHOS (CEMENTO_DESPACHOS.XLS): salida REAL de planta. Una fila por entrega; un despacho = un Transporte (una placa).
 *  · OCs (YSDR142_OC): órdenes de carga de SAP. Interesan solo las «TRANSP. PARIHUELAS (V)» no anuladas:
 *    un tracto que RETORNA a Yura cargado de parihuelas vacías.
 *
 * Regla: el despacho que se sigue es el de CEMENTO que sacó ese tracto de Yura hacia el destino de donde ahora retorna
 * (último despacho de la misma placa en los días previos a la OC de retorno). Las parihuelas que salen de Yura NO cuentan:
 * son parte natural de cualquier despacho de cemento.
 */

export const VENTANA_DIAS = 4; // el despacho de ida debe ser de 0–4 días antes de la OC de retorno
const MS_DIA = 86400000;

const ascii = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
export const normPlaca = (s) => ascii(s).replace(/[^A-Z0-9]/g, "");
const txt = (v) => String(v ?? "").trim();
const clave = (h) => ascii(h).replace(/[^A-Z0-9]/g, "");

/** dd.mm.aaaa | dd/mm/aaaa | aaaa-mm-dd | serie Excel | Date → ms UTC (00:00) o null. */
export function aDia(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  if (typeof v === "number") return v > 20000 ? Math.floor(v - 25569) * MS_DIA : null;
  const s = txt(v);
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return +m[3] > 1900 ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

/** hh:mm[:ss] | fracción de día → minutos desde 00:00, o null. */
export function aMinutos(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v < 1 ? Math.round(v * 1440) : null;
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  const m = txt(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

/** «T300-0286335» → «T300-286335». Devuelve null si no parece una guía. */
export function normGuia(g) {
  const m = txt(g).toUpperCase().replace(/\s+/g, "").match(/^([A-Z]\d{3})-?0*(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** «T300-286700/T300-286701» o «T300-287005/287006» → ["T300-286700", …]. */
export function guiasDeTexto(t) {
  const out = [];
  let serie = null;
  for (const p of String(t ?? "").split(/[\/,;\s]+/)) {
    if (!p) continue;
    const g = normGuia(p);
    if (g) { out.push(g); serie = g.split("-")[0]; }
    else if (/^\d+$/.test(p) && serie) out.push(`${serie}-${+p}`);
  }
  return out;
}

/** Busca la fila de cabecera (la que contiene todas las claves) y devuelve {idx, filas}. */
function conCabecera(aoa, requeridas) {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const ks = (aoa[i] || []).map(clave);
    if (requeridas.every((r) => ks.includes(r))) {
      const idx = new Map();
      ks.forEach((k, j) => k && !idx.has(k) && idx.set(k, j));
      return { idx, filas: aoa.slice(i + 1) };
    }
  }
  return null;
}

export const esArchivoDespachos = (aoa) => !!conCabecera(aoa, ["TRANSPORTE", "PLACA", "FECHASALIDA"]);
export const esArchivoOCs = (aoa) => !!conCabecera(aoa, ["ORDCARGA", "MATRICULA", "ESTADO"]);

/** Despachos: líneas → un registro por Transporte. */
export function leerDespachos(aoa) {
  const c = conCabecera(aoa, ["TRANSPORTE", "PLACA", "FECHASALIDA"]);
  if (!c) throw new Error("No parece el archivo de DESPACHOS (faltan Transporte / Placa / Fecha Salida).");
  const g = (f, ...n) => { for (const k of n) { const i = c.idx.get(k); if (i != null && txt(f[i])) return f[i]; } return ""; };
  const por = new Map();
  let lineas = 0;
  for (const f of c.filas) {
    const transporte = txt(g(f, "TRANSPORTE"));
    if (!transporte) continue;
    lineas++;
    const dia = aDia(g(f, "FECHASALIDA"));
    let d = por.get(transporte);
    if (!d) {
      const [tracto = "", carreta = ""] = txt(g(f, "PLACA")).split("/");
      d = {
        transporte, placa: txt(g(f, "PLACA")), tracto: normPlaca(tracto), carreta: normPlaca(carreta),
        cliente: txt(g(f, "CLIENTE")), destino: txt(g(f, "DESTINO")), conductor: txt(g(f, "IDENTIFEXT1")),
        dia, min: aMinutos(g(f, "SALIDA")), guias: [], pedidos: [], productos: [], cemento: false, neto: null,
      };
      por.set(transporte, d);
    }
    const desc = txt(g(f, "DESCRIPCION"));
    const guia = normGuia(g(f, "GUIA"));
    if (guia && !d.guias.includes(guia)) d.guias.push(guia);
    const ped = txt(g(f, "NROPEDIDO"));
    if (ped && !d.pedidos.includes(ped)) d.pedidos.push(ped);
    if (desc && !d.productos.includes(desc)) d.productos.push(desc);
    if (/CEMENTO|CEM\.|CEM /.test(ascii(desc)) && !/PARIHUELA/.test(ascii(desc))) d.cemento = true;
    if (d.neto == null) d.neto = Number(g(f, "NETO")) || null;
  }
  return { despachos: [...por.values()], lineas };
}

/** OCs: todas las filas con número de OC. */
export function leerOCs(aoa) {
  const c = conCabecera(aoa, ["ORDCARGA", "MATRICULA", "ESTADO"]);
  if (!c) throw new Error("No parece el archivo de OCs (faltan Ord Carga / Matrícula / Estado).");
  const g = (f, ...n) => { for (const k of n) { const i = c.idx.get(k); if (i != null && txt(f[i])) return txt(f[i]); } return ""; };
  const ocs = [];
  for (const f of c.filas) {
    const oc = g(f, "ORDCARGA");
    if (!/^\d{5,8}$/.test(oc)) continue;
    ocs.push({
      oc, dia: aDia(g(f, "FECINIREAL")), estado: g(f, "ESTADO"), tracto: normPlaca(g(f, "MATRICULA")),
      carreta: normPlaca(g(f, "PLACAACOP1")), ruta: g(f, "DESCRIPCIONRUTA"), servicio: g(f, "MATERIALDESERVICIO"),
      grr: g(f, "NOGRR"), obs: g(f, "OBSERVACIONES"), piloto: g(f, "NOMBREPILOTO"),
    });
  }
  return ocs;
}

export const esRetornoParihuelas = (o) => /PARIHUELA/.test(ascii(o.servicio)) && !/ANULAD/.test(ascii(o.estado));
export const esOCCemento = (o) => /CEMENTO/.test(ascii(o.servicio)) && !/ANULAD/.test(ascii(o.estado));

const RUIDO = new Set(["CD", "DE", "DEL", "LA", "A", "AQP", "TAC", "CUZ", "PUN", "ICA", "LIM", "MOQ", "YURA", "ZOFRA", "SAC", "SA", "S", "AREQUIPA", "CONDOROMA"]);
const tokens = (s) => new Set(ascii(s).split(/[^A-Z0-9]+/).filter((t) => t.length > 2 && !RUIDO.has(t)));

/** Origen del retorno: «TAC Tacna a AQP Yura» → «TAC Tacna». */
export function origenDeRuta(ruta) {
  return txt(ruta).split(/\s+a\s+AQP\s+Yura/i)[0].replace(/\s+a\s+.*$/i, "");
}

/** ¿El destino del despacho (CD TACNA) es de donde retorna la OC (TAC Tacna)? */
export function destinoCoincide(destinoDespacho, rutaOC) {
  const a = tokens(destinoDespacho), b = tokens(origenDeRuta(rutaOC));
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * Arma la lista a seguir.
 * @returns {{ seguir: object[], sinDespacho: object[], retornos: number, ocsCemento: number }}
 */
export function consolidar(despachos, ocs, { ventana = VENTANA_DIAS } = {}) {
  const porTracto = new Map();
  for (const d of despachos) {
    if (!d.tracto) continue;
    if (!porTracto.has(d.tracto)) porTracto.set(d.tracto, []);
    porTracto.get(d.tracto).push(d);
  }
  const porGuia = new Map();
  for (const d of despachos) for (const g of d.guias) { if (!porGuia.has(g)) porGuia.set(g, []); porGuia.get(g).push(d); }

  const retornos = ocs.filter(esRetornoParihuelas).sort((a, b) => (a.dia ?? 0) - (b.dia ?? 0));
  const elegido = new Map(); // transporte → fila
  const sinDespacho = [];

  for (const r of retornos) {
    const cand = (porTracto.get(r.tracto) || []).filter((d) => d.dia != null && r.dia != null && r.dia - d.dia >= 0 && r.dia - d.dia <= ventana * MS_DIA);
    if (!cand.length) { sinDespacho.push(r); continue; }
    const puntaje = (d) => (d.cemento ? 4 : 0) + (destinoCoincide(d.destino, r.ruta) ? 2 : 0);
    cand.sort((a, b) => puntaje(b) - puntaje(a) || (b.dia - a.dia) || ((b.min ?? 0) - (a.min ?? 0)));
    const mejor = cand[0];
    const empatados = cand.filter((d) => puntaje(d) === puntaje(mejor)).length;
    const avisos = [];
    if (!mejor.cemento) avisos.push("El despacho no tiene cemento");
    if (!destinoCoincide(mejor.destino, r.ruta)) avisos.push(`Destino ${mejor.destino} no coincide con el origen del retorno (${origenDeRuta(r.ruta)})`);
    if (empatados > 1) avisos.push(`${empatados} despachos posibles de esta placa: revisar`);
    const fila = { despacho: mejor, retorno: r, avisos, confianza: avisos.length ? "REVISAR" : "ALTA", alternativas: cand.filter((d) => d !== mejor).map((d) => d.transporte) };
    const previo = elegido.get(mejor.transporte);
    if (!previo || (r.dia ?? 0) >= (previo.retorno.dia ?? 0)) elegido.set(mejor.transporte, fila);
  }

  // OC de cemento de ida enlazada por guía (dato informativo; no decide nada)
  const ocCemento = ocs.filter(esOCCemento);
  for (const f of elegido.values()) {
    const hit = ocCemento.find((o) => guiasDeTexto(o.grr).some((g) => f.despacho.guias.includes(g)));
    f.oc_ida = hit ? hit.oc : null;
  }

  const seguir = [...elegido.values()].sort((a, b) => (b.despacho.dia ?? 0) - (a.despacho.dia ?? 0) || (b.despacho.min ?? 0) - (a.despacho.min ?? 0));
  return { seguir, sinDespacho, retornos: retornos.length, ocsCemento: ocCemento.length };
}

/** Texto tabulado (el «.xls» de OCs de SAP es texto con tabuladores, cp1252) → matriz de filas. */
export function aoaDeTexto(texto) {
  return String(texto ?? "").split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split("\t").map((x) => x.trim()));
}

/** ArrayBuffer → { aoa } leyendo texto tabulado (cp1252) o, si es Excel binario/xlsx, devuelve null para usar SheetJS. */
export function esExcelBinario(buf) {
  const b = new Uint8Array(buf.slice(0, 4));
  return (b[0] === 0xd0 && b[1] === 0xcf) || (b[0] === 0x50 && b[1] === 0x4b);
}
export const decodificarTexto = (buf) => new TextDecoder("windows-1252").decode(buf);
