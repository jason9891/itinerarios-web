/**
 * Módulo CERRO VERDE · SAP
 *
 * Flujo:
 *  1) Seleccionar Excel → se guarda en este navegador
 *  2) VALIDAR → filtro negocio + cruce maestros (servidor)
 *  3) Resolver pendientes:
 *     - Conductor no encontrado → alta en maestro (licencia + nombre)
 *     - Acople sin maestro → alta 20-C-xxx o continuar solo con placa
 *  4) APLICAR cuando no queden bloqueantes
 *
 * Independiente de Cemento.
 */
import {
  esc,
  fechaPE,
  moduleHead,
  sapApi,
  bufferToBase64,
} from "../api-client.js";
import { loadSapFile, saveSapFile } from "../sap-store.js";

/** Confirmación local (no window.confirm): no bloquea el hilo del navegador de forma opaca. */
function cvLocalConfirm({ title, message, confirmLabel = "CONTINUAR", cancelLabel = "CANCELAR" }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "cv-modal-root";
    host.innerHTML = `
      <div class="cv-modal-backdrop" data-cancel></div>
      <div class="cv-modal-card" role="dialog" aria-modal="true">
        <h3>${title || "Confirmar"}</h3>
        <p>${message || ""}</p>
        <div class="cv-modal-actions">
          <button type="button" class="cv-modal-cancel" data-cancel>${cancelLabel}</button>
          <button type="button" class="cv-modal-ok" data-ok>${confirmLabel}</button>
        </div>
      </div>`;
    const style = document.createElement("style");
    style.textContent = `
      .cv-modal-root{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px}
      .cv-modal-backdrop{position:absolute;inset:0;background:rgba(2,8,16,.72);backdrop-filter:blur(2px)}
      .cv-modal-card{position:relative;z-index:1;width:min(440px,100%);background:#0c1a2a;border:1px solid #1e3a5f;border-radius:14px;padding:18px 18px 14px;box-shadow:0 24px 60px rgba(0,0,0,.45);color:#e2e8f0}
      .cv-modal-card h3{margin:0 0 8px;font-size:16px;color:#7dd3fc;letter-spacing:.03em}
      .cv-modal-card p{margin:0 0 16px;font-size:13px;line-height:1.5;color:#cbd5e1}
      .cv-modal-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
      .cv-modal-cancel,.cv-modal-ok{border-radius:10px;padding:10px 16px;font-weight:800;font-size:12px;cursor:pointer;border:1px solid transparent}
      .cv-modal-cancel{background:#12263a;border-color:#334155;color:#e2e8f0}
      .cv-modal-ok{background:linear-gradient(135deg,#0ea5e9,#2563eb);border-color:#1d4ed8;color:#fff}
    `;
    document.head.appendChild(style);
    document.body.appendChild(host);
    const done = (v) => {
      try { host.remove(); style.remove(); } catch (_) {}
      resolve(v);
    };
    host.querySelectorAll("[data-cancel]").forEach((el) => el.addEventListener("click", () => done(false)));
    host.querySelector("[data-ok]")?.addEventListener("click", () => done(true));
    host.querySelector("[data-ok]")?.focus();
  });
}


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
  const pendientes = Number(summary.pendientes_maestro || 0);
  if (pendientes > 0) return false;
  return (
    Number(summary.nuevas_sap || 0) > 0 ||
    Number(summary.nuevas_diario || 0) > 0
  );
}

function hasBlockers(summary) {
  return Number(summary?.pendientes_maestro || 0) > 0;
}

function renderMetrics(s) {
  return `
    <div class="activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px">
      <div><small>LEÍDAS</small><b>${s.leidas ?? "—"}</b></div>
      <div><small>EN ALCANCE</small><b>${s.en_alcance ?? "—"}</b></div>
      <div><small>YA REGISTRADAS</small><b>${s.registradas ?? "—"}</b></div>
      <div><small>NUEVAS SAP</small><b>${s.nuevas_sap ?? "—"}</b></div>
      <div><small>NUEVAS DIARIO</small><b>${s.nuevas_diario ?? "—"}</b></div>
      <div><small>DESCARTADAS</small><b>${s.descartadas ?? "—"}</b></div>
      <div><small>PEND. MAESTRO</small><b style="color:${Number(s.pendientes_maestro) ? "#fbbf24" : "inherit"}">${s.pendientes_maestro ?? 0}</b></div>
      <div><small>ACOPLES AVISO</small><b>${s.acoples_sin_maestro ?? 0}</b></div>
    </div>`;
}

function renderDiscardGroups(s) {
  const discards = Array.isArray(s.descartes) ? s.descartes : [];
  const resumen = Array.isArray(s.descartes_resumen) ? s.descartes_resumen : [];
  if (!discards.length && !resumen.length) return "";

  const fuera = discards.filter((x) =>
    String(x.motivo || "").includes("FUERA DEL NEGOCIO"),
  );
  const otros = discards.filter(
    (x) => !String(x.motivo || "").includes("FUERA DEL NEGOCIO"),
  );

  return `
    <details style="margin-top:14px">
      <summary><b>Descartes</b> (${discards.length}) — fuera de negocio = no pasó filtro Cliente/Destino CV</summary>
      <p class="muted" style="margin:8px 0">
        <b>FUERA DEL NEGOCIO CERRO VERDE</b> = el registro no es
        cliente <i>SOCIEDAD MINERA CERRO VERDE S.A.A.</i>
        ni <i>CAL &amp; CEMENTO SUR</i> con destino <i>ARE.ARE.YARABAMBA</i>.
      </p>
      ${
        resumen.length
          ? `<ul style="margin:8px 0">${resumen
              .map((r) => `<li>${esc(r.motivo)}: <b>${r.cantidad}</b></li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        fuera.length
          ? `<p class="muted">Fuera de negocio (muestra): ${fuera.length} fila(s)</p>`
          : ""
      }
      <div class="discard-list">${otros
        .slice(0, 60)
        .map((x) => `<p><b>${esc(x.entrega)}</b> · ${esc(x.motivo)}</p>`)
        .join("")}</div>
    </details>`;
}

function renderConductorPanel(pendientes) {
  const conductores = (pendientes || []).filter(
    (x) => x.tipo === "CONDUCTOR" || String(x.motivo || "").includes("CONDUCTOR NO RESUELTO"),
  );
  if (!conductores.length) return "";

  // Agrupar por licencia
  const byLic = new Map();
  for (const x of conductores) {
    const k = String(x.licencia || "").toUpperCase() || "SIN-LIC";
    if (!byLic.has(k)) byLic.set(k, { ...x, entregas: [] });
    byLic.get(k).entregas.push(x.entrega);
  }

  const cards = [...byLic.values()]
    .map((x, i) => {
      const sug = Array.isArray(x.sugerencias_conductor) ? x.sugerencias_conductor : [];
      const sugHtml = sug.length
        ? `<div class="muted" style="margin:6px 0 8px">
            Posibles coincidencias (mismo DNI en licencia):
            ${sug
              .map(
                (s) =>
                  `<button type="button" class="secondary cv-sug-driver" data-idx="${i}" data-lic="${esc(s.licencia)}" data-name="${esc(s.conductor)}" style="margin:2px 4px 2px 0;padding:4px 8px;font-size:12px">
                    ${esc(s.licencia)} · ${esc(s.conductor)}
                  </button>`,
              )
              .join("")}
          </div>`
        : `<p class="muted" style="margin:6px 0">Sin coincidencia automática por DNI. Ingrese el nombre y confirme el alta.</p>`;

      return `
        <article class="panel" data-driver-card="${i}" style="margin-top:10px;border:1px solid #334155">
          <div class="panel-title">
            <div>
              <h3 style="margin:0;font-size:15px">Conductor no resuelto</h3>
              <p class="muted" style="margin:4px 0 0">
                Licencia SAP: <b>${esc(x.licencia || "—")}</b>
                · Entregas: ${esc(x.entregas.slice(0, 5).join(", "))}
                ${x.entregas.length > 5 ? ` +${x.entregas.length - 5}` : ""}
              </p>
              ${x.nombre_sap || x.referencia_sap ? `<p class="muted">Ref. SAP: ${esc(x.nombre_sap || x.referencia_sap)}</p>` : ""}
            </div>
          </div>
          ${sugHtml}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="muted">LICENCIA
              <input data-field="licencia" value="${esc(x.licencia || "")}"
                style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0" />
            </label>
            <label class="muted">NOMBRE CONDUCTOR
              <input data-field="conductor" value="${esc(x.conductor || x.nombre_sap || "")}"
                placeholder="APELLIDOS NOMBRES"
                style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0" />
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
            <button type="button" class="primary cv-add-driver" data-idx="${i}">AÑADIR CONDUCTOR AL MAESTRO</button>
            <span class="muted cv-driver-msg" data-idx="${i}"></span>
          </div>
        </article>`;
    })
    .join("");

  return `
    <section style="margin-top:16px">
      <h2 style="margin:0 0 6px;font-size:16px">Resolver conductores</h2>
      <p class="muted" style="margin:0">
        La unidad (tracto 20-R-…) sí está en maestros, pero la licencia no matchea un conductor.
        Suele ser licencia nueva, recategorización o cambio de letra. Puede buscar por DNI en sus archivos
        y dar de alta aquí; luego vuelva a <b>Validar</b>.
      </p>
      ${cards}
    </section>`;
}

function renderAcoplePanel(s) {
  const acoples = Array.isArray(s.acoples_sin_maestro_detalle)
    ? s.acoples_sin_maestro_detalle
    : [];
  if (!acoples.length) return "";

  // Agrupar por placa carreta
  const byPlate = new Map();
  for (const x of acoples) {
    const k = String(x.placa_carreta || "").toUpperCase() || "SIN";
    if (!byPlate.has(k)) byPlate.set(k, { ...x, entregas: [] });
    byPlate.get(k).entregas.push(x.entrega);
  }

  const cards = [...byPlate.values()]
    .map((x, i) => {
      const codigoSug = x.codigo_sugerido || s.codigo_acople_sugerido || "20-C-001";
      return `
        <article class="panel" data-acople-card="${i}" style="margin-top:10px;border:1px solid #334155">
          <div class="panel-title">
            <div>
              <h3 style="margin:0;font-size:15px">Acople / carreta sin maestro</h3>
              <p class="muted" style="margin:4px 0 0">
                Tracto <b>${esc(x.placa_tracto)}</b> (${esc(x.codigo_tracto || "—")})
                · Carreta SAP: <b>${esc(x.placa_carreta || "—")}</b>
              </p>
              <p class="muted">${esc(x.advertencia || "")} · No bloquea el seguimiento: puede continuar solo con la placa.</p>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="muted">PLACA CARRETA
              <input data-field="placa" value="${esc(x.placa_carreta || "")}" readonly
                style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #1e3a5f;background:#0b1726;color:#94a3b8" />
            </label>
            <label class="muted">CÓDIGO ACOPLE (ej. 20-C-123)
              <input data-field="codigo" value="${esc(codigoSug)}"
                style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0" />
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
            <button type="button" class="primary cv-add-acople" data-idx="${i}">AÑADIR ACOPLE AL MAESTRO</button>
            <button type="button" class="secondary cv-skip-acople" data-idx="${i}">CONTINUAR SOLO CON PLACA</button>
            <span class="muted cv-acople-msg" data-idx="${i}"></span>
          </div>
        </article>`;
    })
    .join("");

  return `
    <section style="margin-top:16px">
      <h2 style="margin:0 0 6px;font-size:16px">Acoples sin maestro</h2>
      <p class="muted" style="margin:0">
        No tener la carreta en maestros <b>no limita</b> el seguimiento: se registra la placa de carreta
        y una advertencia. Si quiere código interno (20-C-…), use <b>Añadir acople</b>.
      </p>
      ${cards}
    </section>`;
}

function renderOtherPendientes(pendientes) {
  const otros = (pendientes || []).filter(
    (x) =>
      x.tipo === "TRACTO" ||
      x.tipo === "LICENCIA" ||
      (!String(x.motivo || "").includes("CONDUCTOR NO RESUELTO") &&
        x.tipo !== "CONDUCTOR"),
  );
  if (!otros.length) return "";
  return `
    <section style="margin-top:16px">
      <h2 style="margin:0 0 6px;font-size:16px">Otros bloqueantes</h2>
      <div class="discard-list">${otros
        .map(
          (x) =>
            `<p><b>${esc(x.entrega)}</b> · ${esc(x.placa || "")} · ${esc(x.motivo)}</p>`,
        )
        .join("")}</div>
      <p class="muted">Tracto ausente en maestros o licencia vacía: debe resolverse en data maestra de equipos antes de aplicar.</p>
    </section>`;
}

function renderSummary(s) {
  const pendientes = Array.isArray(s.pendientes_maestro_detalle)
    ? s.pendientes_maestro_detalle
    : [];
  return `
    <h2 style="margin:16px 0 0;font-size:17px">Resultado de validación</h2>
    ${renderMetrics(s)}
    ${
      s.recuperadas_sap_historico
        ? `<p class="muted" style="margin-top:10px">Recuperadas de SAP histórico: <b>${s.recuperadas_sap_historico}</b></p>`
        : ""
    }
    ${
      hasBlockers(s)
        ? `<p class="notice" style="margin-top:12px"><b>Hay pendientes de maestro.</b> Resuélvalos abajo y vuelva a validar antes de aplicar.</p>`
        : canApply(s)
          ? `<p class="notice" style="margin-top:12px"><b>Listo para aplicar.</b> No hay bloqueantes de maestro.</p>`
          : `<p class="muted" style="margin-top:12px">No hay entregas nuevas ni ciclos faltantes por reconciliar.</p>`
    }
    ${renderConductorPanel(pendientes)}
    ${renderAcoplePanel(s)}
    ${renderOtherPendientes(pendientes)}
    ${renderDiscardGroups(s)}
  `;
}

async function render(container, runtime) {
  current = await loadSapFile().catch(() => null);
  validated = false;
  lastSummary = null;
  const lastName = runtime.state.get("sap.lastFile");

  container.innerHTML =
    moduleHead("Actualizar SAP", "Excel temporal · filtro negocio Cerro Verde") +
    `<section class="notice">
      <b>FLUJO:</b> 1) Seleccione el Excel · 2) Valide (filtro CV + maestros) ·
      3) Si falta conductor o acople, resuélvalo aquí · 4) Aplique.
      <br><small class="muted">
        Negocio CV = cliente SMCV, o CALCESUR con destino ARE.ARE.YARABAMBA.
        Solo el tracto debe existir en maestros; la carreta no bloquea.
      </small>
    </section>

    <section class="panel sap-upload">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">Archivo SAP</h2>
          <p class="muted" style="margin:4px 0 0">.xls / .xlsx · se guarda solo en este navegador hasta aplicar</p>
        </div>
        <label class="primary" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:12px 18px;border-radius:10px;font-weight:700">
          SELECCIONAR EXCEL
          <input id="cv-sap-file" type="file" accept=".xls,.xlsx" hidden>
        </label>
      </div>
      <div id="cv-sap-current" class="muted" style="margin-top:12px"></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
        <button type="button" id="cv-sap-validate" class="primary" style="min-width:160px;padding:12px 18px" disabled>
          VALIDAR ARCHIVO
        </button>
        <button type="button" id="cv-sap-apply" class="primary" style="min-width:160px;padding:12px 18px" disabled>
          APLICAR CAMBIOS
        </button>
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
      currentBox.innerHTML = `Temporal: <b>${esc(current.nombre)}</b> · ${(current.tamano / 1024).toFixed(1)} KB · ${esc(fechaPE(current.guardado))}`;
    } else if (lastName) {
      currentBox.innerHTML = `Último en sesión: <b>${esc(lastName)}</b> (vuelva a seleccionar para validar).`;
    } else {
      currentBox.innerHTML = "No hay un SAP temporal cargado en este navegador.";
    }
    btnValidate.disabled = !current;
    btnApply.disabled = !validated || !canApply(lastSummary);
  }

  function wireResolutionHandlers() {
    // Sugerencias de conductor
    resultBox.querySelectorAll(".cv-sug-driver").forEach((btn) => {
      const onClick = () => {
        const card = resultBox.querySelector(
          `article[data-driver-card="${btn.dataset.idx}"]`,
        );
        if (!card) return;
        const nameInput = card.querySelector('[data-field="conductor"]');
        if (nameInput) nameInput.value = btn.dataset.name || "";
        // Licencia se mantiene la del SAP (nueva); el nombre viene del histórico.
      };
      btn.addEventListener("click", onClick);
      cleanup.push(() => btn.removeEventListener("click", onClick));
    });

    // Alta conductor
    resultBox.querySelectorAll(".cv-add-driver").forEach((btn) => {
      const onClick = async () => {
        const card = resultBox.querySelector(
          `article[data-driver-card="${btn.dataset.idx}"]`,
        );
        const msg = resultBox.querySelector(
          `.cv-driver-msg[data-idx="${btn.dataset.idx}"]`,
        );
        if (!card) return;
        const licencia = card.querySelector('[data-field="licencia"]')?.value?.trim();
        const conductor = card.querySelector('[data-field="conductor"]')?.value?.trim();
        btn.disabled = true;
        if (msg) msg.textContent = "Guardando…";
        try {
          const r = await sapApi({ action: "alta_conductor", licencia, conductor });
          if (msg)
            msg.textContent = `Guardado: ${r.licencia} · ${r.conductor}. Vuelva a VALIDAR.`;
          runtime.bus.emit("cerro-verde:maestro-conductor", r);
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        } finally {
          btn.disabled = false;
        }
      };
      btn.addEventListener("click", onClick);
      cleanup.push(() => btn.removeEventListener("click", onClick));
    });

    // Alta acople
    resultBox.querySelectorAll(".cv-add-acople").forEach((btn) => {
      const onClick = async () => {
        const card = resultBox.querySelector(
          `article[data-acople-card="${btn.dataset.idx}"]`,
        );
        const msg = resultBox.querySelector(
          `.cv-acople-msg[data-idx="${btn.dataset.idx}"]`,
        );
        if (!card) return;
        const placa = card.querySelector('[data-field="placa"]')?.value?.trim();
        const codigo_sap = card.querySelector('[data-field="codigo"]')?.value?.trim();
        btn.disabled = true;
        if (msg) msg.textContent = "Guardando…";
        try {
          const r = await sapApi({ action: "alta_acople", placa, codigo_sap });
          if (msg)
            msg.textContent = r.ya_existia
              ? `Ya existía: ${r.placa} → ${r.codigo_sap}`
              : `Acople añadido: ${r.placa} → ${r.codigo_sap}. Puede revalidar.`;
          runtime.bus.emit("cerro-verde:maestro-acople", r);
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        } finally {
          btn.disabled = false;
        }
      };
      btn.addEventListener("click", onClick);
      cleanup.push(() => btn.removeEventListener("click", onClick));
    });

    // Continuar solo con placa
    resultBox.querySelectorAll(".cv-skip-acople").forEach((btn) => {
      const onClick = () => {
        const msg = resultBox.querySelector(
          `.cv-acople-msg[data-idx="${btn.dataset.idx}"]`,
        );
        if (msg)
          msg.textContent =
            "OK: se usará solo la placa de carreta (sin código maestro). No bloquea aplicar.";
        btn.disabled = true;
      };
      btn.addEventListener("click", onClick);
      cleanup.push(() => btn.removeEventListener("click", onClick));
    });
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
      resultBox.innerHTML = `<p class="muted">Archivo listo. Pulse <b>VALIDAR ARCHIVO</b> para analizar filtro de negocio y maestros.</p>`;
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
    const prevLabel = btnValidate.textContent;
    btnValidate.textContent = "VALIDANDO…";
    resultBox.innerHTML = `<p class="muted">Analizando SAP (negocio Cerro Verde + maestros)…</p>`;
    try {
      const s = await sapApi({
        action: "validar_archivo",
        nombre_archivo: current.nombre,
        contenido_base64: bufferToBase64(current.contenido),
      });
      lastSummary = s;
      validated = canApply(s);
      resultBox.innerHTML = renderSummary(s);
      wireResolutionHandlers();
      runtime.bus.emit("cerro-verde:sap-validated", {
        fileName: current.nombre,
        summary: {
          nuevas_sap: s.nuevas_sap,
          nuevas_diario: s.nuevas_diario,
          pendientes_maestro: s.pendientes_maestro,
          hash: s.hash,
        },
      });
    } catch (err) {
      validated = false;
      lastSummary = null;
      resultBox.innerHTML = `<div class="error-box"><h2>No se pudo validar</h2><p>${esc(err.message || err)}</p></div>`;
    } finally {
      btnValidate.textContent = prevLabel || "VALIDAR ARCHIVO";
      refreshCurrent();
    }
  };
  btnValidate.addEventListener("click", onValidate);
  cleanup.push(() => btnValidate.removeEventListener("click", onValidate));

  const onApply = async () => {
    if (!current || !validated) return;
    const ok = await cvLocalConfirm({
      title: "APLICAR CAMBIOS SAP",
      message:
        "Se aplicarán las entregas nuevas validadas y los ciclos faltantes de SAP histórico. ¿Continuar?",
      confirmLabel: "APLICAR",
      cancelLabel: "CANCELAR",
    });
    if (!ok) return;
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
