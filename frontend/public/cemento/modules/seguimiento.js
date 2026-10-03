/**
 * CEMENTO · Seguimiento
 * Pestañas R-XXX (navegación) + panel detalle a ancho completo (inputs usables)
 * Layout: mapa | detalle | GPS  — split 40/50/10 redimensionable
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
    return `<span class="sg-mont ${r.tipo === "MONTADO EN" ? "in" : "out"}"><b>${esc(r.tipo)}</b> ${arrow} ${esc(shortTracto(r.relacionado))}</span>`;
  });
  return parts.length ? `<div class="sg-mont-row">${parts.join("")}</div>` : "";
}

function ocRowHtml(oc) {
  const p = oc.payload || {};
  const o = oc.original_payload || p;
  const id = oc.id;
  const parihuelas = isParihuelas(p);
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";

  const row = (suffix, label, key) => {
    const val = field(p, key);
    const orig = field(o, key);
    return `<div class="cem-field">
  <div class="cem-field-label">${label}</div>
  <div class="cem-field-row">
    <input class="cem-input" type="text" data-f="${id}-${suffix}" data-original="${esc(orig)}" value="${esc(val)}" autocomplete="off" spellcheck="false">
    <button type="button" class="cem-btn-icon" data-paste="${id}-${suffix}" title="Pegar">📋</button>
    <button type="button" class="cem-btn-icon" data-copy-val title="Copiar">⧉</button>
  </div>
</div>`;
  };

  return `<article class="cem-oc ${parihuelas ? "cem-oc-parihuelas" : ""}" data-oc-id="${id}">
  <div class="cem-oc-head">
    <div>
      <div class="cem-oc-title"><b>OC ${esc(oc.orden_carga)}</b> <span>${esc(p.Ruta || "—")}</span></div>
      <div class="cem-oc-sub">FECHA CARGA REAL: ${esc(ocCreationDate(p))}${parihuelas ? ' · <span class="pg-special-tag">PARIHUELAS</span>' : ""}${draft ? ` · <em>${esc(draft)}</em>` : ""}</div>
    </div>
    <div class="cem-oc-actions">
      <button type="button" class="cem-btn-save" data-save="${id}">GUARDAR</button>
      <button type="button" class="cem-btn-close" data-close="${id}">FIN DE CICLO</button>
    </div>
  </div>
  <div class="cem-fields">
    <div class="cem-field">
      <div class="cem-field-label">ESTADO</div>
      <div class="cem-field-row">
        <select class="cem-input" data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || p.ESTADO || "")}">
          ${stateOptions(field(p, "ESTADO") || p.ESTADO || "")}
        </select>
      </div>
    </div>
    ${row("salida", "SALIDA DE PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}
    ${row("llegada", "LLEGADA A DESTINO", "FECHA LLEGADA A DESTINO")}
    ${row("carga", "CARGA DE RETORNO", "CARGA DE RETORNO")}
    ${row("retorno", "INICIO DE RETORNO", "FECHA INICIO DE RETORNO")}
    ${row("fin", "FIN DE RETORNO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}
    ${row("ubi", "UBICACIÓN", "UBICACIÓN")}
    ${row("obs", "OBSERVACIONES", "OBSERVACIONES")}
  </div>
  <p class="pg-save-hint" data-save-hint="${id}" hidden>✓ Guardado</p>
</article>`;
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
    `minmax(360px, ${trackingSplit.grilla}fr) 7px ` +
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
        mapa = Math.max(18, Math.min(48, mapa));
        let gps = trackingSplit.gps;
        let grilla = 100 - mapa - gps;
        if (grilla < 32) {
          grilla = 32;
          mapa = 100 - grilla - gps;
        }
        trackingSplit = { mapa, grilla, gps };
      } else {
        let gps = ((rect.right - ev.clientX) / usable) * 100;
        gps = Math.max(8, Math.min(22, gps));
        let mapa = trackingSplit.mapa;
        let grilla = 100 - mapa - gps;
        if (grilla < 32) {
          grilla = 32;
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
    filter: "activas", // activas | revisadas | todas
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

function filteredUnits() {
  if (state.filter === "revisadas") {
    return state.units.filter((u) => state.reviewed.has(nplate(u.placa)));
  }
  if (state.filter === "todas") return state.units;
  return state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
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
          <small>Pestañas R-XXX · detalle a ancho completo · inputs usables</small>
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
            <button type="button" class="pg-filter" id="toggle-closed">CERRADAS · VER</button>
          </div>
          <div id="unit-list" class="unit-list" role="list"></div>
          <div id="pg-closed-body" class="hidden">
            <p class="sg-empty-msg">Histórico cerrado (no reabre OCs).</p>
            <div id="pg-closed-content"></div>
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

function unitRowHtml(unit, ordinal) {
  const k = nplate(unit.placa);
  const reviewed = state.reviewed.has(k);
  const selected = k === state.selectedKey;
  const ocs = unit.ocs || [];
  const hasParihuelas = ocs.some((x) => isParihuelas(x.payload || {}));
  const open = selected;

  return `
    <article class="unit-row ${selected ? "selected" : ""} ${reviewed ? "reviewed" : ""} ${hasParihuelas ? "has-parihuelas" : ""}"
      data-placa="${esc(k)}" role="listitem">
      <div class="unit-row-bar">
        <button type="button" class="unit-row-select" data-select="${esc(k)}">
          <span class="tab-num">${ordinal}</span>
          <span class="tab-name">${esc(shortTracto(unit.tracto || unit.placa))}</span>
          <span class="tab-meta">${ocs.length} OC${reviewed ? " · REVISADA" : ""}</span>
          ${hasParihuelas ? `<span class="pg-special-tag">PARIHUELAS</span>` : ""}
        </button>
        <div class="unit-row-actions">
          <button type="button" class="secondary" data-map="${esc(k)}">EN MAPA</button>
          <button type="button" class="btn-validar ${reviewed ? "done" : ""}" data-review="${esc(unit.placa)}">
            ${reviewed ? "✓ REVISADA" : "VALIDAR REVISADA"}
          </button>
        </div>
      </div>
      ${selected ? montadosHtml(unit) : ""}
      ${
        open
          ? `<div class="unit-row-detail">
              ${
                ocs.length
                  ? ocs.map(ocRowHtml).join("")
                  : unit.error
                    ? `<p class="sg-empty-msg">No se pudo cargar detalle: ${esc(unit.error)}</p>`
                    : `<p class="sg-empty-msg">SIN OC ABIERTA — puede marcar REVISADA si corresponde.</p>`
              }
            </div>`
          : ""
      }
    </article>`;
}

function paintUnitList(container) {
  const list = container.querySelector("#unit-list");
  if (!list) return;
  const units = filteredUnits();
  if (!units.length) {
    list.innerHTML = `<p class="sg-empty-msg">No hay unidades en este filtro.</p>`;
    return;
  }
  list.innerHTML = units.map((u, i) => unitRowHtml(u, i + 1)).join("");
  const sel = list.querySelector(".unit-row.selected");
  if (sel) sel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function focusUnit(container, key, runtime) {
  state.selectedKey = key;
  paintUnitList(container);

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
      // re-get mapEl content cleared by Maps
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
      // prefer selected still in filter; else first of filter
      const list = filteredUnits();
      if (!list.some((u) => nplate(u.placa) === state.selectedKey)) {
        state.selectedKey = list[0] ? nplate(list[0].placa) : "";
      }
      paintUnitList(container);
      if (state.selectedKey) focusUnit(container, state.selectedKey, runtime);
    };
  });

  $("toggle-closed").onclick = async () => {
    const body = $("pg-closed-body");
    const opening = body.classList.contains("hidden");
    body.classList.toggle("hidden", !opening);
    $("toggle-closed").textContent = opening ? "CERRADAS · OCULTAR" : "CERRADAS · VER";
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
      await focusUnit(container, state.selectedKey, runtime);
    } catch (e) {
      $("route-update-status").textContent = "ERROR";
      alert(e.message);
    }
  };

  $("view-hours").onclick = () => {
    const b = $("view-hours");
    toggleInspection(b);
  };

  // Center column delegation
  const center = container.querySelector(".track-center");
  const onCenter = async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;

    if (btn.dataset.select) {
      await focusUnit(container, btn.dataset.select, runtime);
      return;
    }
    if (btn.dataset.map) {
      await focusUnit(container, btn.dataset.map, runtime);
      return;
    }
    if (btn.dataset.copyPlate) {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyPlate);
        flashBtn(btn, "✓");
      } catch {
        flashBtn(btn, "!");
      }
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
    if (btn.hasAttribute("data-copy-val")) {
      const wrap = btn.closest(".pg-control");
      const live = wrap?.querySelector("input, select, textarea");
      const text = live ? String(live.value || "") : "";
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
        // En filtro ACTIVAS: pasar a la siguiente pendiente
        if (state.filter === "activas") {
          const next = state.units.find(
            (u) => !state.reviewed.has(nplate(u.placa)) && nplate(u.placa) !== nplate(placa),
          );
          state.selectedKey = next ? nplate(next.placa) : "";
        }
        paintUnitList(container);
        if (state.selectedKey) await focusUnit(container, state.selectedKey, runtime);
      } catch (e) {
        alert(e.message);
      }
      return;
    }
    if (btn.dataset.save) {
      const row = btn.closest(".cem-oc");
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
      const row = btn.closest(".cem-oc");
      const datos = collectOcData(row);
      btn.disabled = true;
      try {
        await trackApi({ action: "cerrar", id: +btn.dataset.close, datos });
        btn.textContent = "CIERRE PREPARADO";
        row.classList.add("cem-oc-closed");
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
  st.id = "cem-sg-v3-style-11";
  st.textContent = `
    body.tracking-active {
      overflow: hidden !important;
    }
    body.tracking-active #content,
    body.tracking-active .content,
    body.tracking-active main#content {
      height: 100% !important; max-height: 100% !important; overflow: hidden !important;
    }
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
      grid-template-columns: minmax(200px, 28fr) 7px minmax(400px, 57fr) 7px minmax(140px, 15fr) !important;
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

    /* Filtros */
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

    /* Lista vertical: 1 unidad por fila */
    body.tracking-active .unit-list {
      flex: 1 1 auto !important; overflow-y: auto !important; overflow-x: hidden !important;
      padding: 8px !important; display: flex !important; flex-direction: column !important;
      gap: 8px !important; min-height: 0 !important;
    }
    body.tracking-active .unit-row {
      border: 1px solid #cbd5e1 !important; border-radius: 10px !important; background: #fff !important;
      overflow: visible !important; width: 100% !important;
    }
    body.tracking-active .unit-row.selected {
      border-color: #2563eb !important; box-shadow: 0 0 0 2px #93c5fd !important;
    }
    body.tracking-active .unit-row.reviewed { background: #f8fafc !important; }
    body.tracking-active .unit-row.has-parihuelas { border-left: 4px solid #eab308 !important; }
    body.tracking-active .unit-row-bar {
      display: flex !important; justify-content: space-between !important; align-items: center !important;
      gap: 8px !important; padding: 10px 12px !important; width: 100% !important;
      background: #f8fafc !important; border-bottom: 1px solid transparent !important;
    }
    body.tracking-active .unit-row.selected .unit-row-bar {
      border-bottom-color: #e2e8f0 !important; background: #eff6ff !important;
    }
    body.tracking-active .unit-row-select {
      border: 0 !important; background: transparent !important; cursor: pointer !important;
      display: flex !important; align-items: center !important; gap: 10px !important;
      flex: 1 1 auto !important; min-width: 0 !important; text-align: left !important; color: #0f172a !important;
    }
    body.tracking-active .unit-row-select .tab-num {
      flex: 0 0 28px !important; height: 28px !important; border-radius: 999px !important;
      background: #dbeafe !important; color: #1e3a8a !important; display: inline-flex !important;
      align-items: center !important; justify-content: center !important; font-size: 12px !important; font-weight: 900 !important;
    }
    body.tracking-active .unit-row-select .tab-name {
      font-size: 20px !important; font-weight: 900 !important; line-height: 1.1 !important;
    }
    body.tracking-active .unit-row-select .tab-meta {
      font-size: 12px !important; color: #64748b !important; font-weight: 700 !important;
    }
    body.tracking-active .unit-row-actions {
      display: flex !important; gap: 8px !important; flex-wrap: wrap !important; flex: 0 0 auto !important;
    }
    body.tracking-active .btn-validar {
      background: #16a34a !important; color: #fff !important; border: 1px solid #15803d !important;
      border-radius: 6px !important; padding: 8px 14px !important; font-size: 12px !important;
      font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .btn-validar.done {
      background: #dcfce7 !important; color: #166534 !important; border-color: #86efac !important;
    }
    body.tracking-active .unit-row-detail {
      padding: 12px !important; width: 100% !important; box-sizing: border-box !important;
      display: block !important; overflow: visible !important;
    }

    body.tracking-active .sg-mont-row { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; margin-top: 6px !important; }
    body.tracking-active .sg-mont {
      font-size: 12px !important; padding: 3px 10px !important; border-radius: 999px !important;
      border: 1px solid #cbd5e1 !important; background: #f8fafc !important;
    }
    body.tracking-active .sg-mont.out { border-color: #65a30d !important; color: #3f6212 !important; }
    body.tracking-active .sg-mont.in { border-color: #0284c7 !important; color: #075985 !important; }

    /* OC form — etiqueta visible + inputs anchos */
    body.tracking-active .pg-oc-row {
      border: 1px solid #cbd5e1 !important; border-radius: 10px !important; padding: 14px !important; background: #fff !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas {
      background: #fffbeb !important; border-color: #eab308 !important;
    }
    body.tracking-active .pg-oc-top {
      display: flex !important; justify-content: space-between !important; gap: 10px !important; flex-wrap: wrap !important;
      margin-bottom: 12px !important; align-items: flex-start !important;
    }
    body.tracking-active .pg-oc-title b { font-size: 16px !important; margin-right: 8px !important; }
    body.tracking-active .pg-oc-title strong { color: #1d4ed8 !important; font-size: 14px !important; margin-right: 8px !important; }
    body.tracking-active .pg-oc-title small { display: block !important; margin-top: 4px !important; color: #64748b !important; font-size: 12px !important; }
    body.tracking-active .pg-draft { color: #b45309 !important; font-weight: 800 !important; }
    body.tracking-active .pg-special-tag {
      display: inline-block !important; margin-left: 6px !important; padding: 2px 8px !important; border-radius: 999px !important;
      font-size: 11px !important; font-weight: 900 !important; background: #fde68a !important; border: 1px solid #d97706 !important; color: #78350f !important;
    }
    body.tracking-active .pg-oc-form {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      width: 100% !important;
    }
    body.tracking-active .pg-oc-row {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    body.tracking-active .pg-field { display: flex !important; flex-direction: column !important; gap: 5px !important; min-width: 0 !important; }
    body.tracking-active .pg-field-wide { grid-column: 1 / -1 !important; }
    body.tracking-active .pg-label {
      display: block !important; font-size: 13px !important; font-weight: 800 !important;
      color: #0f172a !important; letter-spacing: 0.02em !important; line-height: 1.25 !important;
      white-space: normal !important; margin-bottom: 2px !important;
    }
    body.tracking-active .pg-control {
      display: flex !important; gap: 6px !important; align-items: stretch !important; min-height: 48px !important;
      width: 100% !important;
    }
    body.tracking-active .pg-control input,
    body.tracking-active .pg-control select {
      flex: 1 1 auto !important; min-width: 0 !important; width: 100% !important; box-sizing: border-box !important;
      min-height: 48px !important; padding: 12px 14px !important; border-radius: 8px !important;
      border: 1px solid #475569 !important; background: #fff !important; color: #0f172a !important;
      font-size: 16px !important; font-weight: 600 !important;
    }
    body.tracking-active .pg-control input:focus,
    body.tracking-active .pg-control select:focus {
      outline: 2px solid #93c5fd !important; border-color: #2563eb !important;
    }
    body.tracking-active .pg-icon-btn {
      flex: 0 0 40px !important; width: 40px !important; border: 1px solid #cbd5e1 !important;
      background: #f1f5f9 !important; border-radius: 6px !important; cursor: pointer !important; font-size: 15px !important;
    }
    body.tracking-active .pg-icon-btn:hover { background: #e2e8f0 !important; }
    body.tracking-active .pg-top-actions { display: flex !important; gap: 8px !important; }
    body.tracking-active .pg-save-action {
      background: #2563eb !important; color: #fff !important; border: 1px solid #1d4ed8 !important;
      border-radius: 6px !important; padding: 9px 16px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-close-action {
      background: #fff !important; color: #b91c1c !important; border: 1px solid #fca5a5 !important;
      border-radius: 6px !important; padding: 9px 16px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-save-hint { margin: 8px 0 0 !important; color: #15803d !important; font-size: 13px !important; font-weight: 800 !important; }
    body.tracking-active .sg-empty-msg { padding: 12px !important; color: #64748b !important; font-size: 13px !important; }
    body.tracking-active .sg-closed-unit { margin: 8px 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; }
    body.tracking-active .hidden { display: none !important; }

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
      height: 100% !important; min-height: 220px !important; background: #e2e8f0 !important; border-radius: 8px !important;
      color: #64748b !important;
    }
    body.tracking-active #tracking-map:not([data-maps-bound="1"]) {
      display: flex !important; align-items: center !important; justify-content: center !important;
    }
    body.tracking-active #view-hours { position: absolute !important; top: 8px !important; right: 8px !important; z-index: 2 !important; }
    body.tracking-active .track-left > footer { padding: 8px 10px !important; border-top: 1px solid #e2e8f0 !important; font-size: 10px !important; }


    /* Formulario OC — siempre vertical, 100% ancho, inputs reales */
    body.tracking-active .cem-oc {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 10px !important;
      padding: 14px !important;
      margin: 0 0 12px 0 !important;
      background: #fff !important;
    }
    body.tracking-active .cem-oc-parihuelas {
      background: #fffbeb !important;
      border-color: #eab308 !important;
    }
    body.tracking-active .cem-oc-head {
      display: flex !important;
      justify-content: space-between !important;
      gap: 12px !important;
      flex-wrap: wrap !important;
      margin-bottom: 14px !important;
      align-items: flex-start !important;
    }
    body.tracking-active .cem-oc-title {
      font-size: 16px !important;
      font-weight: 800 !important;
      color: #0f172a !important;
    }
    body.tracking-active .cem-oc-title span { color: #1d4ed8 !important; font-weight: 700 !important; }
    body.tracking-active .cem-oc-sub { font-size: 12px !important; color: #64748b !important; margin-top: 4px !important; }
    body.tracking-active .cem-oc-actions { display: flex !important; gap: 8px !important; }
    body.tracking-active .cem-btn-save {
      background: #2563eb !important; color: #fff !important; border: 1px solid #1d4ed8 !important;
      border-radius: 8px !important; padding: 10px 16px !important; font-size: 13px !important;
      font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .cem-btn-close {
      background: #fff !important; color: #b91c1c !important; border: 1px solid #fca5a5 !important;
      border-radius: 8px !important; padding: 10px 16px !important; font-size: 13px !important;
      font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .cem-fields {
      display: block !important;
      width: 100% !important;
    }
    body.tracking-active .cem-field {
      display: block !important;
      width: 100% !important;
      margin: 0 0 14px 0 !important;
      box-sizing: border-box !important;
    }
    body.tracking-active .cem-field-label {
      display: block !important;
      width: 100% !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      color: #0f172a !important;
      margin: 0 0 6px 0 !important;
      line-height: 1.3 !important;
    }
    body.tracking-active .cem-field-row {
      display: flex !important;
      flex-direction: row !important;
      align-items: stretch !important;
      gap: 8px !important;
      width: 100% !important;
    }
    body.tracking-active .cem-input {
      display: block !important;
      flex: 1 1 auto !important;
      width: 100% !important;
      min-width: 0 !important;
      min-height: 48px !important;
      height: 48px !important;
      box-sizing: border-box !important;
      padding: 10px 14px !important;
      border: 2px solid #334155 !important;
      border-radius: 8px !important;
      background: #ffffff !important;
      color: #0f172a !important;
      font-size: 16px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
    }
    body.tracking-active select.cem-input {
      appearance: auto !important;
    }
    body.tracking-active .cem-input:focus {
      outline: none !important;
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px #93c5fd !important;
    }
    body.tracking-active .cem-btn-icon {
      flex: 0 0 48px !important;
      width: 48px !important;
      height: 48px !important;
      border: 1px solid #cbd5e1 !important;
      background: #f1f5f9 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-size: 16px !important;
    }

    @media (max-width: 1100px) {
      body.tracking-active .desktop-tracking.grid-03 > main { grid-template-columns: 1fr !important; overflow: auto !important; }
      body.tracking-active .tracking-splitter { display: none !important; }
      body.tracking-active .pg-oc-form { flex-direction: column !important; }
    }
  `;
  document.head.appendChild(st);
}
