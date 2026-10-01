/**
 * Módulo CEMENTO · precarga
 * Independiente: solo habla con runtime.bus / runtime.state y cemento/api-client.
 * No importa módulos de Cerro Verde ni otros módulos de Cemento.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "/shared/clocator-client.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo precarga…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en precarga</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

async function render(container, runtime) {
  container.innerHTML =
    moduleHead("Precargar rutas", "GPS · pendientes") +
    `<section class="panel">
      <p class="muted">Precarga de Cemento. Usa el cliente CLocator compartido con el endpoint de Cemento.</p>
      <button id="cem-precarga-test" class="primary">PROBAR CLOCATOR (unidad de prueba)</button>
      <pre id="cem-precarga-out" class="muted" style="margin-top:12px;white-space:pre-wrap"></pre>
    </section>`;

  const btn = container.querySelector("#cem-precarga-test");
  const out = container.querySelector("#cem-precarga-out");
  const onClick = async () => {
    btn.disabled = true;
    out.textContent = "Consultando…";
    try {
      const token = await runtime.auth.currentUser.getIdToken();
      const data = await queryClocator({
        endpoint: API.clocator,
        token,
        placa: "AKU-861",
        tracto: "20-R-752",
        includeMap: false,
      });
      out.textContent = JSON.stringify(
        { ok: true, puntos: data?.puntos_gps?.length ?? data?.puntos ?? 0, fuente: data?.cartografia?.fuente },
        null,
        2,
      );
      runtime.bus.emit("cemento:precarga-sample", data);
    } catch (e) {
      out.textContent = "Error: " + e.message;
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", onClick);
  cleanup.push(() => btn.removeEventListener("click", onClick));
}
