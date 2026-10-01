/**
 * Módulo CEMENTO · seguimiento
 * Independiente: solo habla con runtime.bus / runtime.state y cemento/api-client.
 * No importa módulos de Cerro Verde ni otros módulos de Cemento.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "/shared/clocator-client.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo seguimiento…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en seguimiento</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

async function render(container, runtime) {
  // Escucha ejemplo: si SAP de Cemento emite, este módulo puede reaccionar
  // sin conocer el código interno de SAP.
  const off = runtime.bus.on("cemento:sap-updated", (payload) => {
    const el = container.querySelector("#mod-sap-note");
    if (el) el.textContent = "SAP actualizado: " + (payload?.fileName || "—");
  });
  cleanup.push(off);

  container.innerHTML =
    moduleHead('Seguimiento diario', 'OC · unidades') +
    `<section class="panel">
      <p>Módulo <b>seguimiento</b> de <b>Cemento</b>. Archivo propio: <code>cemento/modules/seguimiento.js</code>.</p>
      <p class="muted">Modificar este archivo no afecta a Cerro Verde ni a otros módulos de Cemento, salvo que ellos escuchen eventos del bus.</p>
      <p id="mod-sap-note" class="muted">Esperando eventos cemento:sap-updated…</p>
      <p class="muted">La lógica de negocio completa se migrará aquí desde app.js sin tocar otros itinerarios.</p>
    </section>`;
}
