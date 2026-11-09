/**
 * Análisis GPS de ABARROTES (sin DOM ni red): geocercas, visitas y sugerencias de seguimiento.
 * El algoritmo de visitas es el mismo de Cemento (copiado): una visita se confirma tras 20 min dentro.
 * Todo corre en el navegador sobre los puntos que devuelve el extractor del operador.
 */
import { ascii } from "./api-client.js";
import { ESTADOS, MIN_GPS_NO_ACTUALIZA, QUIETO, PERMANENCIA_MIN, ORIGEN_GEOCERCAS, geocercasDestino, tiempoPromedio, TOLERANCIA } from "./maestros.js";

const LS_KEY = "abarrotes_geocercas_v1";

/** «PLANTA HUACHIPA COPIA» → «PLANTA HUACHIPA» (para comparar nombres). */
export const claveGeocerca = (n) => ascii(n).replace(/\s+COPIA$/, "");

function bboxDe(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const rec = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
    } else c.forEach(rec);
  };
  rec(geom.coordinates || []);
  return [x0, y0, x1, y1];
}

function enAnillo(ring, x, y) {
  let dentro = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function enPoligono(poly, x, y) {
  if (!poly?.length || !enAnillo(poly[0], x, y)) return false;
  for (let k = 1; k < poly.length; k++) if (enAnillo(poly[k], x, y)) return false; // agujero
  return true;
}

/** ¿El punto {lat,lng} está dentro de la geocerca (Polygon o MultiPolygon)? */
export function contiene(f, p) {
  const [x0, y0, x1, y1] = f.bbox;
  if (p.lng < x0 || p.lng > x1 || p.lat < y0 || p.lat > y1) return false;
  const g = f.geometry;
  if (g.type === "Polygon") return enPoligono(g.coordinates, p.lng, p.lat);
  if (g.type === "MultiPolygon") return g.coordinates.some((poly) => enPoligono(poly, p.lng, p.lat));
  return false;
}

/** Normaliza objetos del editor o un GeoJSON FeatureCollection → [{id,name,key,geometry,bbox}]. */
export function normalizarGeocercas(json) {
  const arr = Array.isArray(json) ? json : json?.objetos || json?.geocercas || json?.features || [];
  const out = [];
  for (const o of arr) {
    const geometry = o.geometry;
    const name = o.name || o.nombre || o.properties?.name || o.properties?.nombre;
    if (!name || !geometry || !/Polygon/.test(geometry.type)) continue;
    out.push({ id: o.id || o.properties?.id || name, name: String(name).replace(/\s+COPIA$/i, ""), key: claveGeocerca(name), geometry, bbox: bboxDe(geometry) });
  }
  return out;
}

let semilla = null;
/** Geocercas de la semilla (geocercas.json) + las que el usuario importó (localStorage). */
export async function cargarGeocercas() {
  if (!semilla) {
    try {
      const r = await fetch(new URL("./geocercas.json", import.meta.url));
      semilla = normalizarGeocercas(await r.json());
    } catch {
      semilla = [];
    }
  }
  const propias = leerPropias();
  const keys = new Set(propias.map((f) => f.key));
  return [...propias, ...semilla.filter((f) => !keys.has(f.key))];
}

function leerPropias() {
  try {
    return normalizarGeocercas(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
  } catch {
    return [];
  }
}

/** Guarda geocercas importadas (reemplazan a la semilla si tienen el mismo nombre). Devuelve cuántas. */
export function importarGeocercas(json) {
  const nuevas = normalizarGeocercas(json);
  if (!nuevas.length) throw new Error("El archivo no trae geocercas (polígonos con nombre)");
  const previas = leerPropias();
  const keys = new Set(nuevas.map((f) => f.key));
  const todas = [...nuevas, ...previas.filter((f) => !keys.has(f.key))];
  localStorage.setItem(LS_KEY, JSON.stringify(todas.map(({ id, name, geometry }) => ({ id, name, geometry }))));
  return nuevas.length;
}

export function borrarGeocercasPropias() {
  localStorage.removeItem(LS_KEY);
}

/** Distancia aproximada en metros entre dos puntos. */
export function distM(a, b) {
  const k = 111320, dx = (a.lng - b.lng) * k * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), dy = (a.lat - b.lat) * k;
  return Math.hypot(dx, dy);
}

/**
 * Visitas a geocercas (copia del analizador de Cemento).
 * @param {{t:number,lat:number,lng:number}[]} puntos ordenados por tiempo (t en ms)
 * @param {object[]} fences geocercas normalizadas
 */
export function analizar(puntos, fences) {
  const etiquetas = [];
  let previa = "";
  for (const p of puntos) {
    let name = "";
    if (previa) {
      const f = fences.find((x) => x.key === previa);
      if (f && contiene(f, p)) name = previa;
    }
    if (!name) name = fences.find((x) => contiene(x, p))?.key || "";
    etiquetas.push(name);
    previa = name;
  }
  const bloques = [];
  for (let s = 0; s < etiquetas.length; ) {
    let e = s;
    while (e + 1 < etiquetas.length && etiquetas[e + 1] === etiquetas[s]) e++;
    if (etiquetas[s]) {
      const min = Math.max(0, (puntos[e].t - puntos[s].t) / 60000);
      bloques.push({
        geocerca: fences.find((x) => x.key === etiquetas[s])?.name || etiquetas[s],
        key: etiquetas[s],
        ingreso: puntos[s].t,
        salida: e < puntos.length - 1 ? puntos[e].t : null, // null = sigue dentro
        permanencia_min: Math.round(min * 10) / 10,
        confirmada: min >= PERMANENCIA_MIN,
      });
    }
    s = e + 1;
  }
  return { visitas: bloques.filter((b) => b.confirmada), no_confirmadas: bloques.filter((b) => !b.confirmada), etiqueta_final: etiquetas.at(-1) || "" };
}

/** ¿La unidad está quieta (se movió < QUIETO.radio_m en los últimos QUIETO.ventana_min)? */
export function estaQuieta(puntos) {
  if (puntos.length < 2) return true;
  const fin = puntos.at(-1);
  const ini = puntos.find((p) => fin.t - p.t <= QUIETO.ventana_min * 60000) || fin;
  return distM(ini, fin) < QUIETO.radio_m;
}

/**
 * Sugerencias de seguimiento para un viaje a partir de las visitas.
 * Fases: origen → ida (cargado) → destino (descarga) → retorno (vacío) → de vuelta en origen.
 * @returns {{ salida, llegada, inicio_retorno, fin_retorno, ubicacion, estado, notas:string[],
 *             ida_dias:number|null, exceso:boolean|null, dias_parado:number, origen_ok:boolean, destino_ok:boolean }}
 */
export function sugerir(viaje, analisis, puntos, ahora = Date.now(), ultimoMonitoreo = null) {
  const notas = [];
  const origenKeys = new Set(ORIGEN_GEOCERCAS[viaje.origen] || []);
  const destinoKeys = new Set(geocercasDestino(viaje.ruta, viaje.destino));
  const visitas = [...analisis.visitas].sort((a, b) => a.ingreso - b.ingreso);
  const ultimo = puntos.at(-1) || null;

  const out = { salida: null, llegada: null, inicio_retorno: null, fin_retorno: null, ubicacion: "", estado: "", notas, ida_dias: null, exceso: null, dias_parado: 0, origen_ok: origenKeys.size > 0, destino_ok: destinoKeys.size > 0 };
  if (!destinoKeys.size) notas.push("Sin geocerca de destino para esta ruta: llegada y retorno se completan a mano.");

  const edad = ultimo ? (ahora - ultimo.t) / 60000 : null;
  if (!ultimo && !ultimoMonitoreo) {
    out.estado = "GPS NO ACTUALIZA";
    out.ubicacion = "-";
    notas.push("CLocator no devolvió puntos en el rango consultado.");
    return out;
  }

  // 1) salida del origen: última visita al origen que ya terminó y fue previa a la llegada al destino
  const iDest = visitas.findIndex((v) => destinoKeys.has(v.key));
  const antesDest = iDest >= 0 ? visitas.slice(0, iDest) : visitas;
  const vOrigen = [...antesDest].reverse().find((v) => origenKeys.has(v.key) && v.salida);
  if (vOrigen) out.salida = vOrigen.salida;

  // 2) llegada al destino (primera visita confirmada posterior a la salida)
  const vDest = visitas.find((v) => destinoKeys.has(v.key) && (!out.salida || v.ingreso >= out.salida));
  if (vDest) {
    out.llegada = vDest.ingreso;
    // 3) inicio de retorno: salida de ese destino
    if (vDest.salida) out.inicio_retorno = vDest.salida;
  }
  // 4) fin de retorno: nueva visita al origen posterior al inicio de retorno
  if (out.inicio_retorno) {
    const vVuelta = visitas.find((v) => origenKeys.has(v.key) && v.ingreso >= out.inicio_retorno);
    if (vVuelta) out.fin_retorno = vVuelta.ingreso;
  }

  // Ubicación actual: geocerca (visita en curso) o tránsito
  const enCurso = visitas.at(-1) && !visitas.at(-1).salida && analisis.etiqueta_final === visitas.at(-1).key ? visitas.at(-1) : null;
  const quieta = estaQuieta(puntos);
  if (enCurso) out.ubicacion = enCurso.geocerca;
  else out.ubicacion = `EN RUTA ${viaje.ruta || ""}`.trim();

  // Estado
  if (edad != null && edad > MIN_GPS_NO_ACTUALIZA) {
    out.estado = "GPS NO ACTUALIZA";
    notas.push(`Último punto hace ${Math.round(edad / 60)} h.`);
  } else if (!out.salida && !out.llegada) {
    out.estado = enCurso && origenKeys.has(enCurso.key) ? "ESTACIONADO CARGADO" : quieta ? "ESTACIONADO CARGADO" : "TRANSITO CARGADO";
    if (!enCurso || !origenKeys.has(enCurso.key)) notas.push("No se detectó la salida del origen en el rango consultado: amplía DESDE.");
  } else if (out.salida && !out.llegada) {
    out.estado = enCurso || quieta ? "ESTACIONADO CARGADO" : "TRANSITO CARGADO";
  } else if (out.llegada && !out.inicio_retorno) {
    out.estado = "PROCESO DESCARGUIO";
  } else if (out.inicio_retorno && !out.fin_retorno) {
    out.estado = enCurso || quieta ? "ESTACIONADO VACÍO" : "TRANSITO VACIO";
  } else {
    out.estado = "ESTACIONADO VACÍO";
  }

  // Tiempos
  if (out.salida && out.llegada) {
    out.ida_dias = (out.llegada - out.salida) / 86400000;
    const prom = tiempoPromedio(viaje.ruta);
    out.exceso = prom != null ? out.ida_dias > prom * (1 + TOLERANCIA) : null;
    if (out.exceso) notas.push(`Ida de ${out.ida_dias.toFixed(2)} d sobre el promedio ${prom.toFixed(2)} d (+${TOLERANCIA * 100}%).`);
  }
  const base = out.fin_retorno || out.llegada;
  out.dias_parado = base ? Math.max(0, Math.floor((ahora - base) / 86400000)) : 0;
  if (!ESTADOS.includes(out.estado)) out.estado = "";
  return out;
}
