/**
 * UI del módulo Precarga (Cerro Verde).
 * La descarga GPS corre en precarga-engine.js (sigue en segundo plano
 * si el operador pasa a Seguimiento u otro módulo).
 *
 * Independiente de Cemento.
 */
import { esc, moduleHead, trackApi } from "../api-client.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getCurrentPlaca,
  nplate,
  startPreload,
  stopPreload,
  normalizeDesde,
  resolveDesde,
  resolveHasta,
  clearMeta,
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
    try {
      fn();
    } catch (_) {}
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
      });
    }
  }
  return {
    units: [...map.values()],
    total_ocs: lista.total_ocs || 0,
    schema_ready: lista.schema_ready !== false,
    fuente: lista.fuente || "",
  };
}

function paintRow(container, key, result) {
  const tr = container.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  if (!tr || !result) return;
  const pts = tr.querySelector(".col-pts");
  const st = tr.querySelector(".col-st");
  if (pts) pts.textContent = result.puntos ?? "—";
  if (st) {
    st.innerHTML =
      `<span class="state">${esc(result.estado)}</span>` +
      (result.mensaje ? ` <small class="muted">${esc(result.mensaje)}</small>` : "");
  }
}

async function render(container, runtime) {
  let units = [];
  let totalOcs = 0;
  let schemaReady = true;
  let fuente = "";
  try {
    const data = await fetchUnits();
    units = data.units;
    totalOcs = data.total_ocs;
    schemaReady = data.schema_ready;
    fuente = data.fuente;
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
      <b>Seguimiento</b> con las unidades ya listas (COMPLETO / SIN MOVIMIENTO / SIN PUNTOS).
      El resto sigue cargando en segundo plano; <b>no se detiene</b> al cambiar de módulo.
      ${fuente ? `<br><small class="muted">${esc(fuente)}</small>` : ""}
    </section>
    ${
      !schemaReady
        ? `<section class="notice" style="border-color:#b45309">
            <b>BASE WEB PENDIENTE.</b> La lista actual podría no estar reconciliada.
            Evite reiniciar la precarga hasta confirmar el esquema.
          </section>`
        : ""
    }

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Control de precarga</h2>
          <p class="muted" id="cv-pre-range">Desde ${esc(desdeDefault)} → hasta ${esc(hastaDefault)} (hora Lima)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="cv-pre-start" class="primary" ${units.length && !runningNow && schemaReady ? "" : "disabled"}>
            ${runningNow ? "EN CURSO…" : meta && !meta.completo ? "REANUDAR" : "INICIAR PRECARGA"}
          </button>
          <button type="button" id="cv-pre-stop" class="secondary" ${runningNow ? "" : "disabled"}>DETENER</button>
          <button type="button" id="cv-pre-reset" class="secondary" ${runningNow || !schemaReady ? "disabled" : ""}>REINICIAR</button>
          <button type="button" id="cv-pre-refresh" class="secondary">ACTUALIZAR LISTA</button>
        </div>
      </div>
      <div class="activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px">
        <div><small>ESTADO</small><b id="cv-pre-state">${runningNow ? "EN CURSO (2º PLANO)" : meta?.completo ? "COMPLETO" : meta ? "PENDIENTE" : "LISTO"}</b></div>
        <div><small>PROGRESO</small><b id="cv-pre-count">${c0.done}/${units.length}</b></div>
        <div><small>LISTAS SEG.</small><b id="cv-pre-ok">${c0.ready}</b></div>
        <div><small>ERRORES</small><b id="cv-pre-errors">${c0.errors}</b></div>
        <div><small>ACTUAL</small><b id="cv-pre-current">${esc(getCurrentPlaca() || "—")}</b></div>
      </div>
      <div class="progress" style="margin-top:10px;height:8px;background:#1e3a5f;border-radius:99px;overflow:hidden">
        <span id="cv-pre-bar" style="display:block;height:100%;width:${units.length ? Math.round((100 * c0.done) / units.length) : 0}%;background:#38bdf8"></span>
      </div>
      <p class="muted" style="margin-top:8px">
        Corte de inicio CLocator:
        <input id="cv-pre-desde" type="text" value="${esc(desdeDefault)}"
          style="min-width:180px;margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0"
          placeholder="DD/MM/YYYY HH:mm:ss" ${runningNow ? "disabled" : ""} />
        <button type="button" id="cv-pre-save-desde" class="secondary" style="margin-left:6px" ${runningNow ? "disabled" : ""}>
          APLICAR NUEVO CORTE
        </button>
      </p>
      <p class="muted" style="margin-top:6px">
        Cambiar el corte reinicia <b>todas</b> las placas. Actualizar lista solo refresca unidades del grupo SMCV.
      </p>
    </section>

    <section class="panel">
      <div class="panel-title"><h2>Unidades</h2><span class="muted">resultado por placa</span></div>
      ${
        !units.length
          ? `<p class="muted">No hay unidades en el grupo SMCV activo.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">#</th>
                <th style="text-align:left;padding:8px">TRACTO</th>
                <th style="text-align:left;padding:8px">PLACA</th>
                <th style="text-align:left;padding:8px">PUNTOS</th>
                <th style="text-align:left;padding:8px">ESTADO</th>
              </tr></thead>
              <tbody>
                ${units
                  .map((u, i) => {
                    const k = nplate(u.placa);
                    const r = meta?.resultados?.[k];
                    return `<tr data-key="${esc(k)}">
                      <td style="padding:8px">${i + 1}</td>
                      <td style="padding:8px"><b>${esc(u.tracto)}</b></td>
                      <td style="padding:8px">${esc(u.placa)}</td>
                      <td class="col-pts" style="padding:8px">${r?.puntos ?? "—"}</td>
                      <td class="col-st" style="padding:8px">${
                        r
                          ? `<span class="state">${esc(r.estado)}</span>${
                              r.mensaje
                                ? ` <small class="muted">${esc(r.mensaje)}</small>`
                                : ""
                            }`
                          : `<span class="muted">PENDIENTE</span>`
                      }</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table></div>`
      }
    </section>`;

  const elState = container.querySelector("#cv-pre-state");
  const elCount = container.querySelector("#cv-pre-count");
  const elOk = container.querySelector("#cv-pre-ok");
  const elErrors = container.querySelector("#cv-pre-errors");
  const elCurrent = container.querySelector("#cv-pre-current");
  const elBar = container.querySelector("#cv-pre-bar");
  const elRange = container.querySelector("#cv-pre-range");
  const btnStart = container.querySelector("#cv-pre-start");
  const btnStop = container.querySelector("#cv-pre-stop");
  const btnReset = container.querySelector("#cv-pre-reset");
  const btnRefresh = container.querySelector("#cv-pre-refresh");
  const inputDesde = container.querySelector("#cv-pre-desde");
  const btnDesde = container.querySelector("#cv-pre-save-desde");

  function syncHeader(m, runningFlag) {
    const c = counts(m, units.length);
    if (elState)
      elState.textContent = runningFlag
        ? "EN CURSO (2º PLANO)"
        : m?.completo
          ? "COMPLETO"
          : m
            ? "PENDIENTE"
            : "LISTO";
    if (elCount) elCount.textContent = `${c.done}/${units.length}`;
    if (elOk) elOk.textContent = String(c.ready);
    if (elErrors) elErrors.textContent = String(c.errors);
    if (elCurrent) elCurrent.textContent = getCurrentPlaca() || "—";
    if (elBar) {
      elBar.style.width = `${units.length ? Math.round((100 * c.done) / units.length) : 0}%`;
    }
    if (btnStart) {
      btnStart.disabled = !units.length || runningFlag || !schemaReady;
      btnStart.textContent = runningFlag
        ? "EN CURSO…"
        : m && !m.completo
          ? "REANUDAR"
          : "INICIAR PRECARGA";
    }
    if (btnStop) btnStop.disabled = !runningFlag;
    if (btnReset) btnReset.disabled = runningFlag || !schemaReady;
    if (inputDesde) inputDesde.disabled = runningFlag;
    if (btnDesde) btnDesde.disabled = runningFlag;
  }

  const offUnit = runtime.bus.on("cerro-verde:precarga-unit", (payload) => {
    paintRow(container, nplate(payload.placa), payload);
    syncHeader(loadMeta(), isRunning());
  });
  cleanup.push(offUnit);

  const offProgress = runtime.bus.on("cerro-verde:precarga-progress", () => {
    syncHeader(loadMeta(), isRunning());
  });
  cleanup.push(offProgress);

  const offBatch = runtime.bus.on("cerro-verde:precarga-batch", () => {
    syncHeader(loadMeta(), false);
  });
  cleanup.push(offBatch);

  // Si ya hay precarga corriendo al montar, sincronizar UI de inmediato.
  syncHeader(meta, runningNow);

  const onStart = async () => {
    try {
      const desde = normalizeDesde(inputDesde?.value) || resolveDesde();
      btnStart.disabled = true;
      btnStart.textContent = "EN CURSO…";
      await startPreload(units, { desde });
    } catch (e) {
      alert(e.message || String(e));
      syncHeader(loadMeta(), isRunning());
    }
  };
  btnStart?.addEventListener("click", onStart);
  cleanup.push(() => btnStart?.removeEventListener("click", onStart));

  const onStop = () => {
    stopPreload();
    syncHeader(loadMeta(), isRunning());
  };
  btnStop?.addEventListener("click", onStop);
  cleanup.push(() => btnStop?.removeEventListener("click", onStop));

  const onReset = async () => {
    if (isRunning()) {
      alert("Detenga la precarga antes de reiniciar.");
      return;
    }
    if (
      !window.confirm(
        "Se iniciará una ejecución nueva desde el corte indicado hasta ahora.\n\nNo se borra SAP ni paradas validadas. ¿Continuar?",
      )
    ) {
      return;
    }
    clearMeta();
    const desde = normalizeDesde(inputDesde?.value) || resolveDesde();
    try {
      btnReset.disabled = true;
      await startPreload(units, { desde, forceNew: true });
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      syncHeader(loadMeta(), isRunning());
    }
  };
  btnReset?.addEventListener("click", onReset);
  cleanup.push(() => btnReset?.removeEventListener("click", onReset));

  const onRefresh = () => {
    unmount();
    mount(container, runtime);
  };
  btnRefresh?.addEventListener("click", onRefresh);
  cleanup.push(() => btnRefresh?.removeEventListener("click", onRefresh));

  const onDesde = () => {
    const v = normalizeDesde(inputDesde?.value);
    if (!v) {
      alert("Formato inválido. Use DD/MM/YYYY HH:mm:ss");
      return;
    }
    localStorage.setItem("cerro_verde_rango_desde", v);
    if (elRange) {
      elRange.textContent = `Desde ${v} → hasta ${resolveHasta()} (hora Lima)`;
    }
    clearMeta();
    syncHeader(null, false);
    units.forEach((u) => {
      paintRow(container, nplate(u.placa), {
        estado: "PENDIENTE",
        puntos: "—",
      });
    });
  };
  btnDesde?.addEventListener("click", onDesde);
  cleanup.push(() => btnDesde?.removeEventListener("click", onDesde));
}
