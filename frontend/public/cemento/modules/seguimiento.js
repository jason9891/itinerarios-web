/**
 * Módulo CEMENTO · Seguimiento diario
 * Lista unidades/OCs abiertas tras aplicar SAP. La edición fina se migrará después.
 */
import { esc, moduleHead, trackApi } from "../api-client.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento…</p></section>`;
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
  const off = runtime.bus.on("cemento:sap-applied", () => {
    render(container, runtime).catch(() => {});
  });
  cleanup.push(off);

  let lista;
  try {
    lista = await trackApi({ action: "lista" });
  } catch (e) {
    container.innerHTML =
      moduleHead("Seguimiento diario", "OC · unidades") +
      `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  const placas = lista.placas || [];
  const revisadas = lista.revisadas ?? placas.filter((p) => p.revisada).length;

  container.innerHTML =
    moduleHead(
      "Seguimiento diario",
      `${placas.length} unidades · ${lista.total_ocs || 0} OCs abiertas · revisadas ${revisadas}`,
    ) +
    `<section class="notice">
      Las OCs nuevas/reasignadas aplicadas desde <b>Actualizar SAP</b> alimentan esta lista.
      La precarga GPS se hace en el módulo <b>Precargar rutas</b>.
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>Unidades en seguimiento</h2>
        <button type="button" id="cem-track-refresh" class="secondary">ACTUALIZAR</button>
      </div>
      ${
        !placas.length
          ? `<p class="muted">Sin OCs abiertas. Aplique un SAP con OCs nuevas.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">PLACA</th>
                <th style="text-align:left;padding:8px">TRACTO</th>
                <th style="text-align:left;padding:8px">CONDUCTOR</th>
                <th style="text-align:right;padding:8px">OCs</th>
                <th style="text-align:right;padding:8px">PEND. EDICIÓN</th>
                <th style="text-align:center;padding:8px">REVISADA</th>
              </tr></thead>
              <tbody>
                ${placas
                  .map(
                    (p) => `<tr style="border-top:1px solid #1e3a5f">
                      <td style="padding:8px"><b>${esc(p.placa)}</b></td>
                      <td style="padding:8px">${esc(p.tracto)}</td>
                      <td style="padding:8px">${esc(p.conductor)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.ocs)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.pendientes)}</td>
                      <td style="padding:8px;text-align:center">${p.revisada ? "✓" : "—"}</td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table></div>`
      }
      <p class="muted" style="margin-top:12px">Próximo: detalle por unidad, guardar cambios de OC y consolidar cierre (lógica de app.js → este módulo).</p>
    </section>`;

  const btn = container.querySelector("#cem-track-refresh");
  if (btn) {
    const onR = () => render(container, runtime).catch((e) => alert(e.message));
    btn.addEventListener("click", onR);
    cleanup.push(() => btn.removeEventListener("click", onR));
  }
}
