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

function peToInput(pe) {
  const m = String(pe || "").match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
}

function inputToPE(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}`;
}

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
    if (now === before || (!now && !before)) continue;
    out[apiKey] = now || null;
  }
  return out;
}

function montadosFor(unit) {
  if (!state) return [];
  const keys = [unit.tracto, unit.placa, nplate(unit.placa)].map((x) => String(x || "").trim());
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function montadosHtml(unit) {
  const parts = montadosFor(unit).map((r) => {
    const arrow = r.tipo === "MONTADO EN" ? "←" : "→";
    return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;border-radius:999px;border:1px solid #cbd5e1;font-size:12px;background:#f8fafc"><b>${esc(r.tipo)}</b> ${arrow} ${esc(shortTracto(r.relacionado))}</span>`;
  });
  return parts.length ? `<div style="margin:6px 0 0">${parts.join("")}</div>` : "";
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
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";
  const reviewed = state.reviewed.has(nplate(unit.placa));
  const estado = field(p, "ESTADO") || p.ESTADO || "";
  const bg = parihuelas ? "#fffbeb" : "#fff";
  const borderCol = parihuelas ? "#d97706" : "#829bb6";
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

  // Pestaña tipo navegador (solo en la primera OC de la unidad)
  const tab = isFirst
    ? `<div style="position:relative;height:0;z-index:5">
        <div style="position:absolute;left:8px;top:-30px;height:30px;display:flex;align-items:stretch;border:2px solid #385978;border-bottom:0;border-radius:9px 9px 0 0;overflow:hidden;background:#f5f9fd">
          <span style="display:flex;align-items:center;justify-content:center;min-width:32px;padding:0 8px;font-size:13px;font-weight:900;color:#173e70;background:#e8f0fa;border-right:1px solid #9fb4cb">${unitIndex}</span>
          <button type="button" data-map="${esc(nplate(unit.placa))}" title="Ver en mapa"
            style="display:flex;align-items:center;padding:0 12px;font-size:15px;font-weight:900;color:#0f172a;white-space:nowrap;border:0;background:transparent;cursor:pointer">${esc(shortTracto(unit.tracto || unit.placa))}</button>
          <button type="button" data-review="${esc(unit.placa)}" title="Marcar revisada"
            style="display:flex;align-items:center;justify-content:center;min-width:34px;border:0;border-left:1px solid #9fb4cb;background:${reviewed ? "#16a34a" : "#fff"};color:${reviewed ? "#fff" : "#16a34a"};font-size:16px;font-weight:900;cursor:pointer;padding:0 10px">✓</button>
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
            style="display:block;width:100%;height:54px;box-sizing:border-box;padding:4px 6px;border:1px solid #7a93ad;border-radius:4px;background:#fff;color:#132f4c;font-size:12px;font-weight:700">
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
      <div style="position:absolute;left:8px;top:-30px;height:30px;display:flex;align-items:stretch;border:2px solid #385978;border-bottom:0;border-radius:9px 9px 0 0;overflow:hidden;background:#f5f9fd;z-index:5">
        <span style="display:flex;align-items:center;justify-content:center;min-width:32px;padding:0 8px;font-size:13px;font-weight:900;color:#173e70;background:#e8f0fa;border-right:1px solid #9fb4cb">${ordinal}</span>
        <span style="display:flex;align-items:center;padding:0 12px;font-size:15px;font-weight:900">${esc(shortTracto(unit.tracto || unit.placa))}</span>
        <button type="button" data-review="${esc(unit.placa)}" style="display:flex;align-items:center;justify-content:center;min-width:34px;border:0;border-left:1px solid #9fb4cb;background:${reviewed ? "#16a34a" : "#fff"};color:${reviewed ? "#fff" : "#16a34a"};font-size:16px;font-weight:900;cursor:pointer;padding:0 10px">✓</button>
      </div>
      <div style="border:2px solid #cbd5e1;border-radius:0 10px 10px 10px;padding:14px;background:#fff">
        <p style="color:#64748b;margin:0">SIN OC ABIERTA</p>
        ${montadosHtml(unit)}
      </div>
    </div>`;
  }
  return `<div style="margin:0 0 4px 0" data-placa="${esc(nplate(unit.placa))}">
    ${ocs.map((oc, i) => ocRowHtml(oc, ordinal, i, ocs.length, unit)).join("")}
    ${montadosHtml(unit)}
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
  return state.reviewed.has(nplate(unit.placa)) && !hasPendingSeguimiento(unit);
}

function filteredUnits() {
  if (state.filter === "revisadas") {
    // Solo revisadas reales: NO pueden aparecer unidades con recorrido/OC pendiente
    return state.units.filter((u) => isRevisadaEfectiva(u));
  }
  if (state.filter === "todas") return state.units;
  // ACTIVAS: no revisadas, o revisadas pero aún con OC pendiente
  return state.units.filter((u) => !isRevisadaEfectiva(u));
}

function paintUnitList(container) {
  const list = container.querySelector("#unit-list");
  if (!list) return;
  const units = filteredUnits();
  if (!units.length) {
    list.innerHTML = `<p style="padding:16px;color:#64748b">No hay unidades en este filtro.</p>`;
    return;
  }
  list.innerHTML = units.map((u, i) => unitGroupHtml(u, i + 1)).join("");
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
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${names
            .map(
              (n) =>
                `<button type="button" data-copy="${esc(n)}" style="border:1px solid #94a3b8;background:#f8fafc;color:#0f172a;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer">${esc(n)}</button>`,
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
  const reviewed = new Set(plates.filter((p) => p.revisada).map((p) => nplate(p.placa)));

  // NO auto-marcar SIN MOVIMIENTO como revisada:
  // esas unidades necesitan ver el punto U y seguir en ACTIVAS si tienen OC pendiente.

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
            ocs: d.ocs || [],
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

  units.sort((a, b) => {
    const ra = reviewed.has(nplate(a.placa)) ? 1 : 0;
    const rb = reviewed.has(nplate(b.placa)) ? 1 : 0;
    if (ra !== rb) return ra - rb;
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
        const list = montadosMap.get(key) || [];
        list.push({ tipo, relacionado: rel, ruta, fecha });
        montadosMap.set(key, list);
      };
      push(r.tracto_corto, "MONTADO EN", r.tracto_largo);
      push(r.tracto_largo, "MONTANDO", r.tracto_corto);
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
  const first =
    state.units.find((u) => !state.reviewed.has(nplate(u.placa))) || state.units[0];
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
            <div id="map-unit-id" class="map-unit-id">—</div>
            <div class="route-refresh">
              <label><span>DESDE</span><input id="route-from" type="datetime-local" step="1" value="${esc(peToInput(desdeDef))}"></label>
              <label><span>HASTA</span><input id="route-to" type="datetime-local" step="1" value="${esc(peToInput(hastaDef))}"></label>
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
  if (idEl) idEl.textContent = unitLabel;

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
    const drawn = drawTrackingRoute(gps || { ok: false }, mapNode, cap, unitLabel);

    // Diagnóstico visible y persistente (no lo pisa el texto genérico)
    const u = gps?.ultimo || gps?.ultimo_monitoreo || null;
    const nPts = Array.isArray(gps?.puntos_gps) ? gps.puntos_gps.length : Number(gps?.puntos || 0);
    const diagEl = container.querySelector("#map-u-diag");
    if (statusEl) {
      if (u && nPts < 2) {
        statusEl.textContent =
          `U · lat=${Number(u.lat).toFixed(6)} lng=${Number(u.lng).toFixed(6)} · ${u.fecha || "sin hora"} · ${u.fuente || ""}`;
      } else if (gps?.ok || nPts > 0) {
        statusEl.textContent = `${unitLabel} · ${nPts} PUNTOS EN RANGO`;
      } else {
        statusEl.textContent = st ? `${unitLabel} · PRECARGA: ${st.estado}` : `${unitLabel} · SIN RECORRIDO`;
      }
    }
    if (diagEl) {
      if (u) {
        const pe = Number(u.lat) >= -19.5 && Number(u.lat) <= 0.5 && Number(u.lng) >= -82 && Number(u.lng) <= -68;
        diagEl.textContent =
          `${unitLabel} · U lat=${Number(u.lat).toFixed(6)} lng=${Number(u.lng).toFixed(6)} · ${u.fecha || "sin hora"} · pts=${nPts} · ${pe ? "PERÚ OK" : "FUERA DE CAJA"} · ${u.fuente || ""}`;
        diagEl.style.background = pe ? "#14532d" : "#7f1d1d";
      } else if (nPts >= 2) {
        diagEl.textContent = `${unitLabel} · tramo con ${nPts} puntos (sin U)`;
        diagEl.style.background = "#0f172a";
      } else {
        diagEl.textContent = `${unitLabel} · sin último punto en caché — pulse ACTUALIZAR RECORRIDO`;
        diagEl.style.background = "#0f172a";
      }
    }
  } catch (e) {
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center;color:#fca5a5">Mapa: ${esc(e.message)}</div>`;
    }
    if (statusEl) statusEl.textContent = `ERROR MAPA: ${e.message}`;
    const diagEl = container.querySelector("#map-u-diag");
    if (diagEl) {
      diagEl.textContent = `ERROR: ${e.message}`;
      diagEl.style.background = "#7f1d1d";
    }
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
      const nPts = data?.puntos_gps?.length ?? data?.puntos ?? 0;
      if (u && (nPts < 2)) {
        $("route-update-status").textContent =
          `U DIAG · lat=${Number(u.lat).toFixed(6)} lng=${Number(u.lng).toFixed(6)} · ${u.fecha || "sin hora"} · ${u.fuente || data?.ultimo_monitoreo?.fuente || ""}`;
      } else {
        $("route-update-status").textContent = `LISTO · ${nPts} PUNTOS`;
      }
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
        await trackApi({ action: "marcar_revisada", placa });
        state.reviewed.add(nplate(placa));
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
      const datos = collectOcData(row);
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "GUARDANDO…";
      try {
        await trackApi({ action: "guardar", id: +btn.dataset.save, datos });
        btn.textContent = "GUARDADO";
        row.querySelectorAll("[data-original]").forEach((el) => {
          el.dataset.original = el.value;
        });
        const hint = row.querySelector(`[data-save-hint="${btn.dataset.save}"]`);
        if (hint) {
          hint.hidden = false;
          setTimeout(() => {
            hint.hidden = true;
            btn.textContent = "GUARDAR";
          }, 1500);
        } else {
          setTimeout(() => {
            btn.textContent = "GUARDAR";
          }, 1500);
        }
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

  const off = runtime.bus.on("cemento:precarga-unit", () => {
    const m = loadMeta();
    const c = counts(m, state.units.length);
    const el = $("preload-global");
    if (el) {
      el.textContent = isRunning()
        ? `PRECARGA ${c.done}/${m?.total || state.units.length}`
        : `GPS ${c.ready}/${state.units.length}`;
    }
  });
  cleanup.push(off);
}

function ensureStyles() {
  document.querySelectorAll("style[id^='cem-sg-v3-style']").forEach((n) => n.remove());
  const st = document.createElement("style");
  st.id = "cem-sg-v3-style-18";
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
      flex: 1 1 auto !important; overflow: auto !important; min-height: 200px !important; padding: 10px !important;
    }
    body.tracking-active .route-refresh {
      display: grid !important; grid-template-columns: 1fr 1fr auto !important; gap: 6px !important; align-items: end !important; margin: 8px !important;
    }
    body.tracking-active .route-refresh label { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; font-weight: 800 !important; }
    body.tracking-active .route-refresh input {
      padding: 6px !important; border-radius: 6px !important; border: 1px solid #cbd5e1 !important; background: #fff !important; color: #0f172a !important;
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
