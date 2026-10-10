import { moduleHead } from "../api-client.js";

export async function mount(container) {
  container.innerHTML = `
    ${moduleHead("Reporte", "Cierre de turno y export Excel de operaciones")}
    <section class="panel">
      <p class="muted">Scaffold listo. Siguiente: conectar snapshot CLocator + geocercas _TN + última OC + tipo acople.</p>
    </section>
  `;
}

export function unmount() {}
