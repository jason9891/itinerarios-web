/**
 * MAESTROS FIJOS de ABARROTES (lo que no cambia entre turnos).
 * Salen del Excel «ABARROTES - OCTUBRE 19» (hojas TIEMPOS, TABLA DE TIEMPOS, otros y MONITOREO).
 * Se editan aquí, no en cada carga.
 */
import { ascii } from "./api-client.js";

/** Estados del seguimiento (columna ESTADO del Excel). */
export const ESTADOS = [
  "ESTACIONADO VACÍO", "TRANSITO VACIO", "TRANSITO CARGADO",
  "ESTACIONADO CARGADO", "PROCESO DESCARGUIO", "GPS NO ACTUALIZA",
];

/** Sin puntos nuevos durante tanto tiempo → GPS NO ACTUALIZA (minutos). Provisional. */
export const MIN_GPS_NO_ACTUALIZA = 12 * 60;

/** Una unidad se considera quieta si en los últimos 30 min se movió menos de 150 m. */
export const QUIETO = { ventana_min: 30, radio_m: 150 };

/** Permanencia mínima para confirmar una visita a geocerca (igual que Cemento). */
export const PERMANENCIA_MIN = 20;

/** Geocercas de ORIGEN (nombres normalizados, sin «COPIA»). */
export const ORIGEN_GEOCERCAS = {
  AREQUIPA: ["PLANTA GLORIA AREQUIPA", "RACIEMSA AREQUIPA"],
  HUACHIPA: ["PLANTA HUACHIPA"],
};

/**
 * Destino (palabra clave en el texto del destino de la ruta) → geocercas que lo representan.
 * Los destinos sin geocerca dibujada quedan vacíos: el seguimiento los completa a mano
 * hasta que se dibujen en el editor de geocercas.
 */
export const DESTINO_GEOCERCAS = [
  { clave: /HUACHIPA|LIMA|LURIN|CALLAO|\bATE\b/, geocercas: ["PLANTA HUACHIPA"] },
  { clave: /AREQUIPA|MAJES|CAMANA/, geocercas: ["PLANTA GLORIA AREQUIPA", "RACIEMSA AREQUIPA"] },
  { clave: /YURA/, geocercas: ["PLANTA YURA"] },
  { clave: /MOQUEGUA/, geocercas: ["PLANTA MOQUEGUA"] },
  { clave: /\bILO\b/, geocercas: ["ZONA DE CARGA ILO"] },
];

/** Tiempo promedio de viaje por ruta, en días (hoja TABLA DE TIEMPOS). Tolerancia ±20 %. */
export const TOLERANCIA = 0.2;
export const TIEMPOS_RUTA = {
  "AQP Arequipa a LIB Trujillo": 2.658, "AQP Arequipa a LIM Huachipa": 1.680, "AQP Arequipa a TAC Tacna": 0.498,
  "AQP Arequipa a CUZ Cusco": 1.073, "AQP Arequipa a PIU Piura": 3.822, "AQP Arequipa a LAM Chiclayo": 3.296,
  "AQP Arequipa - Condoroma a CUZ Cuzco": 1.075, "LIM Lima - Tacna": 1.784, "LIM Lima - Majes": 1.153,
  "AQP Arequipa a PUN Juliaca": 0.634, "AQP Arequipa a AYA Ayacucho": 2.009, "LIM Lima - Arequipa": 1.524,
  "LIM Lima - Juliaca": 2.429, "AQP Arequipa a MOQ Ilo": 0.754, "AQP Arequipa-Condoroma a APU Abancay": 2.516,
  "LIM Lima - Yura": 1.449, "AQP Arequipa a AQP Yura": 0.058, "AQP Arequipa a MOQ Moquegua": 0.447,
  "AQP Arequipa a AQP Camana": 0.177, "AQP Arequipa a ICA Ica": 0.979, "CUZ Cuzco - Condoroma a AQP Arequipa": 1.800,
  "CUZ Cuzco a LIM Huachipa": 2.047, "TAC Tacna a AQP Arequipa": 0.688, "PUN Juliaca a AQP Arequipa": 0.585,
  "AQP Arequipa a MDD Madre de Dios": 1.577, "AQP Arequipa a JUN Huancayo": 1.950, "AQP Arequipa a CUZ Anta": 1.761,
  "AQP Arequipa-Condoroma a APU Andahuaylas": 2.131, "LIM Lima - Cusco": 2.058, "PUN Juliaca - CUZ Cuzco": 0.364,
  "TAC Tacna a LIM Huachipa": 2.302, "AQP Arequipa a ANC Chimbote": 1.760, "AQP Arequipa a CAJ Cajamarca": 1.967,
  "AQP Arequipa a AQP Arequipa": 0.017, "AQP Arequipa a TUM Tumbes": 4.755,
};

const claveRuta = (r) => ascii(r).replace(/\s*-\s*/g, " - ");
const TIEMPOS_N = new Map(Object.entries(TIEMPOS_RUTA).map(([k, v]) => [claveRuta(k), v]));

/** Promedio (días) de la ruta o null si no está en la tabla. */
export function tiempoPromedio(ruta) {
  return TIEMPOS_N.get(claveRuta(ruta)) ?? null;
}

/** Texto del destino de una ruta: «LIM Huachipa - ICA Nazca a CUZ Cuzco» → «CUZ Cuzco»; «LIM Lima - Arequipa» → «Arequipa». */
export function destinoDeRuta(ruta) {
  const r = String(ruta || "").trim();
  if (/\sa\s/i.test(r)) return r.split(/\sa\s/i).pop().trim();
  if (r.includes(" - ")) return r.split(" - ").pop().trim();
  return r;
}

/** Geocercas de destino esperadas para una ruta (puede ser []). */
export function geocercasDestino(ruta, nombreDestino = "") {
  const t = ascii(`${destinoDeRuta(ruta)} ${nombreDestino}`);
  const hit = DESTINO_GEOCERCAS.find((d) => d.clave.test(t));
  return hit ? hit.geocercas : [];
}
