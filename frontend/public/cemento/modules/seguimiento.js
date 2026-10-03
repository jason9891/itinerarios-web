/**
 * CEMENTO · Seguimiento definitivo (vista celdas)
 *
 * UNA ventana → todas las placas como celdas → OCs debajo → editar/guardar
 * Layout: mapa ~40% | grilla ~50% | GPS ~10% (redimensionable)
 * Secciones: ACTIVAS · REVISADAS · CERRADAS
 * Solo Cemento — no toca Cerro Verde.
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

let cleanup = [];
let state = null;
/** Default: mapa 40 · grilla 50 · GPS 10 */
let trackingSplit = { mapa: 40, grilla: 50, gps: 10 };

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

function montadosHtml(unit) {
  if (!state) return "";
  const keys = [unit.tracto, unit.placa, nplate(unit.placa)].map((x) => String(x || "").trim());
  const seen = new Set();
  const parts = [];
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const arrow = r.tipo === "MONTADO EN" ? "←" : "→";
      parts.push(
        `<span class="sg-mont ${r.tipo === "MONTADO EN" ? "in" : "out"}"><b>${esc(r.tipo)}</b> ${arrow} ${esc(shortTracto(r.relacionado))}</span>`,
      );
    }
  }
  return parts.length ? `<div class="sg-mont-row">${parts.join("")}</div>` : "";
}

function ocRowHtml(oc) {
  const p = oc.payload || {};
  const o = oc.original_payload || p;
  const id = oc.id;
  const parihuelas = isParihuelas(p);
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";
  const closedPrep = draft === "CERRAR";

  // Campo con etiqueta siempre visible + pegar/copiar
  const cell = (suffix, label, key, opts = {}) => {
    const cls = ["pg-field", opts.wide ? "wide" : "", opts.short ? "short" : ""]
      .filter(Boolean)
      .join(" ");
    const val = field(p, key);
    return `
    <div class="${cls}">
      <label class="pg-label" for="f-${id}-${suffix}">${label}</label>
      <div class="pg-control">
        <input id="f-${id}-${suffix}" data-f="${id}-${suffix}" data-original="${esc(field(o, key))}" value="${esc(val)}" autocomplete="off">
        <button type="button" class="pg-icon-btn" data-paste="${id}-${suffix}" title="Pegar">📋</button>
        <button type="button" class="pg-icon-btn" data-copy-val="${esc(val)}" title="Copiar">⧉</button>
      </div>
    </div>`;
  };

  return `
    <article class="pg-oc-row ${parihuelas ? "pg-parihuelas" : ""} ${closedPrep ? "pg-closed" : ""}" data-oc-id="${id}">
      <div class="pg-oc-top">
        <div class="pg-oc-title">
          <b>OC ${esc(oc.orden_carga)}</b>
          <strong>${esc(p.Ruta || "—")}</strong>
          <small>FECHA CARGA REAL: ${esc(ocCreationDate(p))}</small>
          ${parihuelas ? `<span class="pg-special-tag">PARIHUELAS</span>` : ""}
          ${draft ? `<em class="pg-draft">${esc(draft)}</em>` : ""}
        </div>
        <div class="pg-top-actions">
          <button type="button" data-save="${id}" class="pg-save-action">GUARDAR</button>
          <button type="button" data-close="${id}" class="pg-close-action">FIN DE CICLO</button>
        </div>
      </div>

      <div class="pg-oc-form">
        <div class="pg-field short">
          <label class="pg-label" for="f-${id}-estado">ESTADO</label>
          <div class="pg-control">
            <select id="f-${id}-estado" data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || p.ESTADO || "")}">
              ${stateOptions(field(p, "ESTADO") || p.ESTADO || "")}
            </select>
          </div>
        </div>
        ${cell("salida", "SALIDA DE PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}
        ${cell("llegada", "LLEGADA A DESTINO", "FECHA LLEGADA A DESTINO")}
        ${cell("carga", "CARGA DE RETORNO", "CARGA DE RETORNO")}
        ${cell("retorno", "INICIO DE RETORNO", "FECHA INICIO DE RETORNO")}
        ${cell("fin", "FIN DE RETORNO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}
        ${cell("ubi", "UBICACIÓN", "UBICACIÓN")}
        ${cell("obs", "OBSERVACIONES", "OBSERVACIONES", { wide: true })}
      </div>
      <p class="pg-save-hint" data-save-hint="${id}" hidden>✓ Guardado</p>
    </article>`;
}

function unitBlockHtml(unit, ordinal, expanded) {
  const k = nplate(unit.placa);
  const reviewed = state.reviewed.has(k);
  const active = state.selectedKey === k ? "active" : "";
  const ocs = unit.ocs || [];
  const hasParihuelas = ocs.some((x) => isParihuelas(x.payload || {}));
  const open = !!expanded;

  return `
    <section class="pg-unit-group ${active} ${reviewed ? "reviewed" : ""} ${open ? "is-open" : "is-closed"}"
      data-placa="${esc(k)}" data-open="${open ? "1" : "0"}">
      <header class="pg-unit-bar">
        <button type="button" class="pg-select-unit" data-toggle-unit="${esc(k)}" title="Desplegar / contraer">
          <span class="pg-chevron">${open ? "▼" : "▶"}</span>
          <span class="pg-num">${ordinal}</span>
          <b>${esc(shortTracto(unit.tracto || unit.placa))}</b>
          <small class="pg-oc-count">${ocs.length} OC</small>
          ${reviewed ? `<span class="pg-check">✓</span>` : ""}
          ${hasParihuelas ? `<span class="pg-special-tag">PARIHUELAS</span>` : ""}
        </button>
        <div class="pg-unit-actions">
          <button type="button" class="secondary" data-map="${esc(k)}">EN MAPA</button>
          <button type="button" class="secondary ${reviewed ? "done" : ""}" data-review="${esc(unit.placa)}">
            ${reviewed ? "REVISADA ✓" : "MARCAR REVISADA"}
          </button>
        </div>
      </header>
      ${montadosHtml(unit)}
      <div class="pg-unit-ocs ${open ? "" : "hidden"}">
        ${
          ocs.length
            ? ocs.map(ocRowHtml).join("")
            : unit.error
              ? `<p class="muted">No se pudo cargar detalle: ${esc(unit.error)}</p>`
              : `<p class="muted">SIN OC ABIERTA</p>`
        }
      </div>
    </section>`;
}

function renderEventsHtml(gps) {
  if (!gps?.ok && !gps?.analisis) {
    return `<p class="muted">Sin recorrido en caché. Use precarga o ACTUALIZAR RECORRIDO.</p>`;
  }
  const a = gps.analisis || {};
  const visitas = a.visitas_confirmadas || [];
  const events = visitas
    .map((v) => {
      let html = `<article class="gps-event"><b>INGRESO ${esc(v.geocerca)}</b><button type="button" class="gps-time" data-copy="${esc(v.ingreso)}">${esc(v.ingreso)}</button><em>${esc(v.permanencia_minutos)} min · ${esc(v.puntos_dentro)} puntos</em></article>`;
      if (v.salida) {
        html += `<article class="gps-event"><b>SALIDA ${esc(v.geocerca)}</b><button type="button" class="gps-time" data-copy="${esc(v.salida)}">${esc(v.salida)}</button></article>`;
      }
      return html;
    })
    .join("");
  return `
    <div class="gps-summary">
      <small>ESTADO GPS</small><b>${esc(a.estado_final || "—")}</b>
      <small>ÚLTIMA GEOCERCA</small><b>${esc(a.ultima_geocerca || "—")}</b>
      <small>UBICACIÓN EN RED</small><b>${esc(a.ubicacion_red || a.en_red || "—")}</b>
      <small>FUENTE</small><b>${esc(gps.fuente || "PRECARGA")}</b>
    </div>
    <div class="gps-sequence-title">SECUENCIA GPS · CLIC EN LA HORA PARA COPIAR</div>
    ${events || "<p class='muted'>Sin visitas confirmadas.</p>"}`;
}

/* ─── split redimensionable 40/50/10 ─── */

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
    `minmax(220px, ${trackingSplit.mapa}fr) 7px ` +
    `minmax(320px, ${trackingSplit.grilla}fr) 7px ` +
    `minmax(140px, ${trackingSplit.gps}fr)`;
}

function initTrackingSplit(container) {
  const main = container.querySelector(".desktop-tracking.grid-03 > main");
  const center = main?.querySelector(".track-center");
  const right = main?.querySelector(".track-right");
  if (!main || !center || !right) return;

  main.querySelectorAll(".tracking-splitter").forEach((x) => x.remove());

  const split1 = document.createElement("div");
  split1.className = "tracking-splitter";
  split1.title = "Redimensionar mapa / lista";
  const split2 = document.createElement("div");
  split2.className = "tracking-splitter";
  split2.title = "Redimensionar lista / GPS";

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
        mapa = Math.max(20, Math.min(50, mapa));
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

/* ─── mount / unmount ─── */

export async function mount(container, runtime) {
  cleanup = [];
  state = {
    units: [],
    reviewed: new Set(),
    montadosMap: new Map(),
    selectedKey: "",
    selectedGps: null,
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
    const ga = getStatus(a.placa)?.estado === "COMPLETO" ? 0 : 1;
    const gb = getStatus(b.placa)?.estado === "COMPLETO" ? 0 : 1;
    if (ga !== gb) return ga - gb;
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
  const first = state.units.find((u) => !state.reviewed.has(nplate(u.placa))) || state.units[0];
  state.selectedKey = first ? nplate(first.placa) : "";

  const desdeDef = meta?.desde || localStorage.getItem("cemento_rango_desde") || "";
  const hastaDef = meta?.hasta || formatPE(new Date());

  container.innerHTML = `
    <section class="desktop-tracking v2 v3 grid-test grid-03">
      <header>
        <div>
          <b>CEMENTO · SEGUIMIENTO</b>
          <small>Celdas por placa · OCs debajo · desplegar / contraer</small>
        </div>
        <span id="preload-global">${isRunning() ? `PRECARGA ${c.done}/${meta?.total || state.units.length}` : `GPS ${c.ready}/${state.units.length}`}</span>
        <span id="plate-position">PLACA 0/${state.units.length}</span>
        <span id="review-count">REVISADAS ${state.reviewed.size}/${state.units.length}</span>
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
            <div id="tracking-map">Seleccione EN MAPA o despliegue una unidad con precarga.</div>
            <button type="button" id="view-hours">VER HORAS</button>
          </div>
          <footer>
            <b>RECORRIDO ANALIZADO</b>
            <span id="map-caption">—</span>
          </footer>
        </section>
        <section class="track-center">
          <div class="pg-center-toolbar">
            <span class="pill">ACTIVAS · <b id="n-activas">0</b> PLACAS</span>
            <span class="pill muted">REVISADAS · <b id="n-revisadas">0</b> PLACAS</span>
          </div>
          <div id="plate-grid" class="plate-grid-scroll">
            <h3 class="sg-sec-label">ACTIVAS</h3>
            <div id="pg-active-body" class="pg-cells"></div>
            <div id="pg-reviewed-wrap">
              <button type="button" class="sg-section-toggle" id="toggle-reviewed">REVISADAS · VER ▼</button>
              <div id="pg-reviewed-body" class="pg-cells hidden"></div>
            </div>
            <div id="pg-closed-wrap">
              <button type="button" class="sg-section-toggle" id="toggle-closed">CERRADAS · VER ▼</button>
              <div id="pg-closed-body" class="hidden">
                <p class="sg-empty-msg">Histórico cerrado por tracto (no reabre OCs).</p>
                <div id="pg-closed-content"></div>
              </div>
            </div>
          </div>
        </section>
        <section class="track-right">
          <header><b>SECUENCIA DE EVENTOS GPS</b></header>
          <div id="gps-events"></div>
        </section>
      </main>
    </section>`;

  paintUnits(container);
  initTrackingSplit(container);
  wire(container, runtime);

  if (state.selectedKey) {
    await focusUnit(container, state.selectedKey);
  }
}

function paintUnits(container) {
  const actBody = container.querySelector("#pg-active-body");
  const revBody = container.querySelector("#pg-reviewed-body");
  const toggleRev = container.querySelector("#toggle-reviewed");
  if (!actBody || !revBody) return;

  const activas = state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
  const revisadas = state.units.filter((u) => state.reviewed.has(nplate(u.placa)));
  const expandedKey = state.selectedKey || (activas[0] ? nplate(activas[0].placa) : "");

  let n = 0;
  actBody.innerHTML = !state.units.length
    ? `<p class="sg-empty-msg">No hay unidades con OC abierta.</p>`
    : activas.length
      ? activas.map((u) => unitBlockHtml(u, ++n, nplate(u.placa) === expandedKey)).join("")
      : `<p class="sg-empty-msg">No hay placas activas. Revise REVISADAS abajo.</p>`;

  revBody.innerHTML = revisadas.length
    ? revisadas.map((u) => unitBlockHtml(u, ++n, false)).join("")
    : `<p class="sg-empty-msg">Sin placas revisadas.</p>`;

  if (!activas.length && revisadas.length) {
    revBody.classList.remove("hidden");
    if (toggleRev) toggleRev.textContent = `REVISADAS (${revisadas.length} placas) · OCULTAR ▲`;
  } else if (toggleRev) {
    const hidden = revBody.classList.contains("hidden");
    toggleRev.textContent = `REVISADAS (${revisadas.length} placas) · ${hidden ? "VER ▼" : "OCULTAR ▲"}`;
  }

  const na = container.querySelector("#n-activas");
  const nr = container.querySelector("#n-revisadas");
  if (na) na.textContent = String(activas.length);
  if (nr) nr.textContent = String(revisadas.length);
  const rc = container.querySelector("#review-count");
  if (rc) rc.textContent = `REVISADAS ${state.reviewed.size}/${state.units.length}`;
}

async function focusUnit(container, key) {
  state.selectedKey = key;
  container.querySelectorAll(".pg-unit-group").forEach((el) => {
    el.classList.toggle("active", el.dataset.placa === key);
  });
  const idx = state.units.findIndex((u) => nplate(u.placa) === key);
  const pos = container.querySelector("#plate-position");
  if (pos) pos.textContent = `PLACA ${idx >= 0 ? idx + 1 : 0}/${state.units.length}`;

  const unit = state.units.find((u) => nplate(u.placa) === key);
  if (!unit) return;

  const meta = loadMeta();
  let gps = await readGPS(gpsKey(meta?.id, unit.tracto, unit.placa));
  state.selectedGps = gps;
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
  if (mapEl) {
    const pts = gps?.puntos_gps || gps?.puntos_lista || [];
    if (Array.isArray(pts) && pts.length) {
      mapEl.innerHTML = `<div style="padding:12px;font-size:12px;text-align:left">
        <b>${esc(shortTracto(unit.tracto))}</b> · ${pts.length} puntos en caché<br>
        <span class="muted">Polilínea de mapa: siguiente iteración con Maps API.</span>
      </div>`;
    } else {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center">Sin puntos GPS en caché para ${esc(shortTracto(unit.tracto))}.<br>Precarga o ACTUALIZAR RECORRIDO.</div>`;
    }
  }
}

function setUnitOpen(card, open) {
  if (!card) return;
  card.dataset.open = open ? "1" : "0";
  card.classList.toggle("is-open", open);
  card.classList.toggle("is-closed", !open);
  card.querySelector(".pg-unit-ocs")?.classList.toggle("hidden", !open);
  const chev = card.querySelector(".pg-chevron");
  if (chev) chev.textContent = open ? "▼" : "▶";
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

  $("toggle-reviewed").onclick = () => {
    const body = $("pg-reviewed-body");
    const open = !body.classList.contains("hidden");
    body.classList.toggle("hidden", open);
    const n = state.units.filter((u) => state.reviewed.has(nplate(u.placa))).length;
    $("toggle-reviewed").textContent = open
      ? `REVISADAS (${n} placas) · VER ▼`
      : `REVISADAS (${n} placas) · OCULTAR ▲`;
  };

  $("toggle-closed").onclick = async () => {
    const body = $("pg-closed-body");
    const opening = body.classList.contains("hidden");
    body.classList.toggle("hidden", !opening);
    $("toggle-closed").textContent = opening ? "CERRADAS · OCULTAR ▲" : "CERRADAS · VER ▼";
    if (!opening) return;
    const box = $("pg-closed-content");
    if (!box || box.dataset.loaded === "1") return;
    box.innerHTML = `<p class="muted">Consultando histórico…</p>`;
    const parts = [];
    for (const u of state.units.slice(0, 40)) {
      try {
        const d = await trackApi({ action: "cerradas_por_tracto", tracto: u.tracto || u.placa });
        const rows = d.rows || d.ocs || d.cerradas || [];
        if (!rows.length) continue;
        parts.push(
          `<div class="sg-closed-unit"><b>${esc(shortTracto(u.tracto || u.placa))}</b><ul>${rows
            .slice(0, 8)
            .map((r) => `<li>OC ${esc(r.orden_carga || r.OC || "—")} · ${esc(r.ruta || r.payload?.Ruta || "")}</li>`)
            .join("")}</ul></div>`,
        );
      } catch (_) {}
    }
    box.innerHTML = parts.length ? parts.join("") : `<p class="muted">Sin OCs cerradas recientes.</p>`;
    box.dataset.loaded = "1";
  };

  $("refresh-route").onclick = async () => {
    const unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
    if (!unit) return alert("Seleccione una unidad.");
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
      await focusUnit(container, state.selectedKey);
    } catch (e) {
      $("route-update-status").textContent = "ERROR";
      alert(e.message);
    }
  };

  $("view-hours").onclick = () => {
    $("gps-events")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const grid = $("plate-grid");
  const onGridClick = async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;

    if (btn.dataset.toggleUnit) {
      const key = btn.dataset.toggleUnit;
      const card = grid.querySelector(`.pg-unit-group[data-placa="${CSS.escape(key)}"]`);
      const open = card?.dataset.open === "1";
      setUnitOpen(card, !open);
      state.selectedKey = key;
      await focusUnit(container, key);
      return;
    }

    if (btn.dataset.map) {
      const key = btn.dataset.map;
      const card = grid.querySelector(`.pg-unit-group[data-placa="${CSS.escape(key)}"]`);
      setUnitOpen(card, true);
      state.selectedKey = key;
      await focusUnit(container, key);
      return;
    }

    if (btn.dataset.paste) {
      try {
        const text = await navigator.clipboard.readText();
        const input = grid.querySelector(`[data-f="${btn.dataset.paste}"]`);
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

    if (btn.hasAttribute("data-copy-val")) {
      const wrap = btn.closest(".pg-control");
      const live = wrap?.querySelector("input, select, textarea");
      const text = live ? String(live.value || "") : String(btn.getAttribute("data-copy-val") || "");
      try {
        await navigator.clipboard.writeText(text);
        flashBtn(btn, "✓");
      } catch {
        flashBtn(btn, "!");
      }
      return;
    }

    if (btn.dataset.review) {
      try {
        await trackApi({ action: "marcar_revisada", placa: btn.dataset.review });
        state.reviewed.add(nplate(btn.dataset.review));
        paintUnits(container);
        await focusUnit(container, nplate(btn.dataset.review));
      } catch (e) {
        alert(e.message);
      }
      return;
    }

    if (btn.dataset.save) {
      const row = btn.closest(".pg-oc-row");
      const datos = collectOcData(row);
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "GUARDANDO…";
      try {
        await trackApi({ action: "guardar", id: +btn.dataset.save, datos });
        btn.textContent = "GUARDADO";
        row.classList.add("pg-saved");
        row.querySelectorAll("[data-original]").forEach((el) => {
          el.dataset.original = el.value;
        });
        const hint = row.querySelector(`[data-save-hint="${btn.dataset.save}"]`);
        if (hint) {
          hint.hidden = false;
          setTimeout(() => {
            hint.hidden = true;
            btn.textContent = "GUARDAR";
          }, 1600);
        } else {
          setTimeout(() => {
            btn.textContent = "GUARDAR";
          }, 1600);
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
      const row = btn.closest(".pg-oc-row");
      const datos = collectOcData(row);
      btn.disabled = true;
      try {
        await trackApi({ action: "cerrar", id: +btn.dataset.close, datos });
        btn.textContent = "CIERRE PREPARADO";
        row.classList.add("pg-closed");
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    }
  };
  grid.addEventListener("click", onGridClick);
  cleanup.push(() => grid.removeEventListener("click", onGridClick));

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
  st.id = "cem-sg-v3-style-07";
  st.textContent = `
    body.tracking-active .desktop-tracking.grid-03 {
      display: flex !important; flex-direction: column !important;
      height: calc(100vh - 56px) !important; background: #eef2f7 !important; color: #1f2937 !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > header {
      display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: center !important;
      padding: 8px 10px !important; background: #fff !important; border-bottom: 1px solid #dbe3ef !important; flex: 0 0 auto !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > main {
      display: grid !important;
      grid-template-columns: minmax(220px, 40fr) 7px minmax(320px, 50fr) 7px minmax(140px, 10fr) !important;
      gap: 0 !important; padding: 8px !important; flex: 1 1 auto !important; min-height: 0 !important; overflow: hidden !important;
    }
    body.tracking-active .track-left,
    body.tracking-active .track-center,
    body.tracking-active .track-right {
      display: flex !important; flex-direction: column !important; min-width: 0 !important; min-height: 0 !important;
      overflow: hidden !important; background: #fff !important; border: 1px solid #dbe3ef !important; border-radius: 8px !important;
    }
    body.tracking-active .track-center { overflow: auto !important; padding: 8px !important; }
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
    body.tracking-active .pg-cells {
      display: grid !important; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)) !important;
      gap: 10px !important; align-items: start !important;
    }
    body.tracking-active .sg-sec-label {
      margin: 4px 0 8px !important; font-size: 12px !important; letter-spacing: .04em !important;
      color: #1e3a8a !important; font-weight: 900 !important;
    }
    body.tracking-active .pg-center-toolbar { display: flex !important; gap: 10px !important; padding: 4px 2px 8px !important; position: sticky !important; top: 0 !important; background: #fff !important; z-index: 2 !important; }
    body.tracking-active .pg-center-toolbar .pill {
      background: #e8f0fe !important; color: #1e3a8a !important; border-radius: 999px !important;
      padding: 4px 10px !important; font-size: 11px !important; font-weight: 800 !important;
    }
    body.tracking-active .pg-unit-group {
      border: 1px solid #cbd5e1 !important; border-radius: 10px !important; background: #fff !important;
      overflow: hidden !important; color: #1f2937 !important;
    }
    body.tracking-active .pg-unit-group.active { border-color: #2563eb !important; box-shadow: 0 0 0 2px #93c5fd !important; }
    body.tracking-active .pg-unit-bar {
      display: flex !important; justify-content: space-between !important; gap: 8px !important; align-items: center !important;
      padding: 8px 10px !important; background: #f8fafc !important; border-bottom: 1px solid #e2e8f0 !important;
    }
    body.tracking-active .pg-select-unit {
      border: 0 !important; background: transparent !important; color: #0f172a !important; cursor: pointer !important;
      display: flex !important; gap: 8px !important; align-items: center !important; font: inherit !important; flex-wrap: wrap !important;
    }
    body.tracking-active .pg-chevron { width: 14px !important; color: #64748b !important; font-size: 10px !important; }
    body.tracking-active .pg-num {
      width: 22px !important; height: 22px !important; border-radius: 999px !important; background: #dbeafe !important;
      color: #1e3a8a !important; display: inline-flex !important; align-items: center !important; justify-content: center !important;
      font-size: 11px !important; font-weight: 800 !important;
    }
    body.tracking-active .pg-oc-count { color: #64748b !important; font-weight: 700 !important; font-size: 11px !important; }
    body.tracking-active .pg-check { color: #16a34a !important; font-weight: 900 !important; }
    body.tracking-active .pg-unit-ocs { padding: 8px !important; display: flex !important; flex-direction: column !important; gap: 8px !important; }
    body.tracking-active .pg-unit-group.is-closed .pg-unit-ocs,
    body.tracking-active .hidden { display: none !important; }
    body.tracking-active .pg-oc-row {
      border: 1px solid #cbd5e1 !important; border-radius: 10px !important; padding: 12px 12px 10px !important; background: #fff !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas {
      background: #fff8db !important; border-color: #eab308 !important; color: #1a1200 !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas .pg-label { color: #713f12 !important; }
    body.tracking-active .pg-oc-top { display: flex !important; justify-content: space-between !important; gap: 10px !important; flex-wrap: wrap !important; margin-bottom: 10px !important; align-items: flex-start !important; }
    body.tracking-active .pg-oc-title b { font-size: 15px !important; color: #0f172a !important; margin-right: 8px !important; }
    body.tracking-active .pg-oc-title strong { color: #1d4ed8 !important; margin-right: 8px !important; font-size: 13px !important; }
    body.tracking-active .pg-oc-title small { display: block !important; margin-top: 3px !important; color: #64748b !important; font-size: 12px !important; }
    body.tracking-active .pg-draft { color: #b45309 !important; font-weight: 800 !important; font-size: 12px !important; }
    body.tracking-active .pg-special-tag {
      display: inline-block !important; margin-left: 6px !important; padding: 2px 8px !important; border-radius: 999px !important;
      font-size: 11px !important; font-weight: 900 !important; background: #fde68a !important; border: 1px solid #d97706 !important; color: #78350f !important;
    }
    /* Formulario usable: etiqueta SIEMPRE visible + control legible */
    body.tracking-active .pg-oc-form {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 10px 12px !important;
    }
    body.tracking-active .pg-field {
      display: flex !important; flex-direction: column !important; gap: 4px !important; min-width: 0 !important;
    }
    body.tracking-active .pg-field.wide { grid-column: 1 / -1 !important; }
    body.tracking-active .pg-field.short { max-width: 100% !important; }
    body.tracking-active .pg-label {
      display: block !important; font-size: 12px !important; font-weight: 800 !important;
      color: #334155 !important; letter-spacing: 0.02em !important; line-height: 1.2 !important;
      white-space: normal !important; overflow: visible !important; text-overflow: unset !important;
    }
    body.tracking-active .pg-control {
      display: flex !important; gap: 4px !important; align-items: stretch !important; min-height: 36px !important;
    }
    body.tracking-active .pg-control input,
    body.tracking-active .pg-control select,
    body.tracking-active .pg-control textarea {
      flex: 1 1 auto !important; min-width: 0 !important; box-sizing: border-box !important;
      min-height: 36px !important; padding: 8px 10px !important; border-radius: 6px !important;
      border: 1px solid #94a3b8 !important; background: #fff !important; color: #0f172a !important;
      font-size: 14px !important; font-weight: 600 !important; line-height: 1.2 !important;
    }
    body.tracking-active .pg-control input:focus,
    body.tracking-active .pg-control select:focus,
    body.tracking-active .pg-control textarea:focus {
      outline: 2px solid #93c5fd !important; border-color: #2563eb !important;
    }
    body.tracking-active .pg-icon-btn {
      flex: 0 0 36px !important; width: 36px !important; border: 1px solid #cbd5e1 !important;
      background: #f8fafc !important; border-radius: 6px !important; cursor: pointer !important;
      font-size: 14px !important; line-height: 1 !important;
    }
    body.tracking-active .pg-icon-btn:hover { background: #e2e8f0 !important; }
    body.tracking-active .pg-top-actions { display: flex !important; gap: 8px !important; flex-wrap: wrap !important; }
    body.tracking-active .pg-save-action {
      background: #2563eb !important; color: #fff !important; border: 1px solid #1d4ed8 !important;
      border-radius: 6px !important; padding: 8px 14px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-close-action {
      background: #fff !important; color: #b91c1c !important; border: 1px solid #fca5a5 !important;
      border-radius: 6px !important; padding: 8px 14px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-save-hint {
      margin: 8px 0 0 !important; color: #15803d !important; font-size: 12px !important; font-weight: 800 !important;
    }
    body.tracking-active .sg-mont-row { padding: 4px 10px !important; display: flex !important; flex-wrap: wrap !important; gap: 6px !important; background: #f1f5f9 !important; }
    body.tracking-active .sg-mont { font-size: 11px !important; padding: 2px 8px !important; border-radius: 999px !important; border: 1px solid #cbd5e1 !important; background: #fff !important; }
    body.tracking-active .sg-mont.out { border-color: #65a30d !important; color: #3f6212 !important; }
    body.tracking-active .sg-mont.in { border-color: #0284c7 !important; color: #075985 !important; }
    body.tracking-active .sg-section-toggle {
      width: 100% !important; text-align: left !important; padding: 8px 10px !important; font-weight: 800 !important; cursor: pointer !important;
      background: #f8fafc !important; border: 1px solid #cbd5e1 !important; color: #1e293b !important; border-radius: 8px !important; margin-top: 10px !important;
    }
    body.tracking-active .sg-empty-msg { padding: 14px !important; color: #64748b !important; font-size: 13px !important; }
    body.tracking-active .sg-closed-unit { margin: 8px 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; }
    body.tracking-active .track-right #gps-events { padding: 8px !important; overflow: auto !important; flex: 1 !important; }
    body.tracking-active .gps-summary {
      display: grid !important; grid-template-columns: auto 1fr !important; gap: 2px 8px !important; font-size: 11px !important;
      margin-bottom: 10px !important; background: #f8fafc !important; border: 1px solid #e2e8f0 !important; border-radius: 6px !important; padding: 8px !important;
    }
    body.tracking-active .gps-event {
      margin: 6px 0 !important; padding: 6px 8px !important; border-left: 3px solid #2563eb !important; background: #f8fafc !important; font-size: 11px !important;
    }
    body.tracking-active .route-refresh {
      display: grid !important; grid-template-columns: 1fr 1fr auto !important; gap: 6px !important; align-items: end !important; margin: 8px !important;
    }
    body.tracking-active .route-refresh label { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; font-weight: 800 !important; }
    body.tracking-active .route-refresh input {
      padding: 6px !important; border-radius: 6px !important; border: 1px solid #cbd5e1 !important; background: #fff !important; color: #0f172a !important;
    }
    body.tracking-active .tracking-map-wrap { position: relative !important; flex: 1 !important; min-height: 180px !important; margin: 0 8px !important; }
    body.tracking-active #tracking-map {
      height: 100% !important; min-height: 180px !important; background: #0f172a !important; border-radius: 8px !important;
      color: #94a3b8 !important; display: flex !important; align-items: center !important; justify-content: center !important;
    }
    body.tracking-active #view-hours { position: absolute !important; top: 8px !important; right: 8px !important; z-index: 2 !important; }
    body.tracking-active .track-left > footer { padding: 8px 10px !important; border-top: 1px solid #e2e8f0 !important; font-size: 10px !important; }
    @media (max-width: 1100px) {
      body.tracking-active .desktop-tracking.grid-03 > main { grid-template-columns: 1fr !important; overflow: auto !important; }
      body.tracking-active .tracking-splitter { display: none !important; }
      body.tracking-active .pg-oc-form { grid-template-columns: 1fr !important; }
    }
  `;
  document.head.appendChild(st);
}
