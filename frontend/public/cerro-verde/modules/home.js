/**
 * Módulo CERRO VERDE · home
 * Independiente de Cemento. No importa nada de cemento/.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "/shared/clocator-client.js";

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
  let d = {};
  try { d = await apiGet("resumen"); } catch (_) { d = {}; }
  container.innerHTML =
    moduleHead("Inicio", "Resumen y corte") +
    `<section class="metrics">
      <article><span>UNIDADES</span><strong>${d.unidades ?? "—"}</strong><small>operación</small></article>
      <article><span>CORTE</span><strong class="small-value">${esc(d.corte || "—")}</strong><small>vigente</small></article>
      <article><span>ÚLTIMA ACTIVIDAD</span><strong class="small-value">${esc(fechaPE(d.ultima_actividad))}</strong><small>GPS</small></article>
      <article><span>PRECARGA</span><strong class="small-value">${esc(d.precarga?.estado || "—")}</strong><small>estado</small></article>
    </section>
    <section class="panel">
      <div class="panel-title"><h2>Flujo Cerro Verde</h2><span class="pill">OPERATIVO</span></div>
      <p class="muted">1. Actualizar SAP · 2. Precargar · 3. Seguimiento · 4. Grupo / Paradas · 5. Reporte.</p>
    </section>`;
}
