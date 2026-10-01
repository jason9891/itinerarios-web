/**
 * Módulo CEMENTO · sap
 * Independiente: solo habla con runtime.bus / runtime.state y cemento/api-client.
 * No importa módulos de Cerro Verde ni otros módulos de Cemento.
 */
import { apiGet, apiPost, esc, fechaPE, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "/shared/clocator-client.js";

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
    moduleHead("Actualizar SAP", "Excel temporal · solo este navegador") +
    `<section class="panel">
      <p class="muted">Módulo SAP de <b>Cemento</b>. Independiente del SAP de Cerro Verde.</p>
      <div class="admin-actions" style="margin-top:16px">
        <label class="primary" style="display:inline-block;cursor:pointer;padding:12px 18px">
          SUBIR EXCEL SAP
          <input id="cem-sap-file" type="file" accept=".xlsx,.xls" hidden>
        </label>
        <span id="cem-sap-msg" class="muted"></span>
      </div>
    </section>`;

  const input = container.querySelector("#cem-sap-file");
  const msg = container.querySelector("#cem-sap-msg");
  const onChange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    msg.textContent = "Procesando…";
    try {
      // Notifica solo a módulos de CEMENTO que se suscriban
      runtime.bus.emit("cemento:sap-updated", { fileName: file.name, at: Date.now() });
      runtime.state.set("sap.lastFile", file.name);
      msg.textContent = "Archivo recibido: " + file.name + " · evento cemento:sap-updated emitido";
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  input.addEventListener("change", onChange);
  cleanup.push(() => input.removeEventListener("change", onChange));
}
