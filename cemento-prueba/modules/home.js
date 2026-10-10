/**
 * Módulo CEMENTO · home
 * Independiente: solo habla con runtime.bus / runtime.state y cemento/api-client.
 * No importa módulos de Cerro Verde ni otros módulos de Cemento.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo home…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en home</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

async function render(container, runtime) {
  const d = await apiGet("resumen");
  container.innerHTML =
    moduleHead("Inicio", "Resumen operativo") +
    `<section class="metrics">
      <article><span>UNIDADES</span><strong>${d.unidades ?? "—"}</strong><small>con OC abierta</small></article>
      <article><span>OCs ABIERTAS</span><strong>${d.ocs_abiertas ?? "—"}</strong><small>por evaluar</small></article>
      <article><span>ÚLTIMA ACTIVIDAD</span><strong class="small-value">${esc(fechaPE(d.ultima_actividad))}</strong><small>GPS / seguimiento</small></article>
      <article><span>PRECARGA</span><strong class="small-value">${esc(d.precarga?.estado || "—")}</strong><small>${d.precarga?.completas || 0}/${d.precarga?.total_unidades || 0}</small></article>
    </section>
    <section class="panel">
      <div class="panel-title"><h2>Flujo recomendado</h2><span class="pill">OPERATIVO</span></div>
      <p class="muted">1. Actualizar SAP · 2. Precargar rutas · 3. Seguimiento · 4. Crear reporte.</p>
    </section>`;
}
