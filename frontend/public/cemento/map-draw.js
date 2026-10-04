/**
 * Mapa de recorrido GPS para CEMENTO · Seguimiento
 * - map_config se consulta UNA sola vez
 * - I / F / U: hora solo al hacer clic
 * - Sin tramo en rango: marca U con último punto (gps.ultimo / Comsatel)
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

function normalizeGpsPoint(p, index) {
  const lat = Number(p?.lat ?? p?.latitude);
  const lng = Number(p?.lng ?? p?.lon ?? p?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    fecha: String(p?.fecha || p?.fecha_hora || p?.time || p?.hora || ""),
    index,
  };
}

function shortTime(fecha) {
  const s = String(fecha || "").trim();
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
    google.maps.event.trigger(mapInstance, "resize");
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
  for (const x of overlays) {
    try {
      x.setMap(null);
    } catch (_) {}
  }
  overlays = [];
  for (const x of inspectionMarkers) x.setMap(null);
  inspectionMarkers = [];
  infoWindow?.close();
}

function showTimePopup(marker, title, fecha) {
  infoWindow ??= new google.maps.InfoWindow();
  const t = fecha || "Sin hora";
  infoWindow.setContent(
    `<div style="font:13px/1.35 system-ui,sans-serif;padding:2px 4px">
      <b style="font-size:14px">${title}</b><br>
      <span style="font-size:15px;font-weight:800">${t}</span>
    </div>`,
  );
  infoWindow.open({ map: mapInstance, anchor: marker });
}

function addLetterMarker(pos, letter, color, title, fecha) {
  const m = new google.maps.Marker({
    map: mapInstance,
    position: pos,
    title: `${title}${fecha ? " · " + fecha : ""}`,
    label: { text: letter, color: "white", fontWeight: "700", fontSize: "12px" },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 12,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "white",
      strokeWeight: 3,
    },
    zIndex: 300,
  });
  m.addListener("click", () => showTimePopup(m, title, fecha));
  overlays.push(m);
  return m;
}

/**
 * Dibuja solo desde caché. No consulta CLocator.
 * Si no hay tramo, usa gps.ultimo (último reporte Comsatel) con marcador U.
 */
export function drawTrackingRoute(gps, mapEl, captionEl, unitLabel = "") {
  clearOverlays();
  inspectionEnabled = false;

  const raw = gps?.puntos_gps || gps?.puntos_lista || gps?.puntos || [];
  let data = (Array.isArray(raw) ? raw : []).map(normalizeGpsPoint).filter(Boolean);
  currentPoints = data;

  // Último punto conocido (login Comsatel / respuesta clocator.ultimo)
  const ultimo =
    normalizeGpsPoint(gps?.ultimo, -1) ||
    normalizeGpsPoint(gps?.ultimo_monitoreo, -1) ||
    normalizeGpsPoint(gps?.ultimo_punto, -1) ||
    normalizeGpsPoint(gps?.last, -1) ||
    (data.length === 1 ? data[0] : null);

  if (!mapInstance || !window.google?.maps) {
    if (captionEl) {
      captionEl.textContent = unitLabel
        ? `${unitLabel} · Mapa no inicializado`
        : "Mapa no inicializado";
    }
    return { points: data.length };
  }

  if (mapEl && mapEl.dataset.mapsBound !== "1") {
    mapEl.innerHTML = "";
    mapEl.dataset.mapsBound = "1";
    google.maps.event.trigger(mapInstance, "resize");
  }

  // Sin recorrido útil (≥2 puntos): mostrar U del último reporte
  if (data.length < 2) {
    if (ultimo) {
      currentPoints = [ultimo];
      addLetterMarker(
        { lat: ultimo.lat, lng: ultimo.lng },
        "U",
        "#7c3aed",
        "Último reporte GPS",
        ultimo.fecha,
      );
      mapInstance.setCenter({ lat: ultimo.lat, lng: ultimo.lng });
      mapInstance.setZoom(12);
      if (captionEl) {
        const latS = Number(ultimo.lat).toFixed(6);
        const lngS = Number(ultimo.lng).toFixed(6);
        captionEl.textContent =
          `${unitLabel ? unitLabel + " · " : ""}U · lat=${latS} lng=${lngS} · ${ultimo.fecha || "sin hora"} (clic en U)`;
      }
      return { points: 0, ultimo: true, lat: ultimo.lat, lng: ultimo.lng, fecha: ultimo.fecha || null };
    }
    if (captionEl) {
      captionEl.textContent = unitLabel
        ? `${unitLabel} · Sin recorrido ni último punto en caché`
        : "Sin recorrido temporal en este navegador.";
    }
    return { points: 0 };
  }

  if (captionEl) {
    captionEl.textContent = `${unitLabel ? unitLabel + " · " : ""}${data.length} puntos · ${gps?.desde || ""} → ${gps?.hasta || ""} · clic en I/F para hora`;
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

  // I y F: hora solo al clic
  addLetterMarker(path[0], "I", "#2563eb", "Inicio de tramo", data[0]?.fecha);
  addLetterMarker(
    path[path.length - 1],
    "F",
    "#dc2626",
    "Fin de tramo",
    data[data.length - 1]?.fecha,
  );

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
    m.addListener("click", () => showTimePopup(m, "Punto GPS", p.fecha));
    inspectionMarkers.push(m);
  }
}

export function resetMapState() {
  clearOverlays();
  mapInstance = null;
  mapConfigLoaded = false;
  inspectionEnabled = false;
  currentPoints = [];
}
