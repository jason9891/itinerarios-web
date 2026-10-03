/**
 * Módulo CEMENTO · Precarga
 * Lista placas con OC abierta (pendientes) y permite probar / precargar vía CLocator.
 */
import { esc, moduleHead, trackApi } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];

function formatPE(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando precarga…</p></section>`;
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
  // Escuchar aplicación SAP para refrescar lista
  const off = runtime.bus.on("cemento:sap-applied", () => {
    render(container, runtime).catch(() => {});
  });
  cleanup.push(off);

  let lista = { placas: [], total_ocs: 0 };
  try {
    lista = await trackApi({ action: "lista" });
  } catch (e) {
    // Si falla, mostramos el error pero dejamos UI
    container.innerHTML =
      moduleHead("Precargar rutas", "GPS · pendientes") +
      `<section class="error-box"><h2>No se pudo cargar la lista</h2><p>${esc(e.message)}</p>
       <p class="muted">Aplique un SAP primero o verifique permisos de seguimiento.</p></section>`;
    return;
  }

  const placas = lista.placas || [];
  const lastApply = runtime.state.get("sap.lastApply");

  container.innerHTML =
    moduleHead(
      "Precargar rutas",
      `${placas.length} unidades con OC abierta · ${lista.total_ocs || 0} OCs`,
    ) +
    `<section class="notice">
      Todas las placas con OC pendiente (abierta en Seguimiento Diario) aparecen aquí para precarga GPS.
      ${lastApply ? `<br><small>Último SAP aplicado: ${esc(String(lastApply.agregadas_diario))} OCs al diario.</small>` : ""}
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>Unidades pendientes de precarga</h2>
        <button type="button" id="cem-precarga-refresh" class="secondary">ACTUALIZAR LISTA</button>
      </div>
      ${
        !placas.length
          ? `<p class="muted">No hay placas con OC abierta. Suba y aplique un SAP con OCs nuevas.</p>`
          : `<div style="overflow:auto"><table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">PLACA</th>
                <th style="text-align:left;padding:8px">TRACTO</th>
                <th style="text-align:left;padding:8px">CONDUCTOR</th>
                <th style="text-align:right;padding:8px">OCs</th>
                <th style="text-align:right;padding:8px">PEND.</th>
                <th style="text-align:left;padding:8px">ACCIÓN</th>
              </tr></thead>
              <tbody>
                ${placas
                  .map(
                    (p, i) => `<tr style="border-top:1px solid #1e3a5f">
                      <td style="padding:8px"><b>${esc(p.placa)}</b></td>
                      <td style="padding:8px">${esc(p.tracto)}</td>
                      <td style="padding:8px">${esc(p.conductor)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.ocs)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.pendientes)}</td>
                      <td style="padding:8px">
                        <button type="button" class="secondary cem-preload-one" data-i="${i}">PROBAR GPS</button>
                      </td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table></div>`
      }
      <pre id="cem-precarga-out" class="muted" style="margin-top:12px;white-space:pre-wrap"></pre>
    </section>`;

  const refresh = container.querySelector("#cem-precarga-refresh");
  if (refresh) {
    const onR = () => render(container, runtime).catch((e) => alert(e.message));
    refresh.addEventListener("click", onR);
    cleanup.push(() => refresh.removeEventListener("click", onR));
  }

  const out = container.querySelector("#cem-precarga-out");
  container.querySelectorAll(".cem-preload-one").forEach((btn) => {
    const onClick = async () => {
      const p = placas[Number(btn.dataset.i)];
      if (!p) return;
      btn.disabled = true;
      out.textContent = `Consultando CLocator · ${p.placa}…`;
      try {
        const token = await runtime.auth.currentUser.getIdToken(true);
        // Corte: últimas 12 h por defecto (el corte operativo fino se migra después)
        const hasta = new Date();
        const desde = new Date(hasta.getTime() - 12 * 60 * 60 * 1000);
        const data = await queryClocator({
          endpoint: API.clocator,
          token,
          placa: p.placa,
          tracto: p.tracto,
          desde: formatPE(desde),
          hasta: formatPE(hasta),
          includeMap: false,
        });
        const puntos = data?.puntos_gps?.length ?? data?.puntos ?? 0;
        out.textContent = JSON.stringify(
          { ok: true, placa: p.placa, tracto: p.tracto, puntos, fuente: data?.cartografia?.fuente },
          null,
          2,
        );
        runtime.bus.emit("cemento:precarga-unit", { placa: p.placa, puntos });
      } catch (e) {
        out.textContent = "Error: " + e.message;
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener("click", onClick);
    cleanup.push(() => btn.removeEventListener("click", onClick));
  });
}
