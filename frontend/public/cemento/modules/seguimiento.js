/**
 * CEMENTO · Seguimiento — vista única tipo grilla
 *
 * Modelo: UNA ventana → TODAS las placas → OCs debajo de cada placa
 * Secciones: ACTIVAS · REVISADAS · CERRADAS (contraíble)
 * Parihuelas: fondo amarillo claro
 * Montados: capa informativa MONTANDO / MONTADO EN
 *
 * NO vuelve al modelo "una placa ocupa toda la columna central".
 */
import { esc, trackApi, montadosApi } from "../api-client.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getCurrentPlaca,
  getStatus,
  nplate,
} from "../precarga-engine.js";

let cleanup = [];
/** @type {null | ReturnType<typeof createState>} */
let state = null;

const STATES = [
  "",
  "ESTACIONADO CARGADO",
  "ESTACIONADO VACÍO",
  "TRANSITO CARGADO",
  "TRANSITO VACÍO",
];

function createState() {
  return {
    units: [], // { placa, tracto, conductor, ocs:[], revisada, ultima_oc_cerrada }
    reviewed: new Set(),
    montadosMap: new Map(),
    closedOpen: false,
    loading: false,
  };
}

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
  const key = payload?.["Fecha de Orden"]
    ? "Fecha de Orden"
    : payload?.["Fecha Carga Real"]
      ? "Fecha Carga Real"
      : payload?.FecIniReal
        ? "FecIniReal"
        : "Creado el";
  const value = field(payload, key);
  return value ? value.split(" ")[0] : "SIN FECHA";
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

function collectOcData(row) {
  const id = row.dataset.ocId;
  const map = {
    salida_planta: "salida",
    llegada_destino: "llegada",
    inicio_retorno: "retorno",
    fin_de_ciclo: "fin",
    carga_retorno: "carga",
    observaciones: "obs",
    ubicacion: "ubi",
    estado_fisico: "estado",
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
  const keys = [
    String(unit.tracto || "").trim(),
    String(unit.placa || "").trim(),
    nplate(unit.placa),
  ];
  const out = [];
  const seen = new Set();
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}|${r.ruta}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function ocRowHtml(oc) {
  const p = oc.payload || {};
  const o = oc.original_payload || p;
  const id = oc.id;
  const parihuelas = isParihuelas(p);
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";
  const closedPrep = draft === "CERRAR";
  const hasChanges =
    oc.borrador &&
    (draft === "CERRAR" || Object.keys(oc.borrador.cambios || {}).length > 0);

  const inp = (suffix, label, key) => `
    <label class="sg-field">
      <span>${label}</span>
      <div class="paste-input">
        <input data-f="${id}-${suffix}" data-original="${esc(field(o, key))}" value="${esc(field(p, key))}">
        <button type="button" data-paste="${id}-${suffix}" title="Pegar">📋</button>
      </div>
    </label>`;

  return `
    <article class="sg-oc ${parihuelas ? "sg-parihuelas" : ""} ${closedPrep ? "sg-closed" : ""} ${hasChanges ? "sg-dirty" : ""}"
      data-oc-id="${id}">
      <div class="sg-oc-head">
        <div>
          <b>OC ${esc(oc.orden_carga)}</b>
          <strong>${esc(p.Ruta || "—")}</strong>
          <small>${esc(p.CARGA || "")}</small>
          <span class="sg-created">CREADA ${esc(ocCreationDate(p))}</span>
          ${parihuelas ? `<span class="sg-tag-parihuelas">PARIHUELAS</span>` : ""}
        </div>
        <em class="sg-draft">${esc(draft)}</em>
      </div>
      <div class="sg-fields">
        ${inp("salida", "SALIDA PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}
        ${inp("llegada", "LLEGADA DESTINO", "FECHA LLEGADA A DESTINO")}
        ${inp("retorno", "INICIO RETORNO", "FECHA INICIO DE RETORNO")}
        ${inp("fin", "FIN DE CICLO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}
        <label class="sg-field">
          <span>CARGA DE RETORNO</span>
          <input data-f="${id}-carga" data-original="${esc(field(o, "CARGA DE RETORNO"))}" value="${esc(field(p, "CARGA DE RETORNO"))}">
        </label>
        <label class="sg-field">
          <span>UBICACIÓN</span>
          <input data-f="${id}-ubi" data-original="${esc(field(o, "UBICACIÓN"))}" value="${esc(field(p, "UBICACIÓN"))}">
        </label>
        <label class="sg-field sg-field-wide">
          <span>OBSERVACIONES</span>
          <textarea data-f="${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}">${esc(field(p, "OBSERVACIONES"))}</textarea>
        </label>
        <label class="sg-field">
          <span>ESTADO</span>
          <select data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || p.ESTADO || "")}">
            ${stateOptions(field(p, "ESTADO") || p.ESTADO || "")}
          </select>
        </label>
      </div>
      <div class="sg-oc-actions">
        <button type="button" class="primary" data-save="${id}">GUARDAR OC</button>
        <button type="button" class="danger" data-close="${id}">FIN DE CICLO</button>
      </div>
    </article>`;
}

function unitCardHtml(unit) {
  const k = nplate(unit.placa);
  const reviewed = state.reviewed.has(k);
  const gps = getStatus(unit.placa);
  const montados = montadosFor(unit);
  const ocs = unit.ocs || [];
  const hasParihuelas = ocs.some((x) => isParihuelas(x.payload || {}));

  return `
    <section class="sg-unit ${reviewed ? "sg-unit-reviewed" : ""} ${hasParihuelas ? "sg-unit-has-parihuelas" : ""}"
      data-placa="${esc(k)}" data-open="1">
      <header class="sg-unit-head">
        <button type="button" class="sg-unit-toggle" data-toggle-unit="${esc(k)}" title="Plegar/desplegar">
          <b>${esc(shortTracto(unit.tracto || unit.placa))}</b>
          <span class="muted">${esc(unit.placa)}</span>
          <small>${ocs.length} OC · ${esc(unit.conductor || "—")}</small>
        </button>
        <div class="sg-unit-meta">
          ${hasParihuelas ? `<span class="sg-tag-parihuelas">PARIHUELAS</span>` : ""}
          <span class="sg-gps" title="Estado precarga GPS">${esc(gps?.estado || (isRunning() ? "EN COLA" : "SIN PRECARGA"))}${gps?.puntos != null ? ` · ${gps.puntos} pts` : ""}</span>
          <button type="button" class="secondary sg-btn-reviewed ${reviewed ? "done" : ""}" data-review="${esc(unit.placa)}">
            ${reviewed ? "REVISADA ✓" : "MARCAR REVISADA"}
          </button>
        </div>
      </header>
      ${
        montados.length
          ? `<div class="sg-montados">${montados
              .map(
                (r) =>
                  `<span class="sg-montado ${r.tipo === "MONTADO EN" ? "mounted" : ""}"><b>${esc(r.tipo)}</b> ${esc(shortTracto(r.relacionado))} <small>${esc(r.ruta)} · ${esc(r.fecha)}</small></span>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="sg-unit-body">
        ${
          ocs.length
            ? ocs.map(ocRowHtml).join("")
            : `<p class="muted sg-empty">SIN OC ABIERTA</p>`
        }
      </div>
    </section>`;
}

function categoryOf(unit) {
  const k = nplate(unit.placa);
  if (state.reviewed.has(k)) return "revisadas";
  // Si todas las OCs tienen borrador CERRAR → aún en activas/revisadas según revisada;
  // CERRADAS es histórico (OCs ya consolidadas), no borradores de cierre.
  return "activas";
}

export async function mount(container, runtime) {
  cleanup = [];
  state = createState();
  bindRuntime(runtime);
  document.body.classList.add("tracking-active");
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento (vista grilla)…</p></section>`;
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

async function loadUnitsWithDetails() {
  const lista = await trackApi({ action: "lista" });
  const plates = lista.placas || [];
  const reviewed = new Set(
    plates.filter((p) => p.revisada).map((p) => nplate(p.placa)),
  );

  // Auto SIN MOVIMIENTO → revisada (como producción)
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

  // Detalle en paralelo (lotes de 6)
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
            revisada: reviewed.has(nplate(u.placa)),
          };
        } catch (e) {
          return {
            placa: u.placa,
            tracto: u.tracto,
            conductor: u.conductor || "",
            ocs: [],
            error: e.message,
            revisada: reviewed.has(nplate(u.placa)),
          };
        }
      }),
    );
    units.push(...details);
  }

  // Orden: activas primero, luego revisadas; dentro por tracto
  units.sort((a, b) => {
    const ra = reviewed.has(nplate(a.placa)) ? 1 : 0;
    const rb = reviewed.has(nplate(b.placa)) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return String(a.tracto || a.placa).localeCompare(String(b.tracto || b.placa));
  });

  return { units, reviewed, total_ocs: lista.total_ocs || 0 };
}

async function loadMontados() {
  const map = new Map();
  try {
    const hasta = limaTodayKey();
    const desde = shiftDateKey(hasta, -14);
    const mgf = await montadosApi({ action: "listar", desde, hasta });
    for (const r of mgf.rows || []) {
      const fecha = r.fecha_texto || r.fecha || "";
      const ruta = r.ruta || "";
      const push = (key, tipo, rel) => {
        if (!key) return;
        const list = map.get(key) || [];
        list.push({ tipo, relacionado: rel, ruta, fecha });
        map.set(key, list);
      };
      push(r.tracto_corto, "MONTADO EN", r.tracto_largo);
      push(r.tracto_largo, "MONTANDO", r.tracto_corto);
    }
  } catch (_) {}
  return map;
}

async function bootstrap(container, runtime) {
  ensureStyles();
  const [{ units, reviewed, total_ocs }, montadosMap] = await Promise.all([
    loadUnitsWithDetails(),
    loadMontados(),
  ]);
  state.units = units;
  state.reviewed = reviewed;
  state.montadosMap = montadosMap;

  renderShell(container, runtime, total_ocs);
  paintGrid(container);
  wireChrome(container, runtime);
  wireGrid(container, runtime);

  const off = runtime.bus.on("cemento:precarga-unit", () => {
    // actualizar badges GPS sin re-fetch completo
    container.querySelectorAll(".sg-unit[data-placa]").forEach((el) => {
      const placa = el.dataset.placa;
      const unit = state.units.find((u) => nplate(u.placa) === placa);
      if (!unit) return;
      const badge = el.querySelector(".sg-gps");
      const gps = getStatus(unit.placa);
      if (badge) {
        badge.textContent = `${gps?.estado || (isRunning() ? "EN COLA" : "SIN PRECARGA")}${gps?.puntos != null ? ` · ${gps.puntos} pts` : ""}`;
      }
    });
    const pre = container.querySelector("#sg-preload");
    const m = loadMeta();
    const c = counts(m, state.units.length);
    if (pre) {
      pre.textContent = isRunning()
        ? `PRECARGA ${c.done}/${m?.total || state.units.length}`
        : `GPS LISTOS ${c.ready}`;
    }
  });
  cleanup.push(off);
}

function renderShell(container, runtime, total_ocs) {
  const m = loadMeta();
  const c = counts(m, state.units.length);
  const running = isRunning();
  const nActive = state.units.filter((u) => !state.reviewed.has(nplate(u.placa))).length;
  const nRev = state.units.filter((u) => state.reviewed.has(nplate(u.placa))).length;

  container.innerHTML = `
    <section class="desktop-tracking v2 v3 grid-test grid-03 sg-grid-root">
      <header class="sg-header">
        <div>
          <b>CEMENTO · SEGUIMIENTO</b>
          <small>Vista única · placas como celdas · OCs debajo</small>
        </div>
        <span id="sg-preload">${running ? `PRECARGA ${c.done}/${m?.total || state.units.length}` : `GPS LISTOS ${c.ready}`}</span>
        <span id="sg-counts">PLACAS ${state.units.length} · OCs ${total_ocs} · ACTIVAS ${nActive} · REVISADAS ${nRev}</span>
        <button type="button" id="sg-partial">GUARDAR PARCIAL</button>
        <button type="button" id="sg-finish">TERMINAR SEGUIMIENTO</button>
        <button type="button" id="sg-pause">PAUSAR Y VOLVER</button>
      </header>
      <div class="sg-main">
        <section class="sg-section" id="sg-sec-activas">
          <h2 class="sg-section-title">ACTIVAS · <b id="sg-n-activas">${nActive}</b> placas</h2>
          <div class="sg-section-body" id="sg-body-activas"></div>
        </section>
        <section class="sg-section" id="sg-sec-revisadas">
          <h2 class="sg-section-title">REVISADAS · <b id="sg-n-revisadas">${nRev}</b> placas</h2>
          <div class="sg-section-body" id="sg-body-revisadas"></div>
        </section>
        <section class="sg-section sg-section-closed" id="sg-sec-cerradas">
          <button type="button" class="sg-section-toggle" id="sg-toggle-cerradas">
            CERRADAS (histórico por unidad) · <span id="sg-cerradas-label">VER ▼</span>
          </button>
          <div class="sg-section-body hidden" id="sg-body-cerradas">
            <p class="muted">Al expandir se consulta el histórico cerrado de cada tracto (no reabre OCs).</p>
            <div id="sg-cerradas-content"></div>
          </div>
        </section>
      </div>
    </section>`;
}

function paintGrid(container) {
  const act = container.querySelector("#sg-body-activas");
  const rev = container.querySelector("#sg-body-revisadas");
  if (!act || !rev) return;
  const activas = state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
  const revisadas = state.units.filter((u) => state.reviewed.has(nplate(u.placa)));
  act.innerHTML = activas.length
    ? activas.map(unitCardHtml).join("")
    : `<p class="muted">No hay placas activas pendientes de revisión.</p>`;
  rev.innerHTML = revisadas.length
    ? revisadas.map(unitCardHtml).join("")
    : `<p class="muted">Aún no hay placas marcadas como revisadas.</p>`;
  const na = container.querySelector("#sg-n-activas");
  const nr = container.querySelector("#sg-n-revisadas");
  if (na) na.textContent = String(activas.length);
  if (nr) nr.textContent = String(revisadas.length);
  const countsEl = container.querySelector("#sg-counts");
  if (countsEl) {
    const totalOcs = state.units.reduce((n, u) => n + (u.ocs?.length || 0), 0);
    countsEl.textContent = `PLACAS ${state.units.length} · OCs ${totalOcs} · ACTIVAS ${activas.length} · REVISADAS ${revisadas.length}`;
  }
}

function wireChrome(container, runtime) {
  container.querySelector("#sg-pause")?.addEventListener("click", () => {
    document.body.classList.remove("tracking-active");
    document.querySelector('nav button[data-route="home"]')?.click();
  });

  container.querySelector("#sg-partial")?.addEventListener("click", async () => {
    const b = container.querySelector("#sg-partial");
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "GUARDANDO…";
    try {
      const x = await trackApi({
        action: "guardar_parcial",
        revisadas: [...state.reviewed],
      });
      alert(x.mensaje || `Corte parcial: ${state.reviewed.size}/${state.units.length} placas revisadas.`);
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  });

  container.querySelector("#sg-finish")?.addEventListener("click", async () => {
    if (state.reviewed.size !== state.units.length) {
      alert(`Incompleto: ${state.reviewed.size}/${state.units.length} placas revisadas.`);
      return;
    }
    if (!confirm("¿Terminar seguimiento y consolidar?")) return;
    const b = container.querySelector("#sg-finish");
    b.disabled = true;
    b.textContent = "TERMINANDO…";
    try {
      const x = await trackApi({
        action: "consolidar",
        revisadas: [...state.reviewed],
      });
      alert(x.mensaje || "Seguimiento terminado.");
      document.body.classList.remove("tracking-active");
      document.querySelector('nav button[data-route="reporte"]')?.click();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "TERMINAR SEGUIMIENTO";
    }
  });

  container.querySelector("#sg-toggle-cerradas")?.addEventListener("click", async () => {
    const body = container.querySelector("#sg-body-cerradas");
    const label = container.querySelector("#sg-cerradas-label");
    state.closedOpen = !state.closedOpen;
    body?.classList.toggle("hidden", !state.closedOpen);
    if (label) label.textContent = state.closedOpen ? "OCULTAR ▲" : "VER ▼";
    if (state.closedOpen) await loadClosedSection(container);
  });
}

async function loadClosedSection(container) {
  const box = container.querySelector("#sg-cerradas-content");
  if (!box) return;
  box.innerHTML = `<p class="muted">Consultando histórico cerrado…</p>`;
  const parts = [];
  for (const u of state.units) {
    const tracto = u.tracto || u.placa;
    try {
      const d = await trackApi({ action: "cerradas_por_tracto", tracto });
      const rows = d.rows || d.ocs || d.cerradas || [];
      if (!rows.length) continue;
      parts.push(`
        <div class="sg-closed-unit">
          <b>${esc(shortTracto(tracto))}</b>
          <ul>${rows
            .slice(0, 12)
            .map((r) => {
              const oc = r.orden_carga || r.OC || r.id || "—";
              const ruta = r.ruta || r.payload?.Ruta || "";
              return `<li>OC ${esc(oc)} · ${esc(ruta)}</li>`;
            })
            .join("")}</ul>
        </div>`);
    } catch (_) {}
  }
  box.innerHTML = parts.length
    ? parts.join("")
    : `<p class="muted">Sin OCs cerradas recientes para estas unidades (o sin permiso de consulta).</p>`;
}

function wireGrid(container, runtime) {
  // Event delegation on main grid
  const main = container.querySelector(".sg-main");
  if (!main) return;

  const onClick = async (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;

    // Toggle unit body
    if (t.dataset.toggleUnit) {
      const card = main.querySelector(`.sg-unit[data-placa="${CSS.escape(t.dataset.toggleUnit)}"]`);
      if (!card) return;
      const open = card.dataset.open !== "0";
      card.dataset.open = open ? "0" : "1";
      card.querySelector(".sg-unit-body")?.classList.toggle("hidden", open);
      return;
    }

    // Paste
    if (t.dataset.paste) {
      try {
        const text = await navigator.clipboard.readText();
        const input = main.querySelector(`[data-f="${t.dataset.paste}"]`);
        if (input) {
          input.value = text;
          input.dispatchEvent(new Event("input"));
        }
      } catch {
        alert("No se pudo leer el portapapeles.");
      }
      return;
    }

    // Marcar revisada
    if (t.dataset.review) {
      const placa = t.dataset.review;
      try {
        await trackApi({ action: "marcar_revisada", placa });
        state.reviewed.add(nplate(placa));
        paintGrid(container);
        // re-wire is automatic via paint - need rebind? paint replaces DOM so re-delegate is on main - OK
      } catch (e) {
        alert(e.message);
      }
      return;
    }

    // Guardar OC
    if (t.dataset.save) {
      const row = t.closest(".sg-oc");
      const datos = collectOcData(row);
      t.disabled = true;
      const old = t.textContent;
      t.textContent = "GUARDANDO…";
      try {
        await trackApi({ action: "guardar", id: +t.dataset.save, datos });
        t.textContent = "GUARDADO";
        row.classList.add("sg-saved");
        row.querySelectorAll("[data-original]").forEach((el) => {
          el.dataset.original = el.value;
        });
        const em = row.querySelector(".sg-draft");
        if (em && !em.textContent) em.textContent = "GUARDAR";
      } catch (e) {
        alert(e.message);
        t.textContent = old;
      } finally {
        t.disabled = false;
      }
      return;
    }

    // Fin de ciclo
    if (t.dataset.close) {
      if (!confirm("¿Preparar FIN DE CICLO para esta OC?")) return;
      const row = t.closest(".sg-oc");
      const datos = collectOcData(row);
      t.disabled = true;
      try {
        await trackApi({ action: "cerrar", id: +t.dataset.close, datos });
        t.textContent = "CIERRE PREPARADO";
        row.classList.add("sg-closed");
        const em = row.querySelector(".sg-draft");
        if (em) em.textContent = "CERRAR";
      } catch (e) {
        alert(e.message);
      } finally {
        t.disabled = false;
      }
    }
  };

  main.addEventListener("click", onClick);
  cleanup.push(() => main.removeEventListener("click", onClick));
}

function ensureStyles() {
  if (document.getElementById("cem-sg-grid-style")) return;
  const st = document.createElement("style");
  st.id = "cem-sg-grid-style";
  st.textContent = `
    .sg-grid-root { display:flex; flex-direction:column; gap:0; min-height:70vh; }
    .sg-header {
      display:flex; flex-wrap:wrap; gap:10px; align-items:center;
      padding:10px 12px; border-bottom:1px solid #1e3a5f; background:#071525;
    }
    .sg-header b { display:block; }
    .sg-header small { color:#94a3b8; }
    .sg-main { padding:12px; display:flex; flex-direction:column; gap:18px; overflow:auto; }
    .sg-section-title { margin:0 0 10px; font-size:13px; letter-spacing:.04em; color:#93c5fd; }
    .sg-section-body { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
    .sg-section-toggle {
      width:100%; text-align:left; padding:10px 12px; font-weight:800;
      background:#0b1728; border:1px solid #1e3a5f; color:#e2e8f0; border-radius:8px; cursor:pointer;
    }
    .sg-unit {
      border:1px solid #1e3a5f; border-radius:12px; background:#0b1728; overflow:hidden;
      display:flex; flex-direction:column;
    }
    .sg-unit-reviewed { opacity:.92; border-color:#334155; }
    .sg-unit-head {
      display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px;
      padding:10px 12px; border-bottom:1px solid #1e3a5f; background:#0a1a2e;
    }
    .sg-unit-toggle {
      border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; padding:0;
    }
    .sg-unit-toggle b { font-size:18px; display:block; }
    .sg-unit-meta { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .sg-gps { font-size:11px; color:#94a3b8; }
    .sg-montados { padding:6px 12px; display:flex; flex-wrap:wrap; gap:6px; background:#081422; }
    .sg-montado { font-size:11px; padding:3px 8px; border-radius:999px; background:#132337; border:1px solid #1e3a5f; }
    .sg-montado.mounted { border-color:#38bdf8; color:#7dd3fc; }
    .sg-montado:not(.mounted) { border-color:#a3e635; color:#bef264; }
    .sg-unit-body { padding:10px; display:flex; flex-direction:column; gap:10px; }
    .sg-oc {
      border:1px solid #1e3a5f; border-radius:10px; padding:10px; background:#071525;
    }
    .sg-oc.sg-parihuelas {
      background:#f2d778 !important;
      border-color:#b28b17 !important;
      color:#1a1200;
    }
    .sg-oc.sg-parihuelas input,
    .sg-oc.sg-parihuelas textarea,
    .sg-oc.sg-parihuelas select {
      background:#fff !important;
      color:#0f172a;
    }
    .sg-oc.sg-parihuelas .sg-field span { color:#3f2c00; }
    .sg-tag-parihuelas {
      display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:900;
      background:#dfb82f; border:1px solid #98740c; color:#3f2c00;
    }
    .sg-oc-head { display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; }
    .sg-oc-head b { margin-right:6px; }
    .sg-fields {
      display:grid; grid-template-columns:1fr 1fr; gap:8px;
    }
    .sg-field { display:flex; flex-direction:column; gap:3px; font-size:11px; }
    .sg-field span { font-weight:700; opacity:.8; }
    .sg-field-wide { grid-column:1 / -1; }
    .sg-field input, .sg-field textarea, .sg-field select {
      padding:6px 8px; border-radius:6px; border:1px solid #1e3a5f; background:#0b1728; color:#e2e8f0;
    }
    .paste-input { display:flex; gap:4px; }
    .paste-input input { flex:1; }
    .sg-oc-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .sg-btn-reviewed.done { border-color:#22c55e; color:#86efac; }
    .sg-closed-unit { margin:10px 0; padding:10px; border:1px solid #1e3a5f; border-radius:8px; }
    .sg-closed-unit ul { margin:6px 0 0 16px; }
    .hidden { display:none !important; }
    @media (max-width:700px) {
      .sg-fields { grid-template-columns:1fr; }
      .sg-section-body { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(st);
}
