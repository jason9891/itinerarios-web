/**
 * CEMENTO · Seguimiento
 * Lista vertical de unidades + formulario OC con inputs siempre visibles (inline styles)
 */
import { esc, trackApi, montadosApi } from "../api-client.js";
import { API } from "../registry.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getStatus,
  nplate,
  formatPE,
} from "../precarga-engine.js";
import { readGPS, cacheGPS, gpsKey } from "../gps-cache.js";
import { queryClocator } from "../../shared/clocator-client.js";
import { ensureTrackingMap, drawTrackingRoute, toggleInspection, resetMapState } from "../map-draw.js";

let cleanup = [];
let state = null;
let trackingSplit = { mapa: 28, grilla: 57, gps: 15 };

const STATES = [
  "",
  "ESTACIONADO CARGADO",
  "ESTACIONADO VACÍO",
  "TRANSITO CARGADO",
  "TRANSITO VACÍO",
];

function field(p, k) {
  const s = String(p?.[k] ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : s;
}

function isParihuelas(payload) {
  const carga = String(payload?.CARGA || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return carga.includes("PARIHUELA");
}

/** OC reabierta / reasignada desde SAP → validar geocercas y datos. */
function isReabierta(oc) {
  if (!oc) return false;
  if (oc.reabierta === true) return true;
  const obs = String(oc.observacion_migracion || oc.payload?.observacion_migracion || "").toUpperCase();
  return /REASIGNAD|REABIERT|VALIDAR/.test(obs);
}

function ocCreationDate(payload) {
  for (const key of ["Fecha de Orden", "Fecha Carga Real", "FecIniReal", "Creado el"]) {
    const v = field(payload, key);
    if (v) return v.split(" ")[0];
  }
  return "SIN FECHA";
}

function stateOptions(current) {
  const list = [...STATES];
  if (current && !list.includes(current)) list.push(current);
  return list
    .map((x) => `<option value="${esc(x)}" ${x === current ? "selected" : ""}>${esc(x || "-")}</option>`)
    .join("");
}

function shortTracto(v) {
  return String(v || "—").replace(/^20-/i, "");
}

/** Muestra en inputs: dd/mm/aa HH:mm:ss (24h, sin AM/PM). */
function peToInput(pe) {
  const s = String(pe || "").trim();
  // Ya viene dd/mm/aa o dd/mm/aaaa
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const yy = m[3].length === 4 ? m[3].slice(-2) : m[3].padStart(2, "0");
    const hh = String(m[4]).padStart(2, "0");
    const mm = m[5];
    const ss = (m[6] || "00").padStart(2, "0");
    return `${m[1]}/${m[2]}/${yy} ${hh}:${mm}:${ss}`;
  }
  // ISO / datetime-local residual
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1].slice(-2)} ${m[4]}:${m[5]}:${(m[6] || "00")}`;
  }
  return s;
}

/** Interpreta input dd/mm/aa HH:mm:ss → PE dd/mm/aaaa HH:mm:ss para CLocator. */
function inputToPE(v) {
  const s = String(v || "").trim();
  // dd/mm/aa[aa] HH:mm[:ss]
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = Number(yyyy) >= 70 ? `19${yyyy}` : `20${yyyy}`;
    const hh = String(m[4]).padStart(2, "0");
    const mi = m[5];
    const ss = (m[6] || "00").padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
  }
  // datetime-local residual
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}`;
  }
  return "";
}

/** Mapa API key → columna payload (igual que backend MAP). */
const OC_FIELD_COLS = {
  estado_fisico: "ESTADO",
  salida_planta: "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  llegada_destino: "FECHA LLEGADA A DESTINO",
  carga_retorno: "CARGA DE RETORNO",
  observaciones: "OBSERVACIONES",
  inicio_retorno: "FECHA INICIO DE RETORNO",
  fin_de_ciclo: "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  ubicacion: "UBICACIÓN",
};

function collectOcData(row) {
  const id = row.dataset.ocId;
  const map = {
    estado_fisico: "estado",
    salida_planta: "salida",
    llegada_destino: "llegada",
    carga_retorno: "carga",
    observaciones: "obs",
    inicio_retorno: "retorno",
    fin_de_ciclo: "fin",
    ubicacion: "ubi",
  };
  const out = {};
  for (const [apiKey, suffix] of Object.entries(map)) {
    const el = row.querySelector(`[data-f="${id}-${suffix}"]`);
    if (!el) continue;
    const before = String(el.dataset.original ?? "").trim();
    const now = String(el.value ?? "").trim();
    // Solo campos con data nueva (no enviar vacíos sin cambio)
    if (now === before) continue;
    if (!now && !before) continue;
    out[apiKey] = now || null;
  }
  return out;
}

function applyDatosToOcPayload(oc, datos) {
  if (!oc || !datos) return;
  if (!oc.payload) oc.payload = {};
  for (const [apiKey, val] of Object.entries(datos)) {
    const col = OC_FIELD_COLS[apiKey];
    if (!col) continue;
    oc.payload[col] = val;
  }
}

function peDateKey(s) {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  const m2 = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}${m2[2]}${m2[3]}`;
  return "";
}

/** Variantes de clave para emparejar R-231 / 20-R-231 / R231 */
function plateKeyVariants(v) {
  const raw = String(v || "").trim();
  if (!raw) return [];
  const u = raw.toUpperCase();
  const noSpace = u.replace(/\s+/g, "");
  const short = noSpace.replace(/^20-/, "");
  const compact = noSpace.replace(/-/g, "");
  const shortCompact = short.replace(/-/g, "");
  return [...new Set([raw, u, noSpace, short, compact, shortCompact])];
}

/** Rango de fechas del seguimiento (meta o inputs DESDE/HASTA del mapa). */
function seguimientoRangeKeys() {
  const meta = loadMeta() || {};
  const fromInput = document.querySelector("#route-from")?.value || "";
  const toInput = document.querySelector("#route-to")?.value || "";
  let d0 = peDateKey(meta.desde || localStorage.getItem("cemento_rango_desde") || "") || peDateKey(inputToPE(fromInput));
  let d1 = peDateKey(meta.hasta || "") || peDateKey(inputToPE(toInput)) || peDateKey(formatPE(new Date()));
  if (!d1) d1 = peDateKey(formatPE(new Date()));
  if (!d0) d0 = d1;
  if (d0 > d1) {
    const tmp = d0;
    d0 = d1;
    d1 = tmp;
  }
  return { d0, d1 };
}

function montadosFor(unit) {
  if (!state?.montadosMap) return [];
  const keys = plateKeyVariants(unit?.tracto).concat(plateKeyVariants(unit?.placa));
  const seen = new Set();
  const out = [];
  const { d0, d1 } = seguimientoRangeKeys();
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const fk = peDateKey(r.fecha);
      if (!fk || fk < d0 || fk > d1) continue;
      out.push(r);
    }
  }
  return out;
}

/** Pestañas montados (navegador) ancladas a la derecha, misma línea que la R. */
function montadosTabHtml(unit) {
  const rows = montadosFor(unit);
  if (!rows.length) return "";
  const tabs = rows
    .map((r) => {
      const label = r.tipo === "MONTADO EN" ? "MONTADO EN" : "MONTANDO";
      const rel = shortTracto(r.relacionado);
      return `<div title="${esc(r.tipo)} ${esc(r.fecha || "")} ${esc(r.ruta || "")}"
        style="display:flex;align-items:stretch;height:30px;border:2px solid #64748b;border-bottom:0;border-radius:9px 9px 0 0;overflow:hidden;background:#eef2ff;flex:0 0 auto">
        <span style="display:flex;align-items:center;padding:0 8px;font-size:10px;font-weight:900;color:#3730a3;background:#e0e7ff;border-right:1px solid #a5b4fc;white-space:nowrap">${esc(label)}</span>
        <span style="display:flex;align-items:center;padding:0 10px;font-size:13px;font-weight:900;color:#0f172a;white-space:nowrap">${esc(rel)}</span>
      </div>`;
    })
    .join("");
  return `<div style="margin-left:auto;display:flex;align-items:flex-end;gap:6px;min-width:0;overflow-x:auto;max-width:min(520px,60vw);padding-left:8px">${tabs}</div>`;
}


function fieldCell(id, suffix, label, value, original, withPaste) {
  const pasteBtn = withPaste
    ? `<button type="button" data-paste="${id}-${suffix}" title="Pegar" style="flex:0 0 28px;width:28px;height:28px;border:1px solid #cbd5e1;border-radius:4px;background:#f1f5f9;cursor:pointer;font-size:12px;padding:0">📋</button>`
    : "";
  return `<div style="min-width:0;padding:6px 8px;box-sizing:border-box">
  <div style="font-size:11px;font-weight:900;color:#142f4b;margin:0 0 3px 0;letter-spacing:.02em">${label}</div>
  <div style="display:flex;gap:4px;align-items:center">
    <input type="text" data-f="${id}-${suffix}" data-original="${esc(original)}" value="${esc(value)}" autocomplete="off"
      style="flex:1 1 auto;min-width:0;width:100%;height:34px;box-sizing:border-box;padding:5px 8px;border:1px solid #7a93ad;border-radius:4px;background:#fff;color:#132f4c;font-size:14px;font-weight:700">
    ${pasteBtn}
  </div>
</div>`;
}

function ocRowHtml(oc, unitIndex, ocIndex, totalOcs, unit) {
  const p = oc.payload || {};
  const o = oc.original_payload || p;
  const id = oc.id;
  const parihuelas = isParihuelas(p);
  const reabierta = isReabierta(oc);
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";
  const reviewed = state.reviewed.has(nplate(unit.placa));
  const estado = field(p, "ESTADO") || p.ESTADO || "";
  // Prioridad: reabierta (rojo sutil) > parihuelas (ámbar) > normal
  const bg = reabierta ? "#fef2f2" : parihuelas ? "#fffbeb" : "#fff";
  const borderCol = reabierta ? "#f87171" : parihuelas ? "#d97706" : "#829bb6";
  const isFirst = ocIndex === 0;
  const isLast = ocIndex === totalOcs - 1;
  const radius = totalOcs === 1
    ? "10px"
    : isFirst
      ? "10px 10px 0 0"
      : isLast
        ? "0 0 10px 10px"
        : "0";
  const borderTop = isFirst ? `2px solid ${borderCol}` : "0";

  // Pestaña tipo navegador + montados del rango a la derecha (solo 1ª OC)
  const tab = isFirst
    ? `<div style="position:relative;height:0;z-index:5">
        <div style="position:absolute;left:8px;right:4px;top:-30px;height:30px;display:flex;align-items:flex-end;justify-content:space-between;gap:8px;min-width:0">
          <div style="display:flex;align-items:stretch;border:2px solid #385978;border-bottom:0;border-radius:9px 9px 0 0;overflow:hidden;background:#f5f9fd;flex:0 0 auto">
            <span style="display:flex;align-items:center;justify-content:center;min-width:32px;padding:0 8px;font-size:13px;font-weight:900;color:#173e70;background:#e8f0fa;border-right:1px solid #9fb4cb">${unitIndex}</span>
            <button type="button" data-map="${esc(nplate(unit.placa))}" title="Ver en mapa"
              style="display:flex;align-items:center;padding:0 12px;font-size:15px;font-weight:900;color:#0f172a;white-space:nowrap;border:0;background:transparent;cursor:pointer">${esc(shortTracto(unit.tracto || unit.placa))}</button>
            <button type="button" data-review="${esc(unit.placa)}" title="Marcar revisada"
              style="display:flex;align-items:center;justify-content:center;min-width:34px;border:0;border-left:1px solid #9fb4cb;background:${reviewed ? "#16a34a" : "#fff"};color:${reviewed ? "#fff" : "#16a34a"};font-size:16px;font-weight:900;cursor:pointer;padding:0 10px">✓</button>
          </div>
          ${montadosTabHtml(unit)}
        </div>
      </div>`
    : "";

  return `
  <div style="margin:${isFirst ? "34px" : "0"} 0 ${isLast ? "12px" : "0"} 0;position:relative">
    ${tab}
    <article data-oc-id="${id}" data-placa="${esc(nplate(unit.placa))}"
      style="display:block;width:100%;box-sizing:border-box;background:${bg};border:${borderTop};border-right:2px solid ${borderCol};border-bottom:2px solid ${borderCol};border-left:2px solid ${borderCol};border-radius:${radius};overflow:hidden">
      
      <!-- Cabecera OC -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid rgba(110,135,160,.28);min-height:40px;box-sizing:border-box">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0">
          <span style="font-size:11px;font-weight:900;color:#314a65">OC</span>
          <strong style="font-size:16px;font-weight:950;color:#101f33">${esc(oc.orden_carga || "—")}</strong>
          <b style="font-size:13px;font-weight:700;color:#103f73;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">${esc(p.Ruta || "—")}</b>
          ${reabierta ? `<span style="background:#fecaca;border:1px solid #ef4444;color:#7f1d1d;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:900">REABIERTA</span>` : ""}
          ${parihuelas ? `<span style="background:#fde68a;border:1px solid #d97706;color:#78350f;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:900">PARIHUELAS</span>` : ""}
          ${draft ? `<em style="color:#b45309;font-size:11px;font-weight:800">${esc(draft)}</em>` : ""}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:11px;color:#64748b;white-space:nowrap">FECHA CARGA REAL: <b style="color:#334155">${esc(ocCreationDate(p))}</b></span>
          <button type="button" data-save="${id}"
            style="display:inline-flex;align-items:center;gap:4px;background:#edf5ff;color:#124f95;border:1px solid #7ea6d7;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:900;cursor:pointer">💾 GUARDAR</button>
          <button type="button" data-close="${id}"
            style="display:inline-flex;align-items:center;gap:4px;background:#fff5f5;color:#b91c1c;border:1px solid #fca5a5;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:900;cursor:pointer">🚩 FIN DE CICLO</button>
        </div>
      </div>

      <!-- Grilla compacta 5 columnas × 2 filas de campos -->
      <div style="display:grid;grid-template-columns:minmax(110px,.85fr) minmax(140px,1.1fr) minmax(140px,1.1fr) minmax(140px,1.1fr) minmax(160px,1.25fr);grid-template-rows:auto auto;width:100%;box-sizing:border-box">
        
        <!-- ESTADO (columna 1, ambas filas) -->
        <div style="grid-column:1;grid-row:1/3;padding:8px;border-right:1px solid #d5e0eb;box-sizing:border-box">
          <div style="font-size:10px;font-weight:900;color:#142f4b;margin:0 0 4px 0">ESTADO</div>
          <select data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || "")}"
            style="display:block;width:100%;height:54px;box-sizing:border-box;padding:4px 6px;border:1px solid #7a93ad;border-radius:4px;background:#fff;color:#0f172a;-webkit-text-fill-color:#0f172a;font-size:12px;font-weight:700;color-scheme:light">
            ${stateOptions(estado)}
          </select>
        </div>

        <!-- Fila superior de fechas -->
        <div style="grid-column:2;grid-row:1;border-right:1px solid #d5e0eb;border-bottom:1px solid #d5e0eb">
          ${fieldCell(id, "salida", "SALIDA DE PLANTA", field(p, "FECHA DE SALIDA PLANTA YURA/CARACOTO"), field(o, "FECHA DE SALIDA PLANTA YURA/CARACOTO"), true)}
        </div>
        <div style="grid-column:3;grid-row:1;border-right:1px solid #d5e0eb;border-bottom:1px solid #d5e0eb">
          ${fieldCell(id, "llegada", "LLEGADA A DESTINO", field(p, "FECHA LLEGADA A DESTINO"), field(o, "FECHA LLEGADA A DESTINO"), true)}
        </div>
        <div style="grid-column:4;grid-row:1;border-right:1px solid #d5e0eb;border-bottom:1px solid #d5e0eb">
          ${fieldCell(id, "carga", "CARGA DE RETORNO", field(p, "CARGA DE RETORNO"), field(o, "CARGA DE RETORNO"), false)}
        </div>

        <!-- OBSERVACIONES (columna 5, ambas filas) -->
        <div style="grid-column:5;grid-row:1/3;padding:6px 8px;box-sizing:border-box">
          <div style="font-size:10px;font-weight:900;color:#142f4b;margin:0 0 3px 0">OBSERVACIONES</div>
          <textarea data-f="${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}"
            style="display:block;width:100%;height:calc(100% - 18px);min-height:72px;box-sizing:border-box;padding:6px 8px;border:1px solid #7a93ad;border-radius:4px;background:#fff;color:#132f4c;font-size:13px;font-weight:600;resize:none">${esc(field(p, "OBSERVACIONES"))}</textarea>
        </div>

        <!-- Fila inferior -->
        <div style="grid-column:2;grid-row:2;border-right:1px solid #d5e0eb">
          ${fieldCell(id, "retorno", "INICIO DE RETORNO", field(p, "FECHA INICIO DE RETORNO"), field(o, "FECHA INICIO DE RETORNO"), true)}
        </div>
        <div style="grid-column:3;grid-row:2;border-right:1px solid #d5e0eb">
          ${fieldCell(id, "fin", "FIN DE RETORNO", field(p, "FECHA FIN DE RETORNO AQP/YURA/CRCT"), field(o, "FECHA FIN DE RETORNO AQP/YURA/CRCT"), true)}
        </div>
        <div style="grid-column:4;grid-row:2;border-right:1px solid #d5e0eb">
          ${fieldCell(id, "ubi", "UBICACIÓN", field(p, "UBICACIÓN"), field(o, "UBICACIÓN"), true)}
        </div>
      </div>
      <p data-save-hint="${id}" hidden style="color:#15803d;font-weight:800;margin:0;padding:4px 10px;font-size:12px">✓ Guardado</p>
    </article>
  </div>`;
}

function unitGroupHtml(unit, ordinal) {
  const ocs = unit.ocs || [];
  if (!ocs.length) {
    const reviewed = state.reviewed.has(nplate(unit.placa));
    return `<div style="margin:34px 0 12px;position:relative">
      <div style="position:absolute;left:8px;right:4px;top:-30px;height:30px;display:flex;align-items:flex-end;justify-content:space-between;gap:8px;z-index:5;min-width:0">
        <div style="display:flex;align-items:stretch;border:2px solid #385978;border-bottom:0;border-radius:9px 9px 0 0;overflow:hidden;background:#f5f9fd;flex:0 0 auto">
          <span style="display:flex;align-items:center;justify-content:center;min-width:32px;padding:0 8px;font-size:13px;font-weight:900;color:#173e70;background:#e8f0fa;border-right:1px solid #9fb4cb">${ordinal}</span>
          <button type="button" data-map="${esc(nplate(unit.placa))}" style="display:flex;align-items:center;padding:0 12px;font-size:15px;font-weight:900;border:0;background:transparent;cursor:pointer">${esc(shortTracto(unit.tracto || unit.placa))}</button>
          <button type="button" data-review="${esc(unit.placa)}" style="display:flex;align-items:center;justify-content:center;min-width:34px;border:0;border-left:1px solid #9fb4cb;background:${reviewed ? "#16a34a" : "#fff"};color:${reviewed ? "#fff" : "#16a34a"};font-size:16px;font-weight:900;cursor:pointer;padding:0 10px">✓</button>
        </div>
        ${montadosTabHtml(unit)}
      </div>
      <div style="border:2px solid #cbd5e1;border-radius:0 10px 10px 10px;padding:14px;background:#fff">
        <p style="color:#64748b;margin:0">SIN OC ABIERTA</p>
      </div>
    </div>`;
  }
  return `<div style="margin:0 0 4px 0" data-placa="${esc(nplate(unit.placa))}">
    ${ocs.map((oc, i) => ocRowHtml(oc, ordinal, i, ocs.length, unit)).join("")}
  </div>`;
}

/** OC aún pendiente de seguimiento (no cerrada / sin fin de ciclo). */
function hasPendingSeguimiento(unit) {
  const ocs = unit?.ocs || [];
  if (!ocs.length) return false;
  return ocs.some((oc) => {
    if (oc.cerrada || oc.cerrado || oc.fin_ciclo || oc.fin_de_ciclo) return false;
    const est = String(oc.estado || oc.ESTADO || "").toUpperCase();
    if (est.includes("CERRAD") || est === "FIN" || est.includes("FIN DE CICLO")) return false;
    return true; // tiene OC abierta → pendiente
  });
}

/** Revisada real: marcada ✓ y sin OC pendiente de seguimiento. */
function isRevisadaEfectiva(unit) {
  return state.reviewed.has(nplate(unit.placa));
}

function filteredUnits() {
  if (state.filter === "revisadas") {
    return state.units.filter((u) => isRevisadaEfectiva(u));
  }
  if (state.filter === "todas") return state.units;
  return state.units.filter((u) => !isRevisadaEfectiva(u));
}

function paintUnitList(container) {
  const list = container.querySelector("#unit-list");
  if (!list) return;
  const units = filteredUnits();
  if (!units.length) {
    list.innerHTML = `<p style="padding:16px;color:#64748b">No hay unidades en este filtro.</p>`;
  } else {
    list.innerHTML = units.map((u, i) => unitGroupHtml(u, i + 1)).join("");
  }
  paintClosedSection(container);
}

function closedField(p, col) {
  return field(p, col);
}

function closedOcCardHtml(oc) {
  const id = oc.id;
  const p = oc.payload || {};
  const expanded = state.closedExpanded.has(String(id));
  const orden = oc.orden_carga || "—";
  const fechaRef = oc.fecha_referencia || closedField(p, "Fecha de Orden") || closedField(p, "Fecha Carga Real") || "";
  const fechaCierre =
    closedField(p, "FECHA CIERRE SEGUIMIENTO") ||
    closedField(p, "FECHA FIN DE RETORNO AQP/YURA/CRCT") ||
    "";
  const placa = p.PLACA || p["PLACA TRACTO"] || "";
  const conductor = p.CONDUCTOR || "";
  const ruta = p.Ruta || p.RUTA || "";
  const chevron = expanded ? "▼" : "▶";

  const body = !expanded
    ? ""
    : `
    <div style="padding:10px;border-top:1px solid #e2e8f0;background:#fff">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:10px">
        <div><span style="color:#64748b">Placa</span><br><b>${esc(placa || "—")}</b></div>
        <div><span style="color:#64748b">Conductor</span><br><b>${esc(conductor || "—")}</b></div>
        <div style="grid-column:1/-1"><span style="color:#64748b">Ruta</span><br><b>${esc(ruta || "—")}</b></div>
        <div><span style="color:#64748b">Fecha OC</span><br><b>${esc(fechaRef || "—")}</b></div>
        <div><span style="color:#64748b">Fecha cierre</span><br><b>${esc(fechaCierre || "—")}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">ESTADO
          <select data-cfield="estado_fisico" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;background:#fff;color:#0f172a;-webkit-text-fill-color:#0f172a;color-scheme:light">${stateOptions(closedField(p, "ESTADO"))}</select>
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">SALIDA DE PLANTA
          <input data-cfield="salida_planta" type="text" value="${esc(closedField(p, "FECHA DE SALIDA PLANTA YURA/CARACOTO"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">LLEGADA A DESTINO
          <input data-cfield="llegada_destino" type="text" value="${esc(closedField(p, "FECHA LLEGADA A DESTINO"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">INICIO RETORNO
          <input data-cfield="inicio_retorno" type="text" value="${esc(closedField(p, "FECHA INICIO DE RETORNO"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">FIN DE RETORNO
          <input data-cfield="fin_de_ciclo" type="text" value="${esc(closedField(p, "FECHA FIN DE RETORNO AQP/YURA/CRCT"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">CARGA RETORNO
          <input data-cfield="carga_retorno" type="text" value="${esc(closedField(p, "CARGA DE RETORNO"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">UBICACIÓN
          <input data-cfield="ubicacion" type="text" value="${esc(closedField(p, "UBICACIÓN") || closedField(p, "UBICACION"))}" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
        </label>
        <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:2px;font-size:10px;font-weight:800;color:#475569">OBSERVACIONES
          <textarea data-cfield="observaciones" rows="2" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;resize:vertical">${esc(closedField(p, "OBSERVACIONES"))}</textarea>
        </label>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:flex-end">
        <button type="button" data-closed-save="${id}"
          style="background:#edf5ff;color:#124f95;border:1px solid #7ea6d7;border-radius:5px;padding:6px 12px;font-size:11px;font-weight:900;cursor:pointer">💾 GUARDAR</button>
      </div>
      <p style="margin:8px 0 0;font-size:11px;color:#64748b">OC histórica · estado CERRADA · guardar no reabre el ciclo</p>
    </div>`;

  return `
  <article data-closed-id="${id}" style="border:1px solid #cbd5e1;border-radius:8px;margin:0 0 8px;background:#f1f5f9;overflow:hidden">
    <button type="button" data-closed-toggle="${id}"
      style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border:0;background:transparent;cursor:pointer;text-align:left">
      <span style="font-weight:900;color:#334155">${chevron}</span>
      <span style="font-size:11px;font-weight:900;color:#64748b">OC</span>
      <strong style="font-size:15px;font-weight:950;color:#0f172a">${esc(orden)}</strong>
      <span style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900">✓ CERRADA</span>
      <span style="margin-left:auto;font-size:11px;color:#64748b">${esc(fechaCierre || fechaRef || "")}</span>
    </button>
    ${body}
  </article>`;
}

function paintClosedSection(container) {
  const btn = container.querySelector("#toggle-closed");
  const panel = container.querySelector("#closed-panel");
  const countEl = container.querySelector("#closed-count");
  const labelEl = container.querySelector("#closed-unit-label");
  if (!btn || !panel || !state) return;

  const unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
  const tractoLabel = shortTracto(unit?.tracto || unit?.placa || state.closedTracto || "—");
  if (labelEl) labelEl.textContent = tractoLabel;

  const total = (state.closedAll || []).length;
  const shown = Number(state.closedShown) || 0;
  const visible = (state.closedAll || []).slice(0, shown);

  if (countEl) {
    countEl.textContent = total
      ? `${shown}/${total}`
      : state.closedOpen
        ? "0"
        : "—";
  }

  // Botón: MOSTRAR / MOSTRAR OTRA
  if (state.closedLoading) {
    btn.textContent = "…";
    btn.disabled = true;
  } else if (!total && state.closedOpen) {
    btn.textContent = "MOSTRAR";
    btn.disabled = false;
  } else if (shown < total) {
    btn.textContent = shown === 0 ? "MOSTRAR" : "MOSTRAR OTRA";
    btn.disabled = false;
  } else if (total) {
    btn.textContent = "MOSTRAR OTRA";
    btn.disabled = true;
  } else {
    btn.textContent = "MOSTRAR";
    btn.disabled = false;
  }

  if (!shown) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  panel.hidden = false;
  if (!visible.length) {
    panel.innerHTML = `<p style="padding:8px;color:#64748b;font-size:13px">No hay OCs cerradas para <b>${esc(tractoLabel)}</b>.</p>`;
    return;
  }

  panel.innerHTML = `
    <div style="margin:0 0 8px;font-size:12px;color:#475569">
      Mostrando <b>${shown}</b> de <b>${total}</b> · más reciente primero
    </div>
    ${visible.map((oc) => closedOcCardHtml(oc)).join("")}
  `;
}

/** Carga el histórico del tracto seleccionado (una sola vez) y muestra +1 OC. */
async function showNextClosed(container) {
  if (!state) return;
  let unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
  if (!unit && state.units.length) {
    // Si no hay selección explícita, usar la primera visible
    unit = filteredUnits()[0] || state.units[0];
    state.selectedKey = nplate(unit.placa);
  }
  if (!unit) {
    alert("Seleccione una unidad (pestaña R-…)");
    return;
  }
  const tracto = unit.tracto || unit.placa;
  const key = String(tracto);

  // Si cambió de unidad o aún no hay caché, consultar API
  if (state.closedTracto !== key || !state.closedAll.length) {
    state.closedLoading = true;
    state.closedTracto = key;
    state.closedShown = 0;
    state.closedExpanded = new Set();
    paintClosedSection(container);
    try {
      // Backend normaliza R-231 / 20-R-231
      const data = await trackApi({ action: "cerradas_por_tracto", tracto });
      state.closedAll = Array.isArray(data?.ocs) ? data.ocs : [];
      state.closedOpen = true;
    } catch (e) {
      state.closedAll = [];
      alert(e.message || "No se pudo cargar OCs cerradas");
    } finally {
      state.closedLoading = false;
    }
  }

  if (state.closedShown < state.closedAll.length) {
    state.closedShown += 1;
    state.closedOpen = true;
  }
  paintClosedSection(container);
}

async function loadClosedForSelected(container) {
  // Compat: al cambiar de unidad, reinicia progresión
  const unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
  const tracto = unit ? unit.tracto || unit.placa : "";
  if (String(tracto) !== state.closedTracto) {
    state.closedAll = [];
    state.closedShown = 0;
    state.closedTracto = String(tracto || "");
    state.closedExpanded = new Set();
  }
  paintClosedSection(container);
}

function collectClosedData(article) {
  const datos = {};
  article.querySelectorAll("[data-cfield]").forEach((el) => {
    datos[el.dataset.cfield] = el.value;
  });
  return datos;
}


function renderEventsHtml(gps) {
  if (!gps?.ok && !gps?.analisis) {
    return `<p style="color:#64748b;font-size:13px;padding:8px">Sin recorrido en caché. Use precarga o ACTUALIZAR RECORRIDO.</p>`;
  }
  const a = gps.analisis || {};
  const visitas = a.visitas_confirmadas || [];

  // Nombres únicos de geocercas para copiar
  const names = [];
  const seen = new Set();
  for (const v of visitas) {
    const n = String(v.geocerca || "").trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  // también desde otras claves comunes del análisis
  for (const key of ["geocercas_tocadas", "geocercas", "nombres_geocerca"]) {
    const arr = a[key];
    if (Array.isArray(arr)) {
      for (const x of arr) {
        const n = String(typeof x === "string" ? x : x?.nombre || x?.geocerca || "").trim();
        if (n && !seen.has(n)) {
          seen.add(n);
          names.push(n);
        }
      }
    }
  }

  const chips = names.length
    ? `<div style="margin:0 0 10px 0">
        <div style="font-size:11px;font-weight:800;color:#334155;margin-bottom:6px">GEOCERCAS · CLIC PARA COPIAR</div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:stretch">
          ${names
            .map(
              (n) =>
                `<button type="button" data-copy="${esc(n)}" title="Copiar geocerca" style="display:block;width:100%;text-align:left;border:1px solid #94a3b8;background:#f8fafc;color:#0f172a;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer;box-sizing:border-box;white-space:normal;word-break:break-word">${esc(n)}</button>`,
            )
            .join("")}
        </div>
      </div>`
    : "";

  const events = visitas
    .map((v) => {
      let html = `<article style="margin:8px 0;padding:8px 10px;border-radius:8px;background:#dcfce7;border:1px solid #86efac">
        <div style="font-size:13px;font-weight:900;color:#14532d;margin-bottom:4px">INGRESO ${esc(v.geocerca)}</div>
        <button type="button" data-copy="${esc(v.ingreso)}" style="font-size:14px;font-weight:800;padding:4px 8px;border-radius:6px;border:1px solid #86efac;background:#fff;color:#14532d;cursor:pointer">${esc(v.ingreso)}</button>
        <div style="font-size:12px;color:#166534;margin-top:4px">${esc(v.permanencia_minutos)} min · ${esc(v.puntos_dentro)} puntos</div>
        <button type="button" data-copy="${esc(v.geocerca)}" style="margin-top:4px;font-size:11px;border:0;background:transparent;color:#15803d;cursor:pointer;text-decoration:underline">copiar nombre</button>
      </article>`;
      if (v.salida) {
        html += `<article style="margin:8px 0;padding:8px 10px;border-radius:8px;background:#fee2e2;border:1px solid #fca5a5">
          <div style="font-size:13px;font-weight:900;color:#7f1d1d;margin-bottom:4px">SALIDA ${esc(v.geocerca)}</div>
          <button type="button" data-copy="${esc(v.salida)}" style="font-size:14px;font-weight:800;padding:4px 8px;border-radius:6px;border:1px solid #fca5a5;background:#fff;color:#7f1d1d;cursor:pointer">${esc(v.salida)}</button>
        </article>`;
      }
      return html;
    })
    .join("");

  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:13px;margin-bottom:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px">
      <small style="font-weight:800;color:#64748b">ESTADO GPS</small><b style="font-size:14px">${esc(a.estado_final || "—")}</b>
      <small style="font-weight:800;color:#64748b">ÚLTIMA GEOCERCA</small><b style="font-size:14px">${esc(a.ultima_geocerca || "—")}</b>
      <small style="font-weight:800;color:#64748b">UBICACIÓN EN RED</small><b style="font-size:14px">${esc(a.ubicacion_red || a.en_red || "—")}</b>
      <small style="font-weight:800;color:#64748b">FUENTE</small><b style="font-size:14px">${esc(gps.fuente || "PRECARGA")}</b>
    </div>
    ${chips}
    <div style="font-size:12px;font-weight:900;margin:8px 0 4px;color:#334155">SECUENCIA GPS · CLIC EN LA HORA PARA COPIAR</div>
    ${events || "<p style='color:#64748b;font-size:13px'>Sin visitas confirmadas.</p>"}`;
}

function loadTrackingSplit() {
  try {
    const raw = localStorage.getItem("cemento_tracking_split_v3");
    if (!raw) return;
    const x = JSON.parse(raw);
    if (Number.isFinite(x?.mapa) && Number.isFinite(x?.grilla) && Number.isFinite(x?.gps)) {
      trackingSplit = { mapa: x.mapa, grilla: x.grilla, gps: x.gps };
    }
  } catch (_) {}
}

function saveTrackingSplit() {
  try {
    localStorage.setItem("cemento_tracking_split_v3", JSON.stringify(trackingSplit));
  } catch (_) {}
}

function applyTrackingSplit(container) {
  const main = container.querySelector(".desktop-tracking.grid-03 > main");
  if (!main) return;
  main.style.gridTemplateColumns =
    `minmax(160px, ${trackingSplit.mapa}fr) 7px ` +
    `minmax(280px, ${trackingSplit.grilla}fr) 7px ` +
    `minmax(120px, ${trackingSplit.gps}fr)`;
}

function initTrackingSplit(container) {
  const main = container.querySelector(".desktop-tracking.grid-03 > main");
  const center = main?.querySelector(".track-center");
  const right = main?.querySelector(".track-right");
  if (!main || !center || !right) return;
  main.querySelectorAll(".tracking-splitter").forEach((x) => x.remove());
  const split1 = document.createElement("div");
  split1.className = "tracking-splitter";
  split1.title = "Redimensionar mapa / detalle";
  const split2 = document.createElement("div");
  split2.className = "tracking-splitter";
  split2.title = "Redimensionar detalle / GPS";
  main.insertBefore(split1, center);
  main.insertBefore(split2, right);
  loadTrackingSplit();
  applyTrackingSplit(container);

  const startDrag = (which, event) => {
    event.preventDefault();
    document.body.classList.add("tracking-resizing");
    const move = (ev) => {
      const rect = main.getBoundingClientRect();
      const usable = rect.width - 14;
      if (usable <= 0) return;
      if (which === 1) {
        let mapa = ((ev.clientX - rect.left) / usable) * 100;
        mapa = Math.max(15, Math.min(45, mapa));
        let gps = trackingSplit.gps;
        let grilla = 100 - mapa - gps;
        if (grilla < 30) {
          grilla = 30;
          mapa = 100 - grilla - gps;
        }
        trackingSplit = { mapa, grilla, gps };
      } else {
        let gps = ((rect.right - ev.clientX) / usable) * 100;
        gps = Math.max(8, Math.min(25, gps));
        let mapa = trackingSplit.mapa;
        let grilla = 100 - mapa - gps;
        if (grilla < 30) {
          grilla = 30;
          gps = 100 - mapa - grilla;
        }
        trackingSplit = { mapa, grilla, gps };
      }
      applyTrackingSplit(container);
    };
    const stop = () => {
      document.body.classList.remove("tracking-resizing");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      saveTrackingSplit();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };
  split1.onpointerdown = (e) => startDrag(1, e);
  split2.onpointerdown = (e) => startDrag(2, e);
}

export async function mount(container, runtime) {
  cleanup = [];
  state = {
    units: [],
    reviewed: new Set(),
    montadosMap: new Map(),
    selectedKey: "",
    filter: "activas",
    // OC CERRADAS (histórico — no se mezcla con activas)
    closedOpen: false,
    closedLoading: false,
    closedTracto: "",
    closedAll: [],
    closedShown: 0,
    closedExpanded: new Set(),
  };
  bindRuntime(runtime);
  document.body.classList.add("tracking-active");
  container.innerHTML = `<section class="panel" style="padding:16px"><p class="muted">Cargando seguimiento…</p><p class="muted" id="sg-load-progress">0%</p></section>`;
  try {
    await bootstrap(container, runtime);
  } catch (e) {
    document.body.classList.remove("tracking-active");
    container.innerHTML = `<section class="error-box"><h2>Error en seguimiento</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  document.body.classList.remove("tracking-active");
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
  state = null;
  resetMapState();
}

async function loadData(onProgress) {
  const lista = await trackApi({ action: "lista" });
  const plates = lista.placas || [];
  const metaPre = loadMeta();
  const results = metaPre?.resultados || {};
  const reviewed = new Set();
  const toMark = [];
  const toUnmark = [];

  // REVISADAS se reconstruye desde la precarga ACTUAL (no marcas viejas de sesión):
  // - 0 puntos / sin movimiento → revisada (auto)
  // - con puntos y marcada en servidor → se respeta (revisión manual de una unidad con ruta)
  // - marcada en servidor pero sin resultado de precarga o ya con puntos y era auto → se limpia
  for (const p of plates) {
    const k = nplate(p.placa);
    const r = results[k];
    const st = String(r?.estado || "").toUpperCase();
    const pts = Number(r?.puntos ?? 0);
    const sinMov =
      st === "SIN MOVIMIENTO" ||
      st === "SIN PUNTOS" ||
      (st === "COMPLETO" && pts === 0);
    const doneOk =
      st === "SIN MOVIMIENTO" ||
      st === "SIN PUNTOS" ||
      st === "COMPLETO" ||
      st === "ERROR FINAL";

    if (r && sinMov) {
      reviewed.add(k);
      if (!p.revisada) toMark.push(p.placa);
      continue;
    }
    if (r && doneOk && pts > 0 && p.revisada) {
      // Manual: unidad con recorrido que el operador marcó ✓
      reviewed.add(k);
      continue;
    }
    if (p.revisada) {
      // Marca vieja (p.ej. auto de una precarga anterior) → limpiar
      toUnmark.push(p.placa);
    }
  }

  if (toMark.length) {
    Promise.all(
      toMark.map((placa) => trackApi({ action: "marcar_revisada", placa }).catch(() => null)),
    ).catch(() => null);
  }
  if (toUnmark.length) {
    Promise.all(
      toUnmark.map((placa) => trackApi({ action: "desmarcar_revisada", placa }).catch(() => null)),
    ).catch(() => null);
  }

  const units = [];
  const batch = 8;
  for (let i = 0; i < plates.length; i += batch) {
    const slice = plates.slice(i, i + batch);
    const details = await Promise.all(
      slice.map(async (u) => {
        try {
          const d = await trackApi({ action: "detalle", placa: u.placa });
          return {
            placa: d.placa || u.placa,
            tracto: d.tracto || u.tracto,
            conductor: d.conductor || u.conductor || "",
            ocs: (d.ocs || []).map((oc) => ({
              ...oc,
              reabierta: oc.reabierta === true || /REASIGNAD|REABIERT|VALIDAR/i.test(String(oc.observacion_migracion || "")),
              observacion_migracion: oc.observacion_migracion || "",
            })),
            ultima_oc_cerrada: d.ultima_oc_cerrada || null,
          };
        } catch (e) {
          return {
            placa: u.placa,
            tracto: u.tracto,
            conductor: u.conductor || "",
            ocs: [],
            error: e.message,
          };
        }
      }),
    );
    units.push(...details);
    if (typeof onProgress === "function") {
      onProgress(Math.round((100 * units.length) / Math.max(plates.length, 1)));
    }
  }

  // Orden tipo precarga: primero las que YA tienen recorrido (puntos > 0),
  // luego pendientes de precarga; al final las revisadas / sin movimiento.
  const score = (u) => {
    const k = nplate(u.placa);
    const r = results[k];
    const st = String(r?.estado || "").toUpperCase();
    const pts = Number(r?.puntos ?? 0);
    if (reviewed.has(k)) return 3000; // revisadas al final
    if (pts > 0) return 0 + Math.max(0, 500 - Math.min(pts, 500)); // con ruta primero
    if (st === "SIN MOVIMIENTO" || st === "SIN PUNTOS") return 2500;
    if (st === "COMPLETO" && pts === 0) return 2500;
    if (st === "PROCESANDO" || st === "PENDIENTE" || !r) return 1000; // aún cargando
    if (st === "ERROR FINAL" || st === "REINTENTO") return 1500;
    return 2000;
  };
  units.sort((a, b) => {
    const d = score(a) - score(b);
    if (d !== 0) return d;
    return String(a.tracto || "").localeCompare(String(b.tracto || ""));
  });

  const montadosMap = new Map();
  try {
    const hasta = limaTodayKey();
    const desde = shiftDateKey(hasta, -14);
    const mgf = await montadosApi({ action: "listar", desde, hasta });
    for (const r of mgf.rows || []) {
      const fecha = r.fecha_texto || r.fecha || "";
      const ruta = r.ruta || "";
      const push = (key, tipo, rel) => {
        if (!key) return;
        const row = { tipo, relacionado: rel, ruta, fecha };
        for (const vk of plateKeyVariants(key)) {
          const list = montadosMap.get(vk) || [];
          list.push(row);
          montadosMap.set(vk, list);
        }
      };
      push(r.tracto_corto, "MONTADO EN", r.tracto_largo);
      push(r.tracto_largo, "MONTANDO", r.tracto_corto);
      push(r.tracto, "MONTADO EN", r.tracto_largo || r.relacionado);
    }
  } catch (_) {}

  return { units, reviewed, montadosMap, total_ocs: lista.total_ocs || 0 };
}

async function bootstrap(container, runtime) {
  ensureStyles();
  const data = await loadData((pct) => {
    const el = container.querySelector("#sg-load-progress");
    if (el) el.textContent = `${pct}%`;
  });
  state.units = data.units;
  state.reviewed = data.reviewed;
  state.montadosMap = data.montadosMap;

  const meta = loadMeta();
  const c = counts(meta, state.units.length);
  const metaSel = loadMeta();
  const resSel = metaSel?.resultados || {};
  const firstWithRoute = state.units.find((u) => {
    const k = nplate(u.placa);
    if (state.reviewed.has(k)) return false;
    return Number(resSel[k]?.puntos ?? 0) > 0;
  });
  const first =
    firstWithRoute ||
    state.units.find((u) => !state.reviewed.has(nplate(u.placa))) ||
    state.units[0];
  state.selectedKey = first ? nplate(first.placa) : "";

  const desdeDef = meta?.desde || localStorage.getItem("cemento_rango_desde") || "";
  const hastaDef = meta?.hasta || formatPE(new Date());
  const nAct = state.units.filter((u) => !isRevisadaEfectiva(u)).length;
  const nRev = state.units.filter((u) => isRevisadaEfectiva(u)).length;

  container.innerHTML = `
    <section class="desktop-tracking v2 v3 grid-test grid-03">
      <header>
        <div>
          <b>CEMENTO · SEGUIMIENTO</b>
          <small>Una placa por fila · inputs visibles</small>
        </div>
        <span id="preload-global">${isRunning() ? `PRECARGA ${c.done}/${meta?.total || state.units.length}` : `GPS ${c.ready}/${state.units.length}`}</span>
        <span id="review-count">REVISADAS ${nRev}/${state.units.length}</span>
        <button type="button" id="save-partial">GUARDAR PARCIAL</button>
        <button type="button" id="save-all">TERMINAR SEGUIMIENTO</button>
        <button type="button" id="exit-track">PAUSAR Y VOLVER</button>
      </header>
      <main>
        <section class="track-left">
          <div class="map-unit-bar">
            <div id="map-unit-id" class="map-unit-id">RECORRIDO EN EL MAPA</div>
            <div class="route-refresh">
              <label><span>DESDE (dd/mm/aa hh:mm:ss)</span>
                <input id="route-from" type="text" inputmode="numeric" autocomplete="off"
                  placeholder="04/10/26 00:00:01" value="${esc(peToInput(desdeDef))}"></label>
              <label><span>HASTA (24h)</span>
                <input id="route-to" type="text" inputmode="numeric" autocomplete="off"
                  placeholder="04/10/26 15:30:00" value="${esc(peToInput(hastaDef))}"></label>
              <button type="button" id="refresh-route">ACTUALIZAR RECORRIDO</button>
              <small id="route-update-status">USA LA PRECARGA DISPONIBLE</small>
            </div>
          </div>
          <div class="tracking-map-wrap">
            <div id="tracking-map">Seleccione una unidad con precarga.</div>
            <button type="button" id="view-hours">VER HORAS</button>
          </div>
          <footer>
            <b>RECORRIDO ANALIZADO</b>
            <span id="map-caption">—</span>
          </footer>
        </section>
        <section class="track-center">
          <div class="pg-filter-bar">
            <button type="button" class="pg-filter active" data-filter="activas">ACTIVAS · ${nAct}</button>
            <button type="button" class="pg-filter" data-filter="revisadas">REVISADAS · ${nRev}</button>
            <button type="button" class="pg-filter" data-filter="todas">TODAS · ${state.units.length}</button>
          </div>
          <div id="unit-list" class="plate-grid-scroll"></div>
          <div id="closed-section">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;flex:0 0 auto">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                <span id="closed-unit-label" style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:8px;background:#0f172a;color:#fff;font-size:13px;font-weight:950;letter-spacing:.02em">—</span>
                <b style="font-size:13px;font-weight:950;color:#0f172a;letter-spacing:.04em">CERRADAS</b>
                <span id="closed-count" style="font-size:12px;font-weight:800;color:#64748b">—</span>
              </div>
              <button type="button" id="toggle-closed"
                style="background:#1d4ed8;border:1px solid #1e40af;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:900;color:#fff;cursor:pointer">
                MOSTRAR
              </button>
            </div>
            <div id="closed-panel" hidden style="padding:0 10px 12px"></div>
          </div>
        </section>
        <section class="track-right">
          <header><b>SECUENCIA DE EVENTOS GPS</b></header>
          <div id="gps-events"></div>
        </section>
      </main>
    </section>`;

  paintUnitList(container);
  initTrackingSplit(container);
  wire(container, runtime);
  if (state.selectedKey) await focusUnit(container, state.selectedKey, runtime);
}

async function focusUnit(container, key, runtime) {
  state.selectedKey = key;

  const unit = state.units.find((u) => nplate(u.placa) === key);
  if (!unit) return;
  const unitLabel = shortTracto(unit.tracto || unit.placa);
  const idEl = container.querySelector("#map-unit-id");
  if (idEl) idEl.textContent = unitLabel ? `RECORRIDO EN EL MAPA  ${unitLabel}` : "RECORRIDO EN EL MAPA";

  const meta = loadMeta();
  const gps = await readGPS(gpsKey(meta?.id, unit.tracto, unit.placa));
  const st = getStatus(unit.placa);
  const statusEl = container.querySelector("#route-update-status");
  const cap = container.querySelector("#map-caption");

  const events = container.querySelector("#gps-events");
  if (events) {
    events.innerHTML = renderEventsHtml(gps || { ok: false });
    events.querySelectorAll("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy || "");
          const old = b.textContent;
          b.textContent = "✓";
          setTimeout(() => {
            b.textContent = old;
          }, 800);
        } catch (_) {}
      };
    });
  }

  const mapEl = container.querySelector("#tracking-map");
  try {
    await ensureTrackingMap(mapEl, () => runtime.auth.currentUser.getIdToken(false));
    const mapNode = container.querySelector("#tracking-map");
    drawTrackingRoute(gps || { ok: false }, mapNode, cap, unitLabel);

    const u = gps?.ultimo || gps?.ultimo_monitoreo || null;
    const nPts = Array.isArray(gps?.puntos_gps) ? gps.puntos_gps.length : Number(gps?.puntos || 0);
    if (statusEl) {
      if (u && nPts < 2) {
        statusEl.textContent = `${unitLabel} · SIN TRAMO · ÚLTIMO PUNTO`;
      } else if (gps?.ok || nPts > 0) {
        statusEl.textContent = `${unitLabel} · ${nPts} PUNTOS`;
      } else {
        statusEl.textContent = st ? `${unitLabel} · PRECARGA: ${st.estado}` : `${unitLabel} · SIN RECORRIDO`;
      }
    }
    // Quitar barra de diagnóstico si quedó de versiones anteriores
    container.querySelector("#map-u-diag")?.remove();
  } catch (e) {
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center;color:#fca5a5">Mapa: ${esc(e.message)}</div>`;
    }
    if (statusEl) statusEl.textContent = `ERROR MAPA`;
  }
}

function flashBtn(btn, mark) {
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = mark;
  setTimeout(() => {
    btn.textContent = old;
  }, 900);
}

function wire(container, runtime) {
  const $ = (id) => container.querySelector("#" + id);

  $("exit-track").onclick = () => {
    document.body.classList.remove("tracking-active");
    document.querySelector('nav button[data-route="home"]')?.click();
  };

  $("save-partial").onclick = async () => {
    const b = $("save-partial");
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "GUARDANDO…";
    try {
      const x = await trackApi({ action: "guardar_parcial", revisadas: [...state.reviewed] });
      alert(x.mensaje || `Parcial: ${state.reviewed.size}/${state.units.length} revisadas.`);
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };

  $("save-all").onclick = async () => {
    if (state.reviewed.size !== state.units.length) {
      alert(`Incompleto: ${state.reviewed.size}/${state.units.length} revisadas.`);
      return;
    }
    if (!confirm("¿Terminar seguimiento y consolidar?")) return;
    const b = $("save-all");
    b.disabled = true;
    b.textContent = "TERMINANDO…";
    try {
      await trackApi({ action: "consolidar", revisadas: [...state.reviewed] });
      alert("Seguimiento terminado.");
      document.body.classList.remove("tracking-active");
      document.querySelector('nav button[data-route="reporte"]')?.click();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "TERMINAR SEGUIMIENTO";
    }
  };

  container.querySelectorAll(".pg-filter[data-filter]").forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.filter;
      container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
        b.classList.toggle("active", b.dataset.filter === state.filter);
      });
      paintUnitList(container);
    };
  });

  const toggleClosed = container.querySelector("#toggle-closed");
  if (toggleClosed) {
    toggleClosed.onclick = async () => {
      await showNextClosed(container);
    };
  }

  const closedPanel = container.querySelector("#closed-panel");
  if (closedPanel) {
    closedPanel.onclick = async (ev) => {
      const tgl = ev.target.closest("[data-closed-toggle]");
      if (tgl) {
        const id = String(tgl.dataset.closedToggle);
        if (state.closedExpanded.has(id)) state.closedExpanded.delete(id);
        else state.closedExpanded.add(id);
        paintClosedSection(container);
        return;
      }
      const saveBtn = ev.target.closest("[data-closed-save]");
      if (saveBtn) {
        const id = +saveBtn.dataset.closedSave;
        const article = saveBtn.closest("article[data-closed-id]");
        if (!article) return;
        const datos = collectClosedData(article);
        saveBtn.disabled = true;
        const old = saveBtn.textContent;
        saveBtn.textContent = "GUARDANDO…";
        try {
          const r = await trackApi({ action: "guardar_cerrada", id, datos });
          saveBtn.textContent = r.accion === "SIN CAMBIOS" ? "SIN CAMBIOS" : "GUARDADO";
          // refrescar lista histórica sin cambiar estado CERRADA
          const data = await trackApi({
            action: "cerradas_por_tracto",
            tracto: state.closedTracto,
          });
          state.closedAll = data.ocs || [];
          if (state.closedShown > state.closedAll.length) {
            state.closedShown = state.closedAll.length;
          }
          setTimeout(() => paintClosedSection(container), 600);
        } catch (e) {
          alert(e.message);
          saveBtn.textContent = old;
        } finally {
          saveBtn.disabled = false;
        }
      }
    };
  }

  $("refresh-route").onclick = async () => {
    const unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
    if (!unit) return alert("Seleccione una unidad (clic en el mapa o en VALIDAR de una fila).");
    const desde = inputToPE($("route-from").value);
    const hasta = inputToPE($("route-to").value) || formatPE(new Date());
    if (!desde) return alert("Indique DESDE válido.");
    $("route-update-status").textContent = "CONSULTANDO CLocator…";
    try {
      const token = await runtime.auth.currentUser.getIdToken(false);
      const data = await queryClocator({
        endpoint: API.clocator,
        token,
        placa: unit.placa,
        tracto: unit.tracto,
        desde,
        hasta,
        includeMap: false,
      });
      const meta = loadMeta();
      await cacheGPS(
        { ...data, ok: true, placa: unit.placa, tracto: unit.tracto, run_id: meta?.id, desde, hasta },
        gpsKey(meta?.id, unit.tracto, unit.placa),
      );
      const u = data?.ultimo || data?.ultimo_monitoreo || null;
      const nPts = Array.isArray(data?.puntos_gps) ? data.puntos_gps.length : Number(data?.puntos || 0);
      const statusEl = $("route-update-status");
      if (statusEl) {
        statusEl.textContent =
          nPts >= 2
            ? `LISTO · ${nPts} PUNTOS`
            : u
              ? `SIN TRAMO · ÚLTIMO PUNTO`
              : `SIN PUNTOS`;
      }
      container.querySelector("#map-u-diag")?.remove();
      await focusUnit(container, state.selectedKey, runtime);
    } catch (e) {
      $("route-update-status").textContent = "ERROR";
      alert(e.message);
    }
  };

  $("view-hours").onclick = () => {
    toggleInspection($("view-hours"));
  };

  const center = container.querySelector(".track-center");
  const onCenter = async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;

    if (btn.dataset.map) {
      await focusUnit(container, btn.dataset.map, runtime);
      await loadClosedForSelected(container);
      return;
    }

    if (btn.dataset.paste) {
      try {
        const text = await navigator.clipboard.readText();
        const input = center.querySelector(`[data-f="${btn.dataset.paste}"]`);
        if (input) {
          input.value = text;
          input.dispatchEvent(new Event("input"));
          flashBtn(btn, "✓");
        }
      } catch {
        flashBtn(btn, "!");
      }
      return;
    }

    if (btn.dataset.review) {
      try {
        const placa = btn.dataset.review;
        const key = nplate(placa);
        if (state.reviewed.has(key)) {
          await trackApi({ action: "desmarcar_revisada", placa });
          state.reviewed.delete(key);
        } else {
          await trackApi({ action: "marcar_revisada", placa });
          state.reviewed.add(key);
        }
        const nAct = state.units.filter((u) => !isRevisadaEfectiva(u)).length;
        const nRev = state.units.filter((u) => isRevisadaEfectiva(u)).length;
        container.querySelector("#review-count").textContent = `REVISADAS ${nRev}/${state.units.length}`;
        container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
          if (b.dataset.filter === "activas") b.textContent = `ACTIVAS · ${nAct}`;
          if (b.dataset.filter === "revisadas") b.textContent = `REVISADAS · ${nRev}`;
        });
        paintUnitList(container);
      } catch (e) {
        alert(e.message);
      }
      return;
    }

    if (btn.dataset.save) {
      const row = btn.closest("article[data-oc-id]");
      if (!row) return;
      const ocId = +btn.dataset.save;
      const datos = collectOcData(row);
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "GUARDANDO…";
      try {
        const r = await trackApi({ action: "guardar", id: ocId, datos });
        // Actualizar payload local para que no se pierda al repintar
        const placa = row.dataset.placa;
        const unit = state.units.find((u) => nplate(u.placa) === nplate(placa));
        const oc = unit?.ocs?.find((o) => Number(o.id) === ocId);
        applyDatosToOcPayload(oc, datos);
        if (oc) {
          oc.borrador = {
            ...(oc.borrador || {}),
            accion: "GUARDAR",
            cambios: { ...(oc.borrador?.cambios || {}), ...Object.fromEntries(
              Object.entries(datos).map(([k, v]) => [OC_FIELD_COLS[k] || k, v]),
            ) },
          };
        }
        row.querySelectorAll("[data-original]").forEach((el) => {
          el.dataset.original = el.value;
        });
        const n = Number(r?.cambios || 0);
        const localN = Object.keys(datos).length;
        btn.textContent = localN || n ? `GUARDADO (${localN || n})` : "SIN CAMBIOS";
        const hint = row.querySelector(`[data-save-hint="${btn.dataset.save}"]`);
        if (hint) {
          hint.hidden = false;
          hint.textContent =
            localN || n
              ? `✓ Guardado (${localN || n} campo(s))`
              : "Sin cambios nuevos";
        }
        setTimeout(() => {
          if (hint) hint.hidden = true;
          btn.textContent = "GUARDAR";
        }, 1800);
      } catch (e) {
        alert(e.message);
        btn.textContent = old;
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (btn.dataset.close) {
      if (!confirm("¿Preparar FIN DE CICLO?")) return;
      const row = btn.closest("article[data-oc-id]");
      const datos = collectOcData(row);
      btn.disabled = true;
      try {
        await trackApi({ action: "cerrar", id: +btn.dataset.close, datos });
        btn.textContent = "CIERRE PREPARADO";
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    }
  };
  center.addEventListener("click", onCenter);
  cleanup.push(() => center.removeEventListener("click", onCenter));


  const offReset = runtime.bus.on("cemento:precarga-reset", () => {
    if (!state) return;
    // Reinicio de precarga: todas vuelven a ACTIVAS; el 2º plano irá marcando 0 pts
    const prev = [...state.reviewed];
    state.reviewed = new Set();
    const n = state.units.length;
    const rc = container.querySelector("#review-count");
    if (rc) rc.textContent = `REVISADAS 0/${n}`;
    container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
      if (b.dataset.filter === "activas") b.textContent = `ACTIVAS · ${n}`;
      if (b.dataset.filter === "revisadas") b.textContent = `REVISADAS · 0`;
    });
    if (state.filter === "revisadas" || state.filter === "activas") {
      paintUnitList(container);
    }
    // Limpiar marcas en servidor (sesión)
    Promise.all(
      prev.map((k) => {
        const u = state.units.find((x) => nplate(x.placa) === k);
        const placa = u?.placa || k;
        return trackApi({ action: "desmarcar_revisada", placa }).catch(() => null);
      }),
    ).catch(() => null);
  });
  cleanup.push(offReset);

  const off = runtime.bus.on("cemento:precarga-unit", (ev) => {
    if (!state) return;
    const m = loadMeta();
    const c = counts(m, state.units.length);
    const el = $("preload-global");
    if (el) {
      el.textContent = isRunning()
        ? `PRECARGA ${c.done}/${m?.total || state.units.length}`
        : `GPS ${c.ready}/${state.units.length}`;
    }

    // Segundo plano: 0 puntos → REVISADAS sin tocar la unidad en pantalla
    try {
      const placa = ev?.placa;
      if (!placa) return;
      const key = nplate(placa);
      if (state.reviewed.has(key)) return;

      const st = String(ev?.estado || m?.resultados?.[key]?.estado || "").toUpperCase();
      const pts = Number(ev?.puntos ?? m?.resultados?.[key]?.puntos ?? 0);
      const sinMov =
        st === "SIN MOVIMIENTO" ||
        st === "SIN PUNTOS" ||
        (st === "COMPLETO" && pts === 0);
      if (!sinMov) return;

      state.reviewed.add(key);
      trackApi({ action: "marcar_revisada", placa }).catch(() => null);

      const nAct = state.units.filter((u) => !isRevisadaEfectiva(u)).length;
      const nRev = state.units.filter((u) => isRevisadaEfectiva(u)).length;
      const rc = container.querySelector("#review-count");
      if (rc) rc.textContent = `REVISADAS ${nRev}/${state.units.length}`;
      container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
        if (b.dataset.filter === "activas") b.textContent = `ACTIVAS · ${nAct}`;
        if (b.dataset.filter === "revisadas") b.textContent = `REVISADAS · ${nRev}`;
      });

      // Quitar solo esa tarjeta de ACTIVAS (sin repintar toda la lista ni el formulario actual)
      if (state.filter === "activas" && key !== state.selectedKey) {
        const node = container.querySelector(`#unit-list [data-placa="${key}"]`);
        node?.remove();
      }
      // Si es la unidad seleccionada y tiene 0 pts, no forzamos cambio de vista
      // (el operador puede seguir; al cambiar de filtro o unidad se actualiza).
    } catch (_) {}
  });
  cleanup.push(off);
}

function ensureStyles() {
  document.querySelectorAll("style[id^='cem-sg-v3-style']").forEach((n) => n.remove());
  const st = document.createElement("style");
  st.id = "cem-sg-v3-style-21";
  st.textContent = `
    body.tracking-active { overflow: hidden !important; }
    body.tracking-active .desktop-tracking.grid-03 {
      display: flex !important; flex-direction: column !important;
      height: 100vh !important; max-height: 100vh !important;
      background: #eef2f7 !important; color: #1f2937 !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > header {
      display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: center !important;
      padding: 8px 10px !important; background: #fff !important; border-bottom: 1px solid #dbe3ef !important; flex: 0 0 auto !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > main {
      display: grid !important;
      /* grid-template-columns lo controla JS (splitters); valor inicial abajo */
      grid-template-columns: minmax(160px, 28fr) 7px minmax(280px, 57fr) 7px minmax(120px, 15fr);
      gap: 0 !important; padding: 8px !important; flex: 1 1 auto !important; min-height: 0 !important; overflow: hidden !important;
    }
    body.tracking-active .track-left,
    body.tracking-active .track-center,
    body.tracking-active .track-right {
      display: flex !important; flex-direction: column !important; min-width: 0 !important; min-height: 0 !important;
      overflow: hidden !important; background: #fff !important; border: 1px solid #dbe3ef !important; border-radius: 8px !important;
    }
    body.tracking-active .track-center {
      overflow: hidden !important; display: flex !important; flex-direction: column !important;
      min-height: 0 !important; height: 100% !important;
    }
    body.tracking-active .tracking-splitter {
      position: relative !important; cursor: col-resize !important; background: #dbe4ef !important;
      border-left: 1px solid #aabbd0 !important; border-right: 1px solid #aabbd0 !important;
      z-index: 20 !important; width: 7px !important; min-width: 7px !important; max-width: 7px !important; align-self: stretch !important;
    }
    body.tracking-active .tracking-splitter:hover,
    body.tracking-resizing .tracking-splitter { background: #7db4ef !important; }
    body.tracking-active .tracking-splitter::after {
      content: "⋮" !important; position: absolute !important; top: 50% !important; left: 50% !important;
      transform: translate(-50%,-50%) !important; color: #315d8f !important; font-size: 18px !important; font-weight: 900 !important;
    }
    body.tracking-resizing { cursor: col-resize !important; user-select: none !important; }

    body.tracking-active .pg-filter-bar {
      display: flex !important; flex-wrap: wrap !important; gap: 6px !important; padding: 8px !important;
      border-bottom: 1px solid #e2e8f0 !important; flex: 0 0 auto !important; background: #f8fafc !important;
    }
    body.tracking-active .pg-filter {
      border: 1px solid #cbd5e1 !important; background: #fff !important; color: #334155 !important;
      border-radius: 999px !important; padding: 6px 12px !important; font-size: 12px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-filter.active {
      background: #dbeafe !important; border-color: #2563eb !important; color: #1e3a8a !important;
    }
    body.tracking-active #unit-list,
    body.tracking-active .plate-grid-scroll {
      flex: 1 1 auto !important; overflow: auto !important; min-height: 120px !important; min-width: 0 !important; padding: 10px !important;
    }
    /* CERRADAS siempre visible al pie del panel central (no la come el scroll de la lista) */
    body.tracking-active #closed-section {
      flex: 0 0 auto !important;
      max-height: 42% !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border-top: 2px solid #94a3b8 !important;
      background: #f1f5f9 !important;
      z-index: 5 !important;
    }
    body.tracking-active #closed-panel {
      overflow: auto !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
    }
    body.tracking-active #toggle-closed {
      background: #1d4ed8 !important;
      color: #fff !important;
      border: 1px solid #1e40af !important;
    }

    /* Forzar esquema claro: root es color-scheme:dark y blanquea el hover de <select> */
    body.tracking-active,
    body.tracking-active .desktop-tracking,
    body.tracking-active .track-center,
    body.tracking-active .track-left,
    body.tracking-active .track-right {
      color-scheme: light !important;
    }
    body.tracking-active select,
    body.tracking-active select:hover,
    body.tracking-active select:focus,
    body.tracking-active select:active {
      background: #ffffff !important;
      color: #0f172a !important;
      -webkit-text-fill-color: #0f172a !important;
      caret-color: #0f172a !important;
      color-scheme: light !important;
    }
    body.tracking-active select option,
    body.tracking-active select optgroup {
      background: #ffffff !important;
      color: #0f172a !important;
      -webkit-text-fill-color: #0f172a !important;
    }
    body.tracking-active select option:checked,
    body.tracking-active select option:hover,
    body.tracking-active select option:focus {
      background: #dbeafe !important;
      color: #0f172a !important;
      -webkit-text-fill-color: #0f172a !important;
    }
    body.tracking-active input,
    body.tracking-active textarea {
      color-scheme: light !important;
      background: #ffffff !important;
      color: #0f172a !important;
      -webkit-text-fill-color: #0f172a !important;
    }

    body.tracking-active .map-unit-bar {
      flex: 0 0 auto !important; padding: 8px 10px 6px !important; border-bottom: 1px solid #e2e8f0 !important;
    }
    body.tracking-active .map-unit-id,
    body.tracking-active #map-unit-id {
      display: block !important;
      font-size: 20px !important;
      font-weight: 950 !important;
      letter-spacing: 0.03em !important;
      color: #0f172a !important;
      line-height: 1.2 !important;
      margin: 0 0 8px 0 !important;
      padding: 8px 12px !important;
      background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 55%, #fff 100%) !important;
      border: 2px solid #2563eb !important;
      border-radius: 8px !important;
      text-transform: uppercase !important;
    }
    body.tracking-active .route-refresh {
      display: grid !important; grid-template-columns: 1fr 1fr auto !important; gap: 6px !important; align-items: end !important; margin: 0 !important;
    }
    body.tracking-active .route-refresh label { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; font-weight: 800 !important; color: #334155 !important; }
    body.tracking-active .route-refresh input {
      padding: 8px !important; border-radius: 6px !important; border: 1px solid #64748b !important; background: #fff !important; color: #0f172a !important;
      font-size: 14px !important; font-weight: 700 !important; font-variant-numeric: tabular-nums !important;
      min-width: 11em !important;
    }
    body.tracking-active .tracking-map-wrap { position: relative !important; flex: 1 !important; min-height: 160px !important; margin: 0 8px !important; }
    body.tracking-active #tracking-map {
      height: 100% !important; min-height: 160px !important; background: #e2e8f0 !important; border-radius: 8px !important; color: #64748b !important;
    }
    body.tracking-active #tracking-map:not([data-maps-bound="1"]) {
      display: flex !important; align-items: center !important; justify-content: center !important;
    }
    body.tracking-active #view-hours { position: absolute !important; top: 8px !important; right: 8px !important; z-index: 2 !important; }
    body.tracking-active .track-left > footer { padding: 8px 10px !important; border-top: 1px solid #e2e8f0 !important; font-size: 10px !important; }
    body.tracking-active .track-right #gps-events { padding: 8px !important; overflow: auto !important; flex: 1 !important; }

    @media (max-width: 1100px) {
      body.tracking-active .desktop-tracking.grid-03 > main { grid-template-columns: 1fr !important; overflow: auto !important; }
      body.tracking-active .tracking-splitter { display: none !important; }
    }
  `;
  document.head.appendChild(st);
}
