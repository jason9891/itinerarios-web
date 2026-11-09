/**
 * Almacén de despachos de QUELLAVECO.
 *
 * Solo vive en ESTA pestaña (sessionStorage + memoria): no se conserva entre sesiones,
 * para no trabajar nunca con un Excel viejo. Hay que subir el Excel SAP en cada turno.
 * Cuando se conecte Supabase, aquí se cambiará por la lectura/escritura en base de datos.
 */
const KEY = "qv_despachos_v1";
let memoria = null;

/**
 * @typedef {{
 *   archivo: string, cargado_en: string,
 *   resumen: { leidas:number, en_alcance:number, descartadas:number, duplicadas:number, tractos:number, filtro_definido:boolean },
 *   despachos: object[], descartes: {entrega:string, motivo:string}[]
 * }} Carga
 */

/** @param {Carga} carga */
export function guardarDespachos(carga) {
  memoria = carga;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(carga));
  } catch {
    /* sin espacio: queda solo en memoria hasta recargar la página */
  }
}

/** @returns {Carga | null} */
export function leerDespachos() {
  if (memoria) return memoria;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) memoria = JSON.parse(raw);
  } catch {
    memoria = null;
  }
  return memoria;
}

export function borrarDespachos() {
  memoria = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
