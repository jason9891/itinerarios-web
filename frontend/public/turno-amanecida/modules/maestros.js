/**
 * Maestros TURNO AMANECIDA
 * - Solo se sube el Excel de OC (proceso LOCAL: última por equipo).
 * - Acoples: catálogo editable con “Añadir acople” (sin archivo Excel).
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

function parseFecTs(raw) {
  if (raw == null || raw === "") return 0;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const ms = Math.round((n - 25569) * 86400 * 1000);
    return Number.isFinite(ms) ? ms : 0;
  }
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
          r[found["Acoplado 1"]] != null ? String(r[found["Acoplado 1"]]).trim() : "",
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
      filas,
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
    </div>`;
}

function loadAcoplesLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem("tn_acoples_v1") || "null");
    return Array.isArray(raw?.filas) ? raw.filas : [];
  } catch {
    return [];
  }
}

function saveAcoplesLocal(filas) {
  localStorage.setItem(
    "tn_acoples_v1",
    JSON.stringify({ actualizado_en: new Date().toISOString(), filas }),
  );
}

export async function mount(container) {
  disposed = false;
  let ocFile = null;
  let ocOk = false;
  let ocFilasLocal = [];
  let acoples = loadAcoplesLocal();

  container.innerHTML = `
    ${moduleHead(
      "Maestros",
      "Solo Excel de OC (proceso local). Acoples: catálogo manual con «Añadir acople».",
    )}
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>1 · Archivo OC</h2>
          <p class="muted">Última OC por Equipo en el navegador. En el match con el snapshot solo se usan equipos <b>20-R-</b>.</p>
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
      <div id="tn-oc-result"><p class="muted">Al elegir el archivo se valida y se deja la última OC por equipo (local).</p></div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>2 · Catálogo de acoples</h2>
          <p class="muted">Sin Excel. Solo cuando entre una unidad nueva: <b>Añadir acople</b>. Se usa al cruzar con el snapshot.</p>
        </div>
        <button type="button" class="ghost" id="tn-ac-add">AÑADIR ACOPLE</button>
      </div>
      <div id="tn-ac-form" class="hidden" style="margin:10px 0;display:none;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="tn-field">CÓDIGO<input id="tn-ac-cod" type="text" placeholder="20-P-238" style="background:#06111d;border:1px solid #ffffff1d;border-radius:8px;color:#eaf2ff;padding:8px 10px"></label>
        <label class="tn-field">CARROCERÍA<input id="tn-ac-car" type="text" placeholder="TOLVA HIDRAULICA" style="background:#06111d;border:1px solid #ffffff1d;border-radius:8px;color:#eaf2ff;padding:8px 10px"></label>
        <label class="tn-field">GESTOR<input id="tn-ac-ges" type="text" placeholder="CARLOS YARI" style="background:#06111d;border:1px solid #ffffff1d;border-radius:8px;color:#eaf2ff;padding:8px 10px"></label>
        <button type="button" class="primary" id="tn-ac-save-one">GUARDAR ACOPLE</button>
      </div>
      <div id="tn-ac-msg"></div>
      <div class="tn-table-wrap" style="max-height:280px">
        <table class="tn-table">
          <thead><tr><th>CÓDIGO</th><th>CARROCERÍA</th><th>GESTOR</th><th></th></tr></thead>
          <tbody id="tn-ac-body"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title"><div><h2>Estado</h2></div>
        <button type="button" id="tn-refresh" class="ghost">ACTUALIZAR</button>
      </div>
      <div id="tn-estado" class="tn-grid"></div>
    </section>
  `;

  const ocInput = container.querySelector("#tn-oc-file");
  const ocBtn = container.querySelector("#tn-oc-upload");
  const ocName = container.querySelector("#tn-oc-name");
  const ocRes = container.querySelector("#tn-oc-result");
  const acBody = container.querySelector("#tn-ac-body");
  const acMsg = container.querySelector("#tn-ac-msg");
  const acForm = container.querySelector("#tn-ac-form");
  const estado = container.querySelector("#tn-estado");

  function renderAcoples() {
    acBody.innerHTML = acoples
      .map(
        (r, i) => `
      <tr>
        <td>${esc(r.codigo)}</td>
        <td>${esc(r.carroceria)}</td>
        <td>${esc(r.gestor)}</td>
        <td><button type="button" class="ghost" data-del="${i}" style="padding:4px 8px">✕</button></td>
      </tr>`,
      )
      .join("") || `<tr><td colspan="4" class="muted">Sin acoples. Usa «Añadir acople» cuando haga falta.</td></tr>`;
  }

  async function persistAcoples() {
    saveAcoplesLocal(acoples);
    try {
      await maestrosApi({ action: "guardar_acoples", filas: acoples });
      acMsg.innerHTML = `<span class="tn-badge ok">Acoples guardados (${acoples.length})</span>`;
    } catch (e) {
      acMsg.innerHTML = `<span class="tn-badge warn">Local OK · sync: ${esc(e.message)}</span>`;
    }
  }

  container.querySelector("#tn-ac-add").addEventListener("click", () => {
    const show = acForm.style.display === "none" || !acForm.style.display;
    acForm.style.display = show ? "flex" : "none";
    acForm.classList.toggle("hidden", !show);
  });

  container.querySelector("#tn-ac-save-one").addEventListener("click", async () => {
    const codigo = normalizarClave(container.querySelector("#tn-ac-cod").value);
    const carroceria = String(container.querySelector("#tn-ac-car").value || "").trim();
    const gestor = String(container.querySelector("#tn-ac-ges").value || "").trim();
    if (!codigo) {
      acMsg.innerHTML = `<span class="tn-badge err">Falta código de acople</span>`;
      return;
    }
    const idx = acoples.findIndex((a) => normalizarClave(a.codigo) === codigo);
    const row = { codigo, carroceria, gestor };
    if (idx >= 0) acoples[idx] = row;
    else acoples.push(row);
    acoples.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    renderAcoples();
    await persistAcoples();
    container.querySelector("#tn-ac-cod").value = "";
    container.querySelector("#tn-ac-car").value = "";
    container.querySelector("#tn-ac-ges").value = "";
  });

  acBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    acoples.splice(Number(btn.dataset.del), 1);
    renderAcoples();
    await persistAcoples();
  });

  ocInput.addEventListener("change", async (e) => {
    ocFile = e.target.files?.[0] || null;
    ocOk = false;
    ocFilasLocal = [];
    ocBtn.disabled = true;
    if (!ocFile) {
      ocName.textContent = "";
      ocRes.innerHTML = `<p class="muted">Sin archivo.</p>`;
      return;
    }
    ocName.textContent = `${ocFile.name} · ${(ocFile.size / 1024).toFixed(1)} KB`;
    ocRes.innerHTML = `<p class="muted">Procesando en el navegador…</p>`;
    try {
      const rows0 = await readSheetRows(ocFile, 0);
      const rows1 = await readSheetRows(ocFile, 1);
      if (disposed) return;
      const v = validateOc(rows0, rows1);
      ocOk = v.ok;
      ocFilasLocal = v.filas || [];
      ocBtn.disabled = !v.ok;
      if (v.ok) {
        localStorage.setItem(
          "tn_oc_ultima_v1",
          JSON.stringify({
            nombre_archivo: ocFile.name,
            actualizado_en: new Date().toISOString(),
            filas: ocFilasLocal,
          }),
        );
      }
      ocRes.innerHTML = `
        <div class="tn-card ${v.ok ? "ok" : "warn"}" style="margin-top:10px">
          <small>OC · PROCESO LOCAL</small>
          <b>${v.ok ? "Última OC por equipo lista" : "Cabeceras incompletas"}</b>
          <p class="muted" style="font-size:12px;margin:6px 0">No se sube el Excel. Solo el resumen al sincronizar.</p>
          ${renderHeaders(v.headers || [], v.found || {}, v.missing)}
          ${
            v.ok
              ? `<p>Filas: <b>${v.totalFilasConEquipo}</b> · Únicas: <b>${v.equiposUnicos}</b> · Descartadas: <b>${v.descartadas}</b>
                 · de ellas 20-R-: <b>${ocFilasLocal.filter((f) => String(f.equipo).includes("20-R-")).length}</b></p>
                 ${renderSampleTable(["equipo", "fec", "acoplado", "piloto", "ruta"], v.sample)}`
              : ""
          }
        </div>`;
    } catch (err) {
      ocRes.innerHTML = `<p class="tn-badge err">${esc(err.message || err)}</p>`;
    }
  });

  ocBtn.addEventListener("click", async () => {
    if (!ocOk || !ocFilasLocal.length) return;
    ocBtn.disabled = true;
    ocBtn.textContent = "SINCRONIZANDO…";
    try {
      const r = await maestrosApi({
        action: "guardar_oc",
        nombre_archivo: ocFile?.name || "oc.xlsx",
        filas: ocFilasLocal,
      });
      ocRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge ok" style="margin-top:8px">Sync · ${r.filas ?? ocFilasLocal.length} equipos</p>`,
      );
      await refresh();
    } catch (e) {
      ocRes.insertAdjacentHTML(
        "beforeend",
        `<p class="tn-badge warn" style="margin-top:8px">Local OK · sync: ${esc(e.message)}</p>`,
      );
    } finally {
      ocBtn.disabled = !ocOk;
      ocBtn.textContent = "SINCRONIZAR RESUMEN A SUPABASE";
    }
  });

  async function refresh() {
    try {
      const st = await maestrosApi({ action: "estado" });
      if (disposed) return;
      const oc = st.oc || {};
      estado.innerHTML = `
        <div class="tn-card ${oc.filas ? "ok" : "warn"}"><small>OC EN SUPABASE</small><b>${oc.filas ?? 0}</b>
          <span class="muted" style="font-size:12px">${oc.filas ? fechaPE(oc.actualizado_en) : "Opcional"}</span></div>
        <div class="tn-card ${acoples.length ? "ok" : "warn"}"><small>ACOPLES LOCAL</small><b>${acoples.length}</b>
          <span class="muted" style="font-size:12px">Catálogo manual</span></div>`;
    } catch (e) {
      if (disposed) return;
      estado.innerHTML = `
        <div class="tn-card warn"><small>SUPABASE</small><b>—</b><span class="muted" style="font-size:12px">${esc(e.message)}</span></div>
        <div class="tn-card ${acoples.length ? "ok" : "warn"}"><small>ACOPLES LOCAL</small><b>${acoples.length}</b></div>`;
    }
  }

  // Cargar acoples remotos una vez si local vacío
  if (!acoples.length) {
    try {
      const r = await maestrosApi({ action: "listar_acoples" });
      if (r.filas?.length) {
        acoples = r.filas.map((x) => ({
          codigo: normalizarClave(x.codigo),
          carroceria: x.carroceria || "",
          gestor: x.gestor || "",
        }));
        saveAcoplesLocal(acoples);
      }
    } catch {
      /* ignore */
    }
  }

  renderAcoples();
  container.querySelector("#tn-refresh").addEventListener("click", refresh);
  await refresh();
}

export function unmount() {
  disposed = true;
}
