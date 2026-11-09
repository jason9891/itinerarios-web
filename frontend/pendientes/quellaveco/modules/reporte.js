/**
 * Módulo QUELLAVECO · Reporte
 *
 * Descarga en Excel los despachos de Quellaveco cargados en esta sesión.
 * Si ya se actualizaron las posiciones en Seguimiento, agrega las columnas GPS.
 */
import { esc, fechaPE, moduleHead, loadXlsx, irA } from "../api-client.js";
import { filtroDefinido } from "../config.js";
import { ENCABEZADOS_REPORTE, filasReporte } from "../procesar.js";
import { leerDespachos } from "../store.js";

const MAX_VISTA = 50;

/** Fecha de hoy en Lima (AAAA-MM-DD) para el nombre del archivo. */
function hoyLima() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

export async function mount(container, runtime) {
  const carga = leerDespachos();

  if (!carga?.despachos?.length) {
    container.innerHTML = `
      ${moduleHead("Reporte", "Descargar los despachos de Quellaveco en Excel")}
      <section class="panel">
        <div class="qv-aviso">No hay despachos cargados en esta sesión. Sube el Excel SAP en <b>Despachos</b>.</div>
        <div class="qv-actions"><button type="button" class="primary" id="qv-go-desp">IR A DESPACHOS</button></div>
      </section>`;
    container.querySelector("#qv-go-desp").addEventListener("click", () => irA("despachos"));
    return;
  }

  const p = runtime.state.get("posiciones") || null;
  const porPlaca = p?.porPlaca || null;
  const filas = filasReporte(carga.despachos, porPlaca);
  const conPos = porPlaca ? carga.despachos.filter((d) => porPlaca.get(d.tracto)?.lat != null).length : 0;

  container.innerHTML = `
    ${moduleHead("Reporte", "Descargar los despachos de Quellaveco en Excel")}
    <section class="panel">
      <div class="qv-grid">
        <div class="qv-card"><small>DESPACHOS</small><b>${filas.length}</b></div>
        <div class="qv-card ${p ? "ok" : "warn"}"><small>CON POSICIÓN GPS</small><b>${p ? conPos : "—"}</b>
          <span class="muted" style="font-size:12px">${p ? `Posiciones de ${esc(fechaPE(p.generado_en))}` : "Sin consultar"}</span></div>
        <div class="qv-card ${filtroDefinido() ? "ok" : "warn"}"><small>FILTRO DE NEGOCIO</small><b>${filtroDefinido() ? "Definido" : "Sin definir"}</b></div>
      </div>
      ${
        p
          ? ""
          : `<div class="qv-aviso">Aún no consultaste las posiciones: las columnas de GPS saldrán vacías. Actualízalas en <b>Seguimiento</b> y vuelve aquí.</div>`
      }
      ${
        filtroDefinido()
          ? ""
          : `<div class="qv-aviso">El filtro de negocio no está definido: el reporte incluye <b>todas</b> las filas del Excel SAP.</div>`
      }
      <div class="qv-actions">
        <button type="button" class="primary" id="qv-xlsx">DESCARGAR EXCEL</button>
        <button type="button" class="ghost" id="qv-go-seg">IR A SEGUIMIENTO</button>
        <span id="qv-msg" class="muted"></span>
      </div>
      <p class="muted" style="margin:12px 0 6px">Vista previa (${Math.min(MAX_VISTA, filas.length)} de ${filas.length}):</p>
      <div class="qv-table-wrap">
        <table class="qv-table">
          <thead><tr>${ENCABEZADOS_REPORTE.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${filas
            .slice(0, MAX_VISTA)
            .map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>
      </div>
    </section>`;

  const $ = (sel) => container.querySelector(sel);
  $("#qv-go-seg").addEventListener("click", () => irA("seguimiento"));
  $("#qv-xlsx").addEventListener("click", async () => {
    const btn = $("#qv-xlsx");
    const msg = $("#qv-msg");
    btn.disabled = true;
    msg.textContent = "Generando Excel…";
    try {
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.aoa_to_sheet([ENCABEZADOS_REPORTE, ...filas]);
      ws["!cols"] = ENCABEZADOS_REPORTE.map((h) => ({ wch: Math.max(12, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "DESPACHOS");
      XLSX.writeFile(wb, `QUELLAVECO_despachos_${hoyLima()}.xlsx`);
      msg.textContent = "Excel descargado";
    } catch (e) {
      msg.textContent = `⚠ ${e.message || e}`;
    } finally {
      btn.disabled = false;
    }
  });
}

export function unmount() {}
