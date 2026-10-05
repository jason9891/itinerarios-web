/**
 * Módulo CERRO VERDE · SAP
 *
 * Flujo operativo (filtro en servidor, no en cliente):
 *  1) Seleccionar Excel (.xls / .xlsx)
 *  2) VALIDAR → cerro-verde-sap action validar_archivo
 *     (negocio CV: SMCV o CALCESUR→YARABAMBA; solo tracto en maestro)
 *  3) APLICAR → action aplicar_archivo (nuevas SAP + faltantes diario)
 *
 * Independiente de Cemento. No importa nada de cemento/.
 */
import {
  esc,
  fechaPE,
  moduleHead,
  sapApi,
  bufferToBase64,
} from "../api-client.js";
import { loadSapFile, saveSapFile } from "../sap-store.js";

let cleanup = [];
/** @type {{ nombre:string, tamano:number, contenido:ArrayBuffer, guardado:string } | null} */
let current = null;
let validated = false;
/** @type {object | null} */
let lastSummary = null;

export async function mount(container, runtime) {
  cleanup = [];
  current = null;
  validated = false;
  lastSummary = null;
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo SAP…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en SAP</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
  current = null;
  validated = false;
  lastSummary = null;
}

function canApply(summary) {
  if (!summary) return false;
  return (
    Number(summary.nuevas_sap || 0) > 0 ||
    Number(summary.nuevas_diario || 0) > 0
  );
}

function renderSummary(s) {
  const discards = Array.isArray(s.descartes) ? s.descartes : [];
  const resumen = Array.isArray(s.descartes_resumen) ? s.descartes_resumen : [];
  const pendientes = Array.isArray(s.pendientes_maestro_detalle)
    ? s.pendientes_maestro_detalle
    : [];
  const acoples = Array.isArray(s.acoples_sin_maestro_detalle)
    ? s.acoples_sin_maestro_detalle
    : [];

  return `
    <h2 style="margin:16px 0 8px">Resultado de validación</h2>
    <div class="activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
      <div><small>LEÍDAS</small><b>${s.leidas ?? "—"}</b></div>
      <div><small>EN ALCANCE</small><b>${s.en_alcance ?? "—"}</b></div>
      <div><small>YA REGISTRADAS</small><b>${s.registradas ?? "—"}</b></div>
      <div><small>NUEVAS SAP</small><b>${s.nuevas_sap ?? "—"}</b></div>
      <div><small>NUEVAS DIARIO</small><b>${s.nuevas_diario ?? "—"}</b></div>
      <div><small>DESCARTADAS</small><b>${s.descartadas ?? "—"}</b></div>
    </div>
    ${
      s.recuperadas_sap_historico
        ? `<p class="muted" style="margin-top:10px">Recuperadas de SAP histórico: <b>${s.recuperadas_sap_historico}</b></p>`
        : ""
    }
    ${
      pendientes.length
        ? `<details open style="margin-top:12px"><summary><b>Pendientes de maestro</b> (${s.pendientes_maestro || pendientes.length})</summary>
            <div class="discard-list" style="margin-top:8px">${pendientes
              .map(
                (x) =>
                  `<p><b>${esc(x.entrega)}</b> · ${esc(x.motivo)}</p>`,
              )
              .join("")}</div></details>`
        : ""
    }
    ${
      acoples.length
        ? `<details style="margin-top:12px"><summary>Acoples sin maestro (${s.acoples_sin_maestro || acoples.length})</summary>
            <div class="discard-list" style="margin-top:8px">${acoples
              .map(
                (x) =>
                  `<p><b>${esc(x.entrega)}</b> · ${esc(x.placa_tracto)} / ${esc(x.placa_carreta)} · ${esc(x.advertencia)}</p>`,
              )
              .join("")}</div></details>`
        : ""
    }
    ${
      discards.length
        ? `<details style="margin-top:12px"><summary>Descartes (${discards.length}${resumen.length ? " · ver resumen" : ""})</summary>
            ${
              resumen.length
                ? `<ul style="margin:8px 0">${resumen
                    .map(
                      (r) =>
                        `<li>${esc(r.motivo)}: <b>${r.cantidad}</b></li>`,
                    )
                    .join("")}</ul>`
                : ""
            }
            <div class="discard-list">${discards
              .slice(0, 80)
              .map(
                (x) =>
                  `<p><b>${esc(x.entrega)}</b> · ${esc(x.motivo)}</p>`,
              )
              .join("")}</div></details>`
        : ""
    }`;
}

async function render(container, runtime) {
  current = await loadSapFile().catch(() => null);
  validated = false;
  lastSummary = null;

  const lastName = runtime.state.get("sap.lastFile");

  container.innerHTML =
    moduleHead("Actualizar SAP", "Excel temporal · filtro negocio Cerro Verde") +
    `<section class="notice">
      <b>FLUJO OPERATIVO:</b> 1) Seleccione el Excel SAP · 2) Valide el resumen
      (cliente SMCV / CALCESUR→YARABAMBA; solo el tracto debe estar en maestro) ·
      3) Aplique → entregas nuevas y ciclos faltantes pasan a seguimiento.
      Se aceptan <b>.xls</b> y <b>.xlsx</b>. El archivo queda en este navegador.
    </section>

    <section class="panel sap-upload">
      <div class="panel-title">
        <div>
          <h2>Archivo SAP actualizado</h2>
          <p class="muted">El filtro de negocio y el cruce con maestros se ejecutan en el servidor.</p>
        </div>
        <label class="file-button primary" style="display:inline-block;cursor:pointer;padding:10px 16px">
          SELECCIONAR EXCEL
          <input id="cv-sap-file" type="file" accept=".xls,.xlsx" hidden>
        </label>
      </div>
      <div id="cv-sap-current" class="muted"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button type="button" id="cv-sap-validate" class="secondary" disabled>VALIDAR ARCHIVO</button>
        <button type="button" id="cv-sap-apply" class="primary" disabled>APLICAR CAMBIOS</button>
      </div>
      <div id="cv-sap-result" style="margin-top:14px"></div>
    </section>`;

  const fileInput = container.querySelector("#cv-sap-file");
  const currentBox = container.querySelector("#cv-sap-current");
  const btnValidate = container.querySelector("#cv-sap-validate");
  const btnApply = container.querySelector("#cv-sap-apply");
  const resultBox = container.querySelector("#cv-sap-result");

  function refreshCurrent() {
    if (current) {
      currentBox.innerHTML = `Temporal: <b>${esc(current.nombre)}</b> · ${(current.tamano / 1024).toFixed(1)} KB · guardado ${esc(fechaPE(current.guardado))}`;
    } else if (lastName) {
      currentBox.innerHTML = `Último archivo en sesión: <b>${esc(lastName)}</b> (vuelva a seleccionar para validar).`;
    } else {
      currentBox.innerHTML = "No hay un SAP temporal cargado en este navegador.";
    }
    btnValidate.disabled = !current;
    btnApply.disabled = !validated || !canApply(lastSummary);
  }

  refreshCurrent();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) {
      resultBox.innerHTML = `<div class="error-box"><p>Seleccione un archivo SAP .xls o .xlsx.</p></div>`;
      return;
    }
    resultBox.innerHTML = `<p class="muted">Guardando en este navegador…</p>`;
    try {
      const buffer = await f.arrayBuffer();
      current = {
        nombre: f.name,
        tamano: f.size,
        contenido: buffer,
        guardado: new Date().toISOString(),
      };
      await saveSapFile(current);
      validated = false;
      lastSummary = null;
      runtime.state.set("sap.lastFile", f.name);
      runtime.bus.emit("cerro-verde:sap-file", { fileName: f.name, at: Date.now() });
      resultBox.innerHTML = "";
      refreshCurrent();
    } catch (err) {
      current = null;
      resultBox.innerHTML = `<div class="error-box"><h2>No se pudo guardar el archivo</h2><p>${esc(err.message || err)}</p></div>`;
      refreshCurrent();
    } finally {
      fileInput.value = "";
    }
  };
  fileInput.addEventListener("change", onFile);
  cleanup.push(() => fileInput.removeEventListener("change", onFile));

  const onValidate = async () => {
    if (!current) return;
    btnValidate.disabled = true;
    btnApply.disabled = true;
    btnValidate.textContent = "VALIDANDO…";
    resultBox.innerHTML = `<p class="muted">Analizando el archivo SAP (filtro negocio Cerro Verde)…</p>`;
    try {
      const s = await sapApi({
        action: "validar_archivo",
        nombre_archivo: current.nombre,
        contenido_base64: bufferToBase64(current.contenido),
      });
      lastSummary = s;
      validated = canApply(s);
      resultBox.innerHTML = renderSummary(s);
      if (!validated) {
        resultBox.innerHTML +=
          `<p class="muted" style="margin-top:10px">No hay entregas nuevas ni ciclos faltantes por reconciliar.</p>`;
      }
      runtime.bus.emit("cerro-verde:sap-validated", {
        fileName: current.nombre,
        summary: {
          nuevas_sap: s.nuevas_sap,
          nuevas_diario: s.nuevas_diario,
          hash: s.hash,
        },
      });
    } catch (err) {
      validated = false;
      lastSummary = null;
      resultBox.innerHTML = `<div class="error-box"><h2>No se pudo validar</h2><p>${esc(err.message || err)}</p></div>`;
    } finally {
      btnValidate.textContent = "VALIDAR ARCHIVO";
      refreshCurrent();
    }
  };
  btnValidate.addEventListener("click", onValidate);
  cleanup.push(() => btnValidate.removeEventListener("click", onValidate));

  const onApply = async () => {
    if (!current || !validated) return;
    if (
      !window.confirm(
        "Se aplicarán las entregas nuevas validadas y los ciclos faltantes de SAP histórico. ¿Continuar?",
      )
    ) {
      return;
    }
    btnApply.disabled = true;
    btnValidate.disabled = true;
    btnApply.textContent = "APLICANDO…";
    try {
      const s = await sapApi({
        action: "aplicar_archivo",
        nombre_archivo: current.nombre,
        contenido_base64: bufferToBase64(current.contenido),
      });
      validated = false;
      lastSummary = s;
      resultBox.innerHTML =
        renderSummary(s) +
        `<p class="notice" style="margin-top:12px"><b>APLICACIÓN COMPLETA:</b>
          ${s.agregadas_sap ?? 0} SAP ·
          ${s.agregadas_diario ?? 0} ciclos abiertos ·
          ${s.unidades_grupo_actualizadas ?? 0} unidades del grupo actualizadas.
          ${s.mensaje ? " · " + esc(s.mensaje) : ""}
        </p>`;
      runtime.state.set("sap.lastApplied", {
        fileName: current.nombre,
        at: Date.now(),
        agregadas_sap: s.agregadas_sap,
        agregadas_diario: s.agregadas_diario,
      });
      runtime.bus.emit("cerro-verde:sap-updated", {
        fileName: current.nombre,
        at: Date.now(),
        agregadas_sap: s.agregadas_sap,
        agregadas_diario: s.agregadas_diario,
      });
    } catch (err) {
      resultBox.innerHTML += `<div class="error-box" style="margin-top:12px"><h2>No se pudo aplicar</h2><p>${esc(err.message || err)}</p></div>`;
    } finally {
      btnApply.textContent = "APLICAR CAMBIOS";
      refreshCurrent();
    }
  };
  btnApply.addEventListener("click", onApply);
  cleanup.push(() => btnApply.removeEventListener("click", onApply));
}
