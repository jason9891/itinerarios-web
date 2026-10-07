/**
 * Módulo CERRO VERDE · Paradas / Pernoctes faltantes de registro
 *
 * Muestra viajes Caracoto→SMCV con cambio de día y SIN pernocte registrado.
 * Mapa: consulta CLocator en ventana fija 20:00 (día salida) → 08:00 (día llegada).
 *
 * Distinción:
 *  - Registrado = evento PERNOCTE en cerro_verde_eventos_paradas (inicio/fin)
 *  - Validado   = fila en cerro_verde_pernoctes_validacion (otro módulo, más adelante)
 *
 * Independiente de Cemento.
 */
import { esc, moduleHead, apiPost } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];
let mapRuntime = { map: null, host: null, layers: [], info: null };
let mapsPromise = null;
let selectedKey = null;
let itemsCache = [];

export async function mount(container, runtime) {
  cleanup = [];
  selectedKey = null;
  itemsCache = [];
  clearMapLayers();
  container.innerHTML = `<section class="panel"><p class="muted">Cargando pernoctes sin registro…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    console.error("[cerro-verde paradas]", e);
    container.innerHTML = `<section class="error-box"><h2>Error en paradas</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  clearMapLayers();
  mapRuntime.map = null;
  mapRuntime.host = null;
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

function clearMapLayers() {
  for (const layer of mapRuntime.layers.splice(0)) {
    try {
      layer.setMap?.(null);
    } catch (_) {}
  }
  try {
    mapRuntime.info?.close();
  } catch (_) {}
}

async function loadMaps(key) {
  if (window.google?.maps) return;
  if (!key) throw new Error("Falta GOOGLE_MAPS_API_KEY");
  mapsPromise ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = ok;
    s.onerror = () => no(new Error("No se pudo cargar Google Maps"));
    document.head.append(s);
  });
  return mapsPromise;
}

async function ensureMap(host, center, zoom = 9) {
  await loadMaps((await apiPost(API.clocator, { action: "map_config" })).google_maps_api_key);
  const options = {
    center,
    zoom,
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "greedy",
  };
  if (!mapRuntime.map || mapRuntime.host !== host) {
    mapRuntime.host = host;
    mapRuntime.map = new google.maps.Map(host, options);
  } else {
    mapRuntime.map.setOptions(options);
    mapRuntime.map.setCenter(center);
    mapRuntime.map.setZoom(zoom);
  }
  return mapRuntime.map;
}

function itemKey(it) {
  return `${String(it.entrega_sap || "")}|${String(it.placa || "")}|${String(it.salida_fecha || "")}`;
}

function drawRoute(map, data) {
  clearMapLayers();
  const pts = (data?.puntos_gps || [])
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      fecha: p.fecha || null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const ultimo =
    data?.ultimo && Number.isFinite(+data.ultimo.lat) && Number.isFinite(+data.ultimo.lng)
      ? { lat: +data.ultimo.lat, lng: +data.ultimo.lng, fecha: data.ultimo.fecha || null }
      : data?.ultimo_monitoreo &&
          Number.isFinite(+data.ultimo_monitoreo.lat) &&
          Number.isFinite(+data.ultimo_monitoreo.lng)
        ? {
            lat: +data.ultimo_monitoreo.lat,
            lng: +data.ultimo_monitoreo.lng,
            fecha: data.ultimo_monitoreo.fecha || null,
          }
        : null;

  const info = (mapRuntime.info ||= new google.maps.InfoWindow());
  const bounds = new google.maps.LatLngBounds();

  if (pts.length >= 2) {
    const path = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
    path.forEach((p) => bounds.extend(p));
    const poly = new google.maps.Polyline({
      map,
      path,
      strokeColor: "#2563eb",
      strokeOpacity: 0.95,
      strokeWeight: 5,
    });
    mapRuntime.layers.push(poly);
    // last segment red
    const last3 = path.slice(-Math.min(3, path.length));
    mapRuntime.layers.push(
      new google.maps.Polyline({
        map,
        path: last3,
        strokeColor: "#dc2626",
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 400,
      }),
    );
  } else if (ultimo) {
    bounds.extend(ultimo);
    const marker = new google.maps.Marker({
      map,
      position: ultimo,
      label: { text: "U", color: "#fff", fontWeight: "700" },
      title: ultimo.fecha || "Último punto",
    });
    marker.addListener("click", () => {
      info.setContent(
        `<div style="font:12px/1.4 system-ui"><b>Último punto</b><br>${esc(ultimo.fecha || "—")}<br><button type="button" id="cv-copy-hora">Copiar hora</button></div>`,
      );
      info.open({ map, anchor: marker });
      setTimeout(() => {
        document.getElementById("cv-copy-hora")?.addEventListener("click", () => {
          const t = String(ultimo.fecha || "");
          if (t) navigator.clipboard?.writeText(t);
        });
      }, 50);
    });
    mapRuntime.layers.push(marker);
  } else {
    return { empty: true, puntos: 0 };
  }

  if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
  return { empty: false, puntos: pts.length, tiene_ultimo: !!ultimo };
}

async function fetchFaltantes() {
  return apiPost(API.report, { action: "pernoctes_sin_registro" });
}

async function loadRouteForItem(item, statusEl) {
  if (!auth.currentUser) throw new Error("No hay sesión activa");
  const token = await auth.currentUser.getIdToken(true);
  if (statusEl) statusEl.textContent = `Consultando GPS ${item.placa} · ${item.ventana_gps_desde} → ${item.ventana_gps_hasta}`;
  return queryClocator({
    endpoint: API.clocator,
    token,
    placa: item.placa,
    tracto: item.codigo_tracto,
    desde: item.ventana_gps_desde,
    hasta: item.ventana_gps_hasta,
    includeMap: false,
  });
}

function rowHtml(it, selected) {
  const key = itemKey(it);
  return `<button type="button" class="cv-pernocte-row ${selected ? "selected" : ""}" data-key="${esc(key)}">
    <div class="cv-pernocte-row-top">
      <b>${esc(it.codigo_tracto || "—")}</b>
      <span>${esc(it.placa || "—")}</span>
    </div>
    <div class="cv-pernocte-row-mid">
      <small>SALIDA CARACOTO</small>
      <span>${esc(it.salida_caracoto || "—")}</span>
      <small>LLEGADA SMCV</small>
      <span>${esc(it.llegada_smcv || "—")}</span>
    </div>
    <div class="cv-pernocte-row-bot">
      <span class="badge warn">SIN PERNOCTE REGISTRADO</span>
      <span class="muted">${esc(it.ventana_gps_desde)} → ${esc(it.ventana_gps_hasta)}</span>
    </div>
  </button>`;
}

async function render(container, runtime) {
  let data;
  try {
    data = await fetchFaltantes();
  } catch (e) {
    container.innerHTML =
      moduleHead("Paradas", "Pernoctes sin registro") +
      `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  itemsCache = data.items || [];
  const total = data.total ?? itemsCache.length;

  container.innerHTML =
    moduleHead(
      "Paradas",
      `${total} viaje(s) con cambio de día y sin pernocte registrado`,
    ) +
    `<section class="notice">
      <b>Regla:</b> salida de Caracoto y llegada a SMCV en <b>fechas distintas</b>,
      sin evento PERNOCTE registrado en histórico.
      Mismo día se excluye (aún no se evalúa pernocte).
      <br><b>Ventana GPS:</b> ${esc(data.ventana || "20:00 día salida → 08:00 día llegada")}.
      <br><span class="muted">Registrado ≠ validado. La validación de pernoctes existentes se hará en otro módulo.</span>
    </section>

    <section class="cv-paradas-layout">
      <aside class="cv-paradas-list panel">
        <div class="panel-title">
          <h2>Sin registro</h2>
          <button type="button" id="cv-paradas-refresh" class="secondary">ACTUALIZAR</button>
        </div>
        <div id="cv-paradas-rows" class="cv-paradas-rows">
          ${
            itemsCache.length
              ? itemsCache.map((it) => rowHtml(it, false)).join("")
              : `<p class="muted">No hay viajes multi-día sin pernocte registrado.</p>`
          }
        </div>
      </aside>
      <section class="cv-paradas-map panel">
        <div class="panel-title">
          <h2>Mapa del tramo nocturno</h2>
          <span id="cv-paradas-status" class="muted">Seleccione un viaje</span>
        </div>
        <div id="cv-paradas-map" class="cv-paradas-map-host">Seleccione un viaje de la lista.</div>
        <footer class="muted" style="padding:8px 10px;font-size:12px">
          AZUL: recorrido · U: último punto (0 pts en rango, desde irAMonitoreo)
        </footer>
      </section>
    </section>

    <style>
      .cv-paradas-layout{display:grid;grid-template-columns:minmax(280px,38fr) minmax(320px,62fr);gap:12px;align-items:stretch}
      .cv-paradas-rows{max-height:calc(100vh - 260px);overflow:auto;display:flex;flex-direction:column;gap:8px}
      .cv-pernocte-row{display:block;width:100%;text-align:left;border:1px solid #1e3a5f;background:#0b1d30;color:#e2e8f0;border-radius:8px;padding:10px 12px;cursor:pointer}
      .cv-pernocte-row.selected{border-color:#38bdf8;box-shadow:0 0 0 1px #38bdf8 inset}
      .cv-pernocte-row-top{display:flex;justify-content:space-between;gap:8px;font-weight:800}
      .cv-pernocte-row-mid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:8px;font-size:12px}
      .cv-pernocte-row-mid small{color:#94a3b8;font-size:10px}
      .cv-pernocte-row-bot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;font-size:11px}
      .cv-pernocte-row .badge.warn{background:#7c2d12;color:#ffedd5;border-radius:999px;padding:2px 8px;font-weight:800;font-size:10px}
      .cv-paradas-map-host{height:min(62vh,560px);min-height:320px;background:#0f172a;border-radius:8px;overflow:hidden}
      @media(max-width:900px){.cv-paradas-layout{grid-template-columns:1fr}}
    </style>`;

  const statusEl = container.querySelector("#cv-paradas-status");
  const mapHost = container.querySelector("#cv-paradas-map");
  const rowsHost = container.querySelector("#cv-paradas-rows");

  const selectItem = async (it) => {
    selectedKey = itemKey(it);
    rowsHost.querySelectorAll(".cv-pernocte-row").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.key === selectedKey);
    });
    try {
      if (statusEl) statusEl.textContent = "Cargando mapa…";
      mapHost.textContent = "Cargando recorrido…";
      // reset host for map
      mapHost.innerHTML = "";
      const map = await ensureMap(mapHost, { lat: -16.4, lng: -71.55 }, 9);
      const route = await loadRouteForItem(it, statusEl);
      const drawn = drawRoute(map, route);
      if (statusEl) {
        statusEl.textContent = drawn.empty
          ? `Sin puntos GPS en ventana · ${it.placa}`
          : `${drawn.puntos} pts · ${it.placa} · ${it.ventana_gps_desde} → ${it.ventana_gps_hasta}`;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || String(e);
      mapHost.innerHTML = `<div class="map-error" style="display:grid;place-items:center;height:100%;color:#fca5a5;padding:16px;text-align:center">${esc(e.message || e)}</div>`;
    }
  };

  rowsHost?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-key]");
    if (!btn) return;
    const it = itemsCache.find((x) => itemKey(x) === btn.dataset.key);
    if (it) selectItem(it);
  });

  container.querySelector("#cv-paradas-refresh")?.addEventListener("click", async () => {
    container.innerHTML = `<section class="panel"><p class="muted">Actualizando…</p></section>`;
    await render(container, runtime);
  });

  // auto-select first
  if (itemsCache[0]) {
    selectItem(itemsCache[0]);
  }
}
