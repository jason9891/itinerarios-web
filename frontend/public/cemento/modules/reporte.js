/**
 * CEMENTO · Crear reporte
 * Independiente: usa cemento-reporte + corte PARCIAL/COMPLETO de seguimiento.
 */
import { apiPost, esc, moduleHead } from "../api-client.js";
import { API } from "../registry.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo reporte…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en reporte</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

async function reportApi(body, binary = false) {
  return apiPost(API.report, body, { binary });
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function downloadReportZip(files, zipName, folderName) {
  if (!window.JSZip) throw new Error("No se pudo cargar el empaquetador ZIP");
  const zip = new window.JSZip();
  const folder = zip.folder(folderName || zipName.replace(/\.zip$/i, "")) || zip;
  files.forEach((file) => folder.file(file.name, file.blob));
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, zipName);
}

function rounded(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function textCanvas(ctx, text, x, y, w, h, size = 14, color = "#26364D", bold = false, align = "left") {
  ctx.font = `${bold ? 700 : 400} ${size}px Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  let t = String(text ?? "");
  while (ctx.measureText(t).width > w && t.length > 2) t = t.slice(0, -2) + "…";
  ctx.fillText(t, align === "center" ? x + w / 2 : align === "right" ? x + w : x, y + h / 2);
}

function reportCanvasData(s) {
  const rows = s.rutas || [];
  const bases = s.bases || [];
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = Math.max(720, 220 + rows.length * 62);
  const x = c.getContext("2d");
  const sx = 40;
  const sy = 120;
  const routeWidths = [560, 150, 150, 150];
  const routeTotal = routeWidths.reduce((a, b) => a + b, 0);
  const baseX = 1085;
  const baseW = 470;
  const headerBlue = "#2F66B5";
  const edge = "#D8E1EE";
  x.fillStyle = "#FFFFFF";
  x.fillRect(0, 0, c.width, c.height);
  textCanvas(x, "RESUMEN GENERAL UNIDADES · RACIEMSA ZONA SUR", 45, 26, 1480, 42, 28, "#173B75", true);
  textCanvas(x, "CARGADAS = en ruta o en destino · VACÍAS = retorno o en base según última OC", 45, 70, 1480, 24, 13, "#61708A");

  rounded(x, sx, sy, routeTotal, 52, 10, headerBlue);
  let tx = sx;
  ["RUTA", "CARGADAS", "VACÍAS", "TOTAL"].forEach((label, i) => {
    textCanvas(x, label, tx + 6, sy, routeWidths[i] - 12, 52, 13, "#FFFFFF", true, "center");
    tx += routeWidths[i];
  });

  let y = sy + 60;
  rows.forEach((row, i) => {
    rounded(x, sx, y, routeTotal, 44, 6, i % 2 ? "#F7FAFD" : "#FFFFFF", edge);
    textCanvas(x, row.ruta, sx + 12, y, routeWidths[0] - 24, 44, 12, "#243854");
    let px = sx + routeWidths[0];
    [row.cargadas, row.vacias, row.total].forEach((value, idx) => {
      textCanvas(x, value, px, y, routeWidths[idx + 1], 44, 13, "#173B75", true, "center");
      px += routeWidths[idx + 1];
    });
    y += 52;
  });

  rounded(x, sx, y + 8, routeTotal, 48, 6, "#FFF4E5", "#F0C77B");
  textCanvas(x, "TOTAL DE UNIDADES ASIGNADAS A UNA OPERACION", sx + 12, y + 8, routeWidths[0] + routeWidths[1] + routeWidths[2] - 24, 48, 13, "#8A4B00", true);
  textCanvas(x, s.total_asignadas || 0, sx + routeWidths[0] + routeWidths[1] + routeWidths[2], y + 8, routeWidths[3], 48, 16, "#8A4B00", true, "center");

  let by = sy;
  rounded(x, baseX, by, baseW, 52, 10, headerBlue);
  textCanvas(x, "UNIDADES EN BASE", baseX + 8, by, baseW - 16, 52, 14, "#FFFFFF", true, "center");
  by += 60;
  const baseCols = [210, 110, 100, 50];
  const baseHeaders = ["BASE", "CARGADAS", "VACÍAS", "TOTAL"];
  let bx = baseX;
  baseHeaders.forEach((label, i) => {
    rounded(x, bx, by, baseCols[i], 46, 4, "#EFF4FA", edge);
    textCanvas(x, label, bx + 6, by, baseCols[i] - 12, 46, 12, "#173B75", true, "center");
    bx += baseCols[i];
  });
  by += 54;
  bases.forEach((row) => {
    let cx = baseX;
    [row.base, row.cargadas, row.vacias, row.total].forEach((val, i) => {
      rounded(x, cx, by, baseCols[i], 48, 4, "#FFFFFF", edge);
      textCanvas(x, val, cx + 10, by, baseCols[i] - 20, 48, 12, "#173B75", i > 0, i === 0 ? "left" : "center");
      cx += baseCols[i];
    });
    by += 56;
  });
  rounded(x, baseX, by + 8, baseW, 52, 6, "#EEF4FD", "#B7C9E6");
  textCanvas(x, "TOTAL EN BASE", baseX + 12, by + 8, baseW - 100, 52, 13, "#173B75", true);
  textCanvas(x, s.total_en_base || 0, baseX + baseW - 90, by + 8, 70, 52, 16, "#173B75", true, "center");
  return c;
}

function reportCanvasBars(s) {
  const rows = s.rutas || [];
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 880;
  const x = c.getContext("2d");
  const chartX = 80;
  const chartY = 175;
  const chartW = 1040;
  const chartH = 520;
  const dark = "#1E4FA3";
  const light = "#7EB0E4";
  const grid = "#D8E1EE";
  x.fillStyle = "#FFFFFF";
  x.fillRect(0, 0, c.width, c.height);
  textCanvas(x, "DISTRIBUCIÓN DE UNIDADES POR RUTA", 45, 28, 1480, 40, 26, "#173B75", true);
  textCanvas(x, "Barras azules = CARGADAS · Barras celestes = VACÍAS", 45, 72, 1480, 24, 13, "#61708A");

  x.strokeStyle = grid;
  x.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gy = chartY + (chartH * i) / 5;
    x.beginPath();
    x.moveTo(chartX, gy);
    x.lineTo(chartX + chartW, gy);
    x.stroke();
  }
  x.strokeStyle = "#94A3B8";
  x.strokeRect(chartX, chartY, chartW, chartH);

  const max = Math.max(1, ...rows.map((r) => Math.max(r.cargadas || 0, r.vacias || 0)));
  const n = Math.max(1, rows.length);
  const groupW = chartW / n;
  rows.forEach((row, i) => {
    const cx = chartX + groupW * i + groupW / 2;
    const barW = Math.min(42, groupW * 0.22);
    const gap = Math.min(12, groupW * 0.08);
    const h1 = (chartH * (row.cargadas || 0)) / max;
    const h2 = (chartH * (row.vacias || 0)) / max;
    rounded(x, cx - gap - barW, chartY + chartH - h1, barW, h1, 4, dark);
    rounded(x, cx + gap, chartY + chartH - h2, barW, h2, 4, light);
    textCanvas(x, row.cargadas || 0, cx - gap - barW - 10, chartY + chartH - h1 - 28, barW + 20, 20, 12, dark, true, "center");
    textCanvas(x, row.vacias || 0, cx + gap - 10, chartY + chartH - h2 - 28, barW + 20, 20, 12, "#4E86C9", true, "center");
    const label = String(row.ruta || "").replace(/\s+a\s+/g, " a ").replace(/\s+/g, " ");
    const parts = label.split(" ");
    const maxPerLine = 16;
    let line1 = "", line2 = "", line3 = "";
    for (const part of parts) {
      if ((line1 + " " + part).trim().length <= maxPerLine) line1 = (line1 + " " + part).trim();
      else if ((line2 + " " + part).trim().length <= maxPerLine) line2 = (line2 + " " + part).trim();
      else line3 = (line3 + " " + part).trim();
    }
    [line1, line2, line3].filter(Boolean).forEach((line, idx) => {
      textCanvas(x, line, cx - groupW / 2 + 4, chartY + chartH + 12 + idx * 18, groupW - 8, 18, 11, "#243854", idx === 0, "center");
    });
  });
  textCanvas(x, "NÚMERO DE UNIDADES", 18, chartY + chartH / 2 - 20, 30, 180, 12, "#61708A", true, "center");
  textCanvas(x, "RUTA", chartX + chartW / 2 - 50, 760, 100, 24, 12, "#61708A", true, "center");
  rounded(x, 500, 800, 28, 28, 5, dark);
  textCanvas(x, "CARGADAS", 540, 800, 140, 28, 12, "#243854", true);
  rounded(x, 680, 800, 28, 28, 5, light);
  textCanvas(x, "VACÍAS", 720, 800, 120, 28, 12, "#243854", true);

  const panelX = 1165, panelW = 390;
  rounded(x, panelX, 165, panelW, 54, 10, "#2F66B5");
  textCanvas(x, "TOTALES GENERALES", panelX + 8, 165, panelW - 16, 54, 14, "#FFFFFF", true, "center");
  const cards = [
    ["TOTAL CARGADAS", s.total_cargadas || 0, "#1E4FA3"],
    ["TOTAL VACÍAS", s.total_vacias || 0, "#4E86C9"],
    ["TOTAL OPERATIVO", s.total_asignadas || 0, "#173B75"],
  ];
  let cy = 235;
  cards.forEach(([label, value, color]) => {
    rounded(x, panelX, cy, panelW, 98, 10, "#F7FAFD", grid);
    textCanvas(x, label, panelX + 30, cy + 16, 210, 28, 13, "#173B75", true);
    textCanvas(x, value, panelX + 255, cy + 10, 100, 52, 26, color, true, "center");
    cy += 112;
  });
  return c;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen"))), "image/png"),
  );
}

async function confirmPartial(state) {
  if (state?.estado !== "PARCIAL") return true;
  const when = state.completado_en
    ? new Date(state.completado_en).toLocaleString("es-PE")
    : "sin fecha";
  return window.confirm(
    `SEGUIMIENTO PARCIAL\n\n` +
      `Se revisaron ${state.revisadas} de ${state.total_placas} placas con OC abiertas.\n` +
      `Último guardado parcial: ${when}.\n\n` +
      `El reporte se generará con el estado consolidado hasta ese corte.\n` +
      `¿Desea continuar?`,
  );
}

async function render(container, runtime) {
  const state = await reportApi({ action: "estado" });
  const partial = state.estado === "PARCIAL";
  const cutText = state.completado_en
    ? new Date(state.completado_en).toLocaleString("es-PE")
    : "—";
  const title = state.habilitado
    ? partial
      ? "SEGUIMIENTO PARCIAL · REPORTE DISPONIBLE"
      : "SEGUIMIENTO COMPLETO"
    : "REPORTE PENDIENTE DE CORTE";
  const noticeBg = state.habilitado
    ? partial
      ? "#fff7ed"
      : "#ecfdf5"
    : "#fef2f2";
  const noticeBorder = state.habilitado ? (partial ? "#fdba74" : "#6ee7b7") : "#fca5a5";
  const noticeColor = state.habilitado ? (partial ? "#9a3412" : "#065f46") : "#991b1b";

  container.innerHTML =
    `<div id="cem-report-root" style="color:#0f172a"><style>#cem-report-root,#cem-report-root *{color:inherit}#cem-report-root .module-head h1{color:#f8fafc!important}#cem-report-root .module-head p,#cem-report-root .module-head .eyebrow{color:#94a3b8!important}#cem-report-root article h2{color:#0f172a!important}#cem-report-root article p{color:#334155!important}</style>` +
    moduleHead("Crear reporte", "Excel final y dos imágenes para correo, desde el último corte guardado.") +
    `<section style="border:1px solid ${noticeBorder};background:${noticeBg};color:${noticeColor};padding:14px 16px;border-radius:10px;margin-bottom:14px">
      <b style="display:block;font-size:16px;font-weight:950;color:${noticeColor}">${esc(title)}</b>
      <span style="display:block;margin-top:6px;font-size:13px;font-weight:600;color:${noticeColor};line-height:1.45">${esc(state.mensaje || "—")} · ${state.revisadas || 0}/${state.total_placas || 0} placas revisadas · ${state.diario || 0} OCs abiertas.
      ${state.completado_en ? `<br><small style="opacity:.9">ÚLTIMO CORTE: ${esc(cutText)}</small>` : ""}</span>
    </section>
    <div style="margin:0 0 16px">
      <button type="button" id="report-all" ${state.habilitado ? "" : "disabled"}
        style="background:${state.habilitado ? "#1d4ed8" : "#94a3b8"};color:#fff;border:0;border-radius:8px;padding:14px 22px;font-size:14px;font-weight:900;cursor:${state.habilitado ? "pointer" : "not-allowed"}">
        ${partial ? "GENERAR REPORTE PARCIAL" : "GENERAR REPORTE COMPLETO"} · 3 ARCHIVOS
      </button>
    </div>
    <section class="panel" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
      <article style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fff">
        <div style="width:64px;height:64px;border-radius:14px;background:#dcfce7;display:grid;place-items:center;margin-bottom:10px">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="#15803d" stroke-width="1.8"/>
            <path d="M14 2v4h4" stroke="#15803d" stroke-width="1.8"/>
            <path d="M8 12h8M8 16h5" stroke="#15803d" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 style="margin:0 0 6px;font-size:16px;font-weight:900;color:#0f172a">Excel operativo</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#334155;line-height:1.4">31 columnas y formato autorizado de Cemento.</p>
        <button type="button" id="report-xlsx" ${state.habilitado ? "" : "disabled"}
          style="width:100%;padding:10px;border-radius:6px;border:1px solid #1d4ed8;background:#eff6ff;color:#1e3a8a;font-weight:800;cursor:pointer">DESCARGAR EXCEL</button>
      </article>
      <article style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fff">
        <div style="width:64px;height:64px;border-radius:14px;background:#e0f2fe;display:grid;place-items:center;margin-bottom:10px">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="14" rx="2" stroke="#0369a1" stroke-width="1.8"/>
            <path d="M7 14l3-3 3 2 4-5" stroke="#0369a1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h2 style="margin:0 0 6px;font-size:16px;font-weight:900;color:#0f172a">Resumen de datos</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#334155;line-height:1.4">Rutas, unidades en base y total operativo validado.</p>
        <button type="button" id="report-data" ${state.habilitado ? "" : "disabled"}
          style="width:100%;padding:10px;border-radius:6px;border:1px solid #1d4ed8;background:#eff6ff;color:#1e3a8a;font-weight:800;cursor:pointer">DESCARGAR IMAGEN</button>
      </article>
      <article style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fff">
        <div style="width:64px;height:64px;border-radius:14px;background:#fef3c7;display:grid;place-items:center;margin-bottom:10px">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 18V10M12 18V6M18 18v-7" stroke="#b45309" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 style="margin:0 0 6px;font-size:16px;font-weight:900;color:#0f172a">Distribución por ruta</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#334155;line-height:1.4">Resumen gráfico por ruta: cargadas y vacías.</p>
        <button type="button" id="report-bars" ${state.habilitado ? "" : "disabled"}
          style="width:100%;padding:10px;border-radius:6px;border:1px solid #1d4ed8;background:#eff6ff;color:#1e3a8a;font-weight:800;cursor:pointer">DESCARGAR IMAGEN</button>
      </article>
    </section>
    <p id="report-status" style="margin-top:12px;color:#475569;font-size:13px"></p></div>`;

  if (!state.habilitado) return;

  let data;
  const getData = async () => {
    if (data === undefined) data = await reportApi({ action: "datos" });
    return data;
  };
  const status = (msg) => {
    const el = container.querySelector("#report-status");
    if (el) el.textContent = msg || "";
  };
  const withBusy = async (btn, label, fn) => {
    if (!btn) return;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      await fn();
    } catch (e) {
      status(e.message || String(e));
      alert(e.message || String(e));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };

  const xlsxBtn = container.querySelector("#report-xlsx");
  const dataBtn = container.querySelector("#report-data");
  const barsBtn = container.querySelector("#report-bars");
  const allBtn = container.querySelector("#report-all");

  xlsxBtn.onclick = async () => {
    if (!(await confirmPartial(state))) return;
    await withBusy(xlsxBtn, "GENERANDO…", async () => {
      const x = await reportApi({ action: "excel" }, true);
      downloadBlob(x.blob, x.name);
      status("Excel descargado: " + x.name);
    });
  };

  dataBtn.onclick = async () => {
    if (!(await confirmPartial(state))) return;
    await withBusy(dataBtn, "GENERANDO…", async () => {
      const d = await getData();
      downloadBlob(await canvasBlob(reportCanvasData(d.resumen || {})), "resumen_general_de_unidades_raciemsa.png");
      status("Imagen de resumen descargada.");
    });
  };

  barsBtn.onclick = async () => {
    if (!(await confirmPartial(state))) return;
    await withBusy(barsBtn, "GENERANDO…", async () => {
      const d = await getData();
      downloadBlob(await canvasBlob(reportCanvasBars(d.resumen || {})), "resumen_de_unidades_por_ruta.png");
      status("Imagen de distribución descargada.");
    });
  };

  allBtn.onclick = async () => {
    if (!(await confirmPartial(state))) return;
    await withBusy(allBtn, "GENERANDO LOS 3 ARCHIVOS…", async () => {
      const [x, d] = await Promise.all([reportApi({ action: "excel" }, true), getData()]);
      const resumenBlob = await canvasBlob(reportCanvasData(d.resumen || {}));
      const barrasBlob = await canvasBlob(reportCanvasBars(d.resumen || {}));
      const folderName = x.name.replace(/\.xlsx$/i, "");
      await downloadReportZip(
        [
          { name: x.name, blob: x.blob },
          { name: "resumen_general_de_unidades_raciemsa.png", blob: resumenBlob },
          { name: "resumen_de_unidades_por_ruta.png", blob: barrasBlob },
        ],
        `${folderName}.zip`,
        folderName,
      );
      status("Paquete ZIP descargado: " + folderName + ".zip");

      // Tras reporte COMPLETO: avanza corte de precarga para el siguiente ciclo
      if (state.estado === "COMPLETO") {
        try {
          await apiPost(API.sap, {
            action: "actualizar_corte",
            fecha_local: new Date().toLocaleString("es-PE", { hour12: false }),
          });
        } catch (_) {
          /* no bloquea la descarga */
        }
        try {
          localStorage.removeItem("cemento_precarga_activa");
          localStorage.removeItem("cemento_precarga_v1");
        } catch (_) {}
        status("Reporte COMPLETO generado. Listo para el siguiente ciclo SAP → precarga → seguimiento.");
      }
    });
  };
}
