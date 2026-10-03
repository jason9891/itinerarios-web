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

async function loadData() {
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
  const batch = 6;
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
  const data = await loadData();
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
  const activas = state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
  const revisadas = state.units.filter((u) => state.reviewed.has(nplate(u.placa)));

  let n = 0;
  actBody.innerHTML = activas.length
    ? activas.map((u) => unitBlockHtml(u, ++n)).join("")
    : `<p class="muted" style="padding:12px">No hay placas activas.</p>`;
  revBody.innerHTML = revisadas.length
    ? revisadas.map((u) => unitBlockHtml(u, ++n)).join("")
    : `<p class="muted" style="padding:12px">Sin revisadas aún.</p>`;

  const na = container.querySelector("#n-activas");
  const nr = container.querySelector("#n-revisadas");
  if (na) na.textContent = String(activas.length);
  if (nr) nr.textContent = String(revisadas.length);
  container.querySelector("#review-count").textContent =
    `REVISADAS ${state.reviewed.size}/${state.units.length}`;
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
  if (document.getElementById("cem-sg-v3-style")) return;
  const st = document.createElement("style");
  st.id = "cem-sg-v3-style";
  st.textContent = `
    .desktop-tracking.grid-03 > main {
      display: grid;
      grid-template-columns: 32fr 48fr 20fr;
      gap: 8px;
      padding: 8px;
      min-height: calc(100vh - 120px);
    }
    .track-center { overflow: auto; min-width: 0; }
    .plate-grid-scroll { display: flex; flex-direction: column; gap: 10px; }
    .pg-center-toolbar { display:flex; gap:10px; padding: 6px 4px 10px; align-items:center; }
    .pg-unit-group {
      border: 1px solid #1e3a5f; border-radius: 10px; background: #0b1728; overflow: hidden;
    }
    .pg-unit-group.active { border-color: #38bdf8; box-shadow: 0 0 0 1px #38bdf880; }
    .pg-unit-group.reviewed { opacity: 0.92; }
    .pg-unit-bar {
      display: flex; justify-content: space-between; gap: 8px; align-items: center;
      padding: 8px 10px; background: #0a1a2e; border-bottom: 1px solid #1e3a5f;
    }
    .pg-select-unit {
      border: 0; background: transparent; color: inherit; cursor: pointer;
      display: flex; gap: 8px; align-items: center; font: inherit;
    }
    .pg-num {
      width: 22px; height: 22px; border-radius: 999px; background: #1e3a5f;
      display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800;
    }
    .pg-check { color: #22c55e; font-weight: 900; }
    .pg-unit-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .pg-unit-ocs { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .pg-oc-row {
      border: 1px solid #1e3a5f; border-radius: 8px; padding: 8px 10px; background: #071525;
    }
    .pg-oc-row.pg-parihuelas {
      background: #f2d778 !important;
      border-color: #b28b17 !important;
      color: #1a1200;
    }
    .pg-oc-row.pg-parihuelas input,
    .pg-oc-row.pg-parihuelas select,
    .pg-oc-row.pg-parihuelas textarea {
      background: #fff !important;
      color: #0f172a;
    }
    .pg-oc-top { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .pg-oc-title b { margin-right: 6px; }
    .pg-oc-title strong { color: #38bdf8; margin-right: 8px; }
    .pg-oc-row.pg-parihuelas .pg-oc-title strong { color: #0b3b78; }
    .pg-special-tag {
      display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
      font-size: 10px; font-weight: 900; background: #dfb82f; border: 1px solid #98740c; color: #3f2c00;
    }
    .pg-top-actions { display: flex; gap: 6px; }
    .pg-oc-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px 8px;
    }
    .pg-cell { display: flex; flex-direction: column; gap: 2px; font-size: 10px; min-width: 0; }
    .pg-cell.wide { grid-column: span 2; }
    .pg-cell span { font-weight: 800; opacity: 0.75; }
    .pg-cell input, .pg-cell select, .pg-cell textarea {
      width: 100%; box-sizing: border-box; padding: 6px 7px; border-radius: 5px;
      border: 1px solid #1e3a5f; background: #0b1728; color: #e2e8f0; font-size: 12px;
    }
    .paste-input { display: flex; gap: 3px; align-items: center; }
    .paste-input input { flex: 1; min-width: 0; }
    .pg-paste { border: 0; background: transparent; cursor: pointer; padding: 2px; }
    .sg-mont-row { padding: 4px 10px; display: flex; flex-wrap: wrap; gap: 6px; background: #081422; }
    .sg-mont { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #1e3a5f; }
    .sg-mont.out { border-color: #a3e635; color: #bef264; }
    .sg-mont.in { border-color: #38bdf8; color: #7dd3fc; }
    .sg-section-toggle {
      width: 100%; text-align: left; padding: 8px 10px; font-weight: 800; cursor: pointer;
      background: #0a1a2e; border: 1px solid #1e3a5f; color: #e2e8f0; border-radius: 8px;
    }
    .track-right #gps-events { padding: 8px; overflow: auto; max-height: calc(100vh - 160px); }
    .gps-summary { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: 11px; margin-bottom: 10px; }
    .gps-summary small { color: #94a3b8; }
    .gps-event { margin: 6px 0; padding: 6px 8px; border-left: 3px solid #38bdf8; background: #0a1a2e; font-size: 11px; }
    .gps-time { margin-left: 6px; cursor: pointer; border: 0; background: #132337; color: #7dd3fc; border-radius: 4px; padding: 2px 6px; }
    .route-refresh { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: end; margin-bottom: 8px; }
    .route-refresh label { display: flex; flex-direction: column; gap: 2px; font-size: 10px; font-weight: 800; }
    .route-refresh input { padding: 6px; border-radius: 6px; border: 1px solid #1e3a5f; background: #071525; color: #e2e8f0; }
    .tracking-map-wrap { position: relative; }
    #view-hours { position: absolute; top: 8px; right: 8px; z-index: 2; }
    .hidden { display: none !important; }
    @media (max-width: 1100px) {
      .desktop-tracking.grid-03 > main { grid-template-columns: 1fr; }
      .pg-oc-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(st);
}
