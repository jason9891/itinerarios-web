/**
 * Módulo CERRO VERDE · sap
 * Independiente de Cemento. No importa nada de cemento/.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo sap…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en sap</h2><p>${esc(e.message)}</p></section>`;
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
    moduleHead("Actualizar SAP", "Excel temporal · Cerro Verde") +
    `<section class="panel">
      <p class="muted">Módulo SAP de <b>Cerro Verde</b>. Cambiar este archivo no toca el SAP de Cemento.</p>
      <div class="admin-actions" style="margin-top:16px">
        <label class="primary" style="display:inline-block;cursor:pointer;padding:12px 18px">
          SUBIR EXCEL SAP CV
          <input id="cv-sap-file" type="file" accept=".xlsx,.xls" hidden>
        </label>
        <span id="cv-sap-msg" class="muted"></span>
      </div>
    </section>`;

  const input = container.querySelector("#cv-sap-file");
  const msg = container.querySelector("#cv-sap-msg");
  const onChange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    msg.textContent = "Procesando…";
    try {
      runtime.bus.emit("cerro-verde:sap-updated", { fileName: file.name, at: Date.now() });
      runtime.state.set("sap.lastFile", file.name);
      msg.textContent = "Archivo recibido: " + file.name + " · evento cerro-verde:sap-updated";
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  input.addEventListener("change", onChange);
  cleanup.push(() => input.removeEventListener("change", onChange));
}
