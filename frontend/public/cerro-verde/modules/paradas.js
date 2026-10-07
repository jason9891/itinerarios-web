/**
 * Módulo CERRO VERDE · Paradas / Pernoctes sin registro
 *
 * - Lista viajes multi-día Caracoto→SMCV sin evento PERNOCTE
 * - Mapa CLocator (ventana 20:00→08:00) + marcadores P de candidatos
 * - VER HORAS (misma lógica que seguimiento)
 * - Panel para registrar pernocte (lugar + inicio/fin)
 */
import { esc, moduleHead, apiPost } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { queryClocator } from "../../shared/clocator-client.js";

let cleanup = [];
let mapRuntime = {
  map: null,
  host: null,
  layers: [],
  inspection: [],
  stopMarkers: new Map(),
  info: null,
  routeInfo: null,
  hoursOn: false,
};
let mapsPromise = null;
let selectedKey = null;
let itemsCache = [];
let currentItem = null;
let currentRoute = null;
let selectedStop = null;

export async function mount(container, runtime) {
  cleanup = [];
  selectedKey = null;
  itemsCache = [];
  currentItem = null;
  currentRoute = null;
  selectedStop = null;
  clearAllMap();
  container.innerHTML = `<section class="panel"><p class="muted">Cargando pernoctes sin registro…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    console.error("[cerro-verde paradas]", e);
    container.innerHTML = `<section class="error-box"><h2>Error en paradas</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  clearAllMap();
  mapRuntime.map = null;
  mapRuntime.host = null;
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

function clearAllMap() {
  for (const layer of mapRuntime.layers.splice(0)) {
    try {
      layer.setMap?.(null);
    } catch (_) {}
  }
  for (const m of mapRuntime.inspection.splice(0)) {
    try {
      m.setMap?.(null);
    } catch (_) {}
  }
  mapRuntime.stopMarkers?.clear?.();
  try {
    mapRuntime.info?.close();
  } catch (_) {}
  try {
    mapRuntime.routeInfo?.close();
  } catch (_) {}
  mapRuntime.hoursOn = false;
}

function formatDur(min) {
  const n = Number(min || 0);
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return `${h} h ${String(m).padStart(2, "0")} min`;
  }
  return `${n.toFixed(1)} min`;
}

function parseAny(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function markerIcon(color, scale = 11) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 1.5,
    scale,
  };
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
  await loadMaps(
    (await apiPost(API.clocator, { action: "map_config" })).google_maps_api_key,
  );
  const options = {
    center,
    zoom,
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "greedy",
  };
  // Una sola instancia por sesión del módulo: solo se recrea si cambió el host DOM.
  if (!mapRuntime.map || mapRuntime.host !== host) {
    mapRuntime.host = host;
    mapRuntime.map = new google.maps.Map(host, options);
  } else {
    // Host intacto: no recrear el Map; el tramo se redibuja con clear + layers.
    mapRuntime.map.setOptions(options);
  }
  return mapRuntime.map;
}

function itemKey(it) {
  return `${String(it.entrega_sap || "")}|${String(it.placa || "")}|${String(it.salida_fecha || "")}`;
}

function normalizePts(data) {
  return (data?.puntos_gps || [])
    .map((p, index) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      fecha: p.fecha || null,
      index,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function drawRoute(map, data, onStop) {
  clearAllMap();
  const pts = normalizePts(data);
  const info = (mapRuntime.info ||= new google.maps.InfoWindow());
  const bounds = new google.maps.LatLngBounds();

  const ultimo =
    data?.ultimo && Number.isFinite(+data.ultimo.lat)
      ? { lat: +data.ultimo.lat, lng: +data.ultimo.lng, fecha: data.ultimo.fecha || null }
      : data?.ultimo_monitoreo && Number.isFinite(+data.ultimo_monitoreo.lat)
        ? {
            lat: +data.ultimo_monitoreo.lat,
            lng: +data.ultimo_monitoreo.lng,
            fecha: data.ultimo_monitoreo.fecha || null,
          }
        : null;

  if (pts.length >= 2) {
    const path = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
    path.forEach((p) => bounds.extend(p));
    const arrow = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 3.5,
      strokeColor: "#7c3aed",
      strokeWeight: 2,
      fillColor: "#7c3aed",
      fillOpacity: 1,
    };
    mapRuntime.layers.push(
      new google.maps.Polyline({
        map,
        path,
        strokeColor: "#2563eb",
        strokeOpacity: 0.95,
        strokeWeight: 5,
        icons: [
          { icon: arrow, offset: "40px", repeat: "110px" },
          { icon: arrow, offset: "100%" },
        ],
      }),
    );
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
    [
      { p: pts[0], text: "I", color: "#16a34a", title: `INICIO · ${pts[0].fecha || "-"}` },
      {
        p: pts.at(-1),
        text: "F",
        color: "#2563eb",
        title: `FIN · ${pts.at(-1).fecha || "-"}`,
      },
    ].forEach((x) => {
      mapRuntime.layers.push(
        new google.maps.Marker({
          map,
          position: x.p,
          title: x.title,
          label: { text: x.text, color: "#fff", fontSize: "11px", fontWeight: "700" },
          icon: markerIcon(x.color, 11),
          zIndex: 220,
        }),
      );
    });
  } else if (ultimo) {
    bounds.extend(ultimo);
    mapRuntime.layers.push(
      new google.maps.Marker({
        map,
        position: ultimo,
        label: { text: "U", color: "#fff", fontSize: "11px", fontWeight: "700" },
        title: `ÚLTIMA POSICIÓN · ${ultimo.fecha || ""}`,
        icon: markerIcon("#111827", 11),
        zIndex: 450,
      }),
    );
  }

  // Marcadores P — paradas candidatas (pernocte rojo / pausa amarillo)
  const stopMarkers = new Map();
  mapRuntime.stopMarkers = stopMarkers;
  const candidates = data?.analisis?.paradas_candidatas || [];
  for (const p of candidates) {
    const pos = { lat: +p.lat, lng: +p.lng };
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;
    const isP = String(p.tipo).toUpperCase() === "PERNOCTE";
    const m = new google.maps.Marker({
      map,
      position: pos,
      title: isP ? "POSIBLE PERNOCTE" : "POSIBLE PAUSA ACTIVA",
      label: {
        text: "P",
        color: isP ? "#fff" : "#713f12",
        fontSize: "11px",
        fontWeight: "800",
      },
      icon: markerIcon(isP ? "#dc2626" : "#facc15", 11),
      zIndex: isP ? 520 : 510,
    });
    m.addListener("click", () => {
      info.setContent(
        `<div style="font-family:Segoe UI,Arial;font-size:12px"><b>${
          isP ? "POSIBLE PERNOCTE" : "POSIBLE PAUSA ACTIVA"
        }</b><br>Inicio: ${esc(p.inicio)}<br>Fin: ${esc(p.fin)}<br>Duración: ${esc(
          formatDur(p.duracion_min),
        )}<br>Zona: ${esc(p.geocerca || "FUERA DE GEOCERCA")}</div>`,
      );
      info.open({ map, anchor: m });
      map.panTo(pos);
      if ((map.getZoom() || 0) < 16) map.setZoom(16);
      onStop?.(p);
    });
    mapRuntime.layers.push(m);
    stopMarkers.set(p.id || `${p.inicio}|${p.fin}`, m);
  }

  if (!bounds.isEmpty()) map.fitBounds(bounds, 48);

  // VER HORAS — puntos de inspección
  setupHoursTool(map, pts);

  return {
    empty: pts.length < 2 && !ultimo,
    puntos: pts.length,
    candidatos: candidates.filter((x) => String(x.tipo).toUpperCase() === "PERNOCTE"),
    todosCandidatos: candidates,
  };
}

function setupHoursTool(map, pts) {
  const distanceMeters = (a, b) => {
    const R = 6371000,
      rad = Math.PI / 180;
    const dLat = (+b.lat - +a.lat) * rad,
      dLon = (+b.lng - +a.lng) * rad;
    const lat1 = +a.lat * rad,
      lat2 = +b.lat * rad;
    const q =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  };

  const groupNearbyPasses = (clickPosition) => {
    const near = pts
      .map((p) => ({ ...p, distance: distanceMeters(clickPosition, p) }))
      .filter((p) => p.distance <= 22 && p.fecha)
      .sort((a, b) => a.index - b.index);
    if (!near.length) return [];
    const groups = [];
    let current = [];
    for (const p of near) {
      if (!current.length) {
        current.push(p);
        continue;
      }
      const prev = current[current.length - 1];
      const t1 = parseAny(prev.fecha),
        t2 = parseAny(p.fecha);
      const newPass =
        Number.isFinite(t1) && Number.isFinite(t2)
          ? Math.abs(t2 - t1) / 60000 > 10
          : p.index - prev.index > 20;
      if (newPass) {
        groups.push(current);
        current = [p];
      } else current.push(p);
    }
    if (current.length) groups.push(current);
    return groups.map((group) => ({
      closest: group.reduce(
        (best, item) => (!best || item.distance < best.distance ? item : best),
        null,
      ),
      first: group[0],
      last: group[group.length - 1],
    }));
  };

  const showRouteTime = (clickPosition) => {
    if (!pts.length) return;
    map.panTo(clickPosition);
    if (!Number.isFinite(map.getZoom()) || map.getZoom() < 16) map.setZoom(16);
    const passes = groupNearbyPasses(clickPosition);
    if (!passes.length) return;
    const rows = passes
      .map((pass, index) => {
        const value = esc(pass.closest.fecha || "");
        const range =
          pass.first.fecha !== pass.last.fecha
            ? `<div style="color:#64748B;font-size:10px;margin-top:4px">PASADA ${index + 1} · ${esc(pass.first.fecha)} → ${esc(pass.last.fecha)}</div>`
            : passes.length > 1
              ? `<div style="color:#64748B;font-size:10px;margin-top:4px">PASADA ${index + 1}</div>`
              : "";
        return `<div style="${index ? "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;" : ""}"><button type="button" data-copy-time="${value}" style="border:0;background:#EEF4FF;color:#174589;font-family:Segoe UI,Arial,sans-serif;font-size:12px;font-weight:700;padding:6px 10px;border-radius:6px;cursor:pointer">${value || "—"}</button>${range}</div>`;
      })
      .join("");
    const routeInfo = (mapRuntime.routeInfo ||= new google.maps.InfoWindow());
    routeInfo.setContent(
      `<div style="font-family:Segoe UI,Arial;min-width:160px;max-width:260px"><b style="font-size:11px;color:#64748b">HORA EN PUNTO</b>${rows}<div style="margin-top:8px;font-size:10px;color:#94a3b8">Clic en la hora para copiar</div></div>`,
    );
    routeInfo.setPosition(clickPosition);
    routeInfo.open(map);
    google.maps.event.addListenerOnce(routeInfo, "domready", () => {
      document.querySelectorAll("[data-copy-time]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const v = btn.getAttribute("data-copy-time") || "";
          if (v) navigator.clipboard?.writeText(v);
        });
      });
    });
  };

  // clear previous inspection
  for (const m of mapRuntime.inspection.splice(0)) {
    try {
      m.setMap?.(null);
    } catch (_) {}
  }

  const paintInspection = (on) => {
    for (const m of mapRuntime.inspection.splice(0)) {
      try {
        m.setMap?.(null);
      } catch (_) {}
    }
    if (!on || !pts.length) return;
    // subsample if too many points
    const step = pts.length > 400 ? Math.ceil(pts.length / 400) : 1;
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const m = new google.maps.Marker({
        map,
        position: p,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 3.2,
          fillColor: "#0ea5e9",
          fillOpacity: 0.85,
          strokeWeight: 0,
        },
        zIndex: 300,
        title: p.fecha || "",
      });
      m.addListener("click", () => showRouteTime(p));
      mapRuntime.inspection.push(m);
    }
  };

  mapRuntime._paintInspection = paintInspection;
  mapRuntime._showRouteTime = showRouteTime;

  // map click when hours on
  if (mapRuntime._hoursClick) {
    try {
      google.maps.event.removeListener(mapRuntime._hoursClick);
    } catch (_) {}
  }
  mapRuntime._hoursClick = map.addListener("click", (e) => {
    if (!mapRuntime.hoursOn) return;
    showRouteTime({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  });
}

function toggleHours(btn) {
  mapRuntime.hoursOn = !mapRuntime.hoursOn;
  if (btn) {
    btn.classList.toggle("active", mapRuntime.hoursOn);
    btn.textContent = mapRuntime.hoursOn ? "OCULTAR HORAS" : "VER HORAS";
  }
  mapRuntime._paintInspection?.(mapRuntime.hoursOn);
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

function candidatesHtml(list) {
  if (!list?.length) {
    return `<p class="muted">Sin candidatos PERNOCTE en el análisis de la ventana. Puede completar inicio/fin manualmente.</p>`;
  }
  return list
    .map((p, i) => {
      const id = p.id || `c${i}`;
      return `<button type="button" class="candidate red" data-stop-id="${esc(id)}">
        <b>POSIBLE PERNOCTE</b>
        <span>${esc(p.inicio)} → ${esc(p.fin)}</span>
        <strong>${esc(formatDur(p.duracion_min))} · ${esc(p.geocerca || "FUERA DE GEOCERCA")}</strong>
      </button>`;
    })
    .join("");
}

function fillFormFromStop(form, stop) {
  if (!form || !stop) return;
  form.querySelector('[name="inicio"]').value = stop.inicio || "";
  form.querySelector('[name="fin"]').value = stop.fin || "";
  form.querySelector('[name="geocerca"]').value = stop.geocerca || "";
  form.querySelector('[name="descripcion"]').value =
    stop.motivo || stop.descripcion || "";
  form.querySelector('[name="lat"]').value = stop.lat ?? "";
  form.querySelector('[name="lng"]').value = stop.lng ?? "";
  const dur = form.querySelector("#cv-paradas-dur");
  if (dur) dur.textContent = formatDur(stop.duracion_min);
}

async function fetchFaltantes() {
  return apiPost(API.report, { action: "pernoctes_sin_registro" });
}

async function loadRouteForItem(item) {
  if (!auth.currentUser) throw new Error("No hay sesión activa");
  const token = await auth.currentUser.getIdToken(true);
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

async function registerPernocte(item, form) {
  const fd = new FormData(form);
  const inicio = String(fd.get("inicio") || "").trim();
  const fin = String(fd.get("fin") || "").trim();
  const geocerca = String(fd.get("geocerca") || "").trim();
  const descripcion = String(fd.get("descripcion") || "").trim();
  const lat = Number(fd.get("lat"));
  const lng = Number(fd.get("lng"));
  const t0 = parseAny(inicio);
  const t1 = parseAny(fin);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    throw new Error("Indique inicio y fin válidos del pernocte");
  }
  const duracion_min = (t1 - t0) / 60000;
  if (!(duracion_min > 240)) throw new Error("El pernocte debe ser mayor a 4 horas");
  if (
    new Date(t0).toISOString().slice(0, 10) ===
    new Date(t1).toISOString().slice(0, 10)
  ) {
    throw new Error("El pernocte debe cambiar de fecha");
  }
  if (!geocerca) throw new Error("Indique el lugar / zona de pernocte");

  return apiPost(API.report, {
    action: "pernocte_registrar",
    entrega_sap: item.entrega_sap,
    placa: item.placa,
    codigo_tracto: item.codigo_tracto,
    conductor: item.conductor,
    fecha_carga: item.fecha_carga,
    parada: {
      tipo: "PERNOCTE",
      inicio,
      fin,
      duracion_min,
      geocerca,
      descripcion,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    },
  });
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
      `${total} viaje(s) multi-día sin pernocte registrado`,
    ) +
    `<section class="notice">
      <b>Regla:</b> Caracoto→SMCV en fechas distintas y <b>sin evento PERNOCTE registrado</b>.
      Ventana GPS: ${esc(data.ventana || "20:00 → 08:00")}.
      Marcadores <b>P</b> = candidatos del análisis · use el formulario para registrar el lugar.
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

      <section class="cv-paradas-main">
        <div class="panel cv-paradas-map-panel">
          <div class="panel-title">
            <h2>Mapa del tramo nocturno</h2>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" id="cv-paradas-hours" class="secondary">VER HORAS</button>
              <span id="cv-paradas-status" class="muted">Seleccione un viaje</span>
            </div>
          </div>
          <div class="map-wrap">
            <div id="cv-paradas-map" class="cv-paradas-map-host">Seleccione un viaje de la lista.</div>
          </div>
          <footer class="muted" style="padding:8px 10px;font-size:12px">
            AZUL: recorrido · ROJO: últimos puntos · P: candidato · U: último sin tramo · VER HORAS: puntos clicables
          </footer>
        </div>

        <div class="panel cv-paradas-form-panel">
          <div class="panel-title"><h2>Registrar pernocte</h2></div>
          <div id="cv-paradas-candidates" class="candidate-list">
            <p class="muted">Seleccione un viaje para ver candidatos GPS.</p>
          </div>
          <form id="cv-paradas-form" class="cv-paradas-form">
            <label><span>INICIO</span><input name="inicio" type="text" placeholder="dd/mm/yyyy hh:mm:ss" required></label>
            <label><span>FIN</span><input name="fin" type="text" placeholder="dd/mm/yyyy hh:mm:ss" required></label>
            <label class="full"><span>LUGAR / ZONA DE PERNOCTE</span>
              <input name="geocerca" type="text" list="cv-zonas-pernocte" placeholder="Ej. AREQUIPA, PLANTA YURA, RACIEMSA…" required>
            </label>
            <label class="full"><span>OBSERVACIÓN</span>
              <input name="descripcion" type="text" placeholder="Detalle opcional">
            </label>
            <input type="hidden" name="lat"><input type="hidden" name="lng">
            <div class="cv-paradas-form-actions">
              <span id="cv-paradas-dur" class="muted">Duración: —</span>
              <button type="submit" class="primary" id="cv-paradas-save">REGISTRAR PERNOCTE</button>
            </div>
            <p id="cv-paradas-form-msg" class="muted"></p>
          </form>
          <datalist id="cv-zonas-pernocte">
            <option value="AREQUIPA"></option>
            <option value="RACIEMSA"></option>
            <option value="PLANTA YURA"></option>
            <option value="YURA"></option>
            <option value="CARACOTO"></option>
            <option value="FUERA DE GEOCERCA"></option>
          </datalist>
        </div>
      </section>
    </section>

    <style>
      .cv-paradas-layout{display:grid;grid-template-columns:minmax(260px,32fr) minmax(360px,68fr);gap:12px;align-items:start}
      .cv-paradas-main{display:flex;flex-direction:column;gap:12px;min-width:0}
      .cv-paradas-rows{max-height:calc(100vh - 260px);overflow:auto;display:flex;flex-direction:column;gap:8px}
      .cv-pernocte-row{display:block;width:100%;text-align:left;border:1px solid #1e3a5f;background:#0b1d30;color:#e2e8f0;border-radius:8px;padding:10px 12px;cursor:pointer}
      .cv-pernocte-row.selected{border-color:#38bdf8;box-shadow:0 0 0 1px #38bdf8 inset}
      .cv-pernocte-row-top{display:flex;justify-content:space-between;gap:8px;font-weight:800}
      .cv-pernocte-row-mid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:8px;font-size:12px}
      .cv-pernocte-row-mid small{color:#94a3b8;font-size:10px}
      .cv-pernocte-row-bot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;font-size:11px}
      .badge.warn{background:#7c2d12;color:#ffedd5;border-radius:999px;padding:2px 8px;font-weight:800;font-size:10px}
      .cv-paradas-map-host{height:min(48vh,420px);min-height:280px;background:#0f172a;border-radius:8px;overflow:hidden}
      .map-wrap{position:relative}
      #cv-paradas-hours.active{background:#0ea5e9;color:#0b1d30;border-color:#38bdf8}
      .candidate-list{display:grid;gap:8px;margin-bottom:12px}
      .candidate{display:grid;width:100%;gap:4px;border-radius:8px;padding:10px 12px;text-align:left;font:inherit;cursor:pointer;border:1px solid #ef4444;background:#fff1f2;color:#991b1b}
      .candidate.selected{outline:3px solid rgba(220,38,38,.35)}
      .candidate b,.candidate span,.candidate strong{display:block;font-size:12px;line-height:1.35}
      .cv-paradas-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .cv-paradas-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:#94a3b8}
      .cv-paradas-form label.full{grid-column:1/-1}
      .cv-paradas-form input{border:1px solid #1e3a5f;background:#071525;color:#e2e8f0;border-radius:6px;padding:8px 10px;font-size:13px}
      .cv-paradas-form-actions{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:4px}
      @media(max-width:960px){.cv-paradas-layout{grid-template-columns:1fr}.cv-paradas-form{grid-template-columns:1fr}}
    </style>`;

  const statusEl = container.querySelector("#cv-paradas-status");
  const mapHost = container.querySelector("#cv-paradas-map");
  const rowsHost = container.querySelector("#cv-paradas-rows");
  const candHost = container.querySelector("#cv-paradas-candidates");
  const form = container.querySelector("#cv-paradas-form");
  const formMsg = container.querySelector("#cv-paradas-form-msg");
  const hoursBtn = container.querySelector("#cv-paradas-hours");

  hoursBtn?.addEventListener("click", () => toggleHours(hoursBtn));

  const selectStop = (stop) => {
    selectedStop = stop;
    fillFormFromStop(form, stop);
    candHost?.querySelectorAll(".candidate").forEach((btn) => {
      const id = stop?.id || `${stop?.inicio}|${stop?.fin}`;
      btn.classList.toggle("selected", btn.dataset.stopId === String(id));
    });
    // bounce marker
    const m = mapRuntime.stopMarkers?.get(stop?.id || `${stop?.inicio}|${stop?.fin}`);
    if (m && mapRuntime.map) {
      const pos = m.getPosition?.();
      if (pos) {
        mapRuntime.map.panTo(pos);
        if ((mapRuntime.map.getZoom() || 0) < 16) mapRuntime.map.setZoom(16);
      }
      try {
        m.setAnimation?.(google.maps.Animation.BOUNCE);
        setTimeout(() => {
          try {
            m.setAnimation?.(null);
          } catch (_) {}
        }, 650);
      } catch (_) {}
    }
  };

  const selectItem = async (it) => {
    selectedKey = itemKey(it);
    currentItem = it;
    selectedStop = null;
    rowsHost.querySelectorAll(".cv-pernocte-row").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.key === selectedKey);
    });
    form?.reset();
    if (formMsg) formMsg.textContent = "";
    if (candHost)
      candHost.innerHTML = `<p class="muted">Consultando GPS…</p>`;
    try {
      if (statusEl)
        statusEl.textContent = `Consultando ${it.placa} · ${it.ventana_gps_desde} → ${it.ventana_gps_hasta}`;
      // Mapa persistente: no destruir el host ni el Map de Google
      // (solo se limpian capas al redibujar el tramo).
      if (mapHost.dataset.placeholder !== "0") {
        mapHost.textContent = "";
        mapHost.dataset.placeholder = "0";
      }
      const map = await ensureMap(mapHost, { lat: -16.4, lng: -71.55 }, 9);
      // reset hours UI (capas de inspección se limpian en drawRoute)
      mapRuntime.hoursOn = false;
      if (hoursBtn) {
        hoursBtn.classList.remove("active");
        hoursBtn.textContent = "VER HORAS";
      }
      const route = await loadRouteForItem(it);
      currentRoute = route;
      const drawn = drawRoute(map, route, (stop) => selectStop(stop));
      const pernoctes =
        drawn.candidatos?.length
          ? drawn.candidatos
          : (route?.analisis?.paradas_candidatas || []).filter(
              (x) => String(x.tipo).toUpperCase() === "PERNOCTE",
            );
      if (candHost) {
        candHost.innerHTML = candidatesHtml(pernoctes);
        candHost.querySelectorAll("[data-stop-id]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const stop = pernoctes.find(
              (p, i) => String(p.id || `c${i}`) === btn.dataset.stopId,
            );
            if (stop) selectStop(stop);
          });
        });
      }
      if (pernoctes[0]) selectStop(pernoctes[0]);
      if (statusEl) {
        statusEl.textContent = drawn.empty
          ? `Sin puntos en ventana · ${it.placa}`
          : `${drawn.puntos} pts · ${pernoctes.length} candidato(s) P · ${it.placa}`;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || String(e);
      // No reemplazar el host del mapa: solo capas + mensaje de estado
      clearAllMap();
      if (candHost)
        candHost.innerHTML = `<p class="muted">No se pudo cargar el análisis GPS.</p>`;
    }
  };

  rowsHost?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-key]");
    if (!btn) return;
    const it = itemsCache.find((x) => itemKey(x) === btn.dataset.key);
    if (it) selectItem(it);
  });

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!currentItem) {
      if (formMsg) formMsg.textContent = "Seleccione un viaje de la lista.";
      return;
    }
    const saveBtn = form.querySelector("#cv-paradas-save");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "REGISTRANDO…";
    }
    if (formMsg) formMsg.textContent = "";
    try {
      const out = await registerPernocte(currentItem, form);
      if (formMsg) {
        formMsg.textContent = out.ya_registrado
          ? "Ya estaba registrado con el mismo rango."
          : `Pernocte registrado · id ${out.id}`;
        formMsg.style.color = "#86efac";
      }
      // Quitar de la lista; mapa persistente → dibujar el siguiente (o limpiar capas)
      const prevKey = selectedKey;
      itemsCache = itemsCache.filter((x) => itemKey(x) !== prevKey);
      if (rowsHost) {
        rowsHost.innerHTML = itemsCache.length
          ? itemsCache.map((it) => rowHtml(it, false)).join("")
          : `<p class="muted">No hay viajes multi-día sin pernocte registrado.</p>`;
      }
      form.reset();
      selectedStop = null;
      if (itemsCache[0]) {
        await selectItem(itemsCache[0]);
      } else {
        currentItem = null;
        currentRoute = null;
        clearAllMap();
        if (statusEl) statusEl.textContent = "Sin pendientes · mapa listo";
        if (candHost)
          candHost.innerHTML = `<p class="muted">No quedan viajes sin pernocte registrado.</p>`;
      }
    } catch (e) {
      if (formMsg) {
        formMsg.textContent = e.message || String(e);
        formMsg.style.color = "#fca5a5";
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "REGISTRAR PERNOCTE";
      }
    }
  });

  // live duration
  form?.querySelector('[name="inicio"]')?.addEventListener("input", () => {
    const a = parseAny(form.inicio?.value || form.querySelector('[name="inicio"]').value);
    const b = parseAny(form.querySelector('[name="fin"]').value);
    const el = container.querySelector("#cv-paradas-dur");
    if (el && Number.isFinite(a) && Number.isFinite(b) && b > a) {
      el.textContent = `Duración: ${formatDur((b - a) / 60000)}`;
    }
  });
  form?.querySelector('[name="fin"]')?.addEventListener("input", () => {
    const a = parseAny(form.querySelector('[name="inicio"]').value);
    const b = parseAny(form.querySelector('[name="fin"]').value);
    const el = container.querySelector("#cv-paradas-dur");
    if (el && Number.isFinite(a) && Number.isFinite(b) && b > a) {
      el.textContent = `Duración: ${formatDur((b - a) / 60000)}`;
    }
  });

  container.querySelector("#cv-paradas-refresh")?.addEventListener("click", async () => {
    container.innerHTML = `<section class="panel"><p class="muted">Actualizando…</p></section>`;
    await render(container, runtime);
  });

  if (itemsCache[0]) selectItem(itemsCache[0]);
}
