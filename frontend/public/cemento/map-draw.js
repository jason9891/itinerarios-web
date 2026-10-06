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
let currentUnitLabel = "";

function inPeruBBox(lat, lng) {
  return lat >= -19.5 && lat <= 0.5 && lng >= -82 && lng <= -68;
}

function normalizeGpsPoint(p, index) {
  let lat = Number(p?.lat ?? p?.latitude);
  let lng = Number(p?.lng ?? p?.lon ?? p?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Rechazar UTM / odómetro / basura (ej. lng=8689952) — misma regla que Python
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    if (Math.abs(lng) <= 90 && Math.abs(lat) <= 180) {
      const t = lat;
      lat = lng;
      lng = t;
    } else {
      return null;
    }
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.1 && Math.abs(lng) < 0.1) return null;
  if (!inPeruBBox(lat, lng) && inPeruBBox(lng, lat)) {
    const t = lat;
    lat = lng;
    lng = t;
  }
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

async function copyToClipboard(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function showTimePopup(marker, title, fecha, copied) {
  infoWindow ??= new google.maps.InfoWindow({
    maxWidth: 280,
    pixelOffset: new google.maps.Size(0, -8),
  });
  const t = fecha || "Sin hora";
  const code = String(title || "")
    .split("·")[0]
    .trim()
    .replace(/</g, "&lt;");
  const safeT = String(t).replace(/</g, "&lt;");
  const copyMsg = copied
    ? `<div style="margin-top:6px;color:#15803d;font-size:11px;font-weight:800">✓ Copiado</div>`
    : `<div style="margin-top:6px;color:#64748b;font-size:11px">Clic en la hora para copiar</div>`;
  // Layout simple y estable (sin mover el botón X de Google)
  infoWindow.setContent(
    `<div id="gm-iw-root" style="font:13px/1.3 system-ui,sans-serif;padding:10px 14px 12px 12px;margin:0;min-width:168px;max-width:260px;box-sizing:border-box">
      <div style="font-size:16px;font-weight:950;color:#0b2f68;letter-spacing:.03em;line-height:1.2;margin:0 18px 8px 0;word-break:break-word">${code}</div>
      <button type="button" id="gm-copy-hora" data-hora="${safeT}"
        style="display:block;width:100%;text-align:left;border:1px solid #c7d2fe;background:#eef2ff;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:14px;font-weight:900;color:#0f172a;line-height:1.25;white-space:normal;word-break:break-word">
        ${safeT}
      </button>
      <div id="gm-copy-msg">${copyMsg}</div>
    </div>`,
  );
  infoWindow.open({ map: mapInstance, anchor: marker });
  google.maps.event.addListenerOnce(infoWindow, "domready", () => {
    const btn = document.getElementById("gm-copy-hora");
    const msg = document.getElementById("gm-copy-msg");
    try {
      const iwC = document.querySelector(".gm-style-iw-c");
      const iwD = document.querySelector(".gm-style-iw-d");
      if (iwC) {
        iwC.style.padding = "0";
        iwC.style.borderRadius = "10px";
      }
      if (iwD) {
        iwD.style.overflow = "hidden";
        iwD.style.maxHeight = "none";
      }
    } catch (_) {}
    if (!btn) return;
    btn.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const hora = btn.getAttribute("data-hora") || btn.textContent || "";
      const ok = await copyToClipboard(hora);
      if (msg) {
        msg.innerHTML = ok
          ? `<div style="margin-top:6px;color:#15803d;font-size:11px;font-weight:800">✓ Copiado</div>`
          : `<div style="margin-top:6px;color:#b91c1c;font-size:11px">No se pudo copiar</div>`;
      }
    };
  });
}

function onPointClick(marker, title, fecha) {
  // Solo mostrar; la copia es al hacer clic en la hora
  showTimePopup(marker, title, fecha || "Sin hora", false);
}

function addLetterMarker(pos, letter, color, title, fecha) {
  const m = new google.maps.Marker({
    map: mapInstance,
    position: pos,
    title: `${title}${fecha ? " · " + fecha : ""} · clic = ver hora`,
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
  m.addListener("click", () => onPointClick(m, title, fecha));
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
  currentUnitLabel = unitLabel || "";

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
      const latS = Number(ultimo.lat).toFixed(6);
      const lngS = Number(ultimo.lng).toFixed(6);
      const okPe = inPeruBBox(ultimo.lat, ultimo.lng);
      if (okPe) {
        currentPoints = [ultimo];
        addLetterMarker(
          { lat: ultimo.lat, lng: ultimo.lng },
          "U",
          "#7c3aed",
          unitLabel ? `${unitLabel} · Último` : "Último",
          ultimo.fecha,
        );
        mapInstance.setCenter({ lat: ultimo.lat, lng: ultimo.lng });
        mapInstance.setZoom(12);
      } else {
        mapInstance.setCenter({ lat: -12.05, lng: -77.05 });
        mapInstance.setZoom(6);
      }
      if (captionEl) {
        captionEl.textContent = okPe
          ? `${unitLabel ? unitLabel + " · " : ""}Sin tramo en rango · Último punto ${ultimo.fecha || "—"} (clic en U)`
          : `${unitLabel ? unitLabel + " · " : ""}Sin recorrido ni último punto válido`;
      }
      return { points: 0, ultimo: true, lat: ultimo.lat, lng: ultimo.lng, fecha: ultimo.fecha || null, en_peru: okPe };
    }
    if (captionEl) {
      captionEl.textContent = unitLabel
        ? `${unitLabel} · Sin recorrido ni último punto en caché`
        : "Sin recorrido temporal en este navegador.";
    }
    return { points: 0 };
  }

  if (captionEl) {
    captionEl.textContent = `${unitLabel ? unitLabel + " · " : ""}${data.length} puntos · ${gps?.desde || ""} → ${gps?.hasta || ""} · clic en punto = copiar hora`;
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
  addLetterMarker(path[0], "I", "#2563eb", unitLabel ? `${unitLabel} · Inicio` : "Inicio", data[0]?.fecha);
  addLetterMarker(
    path[path.length - 1],
    "F",
    "#dc2626",
    unitLabel ? `${unitLabel} · Fin` : "Fin",
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
    m.addListener("click", () => onPointClick(m, currentUnitLabel || "GPS", p.fecha));
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
