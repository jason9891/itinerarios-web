/**
 * Mapa de recorrido GPS para CEMENTO · Seguimiento
 * Carga Maps API vía map_config de cemento-clocator y dibuja polilínea.
 */
import { API } from "./registry.js";

let mapsReady = null;
let mapInstance = null;
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
    fecha: String(p?.fecha || p?.fecha_hora || p?.time || ""),
    index,
  };
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

export async function ensureTrackingMap(mapEl, getToken) {
  if (!mapEl) return null;
  if (mapInstance) return mapInstance;
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
  return mapInstance;
}

function clearOverlays() {
  for (const x of overlays) x.setMap(null);
  overlays = [];
  for (const x of inspectionMarkers) x.setMap(null);
  inspectionMarkers = [];
  infoWindow?.close();
}

export function drawTrackingRoute(gps, mapEl, captionEl) {
  clearOverlays();
  inspectionEnabled = false;
  const raw = gps?.puntos_gps || gps?.puntos_lista || gps?.puntos || [];
  const data = (Array.isArray(raw) ? raw : [])
    .map(normalizeGpsPoint)
    .filter(Boolean);
  currentPoints = data;

  if (!data.length) {
    if (captionEl) captionEl.textContent = "Sin recorrido temporal en este navegador.";
    if (mapEl && !mapInstance) {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center;color:#94a3b8">Sin puntos GPS en caché.</div>`;
    }
    return { points: 0 };
  }

  if (captionEl) {
    captionEl.textContent = `${data.length} puntos · ${gps?.desde || ""} → ${gps?.hasta || ""}`;
  }

  if (!mapInstance || !window.google?.maps) {
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#94a3b8;text-align:left">
        <b style="color:#e2e8f0">${data.length} puntos</b> listos · mapa aún no inicializado<br>
        <span>Seleccione EN MAPA de nuevo si no aparece la polilínea.</span>
      </div>`;
    }
    return { points: data.length };
  }

  // Asegurar que el div del mapa esté vacío para Google
  if (mapEl && mapEl.dataset.mapsBound !== "1") {
    mapEl.innerHTML = "";
    mapEl.dataset.mapsBound = "1";
    // re-attach map to element if needed
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

  [
    [path[0], "I", "#2563eb"],
    [path[path.length - 1], "F", "#dc2626"],
  ].forEach(([p, l, c]) => {
    overlays.push(
      new google.maps.Marker({
        map: mapInstance,
        position: p,
        label: { text: l, color: "white" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: c,
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 3,
        },
        zIndex: 300,
      }),
    );
  });

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

  const step =
    currentPoints.length > 2500 ? 3 : currentPoints.length > 1200 ? 2 : 1;
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
  inspectionEnabled = false;
  currentPoints = [];
}
