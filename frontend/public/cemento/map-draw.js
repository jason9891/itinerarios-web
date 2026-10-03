/**
 * Mapa de recorrido GPS para CEMENTO · Seguimiento
 * map_config se consulta UNA sola vez; luego solo se dibujan líneas desde caché.
 */
import { API } from "./registry.js";

let mapsReady = null;
let mapInstance = null;
let mapConfigLoaded = false;
let overlays = [];
let inspectionMarkers = [];
let inspectionEnabled = false;
let infoWindow = null;
let currentPoints = [];
let unitLabelEl = null;

function normalizeGpsPoint(p, index) {
  const lat = Number(p?.lat ?? p?.latitude);
  const lng = Number(p?.lng ?? p?.lon ?? p?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    fecha: String(p?.fecha || p?.fecha_hora || p?.time || ""),
    index,
  };
}

function shortTime(fecha) {
  const s = String(fecha || "").trim();
  // 03/10/2026 14:30:00 → 14:30
  const m = s.match(/(\d{2}):(\d{2})(?::\d{2})?/);
  if (m) return `${m[1]}:${m[2]}`;
  return s || "—";
}

export function loadMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsReady) return mapsReady;
  if (!apiKey) return Promise.reject(new Error("Falta GOOGLE_MAPS_API_KEY"));
  mapsReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    s.async = true;
    s.onload = () => resolve(window.google.maps);
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return mapsReady;
}

/** Solo consulta map_config la primera vez. */
export async function ensureTrackingMap(mapEl, getToken) {
  if (!mapEl) return null;
  if (mapInstance && mapConfigLoaded) {
    if (mapEl.dataset.mapsBound !== "1") {
      mapEl.innerHTML = "";
      mapEl.dataset.mapsBound = "1";
      // reparent is not needed; map stays on original node
      google.maps.event.trigger(mapInstance, "resize");
    }
    return mapInstance;
  }
  const token = await getToken();
  const r = await fetch(API.clocator, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "map_config" }),
  });
  const cfg = await r.json();
  if (!r.ok) throw new Error(cfg.error || "No se pudo cargar configuración del mapa");
  await loadMaps(cfg.google_maps_api_key);
  mapEl.innerHTML = "";
  mapEl.dataset.mapsBound = "1";
  mapInstance = new google.maps.Map(mapEl, {
    center: { lat: -16.4, lng: -71.5 },
    zoom: 9,
    mapTypeId: "roadmap",
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: "greedy",
  });
  mapConfigLoaded = true;
  return mapInstance;
}

function clearOverlays() {
  for (const x of overlays) x.setMap(null);
  overlays = [];
  for (const x of inspectionMarkers) x.setMap(null);
  inspectionMarkers = [];
  infoWindow?.close();
}

function setUnitBadge(mapEl, label) {
  if (!mapEl) return;
  let badge = mapEl.parentElement?.querySelector(".map-unit-badge");
  if (!badge && mapEl.parentElement) {
    badge = document.createElement("div");
    badge.className = "map-unit-badge";
    badge.style.cssText =
      "position:absolute;left:8px;top:8px;z-index:5;background:#0f172a;color:#fff;padding:6px 12px;border-radius:8px;font-size:14px;font-weight:900;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none";
    mapEl.parentElement.style.position = "relative";
    mapEl.parentElement.appendChild(badge);
  }
  if (badge) badge.textContent = label || "—";
  unitLabelEl = badge;
}

/**
 * Dibuja solo desde caché local. No consulta CLocator.
 * @param {object} gps
 * @param {HTMLElement} mapEl
 * @param {HTMLElement|null} captionEl
 * @param {string} [unitLabel]
 */
export function drawTrackingRoute(gps, mapEl, captionEl, unitLabel = "") {
  clearOverlays();
  inspectionEnabled = false;
  if (unitLabel) setUnitBadge(mapEl, unitLabel);

  const raw = gps?.puntos_gps || gps?.puntos_lista || gps?.puntos || [];
  const data = (Array.isArray(raw) ? raw : []).map(normalizeGpsPoint).filter(Boolean);
  currentPoints = data;

  if (!data.length) {
    if (captionEl) {
      captionEl.textContent = unitLabel
        ? `${unitLabel} · Sin recorrido en caché`
        : "Sin recorrido temporal en este navegador.";
    }
    return { points: 0 };
  }

  if (captionEl) {
    captionEl.textContent = `${unitLabel ? unitLabel + " · " : ""}${data.length} puntos · ${gps?.desde || ""} → ${gps?.hasta || ""}`;
  }

  if (!mapInstance || !window.google?.maps) {
    return { points: data.length };
  }

  if (mapEl && mapEl.dataset.mapsBound !== "1") {
    mapEl.innerHTML = "";
    mapEl.dataset.mapsBound = "1";
    google.maps.event.trigger(mapInstance, "resize");
  }

  const path = data.map((p) => ({ lat: p.lat, lng: p.lng }));
  const bounds = new google.maps.LatLngBounds();
  const arrow = {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    scale: 3.5,
    strokeColor: "#7c3aed",
    strokeWeight: 2,
    fillColor: "#7c3aed",
    fillOpacity: 1,
  };
  const line = new google.maps.Polyline({
    map: mapInstance,
    path,
    geodesic: true,
    strokeColor: "#2563eb",
    strokeOpacity: 0.95,
    strokeWeight: 5,
    icons: [
      { icon: arrow, offset: "40px", repeat: "110px" },
      { icon: arrow, offset: "100%" },
    ],
  });
  overlays.push(line);
  path.forEach((p) => bounds.extend(p));

  // I y F con hora visible
  const ends = [
    { pos: path[0], letter: "I", color: "#2563eb", time: shortTime(data[0]?.fecha), full: data[0]?.fecha || "" },
    {
      pos: path[path.length - 1],
      letter: "F",
      color: "#dc2626",
      time: shortTime(data[data.length - 1]?.fecha),
      full: data[data.length - 1]?.fecha || "",
    },
  ];
  for (const e of ends) {
    const m = new google.maps.Marker({
      map: mapInstance,
      position: e.pos,
      title: `${e.letter} · ${e.full}`,
      label: { text: e.letter, color: "white", fontWeight: "700" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: e.color,
        fillOpacity: 1,
        strokeColor: "white",
        strokeWeight: 3,
      },
      zIndex: 300,
    });
    overlays.push(m);
    // etiqueta de hora junto al marcador
    const timeMarker = new google.maps.Marker({
      map: mapInstance,
      position: e.pos,
      clickable: false,
      label: {
        text: e.time,
        color: e.color,
        fontSize: "12px",
        fontWeight: "bold",
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 0,
        fillOpacity: 0,
        strokeOpacity: 0,
      },
      zIndex: 301,
    });
    // offset visual: use custom overlay via InfoWindow-like static
    overlays.push(timeMarker);
  }

  // Labels de hora como InfoWindow no-auto-close would clutter; use Marker with label below via pixelOffset simulation:
  // Better: custom OverlayView-lite with div
  for (const e of ends) {
    const div = document.createElement("div");
    div.textContent = e.time;
    div.style.cssText = `background:${e.color};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:800;white-space:nowrap;transform:translate(-50%,8px);box-shadow:0 1px 3px rgba(0,0,0,.3)`;
    const overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {
      const panes = this.getPanes();
      panes.floatPane.appendChild(div);
    };
    overlay.draw = function () {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(e.pos.lat, e.pos.lng));
      if (!pt) return;
      div.style.left = pt.x + "px";
      div.style.top = pt.y + "px";
      div.style.position = "absolute";
    };
    overlay.onRemove = function () {
      div.remove();
    };
    overlay.setMap(mapInstance);
    overlays.push({ setMap: (m) => overlay.setMap(m) });
  }

  if (path.length >= 2) {
    const last3 = path.slice(-3);
    overlays.push(
      new google.maps.Polyline({
        map: mapInstance,
        path: last3,
        geodesic: true,
        strokeColor: "#dc2626",
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 400,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 4,
              strokeColor: "#dc2626",
              strokeWeight: 2,
              fillColor: "#dc2626",
              fillOpacity: 1,
            },
            offset: "100%",
          },
        ],
      }),
    );
  }

  mapInstance.fitBounds(bounds);
  google.maps.event.trigger(mapInstance, "resize");
  return { points: data.length };
}

export function toggleInspection(button) {
  inspectionEnabled = !inspectionEnabled;
  for (const x of inspectionMarkers) x.setMap(null);
  inspectionMarkers = [];
  infoWindow?.close();
  if (button) {
    button.textContent = inspectionEnabled ? "OCULTAR HORAS" : "VER HORAS";
    button.classList.toggle("active", inspectionEnabled);
  }
  if (!inspectionEnabled || !mapInstance || !currentPoints.length) return;

  const step = currentPoints.length > 2500 ? 3 : currentPoints.length > 1200 ? 2 : 1;
  for (let i = 0; i < currentPoints.length; i += step) {
    const p = currentPoints[i];
    const m = new google.maps.Marker({
      map: mapInstance,
      position: { lat: p.lat, lng: p.lng },
      title: p.fecha,
      optimized: true,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 2.8,
        fillColor: "#fff",
        fillOpacity: 0.75,
        strokeColor: "#174589",
        strokeOpacity: 0.85,
        strokeWeight: 1,
      },
      zIndex: 70,
    });
    m.addListener("click", () => {
      infoWindow ??= new google.maps.InfoWindow();
      infoWindow.setContent(`<div style="font:12px sans-serif">${p.fecha || "—"}</div>`);
      infoWindow.open({ map: mapInstance, anchor: m });
    });
    inspectionMarkers.push(m);
  }
}

export function resetMapState() {
  clearOverlays();
  mapInstance = null;
  mapConfigLoaded = false;
  inspectionEnabled = false;
  currentPoints = [];
  unitLabelEl = null;
}
