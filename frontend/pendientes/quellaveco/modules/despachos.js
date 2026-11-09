/**
 * Módulo QUELLAVECO · Despachos
 *
 * Flujo:
 *  1) Seleccionar el Excel SAP (ZSDF017) → se lee en el navegador (no se sube a ningún servidor).
 *  2) Se aplica el filtro de negocio (config.js), se toma la primera placa como tracto
 *     y se deduplica por ENTREGA.
 *  3) Se muestran métricas, descartes y la tabla de despachos de Quellaveco.
 * Los despachos quedan solo en esta pestaña (store.js) y alimentan Seguimiento y Reporte.
 */
import { esc, fechaPE, moduleHead, formatPlaca, loadXlsx, irA } from "../api-client.js";
import { filtroDefinido } from "../config.js";
import { columnasFaltantes, procesarFilas, agruparDescartes } from "../procesar.js";
import { guardarDespachos, leerDespachos, borrarDespachos } from "../store.js";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILAS = 10000;
const MAX_TABLA = 500;

let disposed = false;

export async function mount(container, runtime) {
  disposed = false;
  container.innerHTML = `
    ${moduleHead("Despachos", "Excel SAP · filtro de negocio · tracto por entrega")}
    <section class="panel">
      <div class="panel-title"><div>
        <h2>1 · Excel SAP de despachos</h2>
        <p class="muted">Sube el Excel de SAP (ZSDF017). Se lee en tu navegador y solo se usa en esta sesión: hay que subirlo en cada turno.</p>
      </div></div>
      <div id="qv-filtro-aviso"></div>
      <div class="qv-upload">
        <label class="file-button">
          SELECCIONAR EXCEL SAP (.xlsx)
          <input id="qv-file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </label>
        <span id="qv-file-name" class="muted"></span>
      </div>
      <div id="qv-msg"></div>
    </section>
    <div id="qv-result"></div>
  `;

  const $ = (sel) => container.querySelector(sel);
  const msg = $("#qv-msg");
  const result = $("#qv-result");

  $("#qv-filtro-aviso").innerHTML = filtroDefinido()
    ? ""
    : `<div class="qv-aviso"><b>Filtro de negocio sin definir.</b> Por ahora se muestran <b>todas</b> las filas del Excel. Cuando se defina el cliente/destino de Quellaveco, solo pasarán los despachos que correspondan (se configura en <code>quellaveco/config.js</code>).</div>`;

  function pintarResultado() {
    const carga = leerDespachos();
    if (!carga) {
      result.innerHTML = "";
      return;
    }
    const r = carga.resumen;
    const grupos = agruparDescartes(carga.descartes);
    result.innerHTML = `
      <section class="panel">
        <div class="panel-title"><div>
          <h2>2 · Resultado</h2>
          <p class="muted">${esc(carga.archivo)} · cargado ${esc(fechaPE(carga.cargado_en))}</p>
        </div></div>
        <div class="qv-grid">
          <div class="qv-card"><small>LEÍDAS</small><b>${r.leidas}</b></div>
          <div class="qv-card ok"><small>DESPACHOS EN ALCANCE</small><b>${r.en_alcance}</b></div>
          <div class="qv-card"><small>TRACTOS ÚNICOS</small><b>${r.tractos}</b></div>
          <div class="qv-card ${r.descartadas ? "warn" : ""}"><small>DESCARTADAS</small><b>${r.descartadas}</b></div>
          <div class="qv-card ${r.duplicadas ? "warn" : ""}"><small>ENTREGAS REPETIDAS</small><b>${r.duplicadas}</b></div>
        </div>
        ${
          grupos.length
            ? `<details style="margin:10px 0"><summary><b>Descartes</b> (${r.descartadas})</summary>
                ${grupos
                  .map(
                    (g) => `<p style="margin:8px 0 2px"><b>${esc(g.motivo)}</b>: ${g.cantidad}</p>
                    <p class="muted" style="font-size:12px;margin:0">${esc(g.entregas.slice(0, 40).join(", "))}${g.entregas.length > 40 ? " …" : ""}</p>`,
                  )
                  .join("")}
              </details>`
            : ""
        }
        <div class="qv-actions">
          <input id="qv-buscar" class="qv-search" placeholder="Buscar entrega, placa, cliente, destino…">
          <button type="button" class="primary" id="qv-go-seg">IR A SEGUIMIENTO</button>
          <button type="button" class="ghost" id="qv-clear">LIMPIAR DESPACHOS</button>
        </div>
        <p id="qv-count" class="muted" style="margin:8px 0"></p>
        <div class="qv-table-wrap">
          <table class="qv-table">
            <thead><tr>
              <th>ENTREGA</th><th>FECHA</th><th>CLIENTE</th><th>DESTINO</th><th>TRACTO</th><th>CARRETA</th>
              <th>MATERIAL</th><th>NETO</th><th>SALIDA</th>
            </tr></thead>
            <tbody id="qv-body"></tbody>
          </table>
        </div>
      </section>`;

    const body = $("#qv-body");
    const count = $("#qv-count");
    function pintarTabla() {
      const q = ($("#qv-buscar")?.value || "").trim().toUpperCase();
      const filas = carga.despachos.filter(
        (d) =>
          !q ||
          [d.Entrega, d.tracto, d.carreta, d.Cliente, d.Destino, d.Descripcion, d.Material]
            .join(" ")
            .toUpperCase()
            .includes(q),
      );
      count.textContent =
        filas.length > MAX_TABLA
          ? `Mostrando ${MAX_TABLA} de ${filas.length} despachos (usa el buscador para acotar).`
          : `${filas.length} despachos.`;
      body.innerHTML = filas
        .slice(0, MAX_TABLA)
        .map(
          (d) => `<tr>
            <td>${esc(d.Entrega)}</td><td>${esc(d.Fecha)}</td><td>${esc(d.Cliente)}</td><td>${esc(d.Destino)}</td>
            <td><b>${esc(formatPlaca(d.tracto))}</b></td><td>${esc(formatPlaca(d.carreta))}</td>
            <td>${esc(d.Descripcion || d.Material)}</td><td>${esc(d.Neto)}</td>
            <td>${esc([d["Fecha Salida"], d.Salida].filter(Boolean).join(" "))}</td>
          </tr>`,
        )
        .join("");
    }
    pintarTabla();
    $("#qv-buscar").addEventListener("input", pintarTabla);
    $("#qv-go-seg").addEventListener("click", () => irA("seguimiento"));
    $("#qv-clear").addEventListener("click", () => {
      borrarDespachos();
      runtime.state.set("despachos", null);
      runtime.bus.emit("quellaveco:despachos-actualizados", { total: 0 });
      $("#qv-file-name").textContent = "";
      msg.innerHTML = `<div class="qv-aviso">Despachos borrados de esta sesión.</div>`;
      pintarResultado();
    });
  }

  $("#qv-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $("#qv-file-name").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    msg.innerHTML = `<p class="muted">Procesando en el navegador…</p>`;
    try {
      if (file.size > MAX_BYTES) throw new Error("El Excel supera 15 MB");
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El Excel no contiene hojas");
      const rows = XLSX.utils
        .sheet_to_json(ws, { defval: "", raw: false })
        .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), v])));
      if (disposed) return;
      if (!rows.length) throw new Error("El Excel no tiene filas");
      if (rows.length > MAX_FILAS) throw new Error(`El Excel supera ${MAX_FILAS} filas`);
      const faltan = columnasFaltantes(rows);
      if (faltan.length) {
        throw new Error(`Formato SAP no reconocido: faltan las columnas ${faltan.join(", ")}`);
      }
      const r = procesarFilas(rows);
      guardarDespachos({
        archivo: file.name,
        cargado_en: new Date().toISOString(),
        resumen: r.resumen,
        despachos: r.despachos,
        descartes: r.descartes.slice(0, 1000),
      });
      runtime.state.set("despachos", leerDespachos());
      runtime.bus.emit("quellaveco:despachos-actualizados", { total: r.despachos.length });
      msg.innerHTML = r.despachos.length
        ? `<span class="qv-badge ok">✔ ${r.despachos.length} despachos cargados para esta sesión</span>`
        : `<div class="qv-aviso err">No quedó ningún despacho en alcance. Revisa el filtro de negocio o el Excel.</div>`;
      pintarResultado();
    } catch (err) {
      msg.innerHTML = `<div class="qv-aviso err">${esc(err.message || err)}</div>`;
    }
  });

  // Si ya hay despachos cargados en esta pestaña, se muestran de inmediato
  const previa = leerDespachos();
  if (previa) $("#qv-file-name").textContent = previa.archivo;
  pintarResultado();
}

export function unmount() {
  disposed = true;
}
