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

function fieldInput(id, suffix, label, value, original) {
  return `<div style="display:block;width:100%;margin:0 0 10px 0;box-sizing:border-box">
  <div style="display:block;font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">${label}</div>
  <div style="display:flex;gap:6px;align-items:stretch;width:100%">
    <input type="text" data-f="${id}-${suffix}" data-original="${esc(original)}" value="${esc(value)}"
      autocomplete="off"
      style="flex:1 1 auto;width:100%;min-width:0;min-height:40px;height:40px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600">
    <button type="button" data-paste="${id}-${suffix}" title="Pegar"
      style="flex:0 0 40px;width:40px;height:40px;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;cursor:pointer">📋</button>
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
  const bg = parihuelas ? "#fffbeb" : "#ffffff";
  const border = parihuelas ? "#eab308" : "#64748b";

  const head =
    ocIndex === 0
      ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 10px 0;padding:8px 10px;background:#eff6ff;border-radius:8px 8px 0 0;border:2px solid ${border};border-bottom:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-weight:900;font-size:13px">${unitIndex}</span>
            <strong style="font-size:20px;color:#0f172a">${esc(shortTracto(unit.tracto || unit.placa))}</strong>
            <span style="font-size:12px;color:#64748b">${totalOcs} OC</span>
            ${reviewed ? `<span style="color:#16a34a;font-weight:900">✓ REVISADA</span>` : ""}
            ${parihuelas ? `<span style="background:#fde68a;border:1px solid #d97706;color:#78350f;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:900">PARIHUELAS</span>` : ""}
          </div>
          <button type="button" data-review="${esc(unit.placa)}"
            style="background:${reviewed ? "#dcfce7" : "#16a34a"};color:${reviewed ? "#166534" : "#fff"};border:1px solid #15803d;border-radius:6px;padding:8px 12px;font-weight:800;font-size:12px;cursor:pointer">
            ${reviewed ? "✓ REVISADA" : "VALIDAR REVISADA"}
          </button>
        </div>`
      : "";

  return `
  <div style="margin:0 0 12px 0">
    ${head}
    <article data-oc-id="${id}" data-placa="${esc(nplate(unit.placa))}"
      style="display:block;width:100%;box-sizing:border-box;padding:12px;background:${bg};border:2px solid ${border};border-radius:${ocIndex === 0 ? "0 0 8px 8px" : "8px"}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin:0 0 12px 0">
        <div>
          <div style="font-size:16px;font-weight:900;color:#0f172a">OC ${esc(oc.orden_carga || "—")}
            <span style="color:#1d4ed8;font-weight:700;margin-left:8px">${esc(p.Ruta || "—")}</span>
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">FECHA CARGA REAL: ${esc(ocCreationDate(p))}${draft ? " · " + esc(draft) : ""}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" data-save="${id}"
            style="background:#2563eb;color:#fff;border:1px solid #1d4ed8;border-radius:6px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer">GUARDAR</button>
          <button type="button" data-close="${id}"
            style="background:#fff;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer">FIN DE CICLO</button>
        </div>
      </div>
      <div style="display:block;width:100%">
        <div style="display:block;width:100%;margin:0 0 10px 0">
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">ESTADO</div>
          <select data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || "")}"
            style="display:block;width:100%;min-height:40px;height:40px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600">
            ${stateOptions(estado)}
          </select>
        </div>
        ${fieldInput(id, "salida", "SALIDA DE PLANTA", field(p, "FECHA DE SALIDA PLANTA YURA/CARACOTO"), field(o, "FECHA DE SALIDA PLANTA YURA/CARACOTO"))}
        ${fieldInput(id, "llegada", "LLEGADA A DESTINO", field(p, "FECHA LLEGADA A DESTINO"), field(o, "FECHA LLEGADA A DESTINO"))}
        ${fieldInput(id, "carga", "CARGA DE RETORNO", field(p, "CARGA DE RETORNO"), field(o, "CARGA DE RETORNO"))}
        ${fieldInput(id, "retorno", "INICIO DE RETORNO", field(p, "FECHA INICIO DE RETORNO"), field(o, "FECHA INICIO DE RETORNO"))}
        ${fieldInput(id, "fin", "FIN DE RETORNO", field(p, "FECHA FIN DE RETORNO AQP/YURA/CRCT"), field(o, "FECHA FIN DE RETORNO AQP/YURA/CRCT"))}
        ${fieldInput(id, "ubi", "UBICACIÓN", field(p, "UBICACIÓN"), field(o, "UBICACIÓN"))}
        <div style="display:block;width:100%;margin:0 0 10px 0">
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">OBSERVACIONES</div>
          <textarea data-f="${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}"
            style="display:block;width:100%;min-height:72px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600;resize:vertical">${esc(field(p, "OBSERVACIONES"))}</textarea>
        </div>
      </div>
      <p data-save-hint="${id}" hidden style="color:#15803d;font-weight:800;margin:6px 0 0">✓ Guardado</p>
    </article>
  </div>`;
}

function unitGroupHtml(unit, ordinal) {
  const ocs = unit.ocs || [];
  if (!ocs.length) {
    return `<div style="margin:0 0 12px 0;padding:12px;border:2px solid #cbd5e1;border-radius:8px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="font-size:18px">${ordinal}. ${esc(shortTracto(unit.tracto || unit.placa))}</strong>
        <button type="button" data-review="${esc(unit.placa)}"
          style="background:#16a34a;color:#fff;border:0;border-radius:6px;padding:8px 12px;font-weight:800;cursor:pointer">VALIDAR REVISADA</button>
      </div>
      <p style="color:#64748b;margin:8px 0 0">SIN OC ABIERTA</p>
      ${montadosHtml(unit)}
    </div>`;
  }
  return `<div style="margin:0 0 16px 0" data-placa="${esc(nplate(unit.placa))}">
    ${ocs.map((oc, i) => ocRowHtml(oc, ordinal, i, ocs.length, unit)).join("")}
    ${montadosHtml(unit)}
  </div>`;
}

function filteredUnits() {
  if (state.filter === "revisadas") {
    return state.units.filter((u) => state.reviewed.has(nplate(u.placa)));
  }
  if (state.filter === "todas") return state.units;
  return state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
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
    return `<p style="color:#64748b;font-size:12px;padding:8px">Sin recorrido en caché. Use precarga o ACTUALIZAR RECORRIDO.</p>`;
  }
  const a = gps.analisis || {};
  const visitas = a.visitas_confirmadas || [];
  const events = visitas
    .map((v) => {
      let html = `<article style="margin:6px 0;padding:6px 8px;border-left:3px solid #2563eb;background:#f8fafc;font-size:11px"><b>INGRESO ${esc(v.geocerca)}</b><br><button type="button" data-copy="${esc(v.ingreso)}" style="margin-top:4px">${esc(v.ingreso)}</button><em> ${esc(v.permanencia_minutos)} min</em></article>`;
      if (v.salida) {
        html += `<article style="margin:6px 0;padding:6px 8px;border-left:3px solid #64748b;background:#f8fafc;font-size:11px"><b>SALIDA ${esc(v.geocerca)}</b><br><button type="button" data-copy="${esc(v.salida)}">${esc(v.salida)}</button></article>`;
      }
      return html;
    })
    .join("");
  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;margin-bottom:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px">
      <small>ESTADO GPS</small><b>${esc(a.estado_final || "—")}</b>
      <small>ÚLTIMA GEOCERCA</small><b>${esc(a.ultima_geocerca || "—")}</b>
      <small>UBICACIÓN EN RED</small><b>${esc(a.ubicacion_red || a.en_red || "—")}</b>
      <small>FUENTE</small><b>${esc(gps.fuente || "PRECARGA")}</b>
    </div>
    <div style="font-size:11px;font-weight:800;margin:8px 0 4px">SECUENCIA GPS · CLIC EN LA HORA PARA COPIAR</div>
    ${events || "<p style='color:#64748b;font-size:12px'>Sin visitas confirmadas.</p>"}`;
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

  const meta = loadMeta();
  for (const u of plates) {
    const k = nplate(u.placa);
    if (meta?.resultados?.[k]?.estado === "SIN MOVIMIENTO" && !reviewed.has(k)) {
      try {
        await trackApi({ action: "marcar_revisada", placa: u.placa });
        reviewed.add(k);
      } catch (_) {}
    }
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
  const nAct = state.units.filter((u) => !state.reviewed.has(nplate(u.placa))).length;
  const nRev = state.reviewed.size;

  container.innerHTML = `
    <section class="desktop-tracking v2 v3 grid-test grid-03">
      <header>
        <div>
          <b>CEMENTO · SEGUIMIENTO</b>
          <small>Una placa por fila · inputs visibles</small>
        </div>
        <span id="preload-global">${isRunning() ? `PRECARGA ${c.done}/${meta?.total || state.units.length}` : `GPS ${c.ready}/${state.units.length}`}</span>
        <span id="plate-position">PLACA 0/${state.units.length}</span>
        <span id="review-count">REVISADAS ${nRev}/${state.units.length}</span>
        <button type="button" id="save-partial">GUARDAR PARCIAL</button>
        <button type="button" id="save-all">TERMINAR SEGUIMIENTO</button>
        <button type="button" id="exit-track">PAUSAR Y VOLVER</button>
      </header>
      <main>
        <section class="track-left">
          <div class="route-refresh">
            <label><span>DESDE</span><input id="route-from" type="datetime-local" step="1" value="${esc(peToInput(desdeDef))}"></label>
            <label><span>HASTA</span><input id="route-to" type="datetime-local" step="1" value="${esc(peToInput(hastaDef))}"></label>
            <button type="button" id="refresh-route">ACTUALIZAR RECORRIDO</button>
            <small id="route-update-status">USA LA PRECARGA DISPONIBLE</small>
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
  const idx = state.units.findIndex((u) => nplate(u.placa) === key);
  const pos = container.querySelector("#plate-position");
  if (pos) pos.textContent = `PLACA ${idx >= 0 ? idx + 1 : 0}/${state.units.length}`;

  const unit = state.units.find((u) => nplate(u.placa) === key);
  if (!unit) return;

  const meta = loadMeta();
  const gps = await readGPS(gpsKey(meta?.id, unit.tracto, unit.placa));
  const st = getStatus(unit.placa);
  const statusEl = container.querySelector("#route-update-status");
  const cap = container.querySelector("#map-caption");
  if (gps?.ok) {
    if (statusEl) statusEl.textContent = `ANÁLISIS LISTO · ${gps.puntos ?? st?.puntos ?? 0} PUNTOS`;
    if (cap) cap.textContent = `${gps.desde || meta?.desde || ""} — ${gps.hasta || meta?.hasta || ""}`;
  } else {
    if (statusEl) statusEl.textContent = st ? `PRECARGA: ${st.estado}` : "SIN RECORRIDO PRECARGADO";
    if (cap) cap.textContent = "Sin caché GPS para esta unidad";
  }

  const events = container.querySelector("#gps-events");
  if (events) {
    events.innerHTML = renderEventsHtml(gps || { ok: false });
    events.querySelectorAll("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy || "");
        } catch (_) {}
      };
    });
  }

  const mapEl = container.querySelector("#tracking-map");
  try {
    if (gps?.ok || (gps?.puntos_gps || gps?.puntos_lista || []).length) {
      await ensureTrackingMap(mapEl, () => runtime.auth.currentUser.getIdToken(true));
      const mapNode = container.querySelector("#tracking-map");
      drawTrackingRoute(gps, mapNode, cap);
    } else if (mapEl) {
      mapEl.dataset.mapsBound = "";
      mapEl.innerHTML = `<div style="padding:12px;text-align:center">Sin puntos GPS en caché para ${esc(shortTracto(unit.tracto))}.</div>`;
    }
  } catch (e) {
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center;color:#fca5a5">Mapa: ${esc(e.message)}</div>`;
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
      const token = await runtime.auth.currentUser.getIdToken(true);
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
        { ...data, placa: unit.placa, tracto: unit.tracto, run_id: meta?.id, desde, hasta },
        gpsKey(meta?.id, unit.tracto, unit.placa),
      );
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
        const nAct = state.units.filter((u) => !state.reviewed.has(nplate(u.placa))).length;
        const nRev = state.reviewed.size;
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
  st.id = "cem-sg-v3-style-15";
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
      grid-template-columns: minmax(160px, 28fr) 7px minmax(280px, 57fr) 7px minmax(120px, 15fr) !important;
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
