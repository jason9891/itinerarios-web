/**
 * Carga ÚNICA de OC y TIPO_ACOPLE.
 * Valida cabeceras en el navegador antes de enviar a Supabase.
 * OC: conserva solo la última por Equipo (FecIniReal).
 */
import { moduleHead, esc, maestrosApi, fechaPE } from "../api-client.js";

let disposed = false;
let xlsxLib = null;

async function loadXlsx() {
  if (xlsxLib) return xlsxLib;
  xlsxLib = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return xlsxLib;
}

function normalizarClave(valor) {
  if (valor == null) return "";
  return String(valor)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

async function readSheetRows(file, headerRow = 0) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
    range: headerRow,
  });
  return rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim()] = v;
    return out;
  });
}

function findCol(row, name) {
  const keys = Object.keys(row || {});
  return keys.find((k) => k.trim().toLowerCase() === name.toLowerCase()) || null;
}

function validateOc(rows0, rows1) {
  const required = [
    "FecIniReal",
    "Equipo",
    "Acoplado 1",
    "Nombre Piloto",
    "Descripción Ruta",
    "Material de Servicio",
  ];
  const tryRows = [
    { header: 0, rows: rows0 },
    { header: 1, rows: rows1 },
  ];
  for (const attempt of tryRows) {
    if (!attempt.rows.length) continue;
    const sample = attempt.rows[0];
    const found = {};
    const missing = [];
    for (const c of required) {
      const k = findCol(sample, c);
      if (k) found[c] = k;
      else missing.push(c);
    }
    if (!missing.length) {
      // última OC por equipo
      const best = new Map();
      let total = 0;
      for (const r of attempt.rows) {
        const eqKey = findCol(r, "Equipo");
        const equipo = normalizarClave(eqKey ? r[eqKey] : "");
        if (!equipo) continue;
        total++;
        const fecKey = findCol(r, "FecIniReal");
        const fecRaw = fecKey ? r[fecKey] : "";
        const ts = Date.parse(String(fecRaw)) || 0;
        const prev = best.get(equipo);
        if (prev && prev.ts >= ts) continue;
        best.set(equipo, { ts, row: r, equipo });
      }
      const unicas = [...best.values()];
      const sampleOut = unicas.slice(0, 5).map((u) => {
        const r = u.row;
        return {
          equipo: u.equipo,
          fec: r[findCol(r, "FecIniReal")] ?? "",
          acoplado: r[findCol(r, "Acoplado 1")] ?? "",
          piloto: r[findCol(r, "Nombre Piloto")] ?? "",
          ruta: r[findCol(r, "Descripción Ruta")] ?? "",
        };
      });
      return {
        ok: true,
        headerRow: attempt.header,
        headers: Object.keys(sample),
        found,
        missing: [],
        totalFilasConEquipo: total,
        equiposUnicos: unicas.length,
        descartadas: Math.max(0, total - unicas.length),
        sample: sampleOut,
      };
    }
  }
  const headers = rows0[0] ? Object.keys(rows0[0]) : rows1[0] ? Object.keys(rows1[0]) : [];
  return {
    ok: false,
    headers,
    missing: required,
    found: {},
    totalFilasConEquipo: 0,
    equiposUnicos: 0,
    descartadas: 0,
    sample: [],
  };
}

function validateAcoples(rows) {
  if (!rows.length) {
    return { ok: false, headers: [], missing: ["(vacío)"], firstCol: null, sample: [] };
  }
  const headers = Object.keys(rows[0]);
  const firstCol = headers[0];
  const hasCar = headers.some((h) => h.toUpperCase() === "CARROCERIA");
  const hasGes = headers.some((h) => h.toUpperCase() === "GESTOR");
  const missing = [];
  if (!hasCar) missing.push("CARROCERIA");
  if (!hasGes) missing.push("GESTOR");
  const byCode = new Map();
  for (const r of rows) {
    const codigo = normalizarClave(r[firstCol]);
    if (!codigo) continue;
    byCode.set(codigo, {
      codigo,
      carroceria: r[headers.find((h) => h.toUpperCase() === "CARROCERIA")] ?? "",
      gestor: r[headers.find((h) => h.toUpperCase() === "GESTOR")] ?? "",
    });
  }
  return {
    ok: missing.length === 0,
    headers,
    firstCol,
    missing,
    unicos: byCode.size,
    sample: [...byCode.values()].slice(0, 5),
  };
}

function renderHeaders(headers, foundMap, missing) {
  const foundSet = new Set(Object.values(foundMap || {}));
  const missSet = new Set((missing || []).map((m) => m.toLowerCase()));
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">
      ${headers
        .map((h) => {
          const ok = foundSet.has(h) || !missSet.has(h.toLowerCase());
          const cls = foundSet.has(h) ? "ok" : missSet.has(h.toLowerCase()) ? "err" : "";
          return `<span class="tn-badge ${cls}">${esc(h)}</span>`;
        })
        .join("")}
    </div>
    ${
      missing?.length
        ? `<p class="tn-badge err">Faltan: ${missing.map(esc).join(", ")}</p>`
        : `<p class="tn-badge ok">Cabeceras requeridas OK</p>`
    }
  `;
}

function renderSampleTable(cols, rows) {
  if (!rows?.length) return "";
  return `
    <div class="tn-table-wrap" style="max-height:220px;margin-top:10px">
      <table class="tn-table">
        <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:12px;margin-top:6px">Muestra de las primeras filas que se guardarán (ya deduplicadas).</p>
  `;
}

export async function mount(container) {
  disposed = false;
  container.innerHTML = `
    ${moduleHead(
      "Maestros",
      "Valida cabeceras → procesa Excel → deja última OC por equipo y catálogo de acoples",
    )}
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>1 · Archivo OC</h2>
          <p class="muted">Requeridas: FecIniReal, Equipo, Acoplado 1, Nombre Piloto, Descripción Ruta, Material de Servicio. Por cada Equipo solo queda la OC más reciente.</p>
        </div>
      </div>
      <div class="tn-upload">
        <label class="file-button">SELECCIONAR OC (.xlsx)
          <input id="tn-oc-file" type="file" accept=".xlsx,.xls" hidden>
        </label>
        <button id="tn-oc-validate" class="ghost" disabled>VALIDAR CABECERAS</button>
        <button id="tn-oc-upload" class="primary" disabled>SUBIR Y GUARDAR ÚLTIMA OC</button>
        <span id="tn-oc-name" class="muted"></span>
      </div>
      <div id="tn-oc-result"></div>
    </section>
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>2 · Tipo de acople</h2>
          <p class="muted">1ª columna = código de acople. Obligatorias: CARROCERIA y GESTOR. Queda editable en el módulo Tipo Acople.</p>
        </div>
      </div>
      <div class="tn-upload">
        <label class="file-button">SELECCIONAR TIPO_ACOPLE (.xlsx)
          <input id="tn-ac-file" type="file" accept=".xlsx,.xls" hidden>
        </label>
        <button id="tn-ac-validate" class="ghost" disabled>VALIDAR CABECERAS</button>
        <button id="tn-ac-upload" class="primary" disabled>SUBIR Y GUARDAR CATÁLOGO</button>
        <span id="tn-ac-name" class="muted"></span>
      </div>
      <div id="tn-ac-result"></div>
    </section>
    <section class="panel">
      <div class="panel-title"><div><h2>Estado en Supabase</h2></div>
        <button id="tn-refresh" class="ghost">ACTUALIZAR</button>
      </div>
      <div id="tn-estado" class="tn-grid"></div>
    </section>
  `;

  const ocFile = container.querySelector("#tn-oc-file");
  const acFile = container.querySelector("#tn-ac-file");
  const ocVal = container.querySelector("#tn-oc-validate");
  const acVal = container.querySelector("#tn-ac-validate");
  const ocBtn = container.querySelector("#tn-oc-upload");
  const acBtn = container.querySelector("#tn-ac-upload");
  const ocName = container.querySelector("#tn-oc-name");
  const acName = container.querySelector("#tn-ac-name");
  const ocRes = container.querySelector("#tn-oc-result");
  const acRes = container.querySelector("#tn-ac-result");
  const estado = container.querySelector("#tn-estado");

  let ocSelected = null;
  let acSelected = null;
  let ocOk = false;
  let acOk = false;

  ocFile.addEventListener("change", () => {
    ocSelected = ocFile.files?.[0] || null;
    ocName.textContent = ocSelected ? `${ocSelected.name} (${(ocSelected.size / 1024).toFixed(1)} KB)` : "";
    ocOk = false;
    ocVal.disabled = !ocSelected;
    ocBtn.disabled = true;
    ocRes.innerHTML = ocSelected
      ? `<p class="muted">Archivo listo. Pulsa <b>VALIDAR CABECERAS</b> antes de subir.</p>`
      : "";
  });
  acFile.addEventListener("change", () => {
    acSelected = acFile.files?.[0] || null;
    acName.textContent = acSelected ? `${acSelected.name} (${(acSelected.size / 1024).toFixed(1)} KB)` : "";
    acOk = false;
    acVal.disabled = !acSelected;
    acBtn.disabled = true;
    acRes.innerHTML = acSelected
      ? `<p class="muted">Archivo listo. Pulsa <b>VALIDAR CABECERAS</b> antes de subir.</p>`
      : "";
  });

  ocVal.addEventListener("click", async () => {
    if (!ocSelected) return;
    ocVal.disabled = true;
    ocVal.textContent = "VALIDANDO…";
    ocRes.innerHTML = `<p class="muted">Leyendo Excel y comprobando cabeceras…</p>`;
    try {
      const rows0 = await readSheetRows(ocSelected, 0);
      const rows1 = await readSheetRows(ocSelected, 1);
      const v = validateOc(rows0, rows1);
      if (disposed) return;
      ocOk = v.ok;
      ocBtn.disabled = !v.ok;
      ocRes.innerHTML = `
        <div class="tn-card ${v.ok ? "ok" : "warn"}" style="margin-top:10px">
          <small>VALIDACIÓN OC</small>
          <b>${v.ok ? "Cabeceras correctas" : "Cabeceras incompletas"}</b>
          <p class="muted" style="font-size:12px;margin:6px 0">Fila de encabezado usada: ${v.headerRow ?? "—"}</p>
          ${renderHeaders(v.headers || [], v.found || {}, v.missing)}
          ${
            v.ok
              ? `<p style="margin-top:8px">Filas con Equipo: <b>${v.totalFilasConEquipo}</b> ·
                 Equipos únicos (última OC): <b>${v.equiposUnicos}</b> ·
                 Descartadas (OC anteriores): <b>${v.descartadas}</b></p>
                 ${renderSampleTable(["equipo", "fec", "acoplado", "piloto", "ruta"], v.sample)}`
              : ""
          }
        </div>
      `;
    } catch (e) {
      ocOk = false;
      ocBtn.disabled = true;
      ocRes.innerHTML = `<p class="tn-badge err">${esc(e.message)}</p>`;
    } finally {
      ocVal.disabled = !ocSelected;
      ocVal.textContent = "VALIDAR CABECERAS";
    }
  });

  acVal.addEventListener("click", async () => {
    if (!acSelected) return;
    acVal.disabled = true;
    acVal.textContent = "VALIDANDO…";
    acRes.innerHTML = `<p class="muted">Leyendo Excel y comprobando cabeceras…</p>`;
    try {
      const rows = await readSheetRows(acSelected, 0);
      const v = validateAcoples(rows);
      if (disposed) return;
      acOk = v.ok;
      acBtn.disabled = !v.ok;
      acRes.innerHTML = `
        <div class="tn-card ${v.ok ? "ok" : "warn"}" style="margin-top:10px">
          <small>VALIDACIÓN TIPO ACOPLE</small>
          <b>${v.ok ? "Cabeceras correctas" : "Cabeceras incompletas"}</b>
          <p class="muted" style="font-size:12px;margin:6px 0">Columna código: <b>${esc(v.firstCol || "—")}</b></p>
          ${renderHeaders(v.headers || [], {}, v.missing)}
          ${
            v.ok
              ? `<p style="margin-top:8px">Acoples únicos: <b>${v.unicos}</b></p>
                 ${renderSampleTable(["codigo", "carroceria", "gestor"], v.sample)}`
              : ""
          }
        </div>
      `;
    } catch (e) {
      acOk = false;
      acBtn.disabled = true;
      acRes.innerHTML = `<p class="tn-badge err">${esc(e.message)}</p>`;
    } finally {
      acVal.disabled = !acSelected;
      acVal.textContent = "VALIDAR CABECERAS";
    }
  });

  async function refresh() {
    try {
      const st = await maestrosApi({ action: "estado" });
      if (disposed) return;
      const oc = st.oc || {};
      const ac = st.acoples || {};
      estado.innerHTML = `
        <div class="tn-card ${oc.filas ? "ok" : "warn"}"><small>OC ÚLTIMA / EQUIPO</small><b>${oc.filas ?? 0}</b>
          <span class="muted" style="font-size:12px">${oc.filas ? fechaPE(oc.actualizado_en) : "Sin datos"} · ${esc(oc.nombre_archivo || "—")}</span></div>
        <div class="tn-card ${ac.filas ? "ok" : "warn"}"><small>ACOPLES</small><b>${ac.filas ?? 0}</b>
          <span class="muted" style="font-size:12px">${ac.filas ? fechaPE(ac.actualizado_en) : "Sin datos"} · ${esc(ac.nombre_archivo || "—")}</span></div>
      `;
    } catch (e) {
      if (disposed) return;
      estado.innerHTML = `<div class="tn-card warn"><small>BACKEND</small><b>Pendiente de despliegue</b>
        <span class="muted" style="font-size:12px">${esc(e.message)}. La validación de cabeceras sí funciona en el navegador.</span></div>`;
    }
  }

  ocBtn.addEventListener("click", async () => {
    if (!ocSelected || !ocOk) return;
    ocBtn.disabled = true;
    ocBtn.textContent = "SUBIENDO…";
    try {
      const b64 = await fileToBase64(ocSelected);
      const r = await maestrosApi({
        action: "cargar_oc",
        nombre_archivo: ocSelected.name,
        contenido_base64: b64,
      });
      ocRes.innerHTML += `<p class="tn-badge ok" style="margin-top:8px">Guardado en Supabase · ${r.filas_unicas ?? r.filas ?? 0} equipos · descartadas ${r.filas_descartadas ?? 0}</p>`;
      await refresh();
    } catch (e) {
      ocRes.innerHTML += `<p class="tn-badge err" style="margin-top:8px">${esc(e.message)}</p>`;
    } finally {
      ocBtn.disabled = !ocOk;
      ocBtn.textContent = "SUBIR Y GUARDAR ÚLTIMA OC";
    }
  });

  acBtn.addEventListener("click", async () => {
    if (!acSelected || !acOk) return;
    acBtn.disabled = true;
    acBtn.textContent = "SUBIENDO…";
    try {
      const b64 = await fileToBase64(acSelected);
      const r = await maestrosApi({
        action: "cargar_acoples",
        nombre_archivo: acSelected.name,
        contenido_base64: b64,
      });
      acRes.innerHTML += `<p class="tn-badge ok" style="margin-top:8px">Guardado · ${r.filas ?? 0} acoples</p>`;
      await refresh();
    } catch (e) {
      acRes.innerHTML += `<p class="tn-badge err" style="margin-top:8px">${esc(e.message)}</p>`;
    } finally {
      acBtn.disabled = !acOk;
      acBtn.textContent = "SUBIR Y GUARDAR CATÁLOGO";
    }
  });

  container.querySelector("#tn-refresh").addEventListener("click", refresh);
  await refresh();
}

export function unmount() {
  disposed = true;
}
