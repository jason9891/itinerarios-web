/**
 * Módulo CERRO VERDE · precarga
 */
import { esc, moduleHead } from "../api-client.js";
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
  const desde = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
  const desdeStr = formatPE(desde);
  const hastaStr = formatPE(ahora);

  container.innerHTML =
    moduleHead("Precargar rutas", "GPS · doble intento") +
    `<section class="panel">
      <p class="muted">Prueba CLocator Cerro Verde. Rango: <b>${esc(desdeStr)}</b> → <b>${esc(hastaStr)}</b></p>
      <button id="cv-precarga-test" class="primary">PROBAR CLOCATOR CV</button>
      <pre id="cv-precarga-out" class="muted" style="margin-top:12px;white-space:pre-wrap"></pre>
    </section>`;

  const btn = container.querySelector("#cv-precarga-test");
  const out = container.querySelector("#cv-precarga-out");
  const onClick = async () => {
    btn.disabled = true;
    out.textContent = "Consultando…";
    try {
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
        { ok: true, puntos: data?.puntos_gps?.length ?? data?.puntos ?? 0, desde: desdeStr, hasta: hastaStr },
        null,
        2,
      );
    } catch (e) {
      out.textContent = "Error: " + e.message;
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", onClick);
  cleanup.push(() => btn.removeEventListener("click", onClick));
}
