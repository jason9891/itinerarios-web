/**
 * Módulo CEMENTO · Precargar rutas
 *
 * INDEPENDENCIA
 * ─────────────
 * - NO importa módulos sap.js / seguimiento.js / montados.
 * - Única dependencia de datos operativos: trackApi({ action: "lista" })
 *   → contrato estable: { placa, tracto, conductor?, ocs? }
 * - Si mañana SAP cambia su UI o su parser, mientras las OCs abiertas
 *   sigan llegando a Seguimiento Diario, este módulo no se rompe.
 * - Estado propio en localStorage (cemento_precarga_v1). No escribe en SAP.
 * - GPS se consulta con el cliente compartido queryClocator (shared/).
 *
 * Flujo:
 *   lista seguimiento → INICIAR/REANUDAR → CLocator por unidad → resultados locales
 */
import { esc, moduleHead, trackApi, fechaPE } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

const STORAGE_KEY = "cemento_precarga_v1";
const TIMEOUT_MS = 120000;
const DONE_STATES = new Set(["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS", "ERROR FINAL"]);

let cleanup = [];
let running = false;
let stopFlag = false;
let controller = null;

function nplate(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function formatPE(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveMeta(m) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}

function clearMeta() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Corte de inicio: localStorage operativo o últimas 24 h */
function resolveDesde() {
  const saved = localStorage.getItem("cemento_rango_desde");
  if (saved && /^\d{2}\/\d{2}\/\d{4}/.test(saved)) {
    // asegurar segundos
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(saved)) return saved + ":00";
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(saved)) return saved;
  }
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return formatPE(d);
}

function resolveHasta() {
  return formatPE(new Date());
}

function classifyResult(data) {
  const puntos = data?.puntos_gps?.length ?? data?.puntos ?? 0;
  const visitas = data?.analisis?.visitas_confirmadas?.length ?? 0;
  if (!puntos) return { estado: "SIN PUNTOS", puntos: 0, visitas: 0 };
  if (puntos < 2) return { estado: "SIN MOVIMIENTO", puntos, visitas };
  return { estado: "COMPLETO", puntos, visitas };
}

function counts(meta, total) {
  const vals = Object.values(meta?.resultados || {});
  const done = vals.filter((x) => DONE_STATES.has(x.estado)).length;
  const errors = vals.filter((x) => x.estado === "ERROR FINAL").length;
  const ok = vals.filter((x) =>
    ["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS"].includes(x.estado),
  ).length;
  return { done, errors, ok, total };
}

export async function mount(container, runtime) {
  cleanup = [];
  stopFlag = false;
  running = false;
  container.innerHTML = `<section class="panel"><p class="muted">Cargando precarga…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en precarga</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  // No abortamos una precarga en curso al salir del módulo:
  // el operador puede volver y reanudar. Solo limpiamos listeners del DOM.
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
  return {
    units: [...map.values()],
    total_ocs: lista.total_ocs || 0,
  };
}

async function render(container, runtime) {
  // Refresco opcional si SAP aplicó OCs nuevas (solo lista, no acoplado a SAP)
  const off = runtime.bus.on("cemento:sap-applied", () => {
    if (!running) render(container, runtime).catch(() => {});
  });
  cleanup.push(off);

  let units = [];
  let totalOcs = 0;
  try {
    const data = await fetchUnits();
    units = data.units;
    totalOcs = data.total_ocs;
  } catch (e) {
    container.innerHTML =
      moduleHead("Precargar rutas", "GPS · pendientes") +
      `<section class="error-box"><h2>No se pudo cargar la lista</h2><p>${esc(e.message)}</p>
       <p class="muted">Este módulo solo lee unidades con OC abierta desde Seguimiento. Aplique un SAP o verifique permisos.</p></section>`;
    return;
  }

  let meta = loadMeta();
  const desdeDefault = meta?.desde || resolveDesde();
  const hastaDefault = meta?.hasta || resolveHasta();

  container.innerHTML =
    moduleHead(
      "Precargar rutas",
      `${units.length} unidades · ${totalOcs} OCs abiertas`,
    ) +
    `<section class="notice">
      <b>Módulo independiente.</b> Lee únicamente la lista de unidades con OC abierta
      (misma fuente que Seguimiento). No depende del código interno de SAP: si SAP sigue
      generando OCs abiertas, esta lista se mantiene válida.
      <br>Los puntos GPS quedan en este navegador (resumen local); no se suben a Supabase.
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Control de precarga</h2>
          <p class="muted" id="cem-pre-range">Desde ${esc(desdeDefault)} → hasta ${esc(hastaDefault)} (hora Lima)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="cem-pre-start" class="primary" ${units.length ? "" : "disabled"}>
            ${meta && !meta.completo ? "REANUDAR" : "INICIAR PRECARGA"}
          </button>
          <button type="button" id="cem-pre-stop" class="secondary" disabled>DETENER</button>
          <button type="button" id="cem-pre-refresh" class="secondary" title="Vuelve a leer unidades con OC abierta desde Seguimiento">ACTUALIZAR LISTA DE UNIDADES</button>
        </div>
      </div>
      <div class="activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:12px">
        <div><small>ESTADO</small><b id="cem-pre-state">${meta?.completo ? "COMPLETO" : meta ? "PENDIENTE" : "LISTO"}</b></div>
        <div><small>PROGRESO</small><b id="cem-pre-count">0/${units.length}</b></div>
        <div><small>OK</small><b id="cem-pre-ok">0</b></div>
        <div><small>ERRORES</small><b id="cem-pre-errors">0</b></div>
      </div>
      <div class="progress" style="margin-top:10px;height:8px;background:#1e3a5f;border-radius:99px;overflow:hidden">
        <span id="cem-pre-bar" style="display:block;height:100%;width:0%;background:#38bdf8;transition:width .2s"></span>
      </div>
      <p class="muted" style="margin-top:8px">
        Corte de inicio CLocator:
        <input id="cem-pre-desde" type="text" value="${esc(desdeDefault)}"
          style="min-width:180px;margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0"
          placeholder="DD/MM/YYYY HH:mm:ss" />
        <button type="button" id="cem-pre-save-desde" class="secondary" style="margin-left:6px"
          title="Si cambia la fecha, se reinician todas las placas para volver a precargar">
          APLICAR NUEVO CORTE
        </button>
      </p>
      <p class="muted" style="margin-top:6px">
        <b>Actualizar lista de unidades</b> = vuelve a pedir a Seguimiento qué placas tienen OC abierta
        (no relanza GPS). <b>Aplicar nuevo corte</b> = cambia la fecha de inicio y
        <b>reinicia todas las placas</b> (también las ya precargadas) para consultar desde ese corte.
      </p>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>Unidades</h2>
        <span class="muted">resultado por placa</span>
      </div>
      ${
        !units.length
          ? `<p class="muted">No hay unidades con OC abierta.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">TRACTO</th>
                <th style="text-align:left;padding:8px">PLACA</th>
                <th style="text-align:right;padding:8px">PUNTOS</th>
                <th style="text-align:right;padding:8px">VISITAS</th>
                <th style="text-align:left;padding:8px">ESTADO</th>
              </tr></thead>
              <tbody id="cem-pre-rows">
                ${units
                  .map((u, i) => {
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

  const paintCounts = () => {
    const m = loadMeta() || meta;
    const c = counts(m, units.length);
    const el = (id) => container.querySelector(id);
    if (el("#cem-pre-count")) el("#cem-pre-count").textContent = `${c.done}/${units.length}`;
    if (el("#cem-pre-ok")) el("#cem-pre-ok").textContent = String(c.ok);
    if (el("#cem-pre-errors")) el("#cem-pre-errors").textContent = String(c.errors);
    if (el("#cem-pre-bar")) {
      const pct = units.length ? Math.round((100 * c.done) / units.length) : 0;
      el("#cem-pre-bar").style.width = `${pct}%`;
    }
  };

  const paintRow = (key, result) => {
    const tr = container.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
    if (!tr) return;
    tr.querySelector(".col-pts").textContent = result.puntos ?? "—";
    tr.querySelector(".col-vis").textContent = result.visitas ?? "—";
    tr.querySelector(".col-st").innerHTML =
      `<span class="state">${esc(result.estado)}</span>` +
      (result.mensaje ? ` <small class="muted">${esc(result.mensaje)}</small>` : "");
  };

  paintCounts();

  const btnStart = container.querySelector("#cem-pre-start");
  const btnStop = container.querySelector("#cem-pre-stop");
  const btnRefresh = container.querySelector("#cem-pre-refresh");
  const btnDesde = container.querySelector("#cem-pre-save-desde");
  const inputDesde = container.querySelector("#cem-pre-desde");

  function normalizeDesde(v) {
    const s = String(v || "").trim();
    if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
    return /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(s) ? s + ":00" : s;
  }

  /** Cambio de corte ⇒ se invalidan resultados previos (todas las placas vuelven a PENDIENTE). */
  function resetResultsForNewCorte(fullDesde) {
    const hasta = resolveHasta();
    meta = {
      id: crypto.randomUUID(),
      desde: fullDesde,
      hasta,
      total: units.length,
      completo: false,
      resultados: {},
      intentos: {},
      started_at: Date.now(),
      corte_cambiado_en: Date.now(),
    };
    saveMeta(meta);
    localStorage.setItem("cemento_rango_desde", fullDesde);
    // Pintar todas las filas como PENDIENTE
    for (const u of units) {
      paintRow(nplate(u.placa), { estado: "PENDIENTE", puntos: "—", visitas: "—" });
    }
    paintCounts();
    const rangeEl = container.querySelector("#cem-pre-range");
    if (rangeEl) rangeEl.textContent = `Desde ${fullDesde} → hasta ${hasta} (hora Lima) · resultados reiniciados`;
    const st = container.querySelector("#cem-pre-state");
    if (st) st.textContent = "LISTO (NUEVO CORTE)";
    if (btnStart) {
      btnStart.disabled = !units.length;
      btnStart.textContent = "INICIAR PRECARGA";
    }
  }

  const onRefresh = async () => {
    if (running) {
      alert("Detenga la precarga antes de actualizar la lista de unidades.");
      return;
    }
    const st = container.querySelector("#cem-pre-state");
    if (st) st.textContent = "ACTUALIZANDO LISTA…";
    try {
      const data = await fetchUnits();
      // Re-render completo con la lista fresca (mantiene meta/resultados si el corte no cambió)
      await render(container, runtime);
    } catch (e) {
      alert("No se pudo actualizar la lista: " + e.message);
      if (st) st.textContent = "ERROR AL ACTUALIZAR";
    }
  };
  btnRefresh?.addEventListener("click", onRefresh);
  cleanup.push(() => btnRefresh?.removeEventListener("click", onRefresh));

  const onSaveDesde = () => {
    if (running) {
      alert("Detenga la precarga antes de cambiar el corte de fecha.");
      return;
    }
    const full = normalizeDesde(inputDesde?.value);
    if (!full) {
      alert("Formato inválido. Use DD/MM/YYYY HH:mm:ss");
      return;
    }
    const prev = loadMeta()?.desde || "";
    if (prev && prev !== full) {
      const ok = confirm(
        "Cambió el corte de fecha.\n\n" +
          "Anterior: " + prev + "\n" +
          "Nuevo: " + full + "\n\n" +
          "Se reiniciarán TODAS las placas (incluidas las ya precargadas) para consultar GPS desde el nuevo corte.\n\n¿Continuar?"
      );
      if (!ok) {
        if (inputDesde) inputDesde.value = prev;
        return;
      }
      resetResultsForNewCorte(full);
      return;
    }
    // Mismo corte o primera vez: solo guardar referencia operativa
    localStorage.setItem("cemento_rango_desde", full);
    const rangeEl = container.querySelector("#cem-pre-range");
    if (rangeEl) rangeEl.textContent = `Desde ${full} → hasta ${resolveHasta()} (hora Lima)`;
    const m = loadMeta();
    if (m) {
      m.desde = full;
      saveMeta(m);
      meta = m;
    }
  };
  btnDesde?.addEventListener("click", onSaveDesde);
  cleanup.push(() => btnDesde?.removeEventListener("click", onSaveDesde));

  const onStop = () => {
    stopFlag = true;
    try { controller?.abort("operator"); } catch (_) {}
    const st = container.querySelector("#cem-pre-state");
    if (st) st.textContent = "DETENIENDO…";
    if (btnStop) btnStop.disabled = true;
  };
  btnStop?.addEventListener("click", onStop);
  cleanup.push(() => btnStop?.removeEventListener("click", onStop));

  const onStart = async () => {
    if (running || !units.length) return;
    running = true;
    stopFlag = false;
    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = false;
    const st = container.querySelector("#cem-pre-state");
    if (st) st.textContent = "EN CURSO";

    const desdeRaw = normalizeDesde(inputDesde?.value) || resolveDesde();
    const desde = desdeRaw;
    const hasta = resolveHasta();

    meta = loadMeta();
    // Si el corte del input no coincide con el de la corrida guardada → nueva corrida completa
    const corteCambio = meta && meta.desde && meta.desde !== desde;
    if (corteCambio) {
      meta = {
        id: crypto.randomUUID(),
        desde,
        hasta,
        total: units.length,
        completo: false,
        resultados: {},
        intentos: {},
        started_at: Date.now(),
        corte_cambiado_en: Date.now(),
      };
      for (const u of units) {
        paintRow(nplate(u.placa), { estado: "PENDIENTE", puntos: "—", visitas: "—" });
      }
    } else {
      const resume = meta && !meta.completo && meta.id;
      if (!resume) {
        meta = {
          id: crypto.randomUUID(),
          desde,
          hasta,
          total: units.length,
          completo: false,
          resultados: {},
          intentos: {},
          started_at: Date.now(),
        };
      } else {
        meta.hasta = hasta;
        meta.desde = meta.desde || desde;
        meta.total = units.length;
        meta.resultados ||= {};
        meta.intentos ||= {};
      }
    }
    localStorage.setItem("cemento_rango_desde", desde);
    saveMeta(meta);
    runtime.state.set("precarga.meta", { id: meta.id, total: units.length });

    const token = await runtime.auth.currentUser.getIdToken(true);

    const process = async (list, second) => {
      for (const u of list) {
        if (stopFlag) break;
        const k = nplate(u.placa);
        const prev = meta.resultados[k]?.estado;
        if (DONE_STATES.has(prev) && prev !== "ERROR FINAL") continue;
        if (second && prev === "ERROR FINAL") continue;

        meta.resultados[k] = {
          estado: second ? "SEGUNDO INTENTO" : "PROCESANDO",
          puntos: meta.resultados[k]?.puntos,
          visitas: meta.resultados[k]?.visitas,
        };
        saveMeta(meta);
        paintRow(k, meta.resultados[k]);
        paintCounts();

        controller = new AbortController();
        const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);
        try {
          const data = await queryClocator({
            endpoint: API.clocator,
            token,
            placa: u.placa,
            tracto: u.tracto,
            desde: meta.desde,
            hasta: meta.hasta,
            includeMap: false,
            signal: controller.signal,
          });
          clearTimeout(timer);
          meta.intentos[k] = (meta.intentos[k] || 0) + 1;
          meta.resultados[k] = classifyResult(data);
          // Emitir por unidad (seguimiento u otros pueden escuchar sin acoplarse)
          runtime.bus.emit("cemento:precarga-unit", {
            placa: u.placa,
            tracto: u.tracto,
            ...meta.resultados[k],
          });
        } catch (e) {
          clearTimeout(timer);
          meta.intentos[k] = (meta.intentos[k] || 0) + 1;
          if (stopFlag) {
            meta.resultados[k] = {
              estado: "PENDIENTE",
              mensaje: "Detenido por el operador",
            };
            saveMeta(meta);
            paintRow(k, meta.resultados[k]);
            break;
          }
          const msg =
            controller?.signal?.aborted
              ? "Tiempo de respuesta agotado"
              : String(e.message || e);
          if (!second && (meta.intentos[k] || 0) <= 1) {
            meta.resultados[k] = { estado: "REINTENTO", mensaje: msg };
          } else {
            meta.resultados[k] = { estado: "ERROR FINAL", mensaje: msg };
          }
        } finally {
          controller = null;
          saveMeta(meta);
          paintRow(k, meta.resultados[k]);
          paintCounts();
        }
      }
    };

    const first = units.filter((u) => {
      const s = meta.resultados[nplate(u.placa)]?.estado;
      return !DONE_STATES.has(s);
    });
    await process(first, false);

    if (!stopFlag) {
      const retry = units.filter(
        (u) => meta.resultados[nplate(u.placa)]?.estado === "REINTENTO",
      );
      await process(retry, true);
    }

    meta.completo =
      !stopFlag &&
      units.every((u) => DONE_STATES.has(meta.resultados[nplate(u.placa)]?.estado));
    saveMeta(meta);
    running = false;

    if (st) {
      st.textContent = stopFlag
        ? "DETENIDO"
        : meta.completo
          ? counts(meta, units.length).errors
            ? "COMPLETO CON ERRORES"
            : "COMPLETO"
          : "PENDIENTE";
    }
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.textContent = meta.completo ? "NUEVA PRECARGA" : "REANUDAR";
    }
    if (btnStop) btnStop.disabled = true;

    runtime.bus.emit("cemento:precarga-batch", {
      completo: meta.completo,
      ...counts(meta, units.length),
    });
  };

  btnStart?.addEventListener("click", () => {
    onStart().catch((e) => {
      running = false;
      alert(e.message);
      if (btnStart) btnStart.disabled = false;
      if (btnStop) btnStop.disabled = true;
    });
  });
  cleanup.push(() => btnStart?.replaceWith(btnStart.cloneNode(true)));
}
