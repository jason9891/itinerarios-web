import { moduleHead, esc } from "../api-client.js?v=tn30";
import { fechaTurnoLima } from "../tiempo-lima.js";
import { ENCABEZADOS, STATUS_OPCIONES, filasReporte, resumen, fechaDDMMYYYY } from "./reporte-datos.js";
import { isDetenido, setDetenido, stopPrecarga } from "../precarga-engine.js?v=tn32";

const BASE_KEY = "tn_base_turno_v1";
const CLASIF_KEY = "tn_clasificaciones_v1";
const EXCELJS = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const leer = (k, def) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null") ?? def;
  } catch {
    return def;
  }
};

function cargarScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => no(new Error("No se pudo cargar la librería de Excel"));
    document.head.appendChild(s);
  });
}

function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Excel con estilos (encabezado azul, listas desplegables, GPS perdido en rojo), como el desktop. */
async function xlsxConEstilos(filas, nombre) {
  if (!window.ExcelJS) await cargarScript(EXCELJS);
  const wb = new window.ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(ENCABEZADOS);
  filas.forEach((f) => ws.addRow(f));
  const anchos = [12, 15, 15, 20, 15, 25, 30, 40, 20, 10, 12, 25, 18, 12, 12, 12, 45];
  anchos.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const head = ws.getRow(1);
  head.height = 32;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  const n = filas.length + 1;
  for (let r = 2; r <= n; r++) {
    ws.getCell(`I${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${STATUS_OPCIONES.join(",")}"`] };
    ws.getCell(`K${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO,-"'] };
    ws.getCell(`N${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO,-"'] };
    if (ws.getCell(`J${r}`).value === "●" && ws.getCell(`I${r}`).value === "-") {
      const j = ws.getCell(`J${r}`);
      j.font = { bold: true, size: 16, color: { argb: "FFC00000" } };
      j.alignment = { horizontal: "center", vertical: "middle" };
      const q = ws.getCell(`Q${r}`);
      q.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
      q.font = { bold: true, color: { argb: "FF9C0006" } };
    }
  }
  ws.autoFilter = { from: "A1", to: `Q${n}` };
  const buf = await wb.xlsx.writeBuffer();
  descargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre);
}

/** Respaldo sin estilos si la librería con estilos no carga. */
async function xlsxSimple(filas, nombre) {
  const XLSX = await import(SHEETJS);
  const ws = XLSX.utils.aoa_to_sheet([ENCABEZADOS, ...filas]);
  ws["!cols"] = [12, 15, 15, 20, 15, 25, 30, 40, 20, 10, 12, 25, 18, 12, 12, 12, 45].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  descargar(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre);
}

export async function mount(container) {
  const fecha0 = fechaTurnoLima();
  container.innerHTML = `
    ${moduleHead("Reporte", "Cierre de turno y Excel de pernocta (mismo formato del desktop)")}
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Reporte del turno</h2>
          <p class="muted">Se arma con la base del turno y las clasificaciones guardadas en este navegador.</p>
        </div>
        <label class="tn-field"><span>FECHA TURNO</span><input type="date" id="tn-rep-fecha" value="${fecha0}"></label>
      </div>
      <div id="tn-rep-res" class="tn-grid"></div>
      <p id="tn-rep-aviso" class="muted" style="margin:10px 0"></p>
      <div class="tn-actions" style="margin-bottom:12px">
        <button type="button" class="primary" id="tn-rep-xlsx">DESCARGAR EXCEL</button>
        <button type="button" class="ghost" id="tn-rep-stop">DETENER ALIMENTACIÓN DE RUTAS</button>
        <button type="button" class="ghost" id="tn-rep-mon">VOLVER A MONITOREO</button>
      </div>
      <div id="tn-rep-msg"></div>
      <div class="tn-table-wrap" style="max-height:60vh">
        <table class="tn-table">
          <thead id="tn-rep-head"></thead>
          <tbody id="tn-rep-body"></tbody>
        </table>
      </div>
    </section>
  `;
  const $ = (id) => container.querySelector(id);
  const fechaEl = $("#tn-rep-fecha");
  const msg = $("#tn-rep-msg");
  let filas = [];

  function pintar() {
    const base = leer(BASE_KEY, null);
    const unidades = base?.unidades || [];
    const clasifs = leer(CLASIF_KEY, {});
    filas = filasReporte(unidades, clasifs, fechaEl.value);
    const r = resumen(unidades, clasifs);
    $("#tn-rep-res").innerHTML = `
      <div class="tn-card"><small>UNIDADES</small><b>${r.total}</b></div>
      <div class="tn-card ok"><small>CALIFICADAS</small><b>${r.calificadas}</b></div>
      <div class="tn-card warn"><small>REVISAR / NO VA</small><b>${r.revisar}</b></div>
      <div class="tn-card ${r.pendientes ? "warn" : "ok"}"><small>PENDIENTES</small><b>${r.pendientes}</b></div>`;
    $("#tn-rep-aviso").textContent = !r.total
      ? "No hay base del turno en este navegador. Genera la base en «Base del turno» y clasifica en Monitoreo."
      : r.pendientes
        ? `Hay ${r.pendientes} unidades sin clasificar: saldrán con las columnas de clasificación vacías (o «GPS PERDIDO» si no reportan).`
        : "Todas las unidades están clasificadas.";
    $("#tn-rep-head").innerHTML = `<tr>${ENCABEZADOS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
    $("#tn-rep-body").innerHTML = filas
      .map((f) => `<tr>${f.map((c) => `<td>${esc(typeof c === "number" ? c.toFixed(5) : c)}</td>`).join("")}</tr>`)
      .join("");
    const det = isDetenido(fechaEl.value);
    $("#tn-rep-stop").textContent = det ? "ALIMENTACIÓN DETENIDA" : "DETENER ALIMENTACIÓN DE RUTAS";
    $("#tn-rep-stop").disabled = det;
  }

  fechaEl.addEventListener("change", pintar);
  $("#tn-rep-mon").addEventListener("click", () => document.querySelector('nav button[data-route="monitoreo"]')?.click());
  $("#tn-rep-stop").addEventListener("click", () => {
    setDetenido(fechaEl.value, true);
    stopPrecarga();
    msg.innerHTML = `<span class="tn-badge ok">Alimentación de rutas detenida</span>`;
    pintar();
  });
  $("#tn-rep-xlsx").addEventListener("click", async () => {
    if (!filas.length) {
      msg.innerHTML = `<span class="tn-badge err">No hay unidades para el reporte</span>`;
      return;
    }
    const nombre = `base_pernocta_${String(fechaEl.value).slice(0, 10)}.xlsx`;
    const btn = $("#tn-rep-xlsx");
    btn.disabled = true;
    msg.textContent = "Generando Excel…";
    try {
      try {
        await xlsxConEstilos(filas, nombre);
      } catch (e) {
        console.warn("[TN] Excel con estilos falló, uso el simple:", e);
        await xlsxSimple(filas, nombre);
      }
      // Generar el reporte cierra el seguimiento: ya no se cargan más rutas de este turno.
      setDetenido(fechaEl.value, true);
      stopPrecarga();
      msg.innerHTML = `<span class="tn-badge ok">Descargado: ${esc(nombre)} · ${filas.length} filas · ${esc(fechaDDMMYYYY(fechaEl.value))} · alimentación de rutas detenida</span>`;
      pintar();
    } catch (e) {
      msg.innerHTML = `<span class="tn-badge err">${esc(e.message || e)}</span>`;
    } finally {
      btn.disabled = false;
    }
  });

  pintar();
}

export function unmount() {}
