/**
 * Módulo CEMENTO · SAP
 * Flujo: subir Excel → filtrar rutas SI → clasificar vs histórico → aplicar a seguimiento.
 * Independiente de Cerro Verde.
 */
import { esc, fechaPE, moduleHead, sapApi } from "../api-client.js";
import {
  SAP_WINDOW_DAYS,
  parseSapFile,
  sapTextKey,
  sapDateKey,
  limaTodayKey,
  shiftDateKey,
} from "../sap-parse.js";

let cleanup = [];
let sapPending = null;
let sapParsed = null;
const reopenDecisions = new Map(); // oc -> REABRIR | NO_REABRIR

export async function mount(container, runtime) {
  cleanup = [];
  sapPending = null;
  sapParsed = null;
  reopenDecisions.clear();
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo SAP…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en SAP</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
  sapPending = null;
  sapParsed = null;
}

async function render(container, runtime) {
  const last = runtime.state.get("sap.lastFile");
  container.innerHTML =
    moduleHead("Actualizar SAP", "Excel temporal · comparación con histórico") +
    `<section class="notice">
      <b>FLUJO:</b> 1) Seleccione el Excel SAP · 2) Se clasifican OCs nuevas / reasignadas / reaperturas ·
      3) Aplique → pasan a Seguimiento Diario · 4) Las placas con OC abierta quedan listadas en Precarga.
    </section>
    <section class="panel sap-upload">
      <div class="panel-title">
        <div>
          <h2>Archivo SAP actualizado</h2>
          <p class="muted">Se aceptan .xlsx y .xls (texto). El archivo no se sube completo: solo se envían OCs accionables.</p>
        </div>
        <label class="file-button primary">
          SELECCIONAR EXCEL
          <input id="cem-sap-file" type="file" accept=".xlsx,.xls" hidden>
        </label>
      </div>
      <div id="cem-sap-current" class="muted">${
        last
          ? `Último archivo en este navegador: <b>${esc(last)}</b>`
          : "No hay un SAP temporal cargado en este navegador."
      }</div>
      <div id="cem-sap-result"></div>
    </section>`;

  const input = container.querySelector("#cem-sap-file");
  const result = container.querySelector("#cem-sap-result");
  const current = container.querySelector("#cem-sap-current");

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reopenDecisions.clear();
    result.innerHTML = `<p class="loading-inline">Leyendo, filtrando rutas y comparando con histórico…</p>`;
    try {
      sapParsed = await parseSapFile(file);
      runtime.state.set("sap.lastFile", file.name);
      runtime.state.set("sap.lastHash", sapParsed.hash);
      current.innerHTML = `Temporal: <b>${esc(file.name)}</b> · ${sapParsed.registros.length} OCs · ${fechaPE(new Date().toISOString())}`;
      await analyze(container, runtime, result);
    } catch (err) {
      sapPending = null;
      sapParsed = null;
      result.innerHTML = `<div class="error-box"><h2>No se pudo leer el SAP</h2><p>${esc(err.message || err)}</p></div>`;
    } finally {
      input.value = "";
    }
  };
  input.addEventListener("change", onFile);
  cleanup.push(() => input.removeEventListener("change", onFile));
}

async function loadRouteRules() {
  const d = await sapApi({ action: "reglas_rutas" });
  const rules = new Map(
    Object.entries(d.reglas || {}).map(([name, decision]) => [name, Boolean(decision)]),
  );
  if (!rules.size) throw new Error("rutas_sap de CEMENTO está vacío");
  return rules;
}

async function analyze(container, runtime, resultEl) {
  if (!sapParsed) return;
  const rules = await loadRouteRules();
  const hasta = limaTodayKey();
  const desde = shiftDateKey(hasta, -SAP_WINDOW_DAYS);
  const withinRange = sapParsed.registros.filter((r) => {
    const d = sapDateKey(r.FecIniReal);
    return d && d >= desde && d <= hasta;
  });
  const outOfRange = sapParsed.registros.length - withinRange.length;
  const unknown = [
    ...new Set(
      withinRange
        .map((r) =>
          String(r["Descripción Ruta"] || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter((x) => sapTextKey(x) && !rules.has(sapTextKey(x))),
    ),
  ];
  const routeNo = withinRange.filter((r) => {
    const k = sapTextKey(r["Descripción Ruta"]);
    return !k || rules.get(k) === false;
  });
  const eligible = withinRange.filter(
    (r) => rules.get(sapTextKey(r["Descripción Ruta"])) === true,
  );
  const blocked = unknown.length > 0;
  const classification =
    blocked || !eligible.length
      ? {
          nuevas: [],
          vacias_reasignadas: [],
          con_informacion_reabiertas: [],
          reaperturas_detalle: [],
          abiertas_existentes: [],
          cerradas_sin_cambios: [],
        }
      : await sapApi({ action: "clasificar", filas: eligible });

  const reopenDetails = classification.reaperturas_detalle || [];
  [...reopenDecisions.keys()].forEach((key) => {
    if (!reopenDetails.some((x) => String(x.orden_carga) === String(key))) {
      reopenDecisions.delete(String(key));
    }
  });
  const pendingReopen = reopenDetails.filter((x) => !reopenDecisions.has(String(x.orden_carga)));
  const approvedReopens = reopenDetails
    .filter((x) => reopenDecisions.get(String(x.orden_carga)) === "REABRIR")
    .map((x) => String(x.orden_carga));
  const rejectedReopens = reopenDetails
    .filter((x) => reopenDecisions.get(String(x.orden_carga)) === "NO_REABRIR")
    .map((x) => String(x.orden_carga));

  const actionableKeys = new Set([
    ...(classification.nuevas || []),
    ...(classification.vacias_reasignadas || []),
    ...approvedReopens,
  ]);
  const actionable = eligible.filter((row) => actionableKeys.has(String(row["Ord Carga"])));

  sapPending = {
    ...sapParsed,
    actionable,
    desde,
    hasta,
    unknown,
    classification,
    approvedReopens,
    rejectedReopens,
  };

  // Persistable snapshot for precarga / other modules via bus+state
  runtime.state.set("sap.classification", {
    nuevas: classification.nuevas || [],
    vacias: classification.vacias_reasignadas || [],
    actionable: actionable.length,
    total: sapParsed.registros.length,
  });

  const emptyNotice = (classification.vacias_reasignadas || []).length
    ? `<section class="notice"><b>OC VACÍA REASIGNADA</b><br>${(classification.vacias_reasignadas || []).map((x) => `OC ${esc(x)}`).join(" · ")}</section>`
    : "";

  const infoNotice = reopenDetails.length
    ? `<section class="notice warning-text">
        <b>${reopenDetails.length} OC CERRADAS TIENEN CAMBIOS</b><br>
        Revise FECHA, CHOFER, TRACTO y CARRETA. La revisión no modifica Supabase.
        <button type="button" id="cem-review-reopens" class="secondary">VER ${reopenDetails.length} CON CAMBIOS</button>
        <br><small>Revisadas: ${reopenDetails.length - pendingReopen.length}/${reopenDetails.length}
        · Reabrir: ${approvedReopens.length} · No reabrir: ${rejectedReopens.length}</small>
      </section>`
    : "";

  const applyDisabled = blocked || pendingReopen.length > 0 || !actionable.length;
  const applyLabel = blocked
    ? "RESOLVER RUTAS NUEVAS"
    : pendingReopen.length
      ? `REVISAR ${pendingReopen.length} REAPERTURAS ANTES DE APLICAR`
      : `APLICAR ${actionable.length} OCs APROBADAS`;

  const unknownBlock = blocked
    ? `<section class="error-box"><h2>Rutas sin regla</h2>
        <p>Hay ${unknown.length} descripción(es) de ruta sin decisión SI/NO. Resuélvalas en Admin antes de aplicar.</p>
        <ul>${unknown.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </section>`
    : "";

  resultEl.innerHTML = `
    <p class="muted"><b>Rango FecIniReal:</b> ${desde.split("-").reverse().join("/")} → ${hasta.split("-").reverse().join("/")}
      · ventana ${SAP_WINDOW_DAYS} días · reglas por Descripción Ruta</p>
    <div class="sap-metrics">
      <article><small>OCs LEÍDAS</small><b>${sapParsed.registros.length}</b></article>
      <article><small>FUERA DEL RANGO</small><b>${outOfRange}</b></article>
      <article><small>RUTAS NO</small><b>${routeNo.length}</b></article>
      <article><small>RUTAS SI</small><b>${eligible.length}</b></article>
      <article><small>NUEVAS</small><b>${(classification.nuevas || []).length}</b></article>
      <article><small>VACÍAS REASIGNADAS</small><b>${(classification.vacias_reasignadas || []).length}</b></article>
      <article><small>CON INFORMACIÓN</small><b>${(classification.con_informacion_reabiertas || []).length}</b></article>
      <article><small>YA ABIERTAS</small><b>${(classification.abiertas_existentes || []).length}</b></article>
      <article><small>CERRADAS SIN CAMBIOS</small><b>${(classification.cerradas_sin_cambios || []).length}</b></article>
    </div>
    ${emptyNotice}${infoNotice}
    ${sapParsed.duplicadas?.length ? `<p class="warning-text">${sapParsed.duplicadas.length} OCs repetidas en el archivo se consolidaron localmente.</p>` : ""}
    ${unknownBlock}
    <div class="sap-actions" style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" id="cem-apply-sap" class="primary" ${applyDisabled ? "disabled" : ""}>${applyLabel}</button>
    </div>
    <p id="cem-sap-apply-msg" class="muted" style="margin-top:10px"></p>
  `;

  const reviewBtn = resultEl.querySelector("#cem-review-reopens");
  if (reviewBtn) {
    const onReview = () => openReopenReview(reopenDetails, () => analyze(container, runtime, resultEl));
    reviewBtn.addEventListener("click", onReview);
    cleanup.push(() => reviewBtn.removeEventListener("click", onReview));
  }

  const applyBtn = resultEl.querySelector("#cem-apply-sap");
  if (applyBtn && !applyDisabled) {
    const onApply = async () => {
      if (!sapPending) return;
      applyBtn.disabled = true;
      applyBtn.textContent = "APLICANDO…";
      const msg = resultEl.querySelector("#cem-sap-apply-msg");
      try {
        const x = await sapApi({
          action: "aplicar",
          nombre_archivo: sapPending.nombre,
          hash_sha256: sapPending.hash,
          filas_recibidas: sapPending.registros.length,
          filas: sapPending.actionable,
        });
        const notices = [
          `SAP actualizado: ${x.agregadas_sap ?? 0} en histórico y ${x.agregadas_diario ?? 0} en Seguimiento Diario.`,
          ...((x.vacias_reasignadas || []).map((oc) => `OC ${oc} VACÍA REASIGNADA.`)),
          ...((x.con_informacion_reabiertas || []).map((oc) => `OC ${oc} REABIERTA PARA VALIDACIÓN.`)),
        ];
        msg.innerHTML = `<span class="ok-text">${esc(notices.join(" "))}</span>`;
        runtime.bus.emit("cemento:sap-applied", {
          fileName: sapPending.nombre,
          agregadas_diario: x.agregadas_diario ?? 0,
          agregadas_sap: x.agregadas_sap ?? 0,
          at: Date.now(),
        });
        runtime.state.set("sap.lastApply", {
          at: Date.now(),
          agregadas_diario: x.agregadas_diario ?? 0,
        });
        // Limpiar precarga local previa; las placas abiertas se listan en módulo Precarga
        try { localStorage.removeItem("cemento_precarga_activa"); } catch (_) {}
        applyBtn.textContent = "APLICADO";
      } catch (e) {
        msg.innerHTML = `<span class="error-text">${esc(e.message)}</span>`;
        applyBtn.disabled = false;
        applyBtn.textContent = `APLICAR ${sapPending.actionable.length} OCs APROBADAS`;
      }
    };
    applyBtn.addEventListener("click", onApply);
    cleanup.push(() => applyBtn.removeEventListener("click", onApply));
  }
}

function openReopenReview(details, onClose) {
  document.getElementById("cem-sap-reopen-review")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "cem-sap-reopen-review";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px";
  const box = document.createElement("div");
  box.style.cssText =
    "width:min(1100px,98vw);max-height:92vh;overflow:auto;background:#0b1728;color:#e2e8f0;border-radius:14px;padding:18px;border:1px solid #1e3a5f";

  const render = () => {
    const decided = details.filter((x) => reopenDecisions.has(String(x.orden_carga))).length;
    const yes = details.filter((x) => reopenDecisions.get(String(x.orden_carga)) === "REABRIR").length;
    const no = details.filter((x) => reopenDecisions.get(String(x.orden_carga)) === "NO_REABRIR").length;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0 0 6px">Revisar OCs cerradas con cambios</h2>
          <p style="margin:0;color:#94a3b8">Comparación SAP histórico vs actual. No modifica Supabase hasta aplicar.</p>
        </div>
        <div style="font-weight:700">REVISADAS ${decided}/${details.length} · REABRIR ${yes} · NO ${no}</div>
      </div>
      <div style="overflow:auto;margin-top:14px">
        <table style="border-collapse:collapse;min-width:1000px;width:100%;font-size:12px">
          <thead>
            <tr>
              <th>OC</th><th>FECHA ANT.</th><th>FECHA SAP</th><th>CHOFER ANT.</th><th>CHOFER SAP</th>
              <th>TRACTO ANT.</th><th>TRACTO SAP</th><th>CARRETA ANT.</th><th>CARRETA SAP</th>
              <th>CAMBIOS</th><th>DECISIÓN</th>
            </tr>
          </thead>
          <tbody>
            ${details
              .map((x) => {
                const key = String(x.orden_carga);
                const dec = reopenDecisions.get(key) || "";
                return `<tr style="border-bottom:1px solid #1e3a5f">
                  <td><b>${esc(key)}</b></td>
                  <td>${esc(x.anterior?.fecha)}</td><td>${esc(x.actual?.fecha)}</td>
                  <td>${esc(x.anterior?.chofer)}</td><td>${esc(x.actual?.chofer)}</td>
                  <td>${esc(x.anterior?.tracto)}</td><td>${esc(x.actual?.tracto)}</td>
                  <td>${esc(x.anterior?.carreta)}</td><td>${esc(x.actual?.carreta)}</td>
                  <td><b>${esc((x.cambios || []).join(" + ") || "—")}</b></td>
                  <td style="white-space:nowrap">
                    <button type="button" data-oc="${esc(key)}" data-dec="REABRIR" style="margin:2px;${dec==="REABRIR"?"outline:2px solid #22c55e":""}">REABRIR</button>
                    <button type="button" data-oc="${esc(key)}" data-dec="NO_REABRIR" style="margin:2px;${dec==="NO_REABRIR"?"outline:2px solid #ef4444":""}">NO</button>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button type="button" id="cem-close-reopen">CERRAR REVISIÓN</button>
      </div>`;

    box.querySelectorAll("[data-oc]").forEach((btn) => {
      btn.onclick = () => {
        reopenDecisions.set(String(btn.dataset.oc), String(btn.dataset.dec));
        render();
      };
    });
    box.querySelector("#cem-close-reopen").onclick = () => {
      overlay.remove();
      onClose?.();
    };
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
      onClose?.();
    }
  };
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  render();
}
