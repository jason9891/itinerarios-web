/**
 * CEMENTO · Despachos
 * Se suben DOS archivos: DESPACHOS (salida real de planta) y OCs (YSDR142).
 * El navegador cruza por placa/fecha/guía y deja la lista de despachos a seguir:
 * los de cemento cuyo tracto tiene una OC de RETORNO DE PARIHUELAS (no anulada).
 * Todo corre en el navegador; el resultado vive en esta pestaña (sessionStorage).
 */
import { esc, moduleHead } from "../api-client.js";
import {
  esArchivoDespachos, esArchivoOCs, leerDespachos, leerOCs, consolidar, aoaDeTexto, decodificarTexto, esExcelBinario, VENTANA_DIAS,
} from "../despachos-parse.js";

const K = "cem_despachos_v1";
let xlsx = null;
const leer = () => { try { return JSON.parse(sessionStorage.getItem(K) || "null"); } catch { return null; } };
const guardar = (v) => { try { sessionStorage.setItem(K, JSON.stringify(v)); } catch { /* sin espacio */ } };

async function aoaDeArchivo(file) {
  const buf = await file.arrayBuffer();
  if (!esExcelBinario(buf)) return aoaDeTexto(decodificarTexto(buf));
  xlsx ||= await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const wb = xlsx.read(buf, { type: "array", cellDates: false });
  let mejor = [];
  for (const n of wb.SheetNames) {
    const aoa = xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
    if (esArchivoDespachos(aoa) || esArchivoOCs(aoa)) return aoa;
    if (aoa.length > mejor.length) mejor = aoa;
  }
  // El «.xls» de SAP a veces es texto con otra extensión: se reintenta como texto
  const primera = (mejor[0] || [])[0] || "";
  return String(primera).includes("\t") ? aoaDeTexto(decodificarTexto(buf)) : mejor;
}

const fFecha = (dia, min) => {
  if (dia == null) return "—";
  const d = new Date(dia);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}${min != null ? ` ${p(Math.floor(min / 60))}:${p(min % 60)}` : ""}`;
};

export async function mount(container) {
  let estado = leer();
  let filtro = "todos";

  container.innerHTML = `
    ${moduleHead("Despachos", "Seguimiento por despacho real de planta · retornos con parihuelas")}
    <section class="panel">
      <p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">
        Sube el archivo de <b>DESPACHOS</b> y el de <b>OCs (YSDR142)</b>. Se siguen los despachos de <b>cemento</b> cuyo tracto tiene una OC de
        <b>retorno de parihuelas</b> (no anulada) en los siguientes ${VENTANA_DIAS} días. Las parihuelas que salen de Yura con el cemento no cuentan.
      </p>
      <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <label class="file-button">SELECCIONAR DESPACHOS<input id="dsp-f-d" type="file" accept=".xls,.xlsx,.txt"></label>
        <span id="dsp-s-d" class="muted"></span>
        <label class="file-button">SELECCIONAR OCs (YSDR142)<input id="dsp-f-o" type="file" accept=".xls,.xlsx,.txt"></label>
        <span id="dsp-s-o" class="muted"></span>
        <button id="dsp-clear" class="secondary" type="button">LIMPIAR</button>
      </div>
      <p id="dsp-msg" class="muted" style="margin-top:8px"></p>
    </section>
    <section class="panel" id="dsp-res"></section>`;

  const $ = (s) => container.querySelector(s);
  const msg = $("#dsp-msg");
  const crudo = { d: null, o: null };

  function pintar() {
    const res = $("#dsp-res");
    if (!estado) { res.innerHTML = `<p class="muted">Aún no hay datos. Sube los dos archivos.</p>`; return; }
    const { seguir, sinDespacho } = estado;
    const alta = seguir.filter((s) => s.confianza === "ALTA").length;
    const rev = seguir.length - alta;
    const vis = seguir.filter((s) => filtro === "todos" || (filtro === "alta" ? s.confianza === "ALTA" : s.confianza === "REVISAR"));
    const card = (k, t, n) => `<button type="button" data-f="${k}" class="secondary" style="${filtro === k ? "outline:2px solid #1d4ed8;" : ""}min-width:150px;text-align:left"><small>${t}</small><br><b style="font-size:20px">${n}</b></button>`;
    res.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${card("todos", "DESPACHOS A SEGUIR", seguir.length)}${card("alta", "COINCIDENCIA SEGURA", alta)}${card("rev", "POR REVISAR", rev)}
        <div style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px"><small>OC RETORNO SIN DESPACHO PREVIO</small><br><b style="font-size:20px">${sinDespacho.length}</b></div>
      </div>
      <p class="muted" style="font-size:12px;margin:0 0 8px">${estado.resumen}</p>
      <div style="overflow:auto;max-height:62vh"><table class="table" style="width:100%;font-size:12px">
        <thead><tr><th>SALIDA PLANTA</th><th>DESPACHO</th><th>PLACA</th><th>CLIENTE / DESTINO</th><th>GUÍAS</th><th>OC RETORNO</th><th>RUTA RETORNO</th><th>OC IDA</th><th>COINCIDENCIA</th></tr></thead>
        <tbody>${vis.map((s) => `<tr>
          <td>${esc(fFecha(s.despacho.dia, s.despacho.min))}</td><td>${esc(s.despacho.transporte)}</td><td>${esc(s.despacho.placa)}</td>
          <td>${esc(s.despacho.cliente)}<br><b>${esc(s.despacho.destino)}</b></td><td>${esc(s.despacho.guias.join(" · "))}</td>
          <td>${esc(s.retorno.oc)}<br><small>${esc(s.retorno.estado.replace(/^@\w+@\s*/, ""))}</small></td><td>${esc(s.retorno.ruta)}</td>
          <td>${esc(s.oc_ida || "—")}</td>
          <td style="color:${s.confianza === "ALTA" ? "#166534" : "#b45309"}"><b>${s.confianza}</b>${s.avisos.length ? `<br><small>${esc(s.avisos.join(" · "))}</small>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">Sin filas.</td></tr>`}</tbody>
      </table></div>
      ${sinDespacho.length ? `<details style="margin-top:10px"><summary>OC de retorno sin despacho previo (${sinDespacho.length})</summary><ul style="font-size:12px">${sinDespacho.map((o) => `<li>OC ${esc(o.oc)} · ${esc(o.tracto)} · ${esc(o.ruta)} · ${esc(fFecha(o.dia))}</li>`).join("")}</ul></details>` : ""}`;
    res.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filtro = b.dataset.f; pintar(); }));
  }

  function calcular() {
    if (!crudo.d || !crudo.o) return;
    const { despachos, lineas } = leerDespachos(crudo.d.aoa);
    const ocs = leerOCs(crudo.o.aoa);
    const r = consolidar(despachos, ocs);
    estado = {
      cargado_en: new Date().toISOString(), seguir: r.seguir, sinDespacho: r.sinDespacho,
      resumen: `${lineas} líneas → ${despachos.length} despachos · ${ocs.length} OC (${r.ocsCemento} de cemento, ${r.retornos} retornos de parihuelas).`,
    };
    guardar(estado);
    msg.textContent = "";
    pintar();
  }

  async function subir(file, tipo) {
    try {
      msg.textContent = `Leyendo ${file.name}…`;
      const aoa = await aoaDeArchivo(file);
      const ok = tipo === "d" ? esArchivoDespachos(aoa) : esArchivoOCs(aoa);
      if (!ok) throw new Error(tipo === "d" ? "Ese no es el archivo de DESPACHOS (faltan Transporte / Placa / Fecha Salida)." : "Ese no es el archivo de OCs (faltan Ord Carga / Matrícula / Estado).");
      crudo[tipo] = { aoa, nombre: file.name };
      $(`#dsp-s-${tipo === "d" ? "d" : "o"}`).textContent = `✓ ${file.name} · ${aoa.length} filas`;
      calcular();
      if (!(crudo.d && crudo.o)) msg.textContent = "Falta subir el otro archivo.";
    } catch (e) {
      msg.innerHTML = `<span style="color:#b91c1c">${esc(e.message || e)}</span>`;
    }
  }
  $("#dsp-f-d").addEventListener("change", (e) => e.target.files[0] && subir(e.target.files[0], "d"));
  $("#dsp-f-o").addEventListener("change", (e) => e.target.files[0] && subir(e.target.files[0], "o"));
  $("#dsp-clear").addEventListener("click", () => { estado = null; crudo.d = crudo.o = null; try { sessionStorage.removeItem(K); } catch { /* */ } $("#dsp-s-d").textContent = $("#dsp-s-o").textContent = ""; pintar(); });
  pintar();
}

export function unmount() {}
