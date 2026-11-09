/**
 * ALARMAS DE PRUEBA — lógica pura (sin DOM, sin red). Independiente de todo itinerario.
 * Registra cada alarma pendiente que CLocator muestra y mide si la captura es confiable.
 */
export const norm = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_ALARMAS = 3000;
const MAX_CONSULTAS = 1000;

export const vacio = () => ({ alarmas: {}, consultas: [], muestras: [] });

const MAX_MUESTRAS = 25;

/** Huella de lo que devolvió CLocator: cambia cuando entra/sale una alarma o cambia el contador. */
export const firmaDe = (res) => {
  const d = res?.diag || {}, g = d.dbg || {};
  return [res?.fuente || "", (res?.alarmas || []).length, g.burbuja ?? "", g.tabla_encontrada ? 1 : 0, (g.ids || []).length, d.ajax_args || "", (d.ajax_xml || "").length].join("|");
};

/**
 * Guarda la respuesta cruda de diagnóstico solo cuando la huella cambia (así no se llena el navegador).
 * @returns {boolean} true si guardó una muestra nueva
 */
export function guardarMuestra(reg, res, ahora) {
  if (!res?.diag?.dbg) return false;
  reg.muestras ||= [];
  const firma = firmaDe(res), ult = reg.muestras[reg.muestras.length - 1];
  if (ult && ult.firma === firma) return false;
  reg.muestras.push({ t: ahora, firma, fuente: res.fuente || "", total: (res.alarmas || []).length, alarmas: (res.alarmas || []).slice(0, 10), diag: res.diag });
  if (reg.muestras.length > MAX_MUESTRAS) reg.muestras.splice(0, reg.muestras.length - MAX_MUESTRAS);
  return true;
}

/** Clave estable de una alarma: el ID del evento de CLocator (o placa+descripción si no viene). */
export const claveDe = (a) => String(a.eventoId || "").trim() || `${norm(a.placa)}|${norm(a.descripcion)}`;

/** ¿El resultado permite afirmar "ya no está pendiente"? (si la lectura fue dudosa, no se marcan desapariciones) */
export const lecturaSegura = (r) =>
  !!r && r.ok !== false && (r.fuente === "html" ? !!r.diag?.tabla_en_html : r.fuente === "ajax" || ((r.fuente === "sesion" || r.fuente === "sesion-nueva") && !!r.diag?.ajax_valido && !r.diag?.rpc_error && !(r.alarmas || []).some((a) => a.via === "contador")));

/**
 * Aplica una consulta al registro (muta y devuelve {nuevas, desaparecidas}).
 * @param {object} reg {alarmas:{clave:rec}, consultas:[]}
 * @param {object} res respuesta del Worker {fuente,total,alarmas:[{placa,descripcion,eventoId,vehiculoId,historicaId}],diag}
 * @param {number} ahora ms epoch
 */
export function aplicarConsulta(reg, res, ahora) {
  const nuevas = [], desaparecidas = [];
  const segura = lecturaSegura(res);
  const vistas = new Set();
  for (const a of res.alarmas || []) {
    const k = claveDe(a);
    vistas.add(k);
    const r = reg.alarmas[k];
    if (r) {
      r.veces++; r.ultima = ahora; r.activa = true; r.desaparecio = null;
    } else {
      const n = { k, placa: a.placa, descripcion: a.descripcion, eventoId: a.eventoId || "", vehiculoId: a.vehiculoId || "",
        historicaId: a.historicaId || "", fechaEvento: a.fecha || null, codigoExt: a.codigo || "", primera: ahora, ultima: ahora, veces: 1, activa: true, desaparecio: null };
      reg.alarmas[k] = n; nuevas.push(n);
    }
  }
  if (segura) {
    for (const r of Object.values(reg.alarmas)) {
      if (r.activa && !vistas.has(r.k)) { r.activa = false; r.desaparecio = ahora; desaparecidas.push(r); }
    }
  }
  reg.consultas.push({ t: ahora, ok: true, fuente: res.fuente || "", total: (res.alarmas || []).length, segura, ms: res.diag?.ms_total ?? null, cnt: res.diag?.count_alarmas ?? null, nueva: !!res.sesion_nueva, desde: res.sesion_desde ?? null, cuenta: res.diag?.cuenta_worker ?? null, redir: res.diag?.sesion_caducada ?? null });
  recortar(reg);
  return { nuevas, desaparecidas };
}

export function registrarFallo(reg, error, ahora) {
  reg.consultas.push({ t: ahora, ok: false, error: String(error || "error").slice(0, 160) });
  recortar(reg);
}

function recortar(reg) {
  if (reg.consultas.length > MAX_CONSULTAS) reg.consultas.splice(0, reg.consultas.length - MAX_CONSULTAS);
  const ks = Object.keys(reg.alarmas);
  if (ks.length > MAX_ALARMAS) {
    ks.sort((a, b) => reg.alarmas[a].ultima - reg.alarmas[b].ultima);
    for (const k of ks.slice(0, ks.length - MAX_ALARMAS)) delete reg.alarmas[k];
  }
}

/** Indicadores de confiabilidad de la captura. */
export function resumen(reg, desdeMs = 0) {
  const cs = reg.consultas.filter((c) => c.t >= desdeMs);
  const ok = cs.filter((c) => c.ok);
  const fallos = cs.length - ok.length;
  const dudosas = ok.filter((c) => !c.segura).length;
  let huecoMax = 0;
  for (let i = 1; i < ok.length; i++) huecoMax = Math.max(huecoMax, ok[i].t - ok[i - 1].t);
  const al = Object.values(reg.alarmas).filter((a) => a.primera >= desdeMs);
  return {
    consultas: cs.length, ok: ok.length, fallos, dudosas,
    pctOk: cs.length ? Math.round((100 * ok.length) / cs.length) : 0,
    huecoMaxMin: Math.round(huecoMax / 60000),
    capturadas: al.length,
    activas: Object.values(reg.alarmas).filter((a) => a.activa).length,
    efimeras: al.filter((a) => !a.activa && a.veces === 1).length, // vistas una sola vez: las que más fácil se pierden
  };
}

const pad = (n) => String(n).padStart(2, "0");
export function horaLima(ms) {
  if (!ms) return "";
  const d = new Date(ms - 5 * 3600000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Texto tabulado (Excel/Sheets) para comparar contra el historial de Comsatel. */
export function aTSV(recs, codigos = new Map()) {
  const cab = ["Hora del evento (Lima)", "Primera captura (Lima)", "Demora (min)", "Placa", "Código", "Descripción", "Veces vista", "Última vez", "Estado", "ID evento"];
  const filas = recs.map((r) => [r.fechaEvento ? horaLima(r.fechaEvento) : "", horaLima(r.primera), r.fechaEvento ? Math.round((r.primera - r.fechaEvento) / 600) / 100 : "", r.placa, codigos.get(norm(r.placa)) || r.codigoExt || "", r.descripcion, r.veces, horaLima(r.ultima),
    r.activa ? "ACTIVA" : `DESAPARECIÓ ${horaLima(r.desaparecio)}`, r.eventoId]);
  return [cab, ...filas].map((f) => f.join("\t")).join("\n");
}
