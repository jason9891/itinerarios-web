/**
 * Carga ÚNICA de OC y TIPO_ACOPLE.
 * Valida cabeceras en el navegador; procesa última OC por equipo.
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

function parseFecTs(raw) {
  if (raw == null || raw === "") return 0;
  const s = String(raw).trim();
  // Excel serial
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const ms = Math.round((n - 25569) * 86400 * 1000);
    return Number.isFinite(ms) ? ms : 0;
  }
  // DD/MM/YYYY[ HH:MM[:SS]]
  const m = s.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const d = new Date(
      yy,
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0),
    );
    return d.getTime() || 0;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
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
  for (const attempt of [
    { header: 0, rows: rows0 },
    { header: 1, rows: rows1 },
  ]) {
    if (!attempt.rows.length) continue;
    const sample = attempt.rows[0];
    const found = {};
    const missing = [];
    for (const c of required) {
      const k = findCol(sample, c);
      if (k) found[c] = k;
      else missing.push(c);
    }
    if (missing.length) continue;

    const best = new Map();
    let total = 0;
    for (const r of attempt.rows) {
      const eqKey = found["Equipo"];
      const equipo = normalizarClave(r[eqKey]);
      if (!equipo) continue;
      total++;
      const fecRaw = r[found["FecIniReal"]];
      const ts = parseFecTs(fecRaw);
      const prev = best.get(equipo);
      if (prev && prev._ts >= ts) continue;
      best.set(equipo, {
        _ts: ts,
        equipo,
        equipo_raw: String(r[eqKey] ?? equipo).trim(),
        fec_ini_real_raw: fecRaw != null ? String(fecRaw).trim() : "",
        fec_ini_real: ts ? new Date(ts).toISOString() : null,
        acoplado_1:
          r[found["Acoplado 1"]] != null
            ? String(r[found["Acoplado 1"]]).trim()
            : "",
        nombre_piloto:
          r[found["Nombre Piloto"]] != null
            ? String(r[found["Nombre Piloto"]]).trim()
            : "",
        descripcion_ruta:
          r[found["Descripción Ruta"]] != null
            ? String(r[found["Descripción Ruta"]]).trim()
            : "",
        material_servicio:
          r[found["Material de Servicio"]] != null
            ? String(r[found["Material de Servicio"]]).trim()
            : "",
      });
    }
    const filas = [...best.values()].map(({ _ts, ...rest }) => rest);
    const sampleOut = filas.slice(0, 8).map((u) => ({
      equipo: u.equipo,
      fec: u.fec_ini_real_raw,
      acoplado: u.acoplado_1,
      piloto: u.nombre_piloto,
      ruta: u.descripcion_ruta,
    }));
    return {
      ok: true,
      headerRow: attempt.header,
      headers: Object.keys(sample),
      found,
      missing: [],
      totalFilasConEquipo: total,
      equiposUnicos: filas.length,
      descartadas: Math.max(0, total - filas.length),
      sample: sampleOut,
      filas, // ya deduplicadas: última OC por equipo (proceso LOCAL)
    };
  }
  const headers = rows0[0]
    ? Object.keys(rows0[0])
    : rows1[0]
      ? Object.keys(rows1[0])
      : [];
  return {
    ok: false,
    headers,
    missing: required,
    found: {},
    totalFilasConEquipo: 0,
    equiposUnicos: 0,
    descartadas: 0,
    sample: [],
    filas: [],
  };
}

function validateAcoples(rows) {
  if (!rows.length) {
    return {
      ok: false,
      headers: [],
      missing: ["(archivo vacío)"],
      firstCol: null,
      sample: [],
      unicos: 0,
    };
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
    sample: [...byCode.values()].slice(0, 8),
  };
}

function renderHeaders(headers, foundMap, missing) {
  const foundSet = new Set(Object.values(foundMap || {}));
  const missLower = new Set((missing || []).map((m) => String(m).toLowerCase()));
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">
      ${(headers || [])
        .map((h) => {
          const isFound = foundSet.has(h);
          const isMiss = missLower.has(String(h).toLowerCase());
          const cls = isFound ? "ok" : isMiss ? "err" : "";
          return `<span class="tn-badge ${cls}">${esc(h)}</span>`;
        })
        .join("")}
    </div>
    ${
      missing?.length
        ? `<p><span class="tn-badge err">Faltan: ${missing.map(esc).join(", ")}</span></p>`
        : `<p><span class="tn-badge ok">Cabeceras requeridas OK</span></p>`
    }
  `;
}

function renderSampleTable(cols, rows) {
  if (!rows?.length) return "";
  return `
    <div class="tn-table-wrap" style="max-height:260px;margin-top:10px">
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
    <p class="muted" style="font-size:12px;margin-top:6px">Vista previa de filas que se guardarán (ya deduplicadas).</p>
  `;
}

export async function mount(container) {
  disposed = false;
  container.innerHTML = `
    ${moduleHead(
      "Maestros",
      "Selecciona el Excel → se validan cabeceras al instante → sube para guardar en Supabase",
    )}
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>1 · Archivo OC</h2>
          <p class="muted">Columnas: FecIniReal, Equipo, Acoplado 1, Nombre Piloto, Descripción Ruta, Material de Servicio. Por cada Equipo solo se conserva la OC más reciente. La comparación se hace en el navegador; no se sube el archivo completo.</p>
        </div>
      </div>
      <div class="tn-upload">
        <label class="file-button">
          SELECCIONAR OC (.xlsx)
          <input id="tn-oc-file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </label>
        <button type="button" id="tn-oc-upload" class="primary" disabled>SINCRONIZAR RESUMEN A SUPABASE</button>
        <span id="tn-oc-name" class="muted"></span>
      </div>
      <div id="tn-oc-result"><p class="muted">Aún no hay archivo. Al elegirlo se validan las cabeceras automáticamente.</p></div>
    </section>
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>2 · Tipo de acople</h2>
          <p class="muted">1ª columna = código. Obligatorias: CARROCERIA y GESTOR. Luego editable en el menú Tipo Acople.</p>
        </div>
      </div>
      <div class="tn-upload">
        <label class="file-button">
          SELECCIONAR TIPO_ACOPLE (.xlsx)
          <input id="tn-ac-file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </label>
        <button type="button" id="tn-ac-upload" class="primary" disabled>SUBIR Y GUARDAR CATÁLOGO</button>
        <span id="tn-ac-name" class="muted"></span>
      </div>
      <div id="tn-ac-result"><p class="muted">Aún no hay archivo. Al elegirlo se validan las cabeceras automáticamente.</p></div>
    </section>
    <section class="panel">
      <div class="panel-title">
        <div><h2>Estado en Supabase</h2></div>
        <button type="button" id="tn-refresh" class="ghost">ACTUALIZAR</button>
      </div>
      <div id="tn-estado" class="tn-grid"></div>
    </section>
  `;

  const ocInput = container.querySelector("#tn-oc-file");
  const acInput = container.querySelector("#tn-ac-file");
  const ocBtn = container.querySelector("#tn-oc-upload");
  const acBtn = container.querySelector("#tn-ac-upload");
  const ocName = container.querySelector("#tn-oc-name");
  const acName = container.querySelector("#tn-ac-name");
  const ocRes = container.querySelector("#tn-oc-result");
  const acRes = container.querySelector("#tn-ac-result");
  const estado = container.querySelector("#tn-estado");

  let ocFile = null;
  let acFile = null;
  let ocOk = false;
  let acOk = false;
  let ocFilasLocal = []; // última OC por equipo (procesada en el navegador)

  async function onOcSelected(file) {
    ocFile = file || null;
    ocOk = false;
    ocBtn.disabled = true;
    if (!ocFile) {
      ocName.textContent = "";
      ocRes.innerHTML = `<p class="muted">Aún no hay archivo.</p>`;
      return;
    }
    ocName.textContent = `${ocFile.name} · ${(ocFile.size / 1024).toFixed(1)} KB`;
    ocRes.innerHTML = `<p class="muted">Leyendo y validando cabeceras…</p>`;
    try {
      const rows0 = await readSheetRows(ocFile, 0);
      const rows1 = await readSheetRows(ocFile, 1);
      if (disposed) return;
      const v = validateOc(rows0, rows1);
      ocOk = v.ok;
      ocFilasLocal = v.filas || [];
      ocBtn.disabled = !v.ok;
      // Cache local inmediato (sin Supabase) para cruces en monitoreo/base
      if (v.ok) {
        try {
          localStorage.setItem(
            "tn_oc_ultima_v1",
            JSON.stringify({
              nombre_archivo: ocFile.name,
              actualizado_en: new Date().toISOString(),
              filas: ocFilasLocal,
            }),
          );
        } catch (err) {
          console.warn("[TN] no se pudo cachear OC local", err);
        }
      }
      ocRes.innerHTML = `
        <div class="tn-card ${v.ok ? "ok" : "warn"}" style="margin-top:10px">
          <small>VALIDACIÓN OC · PROCESO LOCAL</small>
          <b>${v.ok ? "Última OC por equipo lista" : "Cabeceras incompletas"}</b>
          <p class="muted" style="font-size:12px;margin:6px 0">
            Comparación y deduplicación en el navegador (no se sube el Excel completo).
            Fila de encabezado: ${v.headerRow ?? "—"}
          </p>
          ${renderHeaders(v.headers || [], v.found || {}, v.missing)}
          ${
            v.ok
              ? `<p style="margin-top:8px">Filas leídas: <b>${v.totalFilasConEquipo}</b> ·
                 Equipos únicos: <b>${v.equiposUnicos}</b> ·
                 Descartadas (OC anteriores): <b>${v.descartadas}</b></p>
                 <p class="tn-badge ok">Cache local guardado · listo para sincronizar resumen</p>
                 ${renderSampleTable(["equipo", "fec", "acoplado", "piloto", "ruta"], v.sample)}`
              : ""
          }
        </div>
      `;
    } catch (e) {
      ocOk = false;
      ocBtn.disabled = true;
      ocRes.innerHTML = `<p class="tn-badge err">${esc(e.message || e)}</p>`;
    }
  }

  async function onAcSelected(file) {
    acFile = file || null;
    acOk = false;
    acBtn.disabled = true;
    if (!acFile) {
      acName.textContent = "";
      acRes.innerHTML = `<p class="muted">Aún no hay archivo.</p>`;
      return;
    }
    acName.textContent = `${acFile.name} · ${(acFile.size / 1024).toFixed(1)} KB`;
    acRes.innerHTML = `<p class="muted">Leyendo y validando cabeceras…</p>`;
    try {
      const rows = await readSheetRows(acFile, 0);
      if (disposed) return;
      const v = validateAcoples(rows);
      acOk = v.ok;
      acBtn.disabled = !v.ok;
      acRes.innerHTML = `
        <div class="tn-card ${v.ok ? "ok" : "warn"}" style="margin-top:10px">
          <small>VALIDACIÓN TIPO ACOPLE</small>
          <b>${v.ok ? "Listo para subir" : "Cabeceras incompletas"}</b>
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
      acRes.innerHTML = `<p class="tn-badge err">${esc(e.message || e)}</p>`;
    }
  }

  ocInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    onOcSelected(f);
  });
  acInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    onAcSelected(f);
  });

  async function refresh() {
    try {
      const st = await maestrosApi({ action: "estado" });
      if (disposed) return;
      const oc = st.oc || {};
      const ac = st.acoples || {};
      estado.innerHTML = `
        <div class="tn-card ${oc.filas ? "ok" : "warn"}">
          <small>OC ÚLTIMA / EQUIPO</small><b>${oc.filas ?? 0}</b>
          <span class="muted" style="font-size:12px">${oc.filas ? fechaPE(oc.actualizado_en) : "Sin datos"} · ${esc(oc.nombre_archivo || "—")}</span>
        </div>
        <div class="tn-card ${ac.filas ? "ok" : "warn"}">
          <small>ACOPLES</small><b>${ac.filas ?? 0}</b>
          <span class="muted" style="font-size:12px">${ac.filas ? fechaPE(ac.actualizado_en) : "Sin datos"} · ${esc(ac.nombre_archivo || "—")}</span>
        </div>
      `;
    } catch (e) {
      if (disposed) return;
      estado.innerHTML = `
        <div class="tn-card warn">
          <small>BACKEND</small><b>Pendiente de despliegue</b>
          <span class="muted" style="font-size:12px">${esc(e.message)}. La validación de Excel en el navegador sí funciona.</span>
        </div>`;
    }
  }

  ocBtn.addEventListener("click", async () => {
    if (!ocOk || !ocFilasLocal.length) return;
    ocBtn.disabled = true;
    const prev = ocBtn.textContent;
    ocBtn.textContent = "SINCRONIZANDO…";
    try {
      // Solo se envía el resumen ya deduplicado (1 fila por equipo). Sin Excel.
      const r = await maestrosApi({
        action: "guardar_oc",
        nombre_archivo: ocFile?.name || "oc_local.xlsx",
        filas: ocFilasLocal,
      });
      ocRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge ok" style="margin-top:8px">Sync OK · ${r.filas ?? ocFilasLocal.length} equipos (payload liviano, proceso local)</p>`,
      );
      await refresh();
    } catch (e) {
      ocRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge warn" style="margin-top:8px">Cache local OK · sync Supabase: ${esc(e.message)}</p>`,
      );
    } finally {
      ocBtn.textContent = prev;
      ocBtn.disabled = !ocOk;
    }
  });

  acBtn.addEventListener("click", async () => {
    if (!acFile || !acOk) return;
    acBtn.disabled = true;
    const prev = acBtn.textContent;
    acBtn.textContent = "SUBIENDO…";
    try {
      const b64 = await fileToBase64(acFile);
      const r = await maestrosApi({
        action: "cargar_acoples",
        nombre_archivo: acFile.name,
        contenido_base64: b64,
      });
      acRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge ok" style="margin-top:8px">Guardado · ${r.filas ?? 0} acoples</p>`,
      );
      await refresh();
    } catch (e) {
      acRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge err" style="margin-top:8px">${esc(e.message)}</p>`,
      );
    } finally {
      acBtn.textContent = prev;
      acBtn.disabled = !acOk;
    }
  });

  container.querySelector("#tn-refresh").addEventListener("click", refresh);
  await refresh();
}

export function unmount() {
  disposed = true;
}
