/**
 * Módulo CERRO VERDE · seguimiento
 * Independiente de Cemento. No importa nada de cemento/.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

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
  const off = runtime.bus.on("cerro-verde:sap-updated", (payload) => {
    const el = container.querySelector("#mod-sap-note");
    if (el) el.textContent = "SAP CV actualizado: " + (payload?.fileName || "—");
  });
  cleanup.push(off);

  container.innerHTML =
    moduleHead('Seguimiento', 'GPS propone') +
    `<section class="panel">
      <p>Módulo <b>seguimiento</b> de <b>Cerro Verde</b>. Archivo: <code>cerro-verde/modules/seguimiento.js</code>.</p>
      <p class="muted">No comparte código ni estado con Cemento. Eventos con prefijo <code>cerro-verde:</code>.</p>
      <p id="mod-sap-note" class="muted">Esperando eventos cerro-verde:sap-updated…</p>
    </section>`;
}
