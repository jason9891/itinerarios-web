/**
 * Módulo ABARROTES · Reporte
 * Excel de control con la misma estructura de la hoja MONITOREO (+ SIN SEGUIMIENTO y RESUMEN POR RUTA).
 */
import { esc, moduleHead, loadXlsx, irA } from "../api-client.js";
import { contadores } from "../consolidado.js";
import { leerCarga, leerSeguimiento } from "../store.js";
import { ENCABEZADOS_MONITOREO, filasMonitoreo, resumenPorRuta } from "../seg-util.js";
import { ESTADOS } from "../maestros.js";

const MAX_VISTA = 40;
const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export async function mount(container) {
  const carga = leerCarga();
  if (!carga?.viajes?.length) {
    container.innerHTML = `
      ${moduleHead("Reporte", "Excel de control de unidades")}
      <section class="panel">
        <div class="ab-aviso">No hay viajes cargados en esta sesión. Sube los Excel en <b>Carga</b>.</div>
        <div class="ab-actions"><button type="button" class="primary" id="ab-go">IR A CARGA</button></div>
      </section>`;
    container.querySelector("#ab-go").addEventListener("click", () => irA("despachos"));
    return;
  }
  const seg = leerSeguimiento();
  const viajes = carga.viajes;
  const c = contadores(viajes, seg);
  const filas = filasMonitoreo(viajes, seg);
  const iSeg = ENCABEZADOS_MONITOREO.length - 1;

  container.innerHTML = `
    ${moduleHead("Reporte", "Excel de control de unidades")}
    <section class="panel">
      <div class="ab-grid">
        <div class="ab-card"><small>VIAJES</small><b>${c.total}</b></div>
        <div class="ab-card ok"><small>REVISADAS</small><b>${c.revisadas}</b></div>
        <div class="ab-card ${c.con_sugerencia ? "warn" : ""}"><small>SUGERIDAS SIN REVISAR</small><b>${c.con_sugerencia}</b></div>
        <div class="ab-card ${c.sin_gps ? "warn" : "ok"}"><small>SIN SEGUIMIENTO NI GPS</small><b>${c.sin_gps}</b></div>
      </div>
      ${c.sin_seguimiento ? `<div class="ab-aviso">Hay <b>${c.sin_seguimiento}</b> viajes sin revisar. Salen en el Excel con su sugerencia (si ya consultaste el GPS) o vacíos, y quedan marcados en la columna SEGUIMIENTO y en la hoja «SIN SEGUIMIENTO».</div>` : ""}
      <div class="ab-actions">
        <button type="button" class="primary" id="ab-xlsx">DESCARGAR EXCEL</button>
        <button type="button" class="ghost" id="ab-go-seg">IR A SEGUIMIENTO</button>
        <span id="ab-msg" class="muted"></span>
      </div>
      <p class="muted" style="margin:12px 0 6px">Vista previa (${Math.min(MAX_VISTA, filas.length)} de ${filas.length}):</p>
      <div class="ab-table-wrap"><table class="ab-table">
        <thead><tr>${ENCABEZADOS_MONITOREO.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${filas.slice(0, MAX_VISTA).map((f) => `<tr>${f.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </section>`;

  const $ = (s) => container.querySelector(s);
  $("#ab-go-seg").addEventListener("click", () => irA("seguimiento"));
  $("#ab-xlsx").addEventListener("click", async () => {
    const btn = $("#ab-xlsx"), msg = $("#ab-msg");
    btn.disabled = true;
    msg.textContent = "Generando Excel…";
    try {
      const XLSX = await loadXlsx();
      const hoja = (aoa, anchos) => {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = anchos;
        return ws;
      };
      const anchos = ENCABEZADOS_MONITOREO.map((h) => ({ wch: Math.max(12, Math.min(28, h.length + 2)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, hoja([ENCABEZADOS_MONITOREO, ...filas], anchos), "MONITOREO");
      const sin = filas.filter((f) => f[iSeg] !== "REVISADA");
      XLSX.utils.book_append_sheet(wb, hoja([ENCABEZADOS_MONITOREO, ...sin], anchos), "SIN SEGUIMIENTO");
      const res = resumenPorRuta(viajes, seg);
      const cols = [...ESTADOS, "SIN ESTADO"];
      XLSX.utils.book_append_sheet(
        wb,
        hoja([["RUTA", ...cols, "TOTAL"], ...res.map((r) => [r.ruta, ...cols.map((e) => r.porEstado[e] || 0), r.total])], [{ wch: 38 }, ...cols.map(() => { return { wch: 16 }; }), { wch: 8 }]),
        "RESUMEN POR RUTA",
      );
      XLSX.writeFile(wb, `ABARROTES_${hoyLima()}.xlsx`);
      msg.textContent = "Excel descargado";
    } catch (e) {
      msg.textContent = `⚠ ${e.message || e}`;
    } finally {
      btn.disabled = false;
    }
  });
}

export function unmount() {}
