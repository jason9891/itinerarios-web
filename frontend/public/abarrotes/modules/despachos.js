/**
 * Módulo ABARROTES · Carga
 *
 * Se suben los DOS Excel que hoy se cruzan a mano:
 *  1) SAP (órdenes de carga AQP-LIM) y 2) Programación TD de Lima (hoja SATELITAL LIMA).
 * Se leen en el navegador (no se envían a ningún servidor) y se unen en un consolidado de viajes por placa de tracto.
 * También se pueden importar geocercas propias (JSON del editor) — lo demás ya está en los maestros fijos.
 */
import { esc, fechaPE, moduleHead, loadXlsx, irA } from "../api-client.js";
import { esHojaSAP, esHojaTD, leerSAP, leerTD, consolidar, contadores } from "../consolidado.js";
import { leerCarga, guardarCarga, borrarCarga, leerSeguimiento } from "../store.js";
import { cargarGeocercas, importarGeocercas, borrarGeocercasPropias } from "../geo.js";

const MAX_BYTES = 40 * 1024 * 1024;
let disposed = false;

/** Lee un Excel y devuelve la hoja (como matriz) que cumple `esHoja`. Solo parsea las hojas candidatas. */
async function hojaDe(file, esHoja, nombresProbables) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const nombres = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames;
  const orden = [...nombres.filter((n) => nombresProbables.test(n)), ...nombres.filter((n) => !nombresProbables.test(n))];
  for (const nombre of orden) {
    const wb = XLSX.read(buf, { type: "array", sheets: nombre, cellDates: true, dense: true });
    const ws = wb.Sheets[nombre];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    if (esHoja(aoa)) return { aoa, nombre };
  }
  throw new Error("No encontré en el Excel la hoja con el formato esperado");
}

export async function mount(container, runtime) {
  disposed = false;
  container.innerHTML = `
    ${moduleHead("Carga", "SAP + programación TD → consolidado de unidades a seguir")}
    <section class="panel">
      <div class="panel-title"><div>
        <h2>1 · Archivos de la sesión</h2>
        <p class="muted">Se leen en tu navegador y solo viven en esta pestaña: súbelos en cada turno. Puedes subir uno o los dos.</p>
      </div></div>
      <div class="ab-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="ab-card">
          <small>EXCEL SAP · ORDENES DE CARGA AQP-LIM</small>
          <p class="muted" style="font-size:12px;margin:6px 0">Hoja con «Ord Carga» y «Matrícula» (PROCESADOR_ABARROTES_AQP-LIM-SAP).</p>
          <label class="file-button">SELECCIONAR EXCEL SAP<input id="ab-f-sap" type="file" accept=".xlsx,.xls"></label>
          <div class="muted" id="ab-i-sap" style="font-size:12px;margin-top:6px"></div>
        </div>
        <div class="ab-card">
          <small>EXCEL PROGRAMACIÓN TD · LIMA</small>
          <p class="muted" style="font-size:12px;margin:6px 0">Hoja SATELITAL LIMA (PROCESADOR_TD-PROGRAMACIÓN): entran solo las filas «MONITOREO».</p>
          <label class="file-button">SELECCIONAR PROGRAMACIÓN TD<input id="ab-f-td" type="file" accept=".xlsx,.xls"></label>
          <div class="muted" id="ab-i-td" style="font-size:12px;margin-top:6px"></div>
        </div>
      </div>
      <div class="ab-actions" style="margin-top:10px">
        <label class="muted">Solo OC creadas en los últimos
          <input id="ab-dias" class="ab-search" style="width:60px" type="number" min="0" value="${leerCarga()?.dias_max ?? 10}"> días (0 = todas)</label>
      </div>
      <div id="ab-msg"></div>
    </section>
    <div id="ab-result"></div>
    <section class="panel">
      <div class="panel-title"><div>
        <h2>Geocercas</h2>
        <p class="muted" id="ab-geo-info">Cargando…</p>
      </div></div>
      <div class="ab-actions" style="margin-top:0">
        <label class="file-button">IMPORTAR GEOCERCAS (.json)<input id="ab-f-geo" type="file" accept=".json,.geojson,application/json"></label>
        <button type="button" class="ghost" id="ab-geo-reset">VOLVER A LA SEMILLA</button>
        <span class="muted" id="ab-geo-msg"></span>
      </div>
    </section>`;

  const $ = (s) => container.querySelector(s);
  let sap = leerCarga()?.sap || null;
  let td = leerCarga()?.td || null;

  async function pintarGeo() {
    const g = await cargarGeocercas();
    if (!disposed) $("#ab-geo-info").innerHTML = `${g.length} geocercas activas: ${esc(g.map((x) => x.name).join(" · "))}. Los destinos sin geocerca dibujada se completan a mano en Seguimiento.`;
  }

  function pintarInfo() {
    $("#ab-i-sap").textContent = sap ? `✔ ${sap.archivo} · ${sap.viajes.length} OC de ${sap.leidas} leídas` : "";
    $("#ab-i-td").textContent = td ? `✔ ${td.archivo} · ${td.viajes.length} en MONITOREO de ${td.leidas} filas` : "";
  }

  function recalcular() {
    const dias = Math.max(0, Number($("#ab-dias").value) || 0);
    const lim = dias > 0 ? Date.now() - dias * 86400000 : 0;
    const sapViajes = (sap?.viajes || []).filter((v) => !lim || !v.fecha || new Date(v.fecha).getTime() >= lim);
    const c = consolidar(sapViajes.map((v) => ({ ...v })), (td?.viajes || []).map((v) => ({ ...v })));
    guardarCarga({ cargado_en: new Date().toISOString(), dias_max: dias, sap, td, viajes: c.viajes, fusionados: c.fusionados });
    runtime.bus.emit("abarrotes:carga-actualizada", { total: c.viajes.length });
    pintarInfo();
    pintarResultado();
  }

  function pintarResultado() {
    const carga = leerCarga();
    const out = $("#ab-result");
    if (!carga?.viajes?.length) { out.innerHTML = ""; return; }
    const c = contadores(carga.viajes, leerSeguimiento());
    out.innerHTML = `
      <section class="panel">
        <div class="panel-title"><div>
          <h2>2 · Consolidado</h2>
          <p class="muted">Cargado ${esc(fechaPE(carga.cargado_en))}${carga.fusionados ? ` · ${carga.fusionados} unidades de TD ya tenían OC en SAP y se fusionaron` : ""}</p>
        </div></div>
        <div class="ab-grid">
          <div class="ab-card ok"><small>VIAJES A SEGUIR</small><b>${c.total}</b></div>
          <div class="ab-card"><small>TRACTOS ÚNICOS</small><b>${c.tractos}</b></div>
          <div class="ab-card"><small>ORIGEN AREQUIPA</small><b>${c.aqp}</b></div>
          <div class="ab-card"><small>ORIGEN HUACHIPA</small><b>${c.lim}</b></div>
          <div class="ab-card"><small>OTROS ORÍGENES</small><b>${c.otro}</b></div>
          <div class="ab-card ${c.sin_seguimiento ? "warn" : "ok"}"><small>SIN SEGUIMIENTO</small><b>${c.sin_seguimiento}</b></div>
        </div>
        <div class="ab-actions">
          <button type="button" class="primary" id="ab-go-seg">IR A SEGUIMIENTO</button>
          <button type="button" class="ghost" id="ab-clear">LIMPIAR CARGA Y SEGUIMIENTO</button>
        </div>
      </section>`;
    $("#ab-go-seg").addEventListener("click", () => irA("seguimiento"));
    $("#ab-clear").addEventListener("click", () => {
      if (!confirm("Se borran los archivos cargados y TODO el seguimiento de esta sesión. ¿Continuar?")) return;
      borrarCarga(); sap = td = null;
      runtime.state.set("gps", null);
      runtime.bus.emit("abarrotes:carga-actualizada", { total: 0 });
      $("#ab-msg").innerHTML = `<div class="ab-aviso">Carga borrada.</div>`;
      pintarInfo(); pintarResultado();
    });
  }

  async function subir(file, tipo) {
    const msg = $("#ab-msg");
    msg.innerHTML = `<p class="muted">Procesando ${esc(file.name)} en el navegador… (el de programación TD puede tardar unos segundos)</p>`;
    try {
      if (file.size > MAX_BYTES) throw new Error("El Excel supera 40 MB");
      if (tipo === "sap") {
        const { aoa, nombre } = await hojaDe(file, esHojaSAP, /ABARROTES|AQP|SAP|PLANTILLA/i);
        const r = leerSAP(aoa);
        sap = { archivo: `${file.name} › ${nombre}`, viajes: r.viajes, leidas: r.leidas, descartes: r.descartes.length };
      } else {
        const { aoa, nombre } = await hojaDe(file, esHojaTD, /SATELITAL|TD.?PROG/i);
        const r = leerTD(aoa);
        td = { archivo: `${file.name} › ${nombre}`, viajes: r.viajes, leidas: r.leidas };
      }
      if (disposed) return;
      msg.innerHTML = `<span class="ab-badge ok">✔ ${esc(file.name)} leído</span>`;
      recalcular();
    } catch (e) {
      if (!disposed) msg.innerHTML = `<div class="ab-aviso err">${esc(e.message || e)}</div>`;
    }
  }

  $("#ab-f-sap").addEventListener("change", (e) => e.target.files?.[0] && subir(e.target.files[0], "sap"));
  $("#ab-f-td").addEventListener("change", (e) => e.target.files?.[0] && subir(e.target.files[0], "td"));
  $("#ab-dias").addEventListener("change", () => (sap || td) && recalcular());
  $("#ab-f-geo").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const n = importarGeocercas(JSON.parse(await f.text()));
      $("#ab-geo-msg").textContent = `✔ ${n} geocercas importadas`;
      await pintarGeo();
    } catch (err) {
      $("#ab-geo-msg").textContent = `⚠ ${err.message || err}`;
    }
  });
  $("#ab-geo-reset").addEventListener("click", async () => {
    borrarGeocercasPropias();
    $("#ab-geo-msg").textContent = "Geocercas propias borradas";
    await pintarGeo();
  });

  pintarInfo();
  pintarResultado();
  pintarGeo();
}

export function unmount() {
  disposed = true;
}
