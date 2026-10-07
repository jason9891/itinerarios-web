import { moduleHead } from "../api-client.js";

export async function mount(container) {
  container.innerHTML = `
    ${moduleHead("Base del turno", "Snapshot filtrado 20-R- + geocercas _TN + última OC")}
    <section class="panel">
      <p class="muted">Scaffold listo. Siguiente: conectar snapshot CLocator + geocercas _TN + última OC + tipo acople.</p>
    </section>
  `;
}

export function unmount() {}
