/**
 * Tiempo de TURNO AMANECIDA en hora de Lima (UTC-5, sin horario de verano).
 *
 * Todo el turno se calcula en hora de Lima, no en la zona del navegador ni en UTC.
 * Esto evita el error de "fecha del turno = mañana" que ocurría entre las 19:00 y
 * las 23:59 al convertir con toISOString() (UTC).
 */
export const LIMA_UTC_OFFSET_H = 5;

/** Milisegundos UTC de una hora de pared de Lima. */
export function limaMs(y, m, d, h = 0, mi = 0, s = 0) {
  return Date.UTC(y, m - 1, d, h + LIMA_UTC_OFFSET_H, mi, s);
}

const pad = (n) => String(n).padStart(2, "0");

/** Componentes de pared de Lima para un instante. */
export function limaParts(ms = Date.now()) {
  const d = new Date(ms - LIMA_UTC_OFFSET_H * 3600 * 1000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

/** "dd/MM/yyyy HH:mm:ss" en hora de Lima. */
export function formatLima(ms) {
  const p = limaParts(ms);
  return `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/**
 * Fecha del turno (YYYY-MM-DD, Lima). Antes de las 12:00 el turno es el del
 * día calendario anterior (la madrugada pertenece a la noche que empezó ayer).
 */
export function fechaTurnoLima(ms = Date.now()) {
  const p = limaParts(ms);
  let base = Date.UTC(p.y, p.m - 1, p.d);
  if (p.h < 12) base -= 86400 * 1000;
  const d = new Date(base);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Ventana del turno de una fecha YYYY-MM-DD (hora de Lima). */
export function ventanaTurno(fecha) {
  const [y, m, d] = String(fecha || fechaTurnoLima()).slice(0, 10).split("-").map(Number);
  return {
    inicio: limaMs(y, m, d, 16, 0, 0), // 16:00 del día del turno
    corte22: limaMs(y, m, d, 22, 0, 0),
    corte23: limaMs(y, m, d, 23, 0, 0),
    fin: limaMs(y, m, d + 1, 4, 0, 0), // 04:00 del día siguiente
  };
}

/**
 * Fecha de un punto GPS → ms UTC (o null).
 * Comsatel entrega "dd/MM/yyyy HH:mm:ss" en hora de Lima.
 */
export function parsePuntoMs(p) {
  const raw = p?.fecha || p?.fechaFinToString || p?.fechaInicioToString || p?.time || "";
  if (!raw) return null;
  const m = String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return limaMs(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** "dd/MM/yyyy HH:mm[:ss]" (Lima) → ms UTC (o null). */
export function parseLimaStr(str) {
  const m = String(str || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return limaMs(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
}
