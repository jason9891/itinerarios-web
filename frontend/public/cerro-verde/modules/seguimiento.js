/**
 * Módulo CERRO VERDE · seguimiento
 *
 * 1) Espera ≥ MIN_ROUTES_TO_OPEN unidades con puntos (o precarga terminada).
 * 2) Monta el UI clásico (mapa + columna central despacho/pernoctes) de
 *    cerro-verde-tracking.js, con adaptador al runtime modular.
 *
 * Independiente de Cemento. No importa nada de cemento/.
 */
import { esc, trackApi, apiGet, apiPost, bufferToBase64 } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  nplate,
} from "../precarga-engine.js";
import { readLegacyGPS, putLegacyGPS } from "../gps-cache.js";
import { tracking } from "../../cerro-verde-tracking.js?v=cv-mapa-modular-01";

const MIN_ROUTES_TO_OPEN = 5;
const PRECARGA_DONE = new Set([
  "COMPLETO",
  "SIN MOVIMIENTO",
  "SIN PUNTOS",
  "ERROR FINAL",
]);

let cleanup = [];
let classicUnmount = null;

export async function mount(container, runtime) {
  cleanup = [];
  classicUnmount = null;
  bindRuntime(runtime);
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento…</p></section>`;
  try {
    await bootstrap(container, runtime);
  } catch (e) {
    console.error("[cerro-verde seguimiento]", e);
    container.innerHTML = `<section class="error-box"><h2>Error en seguimiento</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  try {
    classicUnmount?.();
  } catch (_) {}
  classicUnmount = null;
  document.body.classList.remove("tracking-active");
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

async function fetchUnits() {
  const lista = await trackApi({ action: "lista" });
  const map = new Map();
  for (const p of lista.placas || []) {
    const placa = String(p.placa || p.tracto || "").trim();
    const tracto = String(p.tracto || p.placa || "").trim();
    if (!placa && !tracto) continue;
    const key = nplate(placa || tracto);
    if (!map.has(key)) {
      map.set(key, {
        placa: placa || tracto,
        tracto: tracto || placa,
        revisada: !!p.revisada,
        ocs: p.ocs ?? p.despachos_abiertos ?? 0,
      });
    }
  }
  return {
    units: [...map.values()],
    total_ocs: lista.total_ocs || 0,
    schema_ready: lista.schema_ready !== false,
  };
}

function countUnitsWithRoute(units) {
  const res = loadMeta()?.resultados || {};
  let n = 0;
  for (const u of units || []) {
    if (Number(res[nplate(u.placa)]?.puntos ?? 0) > 0) n++;
  }
  return n;
}

function allUnitsPrecargaSettled(units) {
  const res = loadMeta()?.resultados || {};
  const list = units || [];
  if (!list.length) return true;
  return list.every((u) =>
    PRECARGA_DONE.has(String(res[nplate(u.placa)]?.estado || "").toUpperCase()),
  );
}

function waitForMinRoutes(container, units, runtime) {
  return new Promise((resolve) => {
    const total = units.length;
    const paint = () => {
      const withRoute = countUnitsWithRoute(units);
      const settled = allUnitsPrecargaSettled(units);
      const meta = loadMeta();
      const c = counts(meta, total);
      const running = isRunning();
      const el = container.querySelector("#sg-load-progress");
      const sub = container.querySelector("#sg-load-sub");
      if (el) {
        el.textContent =
          settled && withRoute < MIN_ROUTES_TO_OPEN
            ? `Listo · ${withRoute} unidad(es) con ruta (menos de ${MIN_ROUTES_TO_OPEN} en total)`
            : `Esperando unidades con ruta · ${withRoute}/${MIN_ROUTES_TO_OPEN}`;
      }
      if (sub) {
        sub.textContent = running
          ? `Precarga en curso ${c.done}/${c.total || total}. El mapa se abre al tener ${MIN_ROUTES_TO_OPEN} recorridos (o al terminar todas).`
          : settled
            ? `Precarga finalizada. Abriendo con ${withRoute} recorrido(s).`
            : `Precarga en pausa o no iniciada. Con ${withRoute} ruta(s) de ${MIN_ROUTES_TO_OPEN} mínimas.`;
      }
      return { withRoute, settled, running };
    };

    let offUnit = null;
    let offProg = null;
    let timer = null;
    const cleanupWait = () => {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        offUnit?.();
      } catch (_) {}
      try {
        offProg?.();
      } catch (_) {}
      offUnit = offProg = null;
    };

    const tryOpen = () => {
      const { withRoute, settled } = paint();
      if (withRoute >= MIN_ROUTES_TO_OPEN || settled) {
        cleanupWait();
        resolve({ withRoute, openedEarly: withRoute >= MIN_ROUTES_TO_OPEN });
        return true;
      }
      return false;
    };

    container.innerHTML = `<section class="sg-boot" style="min-height:calc(100vh - 120px);display:flex;align-items:center;justify-content:center;padding:32px 16px;box-sizing:border-box">
      <div style="text-align:center;max-width:420px">
        <div class="sg-spinner" aria-hidden="true" style="width:56px;height:56px;margin:0 auto 18px;border-radius:50%;border:4px solid #1e3a5f;border-top-color:#38bdf8;animation:sg-spin .75s linear infinite"></div>
        <h2 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#e2e8f0;letter-spacing:.02em">Esperando unidades con ruta</h2>
        <p id="sg-load-progress" style="margin:0;font-size:14px;font-weight:700;color:#7dd3fc">Esperando unidades con ruta · 0/${MIN_ROUTES_TO_OPEN}</p>
        <p id="sg-load-sub" style="margin:12px 0 0;font-size:12px;line-height:1.45;color:#94a3b8">Se abrirá el mapa al precargar al menos ${MIN_ROUTES_TO_OPEN} recorridos con puntos GPS.</p>
        <style>@keyframes sg-spin{to{transform:rotate(360deg)}}</style>
      </div>
    </section>`;

    if (tryOpen()) return;

    if (runtime?.bus?.on) {
      offUnit = runtime.bus.on("cerro-verde:precarga-unit", () => tryOpen());
      offProg = runtime.bus.on("cerro-verde:precarga-progress", () => tryOpen());
    }
    timer = setInterval(() => tryOpen(), 1000);
    cleanup.push(() => cleanupWait());
  });
}

/** Adaptador del contexto legacy que espera cerro-verde-tracking.js */
function buildTrackingContext(runtime) {
  const $ = (id) => document.getElementById(id);
  const routes = {};
  const go = (route) => {
    const r = route || "home";
    document.body.classList.remove("tracking-active");
    history.replaceState(null, "", `#/${r}`);
    // delegar al main modular vía hashchange / runtime
    try {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (_) {
      location.hash = `#/${r}`;
    }
  };

  async function post(url, body, binary = false, signal) {
    return apiPost(url, body, { signal, binary: !!binary });
  }
  async function get(path) {
    return apiGet(path);
  }
  async function one(store, key) {
    if (store === "gps") return readLegacyGPS(key);
    // sap u otros no usados por tracking core
    return null;
  }
  async function put(store, key, val) {
    if (store === "gps") return putLegacyGPS(key, val);
    return null;
  }

  return {
    $,
    esc,
    END: {
      gps: API.clocator,
      track: API.track,
      sap: API.sap,
      q: API.consulta,
      report: API.reporte,
    },
    post,
    get,
    one,
    put,
    b64: bufferToBase64,
    auth,
    go,
    routes,
  };
}

async function bootstrap(container, runtime) {
  let units = [];
  try {
    const data = await fetchUnits();
    units = data.units;
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>No se pudo cargar la lista</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  if (!units.length) {
    container.innerHTML = `<section class="panel"><p class="muted">No hay unidades en el grupo SMCV activo. Actualice SAP o el grupo primero.</p></section>`;
    return;
  }

  await waitForMinRoutes(container, units, runtime);

  // UI clásico: mapa + despachos + pernoctes
  document.body.classList.add("tracking-active");
  classicUnmount = () => {
    document.body.classList.remove("tracking-active");
  };

  const ctx = buildTrackingContext(runtime);
  const runTracking = tracking(ctx);
  await runTracking();
}
