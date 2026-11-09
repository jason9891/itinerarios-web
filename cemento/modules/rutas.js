/**
 * CEMENTO · Validador de rutas SAP.
 * Auditoría de solo lectura y corrección individual explícita de reglas.
 * No modifica órdenes de carga ni registros de seguimiento.
 */
import { esc, moduleHead, sapApi } from "../api-client.js";

let cleanup = [];

export async function mount(container) {
  cleanup = [];
  container.innerHTML = moduleHead("Validador de rutas", "Auditoría del catálogo SAP · solo CEMENTO") +
    `<section class="notice">
      <b>IMPORTANTE:</b> el validador compara las reglas de Supabase con el catálogo base del repositorio.
      La auditoría no modifica datos. Cada corrección requiere que selecciones una ruta y confirmes el cambio.
      Corregir una regla no elimina retroactivamente OCs ya importadas.
    </section>
    <section class="panel">
      <div class="panel-title">
        <div><h2>Auditoría del catálogo</h2><p class="muted">Busca aceptaciones fuera del catálogo o decisiones que contradicen el catálogo base.</p></div>
        <button id="cem-route-audit" class="primary" type="button">EJECUTAR AUDITORÍA</button>
      </div>
      <div id="cem-route-summary" class="muted">Pulsa “Ejecutar auditoría” para consultar las reglas actuales.</div>
      <div id="cem-route-audit-results" style="margin-top:12px;overflow:auto"></div>
    </section>
    <section class="panel">
      <div class="panel-title"><div><h2>Reglas de ruta guardadas</h2><p class="muted">Puedes buscar y corregir una decisión por vez.</p></div></div>
      <label style="display:block;margin-bottom:10px">BUSCAR RUTA
        <input id="cem-route-filter" type="search" placeholder="Ej. AQP Arequipa a LIM Huachipa" style="display:block;width:100%;box-sizing:border-box;margin-top:5px">
      </label>
      <div id="cem-route-list" style="overflow:auto"><p class="muted">Cargando reglas…</p></div>
      <p id="cem-route-msg" class="muted" role="status"></p>
    </section>`;

  const auditBtn = container.querySelector("#cem-route-audit");
  const summary = container.querySelector("#cem-route-summary");
  const auditResults = container.querySelector("#cem-route-audit-results");
  const list = container.querySelector("#cem-route-list");
  const filter = container.querySelector("#cem-route-filter");
  const msg = container.querySelector("#cem-route-msg");
  let rules = {};
  let discrepancies = [];
  let loading = false;

  const discrepancyByKey = () => new Map(discrepancies.map(x => [key(x.descripcion_normalizada || x.descripcion), x]));
  const renderList = () => {
    const term = key(filter.value);
    const entries = Object.entries(rules)
      .filter(([name]) => !term || key(name).includes(term))
      .sort(([a], [b]) => a.localeCompare(b, "es"));
    if (!entries.length) {
      list.innerHTML = '<p class="muted">No hay rutas que coincidan con la búsqueda.</p>';
      return;
    }
    const flags = discrepancyByKey();
    list.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr><th style="text-align:left;padding:8px">RUTA SAP</th><th style="text-align:left;padding:8px">DECISIÓN</th><th style="text-align:left;padding:8px">AUDITORÍA</th><th style="text-align:left;padding:8px">ACCIÓN</th></tr></thead>
      <tbody>${entries.map(([name, accepted]) => {
        const d = flags.get(key(name));
        const decision = accepted ? "SI · ACEPTADA" : "NO · RECHAZADA";
        const status = d ? (d.motivo || "DISCREPANCIA") : "Sin discrepancia detectada";
        return `<tr style="border-top:1px solid #1e3a5f">
          <td style="padding:8px;min-width:230px">${esc(name)}</td>
          <td style="padding:8px;white-space:nowrap">${accepted ? '<span class="ok-text">SI · ACEPTADA</span>' : '<span class="muted">NO · RECHAZADA</span>'}</td>
          <td style="padding:8px;min-width:180px">${esc(status)}</td>
          <td style="padding:8px;white-space:nowrap"><button type="button" class="${accepted ? "secondary" : "primary"}" data-route-name="${esc(name)}" data-route-next="${accepted ? "false" : "true"}">${accepted ? "CAMBIAR A NO" : "CAMBIAR A SI"}</button></td>
        </tr>`;
      }).join("")}</tbody></table>`;
  };

  const loadRules = async () => {
    const data = await sapApi({ action: "reglas_rutas" });
    rules = data.reglas || {};
    renderList();
  };

  const runAudit = async () => {
    if (loading) return;
    loading = true;
    auditBtn.disabled = true;
    auditBtn.textContent = "AUDITANDO…";
    msg.textContent = "";
    try {
      const data = await sapApi({ action: "auditar_reglas_rutas" });
      discrepancies = Array.isArray(data.discrepancias) ? data.discrepancias : [];
      summary.innerHTML = `Catálogo base: <b>${esc(data.total_catalogo_base ?? "—")}</b> rutas · Reglas en Supabase: <b>${esc(data.total_reglas_bd ?? "—")}</b> · Discrepancias: <b>${esc(data.total_discrepancias ?? discrepancies.length)}</b><p class="muted">${esc(data.mensaje || "Auditoría completada; no se modificaron reglas.")}</p>`;
      if (!discrepancies.length) {
        auditResults.innerHTML = '<p class="ok-text">No se detectaron discrepancias entre las reglas persistidas y el catálogo base.</p>';
      } else {
        auditResults.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr><th style="text-align:left;padding:8px">RUTA</th><th style="text-align:left;padding:8px">DECISIÓN ACTUAL</th><th style="text-align:left;padding:8px">CATÁLOGO BASE</th><th style="text-align:left;padding:8px">MOTIVO</th></tr></thead>
          <tbody>${discrepancies.map(d => `<tr style="border-top:1px solid #1e3a5f"><td style="padding:8px">${esc(d.descripcion)}</td><td style="padding:8px">${d.usar_actual ? "SI" : "NO"}</td><td style="padding:8px">${esc(d.decision_catalogo_base)}</td><td style="padding:8px">${esc(d.motivo)}</td></tr>`).join("")}</tbody></table>
          <p class="muted">Las discrepancias son sugerencias para revisión, no cambios automáticos. Revisa el catálogo operativo antes de cambiar una regla.</p>`;
      }
      renderList();
    } catch (e) {
      auditResults.innerHTML = `<div class="error-box"><b>No se pudo ejecutar la auditoría</b><p>${esc(e.message || e)}</p><p>Si aparece “acción desconocida”, primero hay que desplegar la versión de cemento-sap que incluye el auditor.</p></div>`;
      summary.textContent = "Auditoría no completada.";
    } finally {
      loading = false;
      auditBtn.disabled = false;
      auditBtn.textContent = "EJECUTAR AUDITORÍA";
    }
  };

  const onAudit = () => runAudit();
  const onFilter = () => renderList();
  const onClick = async e => {
    const button = e.target.closest("button[data-route-name]");
    if (!button || !container.contains(button)) return;
    const name = button.dataset.routeName;
    const next = button.dataset.routeNext === "true";
    const current = Boolean(rules[name]);
    if (current === next) return;
    const verb = next ? "ACEPTAR (SI)" : "RECHAZAR (NO)";
    if (!confirm(`¿Confirmas cambiar esta regla de CEMENTO a ${verb}?\n\n${name}\n\nEsto afecta futuras validaciones; no elimina ni modifica OCs ya importadas.`)) return;
    button.disabled = true;
    msg.textContent = "Guardando decisión…";
    try {
      await sapApi({ action: "guardar_regla_ruta", descripcion: name, usar: next });
      msg.innerHTML = `<span class="ok-text">Regla actualizada: ${esc(name)} → ${next ? "SI" : "NO"}.</span>`;
      await loadRules();
      await runAudit();
    } catch (err) {
      msg.innerHTML = `<span class="error-text">${esc(err.message || err)}</span>`;
      button.disabled = false;
    }
  };
  auditBtn.addEventListener("click", onAudit);
  filter.addEventListener("input", onFilter);
  container.addEventListener("click", onClick);
  cleanup.push(() => auditBtn.removeEventListener("click", onAudit));
  cleanup.push(() => filter.removeEventListener("input", onFilter));
  cleanup.push(() => container.removeEventListener("click", onClick));

  try {
    await loadRules();
  } catch (e) {
    list.innerHTML = `<div class="error-box"><p>No se pudieron cargar las reglas.</p><p>${esc(e.message || e)}</p></div>`;
  }
}

export function unmount() {
  cleanup.forEach(fn => { try { fn(); } catch (_) {} });
  cleanup = [];
}

function key(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}
