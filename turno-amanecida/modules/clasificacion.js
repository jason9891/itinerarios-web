/**
 * Alias: la clasificación vive dentro de Monitoreo (mapa + lista + formulario).
 * Redirige para no fragmentar el flujo del controlador.
 */
export async function mount(container, runtime) {
  container.innerHTML = `
    <section class="panel">
      <p class="eyebrow">TURNO AMANECIDA</p>
      <h1>Clasificación</h1>
      <p class="muted">La validación se hace en la pantalla de <b>Monitoreo</b>: mapa, lista y formulario juntos (como la ventana del desktop).</p>
      <p style="margin-top:14px">
        <button type="button" class="primary" id="tn-go-mon">IR A MONITOREO</button>
      </p>
    </section>
  `;
  container.querySelector("#tn-go-mon").addEventListener("click", () => {
    document.querySelector('nav button[data-route="monitoreo"]')?.click();
  });
}

export function unmount() {}
