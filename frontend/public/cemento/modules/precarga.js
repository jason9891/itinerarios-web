/**
 * Módulo CEMENTO · precarga
 * Independiente: solo habla con runtime.bus / runtime.state y cemento/api-client.
 */
import { esc, moduleHead } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];

/** Formato exigido por cemento-clocator: DD/MM/YYYY HH:mm:ss (America/Lima) */
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
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 6 * 60 * 60 * 1000); // últimas 6 horas
  const desdeStr = formatPE(desde);
  const hastaStr = formatPE(ahora);

  container.innerHTML =
    moduleHead("Precargar rutas", "GPS · pendientes") +
    `<section class="panel">
      <p class="muted">Prueba del cliente CLocator compartido (endpoint Cemento).</p>
      <p class="muted">Rango de prueba: <b>${esc(desdeStr)}</b> → <b>${esc(hastaStr)}</b> (hora Lima)</p>
      <button id="cem-precarga-test" class="primary">PROBAR CLOCATOR (unidad de prueba)</button>
      <pre id="cem-precarga-out" class="muted" style="margin-top:12px;white-space:pre-wrap"></pre>
    </section>`;

  const btn = container.querySelector("#cem-precarga-test");
  const out = container.querySelector("#cem-precarga-out");
  const onClick = async () => {
    btn.disabled = true;
    out.textContent = "Consultando CLocator…";
    try {
      if (!runtime.auth?.currentUser) throw new Error("No hay sesión activa");
      const token = await runtime.auth.currentUser.getIdToken(true);
      const data = await queryClocator({
        endpoint: API.clocator,
        token,
        placa: "AKU-861",
        tracto: "20-R-752",
        desde: desdeStr,
        hasta: hastaStr,
        includeMap: false,
      });
      out.textContent = JSON.stringify(
        {
          ok: true,
          puntos: data?.puntos_gps?.length ?? data?.puntos ?? 0,
          fuente: data?.cartografia?.fuente,
          desde: desdeStr,
          hasta: hastaStr,
        },
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
