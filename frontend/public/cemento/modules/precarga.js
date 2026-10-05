/**
 * UI del módulo Precarga (Cemento).
 * La descarga GPS corre en precarga-engine.js (sigue en segundo plano
 * si el operador pasa a Seguimiento).
 */
import { esc, moduleHead, trackApi } from "../api-client.js";
import {
  bindRuntime,
  loadMeta,
  saveMeta,
  counts,
  isRunning,
  getCurrentPlaca,
  nplate,
  startPreload,
  stopPreload,
  normalizeDesde,
  resolveDesde,
  resolveHasta,
  DONE_STATES,
} from "../precarga-engine.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  bindRuntime(runtime);
  container.innerHTML = `<section class="panel"><p class="muted">Cargando precarga…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en precarga</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  // NO detiene el motor: la precarga sigue en segundo plano.
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

async function fetchUnits() {
  const lista = await trackApi({ action: "lista" });
  const map = new Map();
  for (const p of lista.placas || []) {
    const placa = String(p.placa || p.tracto || "").trim();
    const tracto = String(p.tracto || p.placa || "").trim();
    if (!placa && !tracto) continue;
    const key = nplate(placa || tracto);
    if (!map.has(key)) {
      map.set(key, {
        placa: placa || tracto,
        tracto: tracto || placa,
        conductor: p.conductor || "",
        ocs: p.ocs ?? 0,
      });
    }
  }
  return { units: [...map.values()], total_ocs: lista.total_ocs || 0 };
}

function paintRow(container, key, result) {
  const tr = container.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  if (!tr || !result) return;
  const pts = tr.querySelector(".col-pts");
  const vis = tr.querySelector(".col-vis");
  const st = tr.querySelector(".col-st");
  if (pts) pts.textContent = result.puntos ?? "—";
  if (vis) vis.textContent = result.visitas ?? "—";
  if (st) {
    st.innerHTML =
      `<span class="state">${esc(result.estado)}</span>` +
      (result.mensaje ? ` <small class="muted">${esc(result.mensaje)}</small>` : "");
  }
}

async function render(container, runtime) {
  let units = [];
  let totalOcs = 0;
  try {
    const data = await fetchUnits();
    units = data.units;
    totalOcs = data.total_ocs;
  } catch (e) {
    container.innerHTML =
      moduleHead("Precargar rutas", "GPS · segundo plano") +
      `<section class="error-box"><h2>No se pudo cargar la lista</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  let meta = loadMeta();
  const desdeDefault = meta?.desde || resolveDesde();
  const hastaDefault = meta?.hasta || resolveHasta();
  const runningNow = isRunning();
  const c0 = counts(meta, units.length);

  container.innerHTML =
    moduleHead(
      "Precargar rutas",
      `${units.length} unidades · ${totalOcs} OCs · GPS en segundo plano`,
    ) +
    `<section class="notice">
      <b>Vinculado con Seguimiento.</b> Puede iniciar la precarga y pasar a
      <b>Seguimiento diario</b> con las unidades ya listas (COMPLETO / SIN MOVIMIENTO).
      El resto sigue cargando en segundo plano; no se detiene al cambiar de módulo.
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Control de precarga</h2>
          <p class="muted" id="cem-pre-range">Desde ${esc(desdeDefault)} → hasta ${esc(hastaDefault)} (hora Lima)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="cem-pre-start" class="primary" ${units.length && !runningNow ? "" : "disabled"}>
            ${runningNow ? "EN CURSO…" : meta && !meta.completo ? "REANUDAR" : "INICIAR PRECARGA"}
          </button>
          <button type="button" id="cem-pre-stop" class="secondary" ${runningNow ? "" : "disabled"}>DETENER</button>
          <button type="button" id="cem-pre-refresh" class="secondary">ACTUALIZAR LISTA DE UNIDADES</button>
        </div>
      </div>
      <div class="activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px">
        <div><small>ESTADO</small><b id="cem-pre-state">${runningNow ? "EN CURSO · 2º PLANO" : meta?.completo ? "COMPLETO" : meta ? "PENDIENTE" : "LISTO"}</b></div>
        <div><small>PROGRESO</small><b id="cem-pre-count">${c0.done}/${units.length}</b></div>
        <div><small>LISTAS SEG.</small><b id="cem-pre-ok">${c0.ready}</b></div>
        <div><small>ERRORES</small><b id="cem-pre-errors">${c0.errors}</b></div>
        <div><small>ACTUAL</small><b id="cem-pre-current">${esc(getCurrentPlaca() || "—")}</b></div>
      </div>
      <div class="progress" style="margin-top:10px;height:8px;background:#1e3a5f;border-radius:99px;overflow:hidden">
        <span id="cem-pre-bar" style="display:block;height:100%;width:${units.length ? Math.round((100 * c0.done) / units.length) : 0}%;background:#38bdf8"></span>
      </div>
      <p class="muted" style="margin-top:8px">
        Corte de inicio CLocator:
        <input id="cem-pre-desde" type="text" value="${esc(desdeDefault)}"
          style="min-width:180px;margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0"
          placeholder="DD/MM/YYYY HH:mm:ss" ${runningNow ? "disabled" : ""} />
        <button type="button" id="cem-pre-save-desde" class="secondary" style="margin-left:6px" ${runningNow ? "disabled" : ""}>
          APLICAR NUEVO CORTE
        </button>
      </p>
      <p class="muted" style="margin-top:6px">
        Cambiar el corte reinicia <b>todas</b> las placas. Actualizar lista solo refresca unidades con OC abierta.
      </p>
    </section>

    <section class="panel">
      <div class="panel-title"><h2>Unidades</h2><span class="muted">resultado por placa</span></div>
      ${
        !units.length
          ? `<p class="muted">No hay unidades con OC abierta.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">TRACTO</th>
                <th style="text-align:left;padding:8px">PLACA</th>
                <th style="text-align:right;padding:8px">PUNTOS</th>
                <th style="text-align:right;padding:8px">VISITAS</th>
                <th style="text-align:left;padding:8px">ESTADO GPS</th>
              </tr></thead>
              <tbody>
                ${units
                  .map((u) => {
                    const k = nplate(u.placa);
                    const r = meta?.resultados?.[k];
                    return `<tr style="border-top:1px solid #1e3a5f" data-key="${esc(k)}">
                      <td style="padding:8px">${esc(u.tracto)}</td>
                      <td style="padding:8px"><b>${esc(u.placa)}</b></td>
                      <td style="padding:8px;text-align:right" class="col-pts">${r ? esc(r.puntos ?? "—") : "—"}</td>
                      <td style="padding:8px;text-align:right" class="col-vis">${r ? esc(r.visitas ?? "—") : "—"}</td>
                      <td style="padding:8px" class="col-st"><span class="state">${esc(r?.estado || "PENDIENTE")}</span>${r?.mensaje ? ` <small class="muted">${esc(r.mensaje)}</small>` : ""}</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table></div>`
      }
    </section>`;

  const btnStart = container.querySelector("#cem-pre-start");
  const btnStop = container.querySelector("#cem-pre-stop");
  const btnRefresh = container.querySelector("#cem-pre-refresh");
  const btnDesde = container.querySelector("#cem-pre-save-desde");
  const inputDesde = container.querySelector("#cem-pre-desde");

  const refreshHud = () => {
    meta = loadMeta();
    const c = counts(meta, units.length);
    const el = (id) => container.querySelector(id);
    if (el("#cem-pre-count")) el("#cem-pre-count").textContent = `${c.done}/${units.length}`;
    if (el("#cem-pre-ok")) el("#cem-pre-ok").textContent = String(c.ready);
    if (el("#cem-pre-errors")) el("#cem-pre-errors").textContent = String(c.errors);
    if (el("#cem-pre-bar")) {
      el("#cem-pre-bar").style.width = `${units.length ? Math.round((100 * c.done) / units.length) : 0}%`;
    }
    if (el("#cem-pre-current")) el("#cem-pre-current").textContent = getCurrentPlaca() || "—";
    if (el("#cem-pre-state")) {
      el("#cem-pre-state").textContent = isRunning()
        ? "EN CURSO · 2º PLANO"
        : meta?.completo
          ? c.errors
            ? "COMPLETO CON ERRORES"
            : "COMPLETO"
          : meta
            ? "PENDIENTE"
            : "LISTO";
    }
    if (btnStart) {
      btnStart.disabled = isRunning() || !units.length;
      btnStart.textContent = isRunning()
        ? "EN CURSO…"
        : meta && !meta.completo
          ? "REANUDAR"
          : "INICIAR PRECARGA";
    }
    if (btnStop) btnStop.disabled = !isRunning();
  };

  // Live updates while this screen is open
  const offUnit = runtime.bus.on("cemento:precarga-unit", (p) => {
    if (p?.placa) paintRow(container, nplate(p.placa), p);
    refreshHud();
  });
  const offProg = runtime.bus.on("cemento:precarga-progress", refreshHud);
  const offBatch = runtime.bus.on("cemento:precarga-batch", refreshHud);
  cleanup.push(offUnit, offProg, offBatch);

  btnRefresh?.addEventListener("click", () => {
    if (isRunning()) {
      // Permitir refrescar lista aunque corra en fondo: solo re-render UI
    }
    render(container, runtime).catch((e) => alert(e.message));
  });
  cleanup.push(() => {});

  btnDesde?.addEventListener("click", () => {
    if (isRunning()) return alert("Detenga la precarga antes de cambiar el corte.");
    const full = normalizeDesde(inputDesde?.value);
    if (!full) return alert("Formato inválido. Use DD/MM/YYYY HH:mm:ss");
    const prev = loadMeta()?.desde || "";
    if (prev && prev !== full) {
      if (
        !confirm(
          `Cambió el corte.\nAnterior: ${prev}\nNuevo: ${full}\n\nSe reiniciarán TODAS las placas. ¿Continuar?`,
        )
      ) {
        if (inputDesde) inputDesde.value = prev;
        return;
      }
    }
    localStorage.setItem("cemento_rango_desde", full);
    meta = {
      id: crypto.randomUUID(),
      desde: full,
      hasta: resolveHasta(),
      total: units.length,
      completo: false,
      resultados: {},
      intentos: {},
      started_at: Date.now(),
    };
    saveMeta(meta);
    try {
      runtime.bus.emit("cemento:precarga-reset", { desde: full, forceNew: true, corteCambio: true });
    } catch (_) {}
    for (const u of units) {
      paintRow(container, nplate(u.placa), { estado: "PENDIENTE", puntos: "—", visitas: "—" });
    }
    const rangeEl = container.querySelector("#cem-pre-range");
    if (rangeEl) rangeEl.textContent = `Desde ${full} → hasta ${resolveHasta()} (hora Lima) · resultados reiniciados`;
    refreshHud();
  });

  btnStop?.addEventListener("click", () => {
    stopPreload();
    const st = container.querySelector("#cem-pre-state");
    if (st) st.textContent = "DETENIENDO…";
  });

  btnStart?.addEventListener("click", () => {
    if (isRunning() || !units.length) return;
    const desde = normalizeDesde(inputDesde?.value) || resolveDesde();
    btnStart.disabled = true;
    btnStart.textContent = "EN CURSO…";
    if (btnStop) btnStop.disabled = false;
    startPreload(units, { desde })
      .then(() => refreshHud())
      .catch((e) => {
        alert(e.message);
        refreshHud();
      });
  });

  refreshHud();

  // Reanudar sola si quedó incompleta (p.ej. al volver de Seguimiento o tras NetworkError)
  if (!isRunning() && units.length && meta && !meta.completo) {
    const pending = units.some((u) => {
      const s = meta.resultados?.[nplate(u.placa)]?.estado;
      return !DONE_STATES.has(s);
    });
    if (pending) {
      const desde = normalizeDesde(inputDesde?.value) || resolveDesde();
      if (btnStart) {
        btnStart.disabled = true;
        btnStart.textContent = "EN CURSO…";
      }
      if (btnStop) btnStop.disabled = false;
      startPreload(units, { desde })
        .then(() => refreshHud())
        .catch(() => refreshHud());
    }
  }
}
