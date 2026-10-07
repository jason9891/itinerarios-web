/**
 * Módulo CERRO VERDE · crear reporte
 *
 * Misma lógica operativa que reportV3 (cerro-verde-tracking.js):
 *   - estado del seguimiento / habilitación de descarga
 *   - resumen CAL VACÍO / CAL CARGADO / pernoctes
 *   - edición y guardado de CONVOY (10 posiciones)
 *   - DESCARGAR EXCEL (action: excel) del edge cerro-verde-reporte
 *
 * Independiente de Cemento.
 */
import { esc, apiGet, apiPost, bufferToBase64 } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { reportV3 } from "../../cerro-verde-tracking.js?v=cv-report-01";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  // reportV3 escribe en #content (host modular)
  container.innerHTML = `<section class="panel"><p class="muted">Cargando reporte operativo…</p></section>`;
  try {
    const ctx = buildContext(runtime);
    await reportV3(ctx)();
  } catch (e) {
    console.error("[cerro-verde reporte]", e);
    container.innerHTML = `<section class="error-box"><h2>Error en reporte</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

function buildContext(runtime) {
  const $ = (id) => document.getElementById(id);
  const go = (route) => {
    const r = route || "home";
    history.replaceState(null, "", `#/${r}`);
    try {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (_) {
      location.hash = `#/${r}`;
    }
  };

  /**
   * Firma legacy: post(url, body, binary=false, signal)
   * reportV3 usa post(END.report, {action:"excel"}, true) para el Excel.
   */
  async function post(url, body, binary = false, signal) {
    return apiPost(url, body, { signal, binary: !!binary });
  }

  async function get(path) {
    return apiGet(path);
  }

  return {
    $,
    esc,
    END: {
      gps: API.clocator,
      track: API.track,
      sap: API.sap,
      q: API.consulta,
      report: API.report,
    },
    post,
    get,
    one: async () => null,
    put: async () => null,
    b64: bufferToBase64,
    auth,
    go,
    routes: {},
  };
}
