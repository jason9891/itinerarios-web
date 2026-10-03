/**
 * CEMENTO · Seguimiento V3 (vista objetivo)
 *
 * Layout como producción:
 *   izquierda  → mapa / rango / actualizar recorrido
 *   centro     → lista de placas con OCs debajo (ACTIVAS / REVISADAS)
 *   derecha    → secuencia de eventos GPS
 *
 * No es el modelo "una placa llena la columna central".
 */
import { esc, trackApi, montadosApi } from "../api-client.js";
import { API } from "../registry.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getCurrentPlaca,
  getStatus,
  nplate,
  formatPE,
} from "../precarga-engine.js";
import { readGPS, cacheGPS, gpsKey } from "../gps-cache.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];
let state = null;
/** Proporciones por defecto: mapa 40 · grilla 50 · GPS 10 */
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
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
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
    .map(
      (x) =>
        `<option value="${esc(x)}" ${x === current ? "selected" : ""}>${esc(x || "-")}</option>`,
    )
    .join("");
}

function shortTracto(v) {
  return String(v || "—").replace(/^20-/i, "");
}

function peToInput(pe) {
  // DD/MM/YYYY HH:mm:ss → YYYY-MM-DDTHH:mm:ss
  const m = String(pe || "").match(
    /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
}

function inputToPE(v) {
  const m = String(v || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
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
  const keys = [unit.tracto, unit.placa, nplate(unit.placa)].map((x) => String(x || "").trim());
  const seen = new Set();
  const parts = [];
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      parts.push(
        `<span class="sg-mont ${r.tipo === "MONTADO EN" ? "in" : "out"}"><b>${esc(r.tipo)}</b> ${esc(shortTracto(r.relacionado))}</span>`,
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

  const cell = (suffix, label, key, wide = false) => `
    <label class="pg-cell ${wide ? "wide" : ""}">
      <span>${label}</span>
      <div class="paste-input">
        <input data-f="${id}-${suffix}" data-original="${esc(field(o, key))}" value="${esc(field(p, key))}">
        <button type="button" class="pg-paste" data-paste="${id}-${suffix}" title="Pegar">📋</button>
      </div>
    </label>`;

  return `
    <article class="pg-oc-row ${parihuelas ? "pg-parihuelas" : ""} ${closedPrep ? "pg-closed" : ""}" data-oc-id="${id}">
      <div class="pg-oc-top">
        <div class="pg-oc-title">
          <b>OC ${esc(oc.orden_carga)}</b>
          <strong>${esc(p.Ruta || "—")}</strong>
          <small>FECHA CARGA REAL: ${esc(ocCreationDate(p))}</small>
          ${parihuelas ? `<span class="pg-special-tag">PARIHUELAS</span>` : ""}
          ${draft ? `<em>${esc(draft)}</em>` : ""}
        </div>
        <div class="pg-top-actions">
          <button type="button" data-save="${id}" class="pg-save-action">💾 GUARDAR</button>
          <button type="button" data-close="${id}" class="pg-close-action">🚩 FIN DE CICLO</button>
        </div>
      </div>
      <div class="pg-oc-grid">
        <label class="pg-cell">
          <span>ESTADO</span>
          <select data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || p.ESTADO || "")}">
            ${stateOptions(field(p, "ESTADO") || p.ESTADO || "")}
          </select>
        </label>
        ${cell("salida", "SALIDA DE PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}
        ${cell("llegada", "LLEGADA A DESTINO", "FECHA LLEGADA A DESTINO")}
        ${cell("carga", "CARGA DE RETORNO", "CARGA DE RETORNO")}
        ${cell("obs", "OBSERVACIONES", "OBSERVACIONES", true)}
        ${cell("retorno", "INICIO DE RETORNO", "FECHA INICIO DE RETORNO")}
        ${cell("fin", "FIN DE RETORNO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}
        ${cell("ubi", "UBICACIÓN", "UBICACIÓN")}
      </div>
    </article>`;
}

function unitBlockHtml(unit, ordinal) {
  const k = nplate(unit.placa);
  const reviewed = state.reviewed.has(k);
  const active = state.selectedKey === k ? "active" : "";
  const ocs = unit.ocs || [];

  return `
    <section class="pg-unit-group ${active} ${reviewed ? "reviewed" : ""}" data-placa="${esc(k)}" data-grid-group="${ordinal}">
      <header class="pg-unit-bar">
        <button type="button" class="pg-select-unit" data-select="${esc(k)}">
          <span class="pg-num">${ordinal}</span>
          <b>${esc(shortTracto(unit.tracto || unit.placa))}</b>
          ${reviewed ? `<span class="pg-check">✓</span>` : ""}
        </button>
        <div class="pg-unit-actions">
          <button type="button" class="secondary" data-map="${esc(k)}">EN MAPA</button>
          <button type="button" class="secondary ${reviewed ? "done" : ""}" data-review="${esc(unit.placa)}">
            ${reviewed ? "REVISADA ✓" : "MARCAR REVISADA"}
          </button>
        </div>
      </header>
      ${montadosHtml(unit)}
      <div class="pg-unit-ocs">
        ${ocs.length ? ocs.map(ocRowHtml).join("") : `<p class="muted">SIN OC ABIERTA</p>`}
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
  split1.title = "Redimensionar mapa / lista de placas";
  const split2 = document.createElement("div");
  split2.className = "tracking-splitter";
  split2.title = "Redimensionar lista / secuencia GPS";

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


export async function mount(container, runtime) {
  cleanup = [];
  state = {
    units: [],
    reviewed: new Set(),
    montadosMap: new Map(),
    selectedKey: "",
    selectedGps: null,
    map: null,
  };
  bindRuntime(runtime);
  document.body.classList.add("tracking-active");
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento…</p></section>`;
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

  // Solo auto-revisar SIN MOVIMIENTO (no bloquear la UI si falla)
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
          // Mantener la placa visible aunque falle el detalle
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

  // Rank: COMPLETO first (ready to work), then others; reviewed last
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
  container.innerHTML = `<section class="panel" style="padding:16px"><p class="muted">Cargando lista de placas y detalle de OCs…</p><p class="muted" id="sg-load-progress">0%</p></section>`;
  // progress hook via temporary state flag
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
          <b>CEMENTO · SEGUIMIENTO · VERSIÓN 3</b>
          <small>Vista única · placas en lista · OCs debajo · corte parcial disponible</small>
        </div>
        <span id="preload-global">${isRunning() ? `PRECARGA ${c.done}/${meta?.total || state.units.length}` : `GPS ${c.ready}/${state.units.length}`}</span>
        <span id="plate-position">PLACA ${state.selectedKey ? 1 : 0}/${state.units.length}</span>
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
            <div id="tracking-map" style="min-height:220px;background:#0a1628;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;padding:12px;text-align:center">
              Mapa: seleccione EN MAPA en una unidad con precarga.
            </div>
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
            <span class="pill muted">REVISADAS · <b id="n-revisadas">0</b></span>
          </div>
          <div id="plate-grid" class="plate-grid-scroll">
            <div id="pg-active-body"></div>
            <div id="pg-reviewed-wrap">
              <button type="button" class="sg-section-toggle" id="toggle-reviewed">REVISADAS · VER ▼</button>
              <div id="pg-reviewed-body" class="hidden"></div>
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

  let n = 0;
  actBody.innerHTML = state.units.length === 0
    ? `<p class="sg-empty-msg">No hay unidades con OC abierta. Aplique un SAP primero.</p>`
    : activas.length
      ? activas.map((u) => unitBlockHtml(u, ++n)).join("")
      : `<p class="sg-empty-msg">No hay placas activas pendientes. Las revisadas están abajo.</p>`;
  revBody.innerHTML = revisadas.length
    ? revisadas.map((u) => unitBlockHtml(u, ++n)).join("")
    : `<p class="sg-empty-msg">Sin placas revisadas aún.</p>`;

  // Si no hay activas pero sí revisadas, abrir sección revisadas
  if (!activas.length && revisadas.length) {
    revBody.classList.remove("hidden");
    if (toggleRev) toggleRev.textContent = `REVISADAS (${revisadas.length}) · OCULTAR ▲`;
  } else if (toggleRev) {
    toggleRev.textContent = `REVISADAS (${revisadas.length}) · ${revBody.classList.contains("hidden") ? "VER ▼" : "OCULTAR ▲"}`;
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
  container.querySelector("#plate-position").textContent =
    `PLACA ${idx >= 0 ? idx + 1 : 0}/${state.units.length}`;

  const unit = state.units.find((u) => nplate(u.placa) === key);
  if (!unit) return;

  const meta = loadMeta();
  const cacheKey = gpsKey(meta?.id, unit.tracto, unit.placa);
  let gps = await readGPS(cacheKey);
  // fallback: any key ending with tracto|placa
  if (!gps?.ok && meta?.id) {
    gps = await readGPS(`${meta.id}|${unit.tracto}|${unit.placa}`);
  }
  state.selectedGps = gps;
  const st = getStatus(unit.placa);
  const statusEl = container.querySelector("#route-update-status");
  const cap = container.querySelector("#map-caption");
  if (gps?.ok) {
    if (statusEl) statusEl.textContent = `ANÁLISIS LISTO · ${gps.puntos ?? st?.puntos ?? 0} PUNTOS`;
    if (cap) {
      cap.textContent = `${gps.desde || meta?.desde || ""} — ${gps.hasta || meta?.hasta || ""}`;
    }
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
      mapEl.innerHTML = `<div style="padding:12px;font-size:12px;color:#94a3b8;text-align:left">
        <b style="color:#e2e8f0">${esc(shortTracto(unit.tracto))}</b> · ${pts.length} puntos en caché<br>
        <span class="muted">Mapa Google se enlaza cuando la API esté cargada en esta build modular.
        La secuencia de eventos ya está a la derecha.</span>
      </div>`;
    } else {
      mapEl.innerHTML = `<div style="padding:12px;color:#64748b;font-size:12px;text-align:center">
        Sin puntos GPS en caché para ${esc(shortTracto(unit.tracto))}.<br>
        Ejecute precarga o ACTUALIZAR RECORRIDO.
      </div>`;
    }
  }
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
      const x = await trackApi({
        action: "guardar_parcial",
        revisadas: [...state.reviewed],
      });
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
    $("toggle-reviewed").textContent = open
      ? `REVISADAS · VER ▼`
      : `REVISADAS · OCULTAR ▲`;
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
    const panel = $("gps-events");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // Delegation for center list
  const grid = $("plate-grid");
  const onGridClick = async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;

    if (btn.dataset.select || btn.dataset.map) {
      const key = btn.dataset.select || btn.dataset.map;
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
        }
      } catch {
        alert("No se pudo leer el portapapeles.");
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
  st.id = "cem-sg-v3-style-04";
  st.textContent = `
    /* Forzar layout 3 columnas sobre reglas de seguimiento19.css */
    body.tracking-active .desktop-tracking.grid-03 {
      display: flex !important;
      flex-direction: column !important;
      height: calc(100vh - 56px) !important;
      background: #eef2f7 !important;
      color: #1f2937 !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > header {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      align-items: center !important;
      padding: 8px 10px !important;
      background: #fff !important;
      border-bottom: 1px solid #dbe3ef !important;
      flex: 0 0 auto !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > main {
      display: grid !important;
      grid-template-columns: minmax(220px, 40fr) 7px minmax(320px, 50fr) 7px minmax(140px, 10fr) !important;
      gap: 8px !important;
      padding: 8px !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    body.tracking-active .desktop-tracking.grid-03 .track-left,
    body.tracking-active .desktop-tracking.grid-03 .track-center,
    body.tracking-active .desktop-tracking.grid-03 .track-right {
      display: flex !important;
      flex-direction: column !important;
      min-width: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
      background: #fff !important;
      border: 1px solid #dbe3ef !important;
      border-radius: 8px !important;
    }
    body.tracking-active .track-center {
      overflow: auto !important;
      padding: 8px !important;
    }
    body.tracking-active .plate-grid-scroll {
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
    }
    body.tracking-active .pg-center-toolbar {
      display: flex !important;
      gap: 10px !important;
      padding: 4px 2px 8px !important;
      position: sticky !important;
      top: 0 !important;
      background: #fff !important;
      z-index: 2 !important;
    }
    body.tracking-active .pg-center-toolbar .pill {
      background: #e8f0fe !important;
      color: #1e3a8a !important;
      border-radius: 999px !important;
      padding: 4px 10px !important;
      font-size: 11px !important;
      font-weight: 800 !important;
    }
    body.tracking-active .pg-unit-group {
      border: 1px solid #cbd5e1 !important;
      border-radius: 10px !important;
      background: #fff !important;
      overflow: hidden !important;
      color: #1f2937 !important;
    }
    body.tracking-active .pg-unit-group.active {
      border-color: #2563eb !important;
      box-shadow: 0 0 0 2px #93c5fd !important;
    }
    body.tracking-active .pg-unit-bar {
      display: flex !important;
      justify-content: space-between !important;
      gap: 8px !important;
      align-items: center !important;
      padding: 8px 10px !important;
      background: #f8fafc !important;
      border-bottom: 1px solid #e2e8f0 !important;
    }
    body.tracking-active .pg-select-unit {
      border: 0 !important;
      background: transparent !important;
      color: #0f172a !important;
      cursor: pointer !important;
      display: flex !important;
      gap: 8px !important;
      align-items: center !important;
      font: inherit !important;
    }
    body.tracking-active .pg-num {
      width: 22px !important; height: 22px !important; border-radius: 999px !important;
      background: #dbeafe !important; color: #1e3a8a !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      font-size: 11px !important; font-weight: 800 !important;
    }
    body.tracking-active .pg-unit-ocs { padding: 8px !important; display: flex !important; flex-direction: column !important; gap: 8px !important; }
    body.tracking-active .pg-oc-row {
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      padding: 8px 10px !important;
      background: #f8fafc !important;
      color: #1f2937 !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas {
      background: #f2d778 !important;
      border-color: #b28b17 !important;
      color: #1a1200 !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas input,
    body.tracking-active .pg-oc-row.pg-parihuelas select,
    body.tracking-active .pg-oc-row.pg-parihuelas textarea {
      background: #fff !important;
      color: #0f172a !important;
    }
    body.tracking-active .pg-oc-top {
      display: flex !important; justify-content: space-between !important;
      gap: 8px !important; flex-wrap: wrap !important; margin-bottom: 8px !important;
    }
    body.tracking-active .pg-oc-title strong { color: #1d4ed8 !important; margin-right: 8px !important; }
    body.tracking-active .pg-special-tag {
      display: inline-block !important; margin-left: 6px !important; padding: 1px 7px !important;
      border-radius: 999px !important; font-size: 10px !important; font-weight: 900 !important;
      background: #dfb82f !important; border: 1px solid #98740c !important; color: #3f2c00 !important;
    }
    body.tracking-active .pg-oc-grid {
      display: grid !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      gap: 6px 8px !important;
    }
    body.tracking-active .pg-cell { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; min-width: 0 !important; }
    body.tracking-active .pg-cell.wide { grid-column: span 2 !important; }
    body.tracking-active .pg-cell span { font-weight: 800 !important; color: #64748b !important; }
    body.tracking-active .pg-cell input,
    body.tracking-active .pg-cell select,
    body.tracking-active .pg-cell textarea {
      width: 100% !important; box-sizing: border-box !important; padding: 6px 7px !important;
      border-radius: 5px !important; border: 1px solid #cbd5e1 !important;
      background: #fff !important; color: #0f172a !important; font-size: 12px !important;
    }
    body.tracking-active .paste-input { display: flex !important; gap: 3px !important; align-items: center !important; }
    body.tracking-active .paste-input input { flex: 1 !important; min-width: 0 !important; }
    body.tracking-active .pg-top-actions { display: flex !important; gap: 6px !important; }
    body.tracking-active .pg-save-action,
    body.tracking-active .pg-close-action {
      border-radius: 6px !important; padding: 6px 10px !important; font-size: 11px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-save-action { background: #2563eb !important; color: #fff !important; border: 1px solid #1d4ed8 !important; }
    body.tracking-active .pg-close-action { background: #fff !important; color: #b91c1c !important; border: 1px solid #fca5a5 !important; }
    body.tracking-active .sg-mont-row { padding: 4px 10px !important; display: flex !important; flex-wrap: wrap !important; gap: 6px !important; background: #f1f5f9 !important; }
    body.tracking-active .sg-mont { font-size: 11px !important; padding: 2px 8px !important; border-radius: 999px !important; border: 1px solid #cbd5e1 !important; background: #fff !important; }
    body.tracking-active .sg-mont.out { border-color: #65a30d !important; color: #3f6212 !important; }
    body.tracking-active .sg-mont.in { border-color: #0284c7 !important; color: #075985 !important; }
    body.tracking-active .sg-section-toggle {
      width: 100% !important; text-align: left !important; padding: 8px 10px !important; font-weight: 800 !important;
      cursor: pointer !important; background: #f8fafc !important; border: 1px solid #cbd5e1 !important;
      color: #1e293b !important; border-radius: 8px !important;
    }
    body.tracking-active .sg-empty-msg { padding: 14px !important; color: #64748b !important; font-size: 13px !important; }
    body.tracking-active .track-right #gps-events { padding: 8px !important; overflow: auto !important; flex: 1 !important; }
    body.tracking-active .gps-summary {
      display: grid !important; grid-template-columns: auto 1fr !important; gap: 2px 8px !important;
      font-size: 11px !important; margin-bottom: 10px !important; background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important; border-radius: 6px !important; padding: 8px !important;
    }
    body.tracking-active .gps-event {
      margin: 6px 0 !important; padding: 6px 8px !important; border-left: 3px solid #2563eb !important;
      background: #f8fafc !important; font-size: 11px !important;
    }
    body.tracking-active .route-refresh {
      display: grid !important; grid-template-columns: 1fr 1fr auto !important;
      gap: 6px !important; align-items: end !important; margin: 8px !important;
    }
    body.tracking-active .route-refresh label { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; font-weight: 800 !important; }
    body.tracking-active .route-refresh input {
      padding: 6px !important; border-radius: 6px !important; border: 1px solid #cbd5e1 !important;
      background: #fff !important; color: #0f172a !important;
    }
    body.tracking-active .tracking-map-wrap { position: relative !important; flex: 1 !important; min-height: 180px !important; margin: 0 8px !important; }
    body.tracking-active #tracking-map {
      height: 100% !important; min-height: 180px !important; background: #0f172a !important;
      border-radius: 8px !important; color: #94a3b8 !important;
    }
    body.tracking-active #view-hours { position: absolute !important; top: 8px !important; right: 8px !important; z-index: 2 !important; }
    body.tracking-active .track-left > footer {
      padding: 8px 10px !important; border-top: 1px solid #e2e8f0 !important; font-size: 10px !important;
    }
    body.tracking-active .hidden { display: none !important; }

    body.tracking-active .tracking-splitter {
      position: relative !important;
      cursor: col-resize !important;
      background: #dbe4ef !important;
      border-left: 1px solid #aabbd0 !important;
      border-right: 1px solid #aabbd0 !important;
      z-index: 20 !important;
      width: 7px !important;
      min-width: 7px !important;
      max-width: 7px !important;
      align-self: stretch !important;
    }
    body.tracking-active .tracking-splitter:hover,
    body.tracking-resizing .tracking-splitter {
      background: #7db4ef !important;
    }
    body.tracking-active .tracking-splitter::after {
      content: "⋮" !important;
      position: absolute !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%,-50%) !important;
      color: #315d8f !important;
      font-size: 18px !important;
      font-weight: 900 !important;
    }
    body.tracking-resizing {
      cursor: col-resize !important;
      user-select: none !important;
    }

    @media (max-width: 1100px) {
      body.tracking-active .desktop-tracking.grid-03 > main {
        grid-template-columns: 1fr !important;
        overflow: auto !important;
      }
      body.tracking-active .tracking-splitter { display: none !important; }
      body.tracking-active .desktop-tracking.grid-03 .track-left { min-height: 280px !important; }
      body.tracking-active .pg-oc-grid { grid-template-columns: 1fr 1fr !important; }
    }
  `;
  document.head.appendChild(st);
}
