/**
 * Módulo CERRO VERDE · crear reporte / ENVIABLE de seguimiento
 *
 * - reportV3: estado y descarga (convoy solo en Excel)
 * - Previsualización editable CAL VACÍO / CAL CARGADO antes del Excel
 *   (corregir sección vacío→cargado, estado, hitos, llegada SMCV, etc.)
 */
import { esc, apiGet, apiPost, bufferToBase64 } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { reportV3 } from "../../cerro-verde-tracking.js?v=cv-noconvoy-01";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando reporte operativo…</p></section>`;
  try {
    const ctx = buildContext(runtime);
    await reportV3(ctx)();
    await mountPreview(container);
  } catch (e) {
    console.error("[cerro-verde reporte]", e);
    container.innerHTML = `<section class="error-box"><h2>Error en reporte</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

function buildContext(runtime) {
  const $ = (id) => document.getElementById(id);
  const go = (route) => {
    const r = route || "home";
    history.replaceState(null, "", `#/${r}`);
    try { window.dispatchEvent(new HashChangeEvent("hashchange")); }
    catch (_) { location.hash = `#/${r}`; }
  };
  async function post(url, body, binary = false, signal) {
    return apiPost(url, body, { signal, binary: !!binary });
  }
  return {
    $,
    esc,
    END: { gps: API.clocator, track: API.track, sap: API.sap, q: API.consulta, report: API.report },
    post,
    get: apiGet,
    one: async () => null,
    put: async () => null,
    b64: bufferToBase64,
    auth,
    go,
    routes: {},
  };
}

async function downloadExcel() {
  const x = await apiPost(API.report, { action: "excel" }, { binary: true });
  if (!x?.blob || x.blob.size < 64) throw new Error("Excel vacío o inválido");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(x.blob);
  a.download = x.name || "REPORTE_DIARIO_CERRO_VERDE.xlsx";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return a.download;
}

function sectionSelect(tracto, value) {
  const v = String(value || "VACIO").toUpperCase().includes("CARGADO") ? "CARGADO" : "VACIO";
  return `<select data-tracto="${esc(tracto)}" data-field="seccion">
    <option value="VACIO" ${v === "VACIO" ? "selected" : ""}>CAL VACÍO</option>
    <option value="CARGADO" ${v === "CARGADO" ? "selected" : ""}>CAL CARGADO</option>
  </select>`;
}

function input(tracto, field, value, ph = "") {
  return `<input data-tracto="${esc(tracto)}" data-field="${esc(field)}" value="${esc(value ?? "")}" placeholder="${esc(ph)}" />`;
}

function tableBlock(title, rows, kind) {
  const hitos =
    kind === "CARGADO"
      ? ["SALIDA CARACOTO", "LLEG. BASE", "SAL. BASE CARG.", "INGRESO SMCV"]
      : ["SAL. RACIEMSA", "LLEG. CARACOTO", "SAL. SMCV", "LLEG. BASE VACÍO"];
  return `
    <section class="panel" style="margin-top:12px">
      <div class="panel-title"><h2>${esc(title)} (${rows.length})</h2></div>
      <div class="cv-rep-wrap">
        <table class="cv-rep-table">
          <thead>
            <tr>
              <th>SECCIÓN</th><th>TRACTO</th><th>PLACA</th><th>CONDUCTOR</th><th>CARRETA</th>
              <th>${hitos[0]}</th><th>${hitos[1]}</th><th>${hitos[2]}</th><th>${hitos[3]}</th>
              <th>ESTADO</th><th>MONITOREO</th><th>OBSERVACIÓN</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map((r) => {
                      const t = r.codigo_tracto || r.tracto;
                      return `<tr data-tracto="${esc(t)}" class="${r.alerta ? "alerta" : ""}" data-alerta="${r.alerta ? "1" : "0"}">
                        <td>${sectionSelect(t, r.seccion || kind)}</td>
                        <td><b>${esc(t)}</b></td>
                        <td>${esc(r.placa)}</td>
                        <td>${input(t, "conductor", r.conductor)}</td>
                        <td>${esc(r.carreta)}</td>
                        <td>${input(t, "h1", r.h1 === "-" ? "" : r.h1)}</td>
                        <td>${input(t, "h2", r.h2 === "-" ? "" : r.h2)}</td>
                        <td>${input(t, "h3", r.h3 === "-" ? "" : r.h3)}</td>
                        <td>${input(t, "h4", r.h4 === "-" ? "" : r.h4, kind === "CARGADO" ? "ingreso SMCV" : "")}</td>
                        <td>${input(t, "estado", r.estado)}</td>
                        <td>${input(t, "monitoreo", r.monitoreo === "-" ? "" : r.monitoreo)}</td>
                        <td>${input(t, "observacion", r.observacion === "-" ? "" : r.observacion)}</td>
                        <td>${r.alerta ? `<span class="cv-rep-badge" title="${esc(r.alerta_motivo || "")}">REVISAR</span>` : ""}</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="13" class="muted">Sin unidades en esta sección.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`;
}

async function mountPreview(host) {
  const content = document.getElementById("content") || host;
  const box = document.createElement("div");
  box.id = "cv-reporte-preview";
  box.innerHTML = `<section class="panel"><p class="muted">Cargando previsualización ENVIABLE…</p></section>`;
  content.appendChild(box);

  const style = document.createElement("style");
  style.textContent = `
    .cv-rep-wrap{overflow:auto;max-height:min(52vh,520px);border:1px solid #1e3a5f;border-radius:8px}
    .cv-rep-table{width:100%;border-collapse:collapse;font-size:11px;min-width:1400px}
    .cv-rep-table th{position:sticky;top:0;background:#0b1d30;color:#94a3b8;padding:8px 6px;border-bottom:1px solid #1e3a5f;z-index:1;text-align:left;white-space:nowrap}
    .cv-rep-table td{padding:4px;border-bottom:1px solid #132337;vertical-align:middle}
    .cv-rep-table tr.alerta{background:rgba(127,29,29,.22)}
    .cv-rep-table tr.dirty{outline:1px solid #38bdf8}
    .cv-rep-table input,.cv-rep-table select{width:100%;min-width:70px;box-sizing:border-box;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:11px}
    .cv-rep-badge{display:inline-block;font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px;background:#7c2d12;color:#ffedd5}
  `;
  content.appendChild(style);
  cleanup.push(() => { try { box.remove(); style.remove(); } catch (_) {} });

  async function render() {
    let data;
    try {
      data = await apiPost(API.report, { action: "reporte_preview" });
    } catch (e) {
      box.innerHTML = `<section class="error-box"><h2>Previsualización</h2><p>${esc(e.message)}</p></section>`;
      return;
    }
    const dirty = new Map();
    const mark = (tracto, field, value) => {
      const cur = dirty.get(tracto) || { codigo_tracto: tracto };
      cur[field] = value;
      dirty.set(tracto, cur);
      const tr = box.querySelector(`tr[data-tracto="${CSS.escape(tracto)}"]`);
      if (tr) tr.classList.add("dirty");
      const n = box.querySelector("#cv-rep-dirty");
      if (n) n.textContent = `${dirty.size} unidad(es) modificada(s)`;
    };

    box.innerHTML = `
      <section class="notice" style="margin-top:14px">
        <b>Previsualización ENVIABLE (seguimiento)</b> —
        Orden del Excel: <b>CAL VACÍO → CONVOY (en Excel) → CAL CARGADO</b>. El convoy no se edita en la web.
        Si una unidad está en vacío pero ya salió de Caracoto / va cargada, cámbiela a
        <b>CAL CARGADO</b>, complete hitos (p. ej. ingreso SMCV) y estado.
        Filas en rojo = posible mala clasificación.
      </section>
      <section class="panel">
        <div class="panel-title" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center">
              <input type="checkbox" id="cv-rep-only-alert" /> Solo alertas
            </label>
            <span id="cv-rep-dirty" class="muted">0 unidad(es) modificada(s)</span>
            <span class="muted">${data.alertas || 0} alerta(s) · ${data.unidades || 0} en grupo</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" id="cv-rep-refresh" class="secondary">ACTUALIZAR PREVIEW</button>
            <button type="button" id="cv-rep-save" class="secondary">GUARDAR CORRECCIONES</button>
            <button type="button" id="cv-rep-xlsx" class="primary">DESCARGAR EXCEL</button>
          </div>
        </div>
        <p id="cv-rep-msg" class="muted"></p>
      </section>
      ${tableBlock("CAL VACÍO", data.vacio || [], "VACIO")}
      ${tableBlock("CAL CARGADO", data.cargado || [], "CARGADO")}
    `;

    box.querySelectorAll("[data-tracto][data-field]").forEach((el) => {
      const handler = () => mark(el.dataset.tracto, el.dataset.field, el.value);
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    box.querySelector("#cv-rep-only-alert")?.addEventListener("change", (ev) => {
      const only = ev.target.checked;
      box.querySelectorAll("tr[data-tracto]").forEach((tr) => {
        tr.style.display = only && tr.dataset.alerta !== "1" ? "none" : "";
      });
    });

    box.querySelector("#cv-rep-refresh")?.addEventListener("click", () => render());

    box.querySelector("#cv-rep-save")?.addEventListener("click", async () => {
      const msg = box.querySelector("#cv-rep-msg");
      if (!dirty.size) {
        if (msg) msg.textContent = "No hay cambios.";
        return;
      }
      const btn = box.querySelector("#cv-rep-save");
      if (btn) { btn.disabled = true; btn.textContent = "GUARDANDO…"; }
      try {
        const out = await apiPost(API.report, {
          action: "reporte_actualizar_lote",
          filas: [...dirty.values()],
        });
        if (msg) {
          msg.textContent = `${out.actualizadas || 0} unidad(es) actualizadas en GRUPO_SMCV.`;
          msg.style.color = "#86efac";
        }
        await render();
      } catch (e) {
        if (msg) { msg.textContent = e.message || String(e); msg.style.color = "#fca5a5"; }
        alert(e.message || e);
        if (btn) { btn.disabled = false; btn.textContent = "GUARDAR CORRECCIONES"; }
      }
    });

    box.querySelector("#cv-rep-xlsx")?.addEventListener("click", async () => {
      const msg = box.querySelector("#cv-rep-msg");
      if (dirty.size && !confirm(`Hay ${dirty.size} cambio(s) sin guardar. ¿Descargar igual con datos del servidor?`)) return;
      const btn = box.querySelector("#cv-rep-xlsx");
      if (btn) { btn.disabled = true; btn.textContent = "GENERANDO…"; }
      try {
        const name = await downloadExcel();
        if (msg) { msg.textContent = `Descargado: ${name}`; msg.style.color = "#86efac"; }
      } catch (e) {
        if (msg) { msg.textContent = e.message || String(e); msg.style.color = "#fca5a5"; }
        alert(e.message || e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "DESCARGAR EXCEL"; }
      }
    });
  }

  await render();
}
