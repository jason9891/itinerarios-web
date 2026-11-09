/**
 * Módulo CEMENTO · SAP
 * Flujo: subir Excel → filtrar rutas SI → clasificar vs histórico → aplicar a seguimiento.
 * Independiente de Cerro Verde.
 */
import { esc, fechaPE, moduleHead, sapApi, montadosApi, trackApi } from "../api-client.js";
import {
  SAP_WINDOW_DAYS,
  parseSapFile,
  sapTextKey,
  sapDateKey,
  limaTodayKey,
  shiftDateKey,
} from "../sap-parse.js";
import { parsePaste, toSavePayload } from "../montados-parse.js";

let cleanup = [];
let sapPending = null;
let sapParsed = null;
const reopenDecisions = new Map(); // oc -> REABRIR | NO_REABRIR

/** Resumen operativo: lo que realmente hay que revisar en DIARIO (no el filtro del Excel). */
async function loadDiarioPendiente() {
  try {
    const lista = await trackApi({ action: "lista" }, { forceNetwork: true });
    const placas = Array.isArray(lista?.placas) ? lista.placas : [];
    const totalOcs = Number(lista?.total_ocs ?? 0) || placas.reduce((n, p) => n + Number(p?.ocs || p?.count || 0), 0);
    // si total_ocs no viene, contar por bootstrap
    if (!totalOcs && !placas.length) {
      const boot = await trackApi({ action: "bootstrap" }, { forceNetwork: true });
      const units = boot?.units || [];
      const ocs = units.reduce((n, u) => n + (Array.isArray(u.ocs) ? u.ocs.length : 0), 0);
      return { placas: units.length, ocs, ok: true };
    }
    return { placas: placas.length, ocs: totalOcs || placas.length, ok: true };
  } catch (e) {
    return { placas: 0, ocs: 0, ok: false, error: e?.message || String(e) };
  }
}

function diarioBannerHtml(d) {
  if (!d?.ok) {
    return `<section class="notice" style="border-color:#b45309;background:#422006">
      <b>PENDIENTE EN DIARIO:</b> no se pudo leer el maestro (${esc(d?.error || "error")}).
    </section>`;
  }
  return `<section class="notice" style="border-color:#0ea5e9;background:#0c4a6e">
    <div style="display:flex;flex-wrap:wrap;gap:16px 28px;align-items:baseline">
      <div><small style="opacity:.85">PENDIENTE EN DIARIO (a revisar)</small><br>
        <b style="font-size:28px;letter-spacing:.02em">${d.ocs}</b>
        <span style="font-size:14px;margin-left:6px">OCs abiertas</span></div>
      <div><small style="opacity:.85">PLACAS CON OC ABIERTA</small><br>
        <b style="font-size:28px">${d.placas}</b>
        <span style="font-size:14px;margin-left:6px">unidades</span></div>
      <p style="margin:0;flex:1;min-width:220px;font-size:13px;line-height:1.4;opacity:.95">
        Este es el volumen real de seguimiento. Las tarjetas de abajo describen solo el <b>Excel</b>
        (filtro de rutas y match con histórico). <b>RUTAS SI</b> ≠ pendientes en diario.
      </p>
    </div>
  </section>`;
}


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
  const diario = await loadDiarioPendiente();
  container.innerHTML =
    moduleHead("Actualizar SAP", "Pendiente en Diario · Excel vs histórico") +
    diarioBannerHtml(diario) +
    `<section class="notice">
      <b>FLUJO:</b> 1) Vea arriba cuántas OCs tiene pendientes en Diario ·
      2) Excel SAP → clasifica nuevas / reasignadas / reaperturas ·
      3) Aplique solo accionables → actualizan Diario ·
      4) Precarga / Seguimiento usan las OCs abiertas de Diario.
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
    </section>

    <section class="panel" id="cem-montados-panel">
      <div class="panel-title">
        <div>
          <h2>Guías de montados</h2>
          <p class="muted">
            Pegue filas desde Excel (<b>Ctrl+V</b>). No hacen falta encabezados.
            <br><b>1ª unidad = ACOPLE CORTO = MONTADO</b> ·
            <b>2ª unidad = ACOPLE LARGO = TRANSPORTA (montando a)</b>
            <br>Fecha = celda anterior a la ruta realizada.
          </p>
        </div>
      </div>
      <textarea id="cem-montados-paste" rows="6"
        placeholder="Haga clic aquí y pegue las filas con Ctrl+V"
        style="width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:12px;padding:10px;border-radius:10px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0"></textarea>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px" class="muted">
        <span>FILAS <b id="cem-mgf-total">0</b></span>
        <span>VÁLIDAS <b id="cem-mgf-valid">0</b></span>
        <span>DUPLICADAS <b id="cem-mgf-dup">0</b></span>
        <span>REVISAR <b id="cem-mgf-bad">0</b></span>
      </div>
      <div id="cem-montados-preview" style="margin-top:10px;overflow:auto;max-height:240px"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button type="button" id="cem-montados-save" class="primary" disabled>GUARDAR MONTADOS</button>
        <button type="button" id="cem-montados-clear" class="secondary">LIMPIAR</button>
      </div>
      <p id="cem-montados-msg" class="muted" style="margin-top:8px"></p>
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

  wireMontados(container, runtime);
}

function wireMontados(container, runtime) {
  const ta = container.querySelector("#cem-montados-paste");
  const preview = container.querySelector("#cem-montados-preview");
  const msg = container.querySelector("#cem-montados-msg");
  const btnSave = container.querySelector("#cem-montados-save");
  const btnClear = container.querySelector("#cem-montados-clear");
  if (!ta) return;

  let lastValid = [];

  const analyse = () => {
    const rows = parsePaste(ta.value || "");
    const valid = rows.filter((r) => r.valida && !r.duplicada);
    const dup = rows.filter((r) => r.duplicada);
    const bad = rows.filter((r) => !r.valida);
    lastValid = valid;

    container.querySelector("#cem-mgf-total").textContent = String(rows.length);
    container.querySelector("#cem-mgf-valid").textContent = String(valid.length);
    container.querySelector("#cem-mgf-dup").textContent = String(dup.length);
    container.querySelector("#cem-mgf-bad").textContent = String(bad.length);
    btnSave.disabled = !valid.length;

    if (!rows.length) {
      preview.innerHTML = "";
      return;
    }

    preview.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="text-align:left;padding:6px">#</th>
        <th style="text-align:left;padding:6px">FECHA SALIDA</th>
        <th style="text-align:left;padding:6px">RUTA</th>
        <th style="text-align:left;padding:6px">MONTADO (corto)</th>
        <th style="text-align:left;padding:6px">MONTANDO A (largo)</th>
        <th style="text-align:left;padding:6px">ESTADO</th>
      </tr></thead>
      <tbody>
        ${rows
          .slice(0, 40)
          .map((r) => {
            const st = !r.valida
              ? `REVISAR: ${(r.errores || []).join(", ")}`
              : r.duplicada
                ? "DUPLICADA"
                : "OK";
            return `<tr style="border-top:1px solid #1e3a5f">
              <td style="padding:6px">${r.number}</td>
              <td style="padding:6px">${esc(r.fecha || "—")}</td>
              <td style="padding:6px">${esc(r.ruta || "—")}</td>
              <td style="padding:6px"><b>${esc(r.corto?.tracto || "—")}</b></td>
              <td style="padding:6px"><b>${esc(r.largo?.tracto || "—")}</b></td>
              <td style="padding:6px">${esc(st)}</td>
            </tr>`;
          })
          .join("")}
        ${rows.length > 40 ? `<tr><td colspan="6" class="muted" style="padding:6px">… y ${rows.length - 40} más</td></tr>` : ""}
      </tbody>
    </table>`;
  };

  const onInput = () => analyse();
  ta.addEventListener("input", onInput);
  ta.addEventListener("paste", () => setTimeout(analyse, 40));
  cleanup.push(() => ta.removeEventListener("input", onInput));

  const onClear = () => {
    ta.value = "";
    msg.textContent = "";
    analyse();
  };
  btnClear.addEventListener("click", onClear);
  cleanup.push(() => btnClear.removeEventListener("click", onClear));

  const onSave = async () => {
    if (!lastValid.length) return;
    btnSave.disabled = true;
    btnSave.textContent = "GUARDANDO…";
    msg.textContent = "";
    try {
      const payload = toSavePayload(lastValid);
      const res = await montadosApi({ action: "guardar", rows: payload });
      msg.innerHTML = `<span class="ok-text">Montados guardados: ${esc(res.guardadas ?? 0)} · inválidas: ${esc(res.invalidas ?? 0)}</span>`;
      runtime.bus.emit("cemento:montados-updated", {
        guardadas: res.guardadas ?? 0,
        at: Date.now(),
      });
      runtime.state.set("montados.lastSave", { at: Date.now(), guardadas: res.guardadas ?? 0 });
    } catch (e) {
      msg.innerHTML = `<span class="error-text">${esc(e.message)}</span>`;
    } finally {
      btnSave.disabled = !lastValid.length;
      btnSave.textContent = "GUARDAR MONTADOS";
    }
  };
  btnSave.addEventListener("click", onSave);
  cleanup.push(() => btnSave.removeEventListener("click", onSave));
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
    ? `<section class="route-decisions">
        <h2>Rutas nuevas · decisión requerida</h2>
        <p>Hay ${unknown.length} descripción(es) de ruta sin regla. Indique si es <b>válida (SI)</b> o <b>no válida (NO)</b>. Se guarda en Supabase al instante.</p>
        ${unknown.map((ruta, i) => `
          <article data-ruta-idx="${i}">
            <b>${esc(ruta)}</b>
            <div>
              <button type="button" data-ruta-si="${i}">RUTA VÁLIDA · SI</button>
              <button type="button" data-ruta-no="${i}" class="danger">NO VÁLIDA · NO</button>
            </div>
          </article>`).join("")}
        <p id="cem-ruta-msg" class="muted" style="margin:10px 0 0"></p>
      </section>`
    : "";

  resultEl.innerHTML = `
    <p class="muted"><b>Rango FecIniReal:</b> ${desde.split("-").reverse().join("/")} → ${hasta.split("-").reverse().join("/")}
      · ventana ${SAP_WINDOW_DAYS} días · reglas por Descripción Ruta</p>
    <p class="muted" style="margin:0 0 8px"><b>Clasificación del Excel</b> (no es el total a revisar en seguimiento)</p>
    <div class="sap-metrics">
      <article><small>EXCEL · LEÍDAS</small><b>${sapParsed.registros.length}</b></article>
      <article><small>EXCEL · FUERA RANGO</small><b>${outOfRange}</b></article>
      <article><small>EXCEL · RUTA NO</small><b>${routeNo.length}</b></article>
      <article><small>EXCEL · RUTA SI</small><b>${eligible.length}</b></article>
      <article><small>NUEVAS → DIARIO</small><b>${(classification.nuevas || []).length}</b></article>
      <article><small>VACÍAS REASIGNADAS</small><b>${(classification.vacias_reasignadas || []).length}</b></article>
      <article><small>REABRIR CON INFO</small><b>${(classification.con_informacion_reabiertas || []).length}</b></article>
      <article style="outline:1px solid #38bdf8"><small>YA EN DIARIO (match)</small><b>${(classification.abiertas_existentes || []).length}</b></article>
      <article><small>CERRADAS SIN CAMBIOS</small><b>${(classification.cerradas_sin_cambios || []).length}</b></article>
    </div>
    <p class="muted" style="margin:10px 0 0">
      <b>YA EN DIARIO</b> = OCs del Excel que ya están abiertas (forman parte de las pendientes de arriba).
      El total a precargar/seguir es el de <b>PENDIENTE EN DIARIO</b>, no “RUTA SI”.
    </p>
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

  // Decisiones SI/NO para rutas nuevas → guardar_regla_ruta y reanalizar
  const rutaMsg = resultEl.querySelector("#cem-ruta-msg");
  resultEl.querySelectorAll("[data-ruta-si], [data-ruta-no]").forEach((btn) => {
    const onClick = async () => {
      const isSi = btn.hasAttribute("data-ruta-si");
      const idx = Number(btn.getAttribute("data-ruta-si") ?? btn.getAttribute("data-ruta-no"));
      const descripcion = unknown[idx];
      if (!descripcion) return;
      const article = btn.closest("article");
      article?.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      if (rutaMsg) rutaMsg.textContent = `Guardando regla (${isSi ? "SI" : "NO"})…`;
      try {
        await sapApi({
          action: "guardar_regla_ruta",
          descripcion,
          usar: isSi,
        });
        if (rutaMsg) {
          rutaMsg.innerHTML = `<span style="color:#86efac">Guardado: <b>${esc(descripcion)}</b> → ${isSi ? "RUTA VÁLIDA (SI)" : "NO VÁLIDA (NO)"}</span>`;
        }
        // Reclasificar con la nueva regla
        await analyze(container, runtime, resultEl);
      } catch (e) {
        article?.querySelectorAll("button").forEach((b) => { b.disabled = false; });
        if (rutaMsg) rutaMsg.innerHTML = `<span class="error-text">${esc(e.message)}</span>`;
      }
    };
    btn.addEventListener("click", onClick);
    cleanup.push(() => btn.removeEventListener("click", onClick));
  });

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
