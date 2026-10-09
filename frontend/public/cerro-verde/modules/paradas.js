/**
 * Módulo CERRO VERDE · Paradas
 *
 * Pestañas:
 *  1) Sin registro — multi-día Caracoto→SMCV sin evento PERNOCTE + mapa + registrar
 *  2) Validación — SI / NO / SIN REPORTE GPS (como antes) + descargas interno/enviable
 *
 * Mapa persistente: se crea una vez; al cambiar de viaje solo se redibujan capas.
 */
import { esc, moduleHead, apiPost } from "../api-client.js";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { queryClocator } from "../../shared/clocator-client.js";
import { readLegacyGPS, putLegacyGPS } from "../gps-cache.js";

/** Corredor autorizado de pernocte (solo informativo para el validador SI/NO). */
const RUTA_PERNOCTE_AUTORIZADA = [
  "JULIACA",
  "CABANILLAS",
  "SANTA LUCÍA",
  "IMATA",
  "PATAHUASI",
  "YURA",
  "RACIEMSA",
];

function rutaPernocteGuideHtml() {
  const steps = RUTA_PERNOCTE_AUTORIZADA.map(
    (z, i) =>
      `<span class="cv-ruta-step"><b>${i + 1}</b>${esc(z)}</span>${
        i < RUTA_PERNOCTE_AUTORIZADA.length - 1
          ? `<span class="cv-ruta-arrow" aria-hidden="true">→</span>`
          : ""
      }`,
  ).join("");
  return `<section class="cv-ruta-guide" role="note">
    <div class="cv-ruta-guide-title">
      <b>PUNTOS AUTORIZADOS DE PERNOCTE</b>
      <small>Solo referencia · no bloquea la validación SI/NO</small>
    </div>
    <div class="cv-ruta-guide-flow">${steps}</div>
    <p class="cv-ruta-guide-note">Orden correcto del corredor: <b>Juliaca → Cabanillas → Santa Lucía → Imata → Patahuasi → Yura → Raciemsa</b>. Use esta secuencia al contrastar “DEBIÓ PERNOCTAR” vs “PERNOCTÓ EN”.</p>
  </section>`;
}


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
  _paintInspection: null,
  _hoursClick: null,
};
let mapsPromise = null;
let activeTab = "sin-registro";
let itemsCache = [];
let selectedKey = null;
let currentItem = null;
let currentRoute = null;
let selectedStop = null;
let validationDrafts = new Map();

export async function mount(container, runtime) {
  cleanup = [];
  selectedKey = null;
  itemsCache = [];
  currentItem = null;
  currentRoute = null;
  selectedStop = null;
  validationDrafts = new Map();
  clearAllMap();
  container.innerHTML = `<section class="panel"><p class="muted">Cargando paradas…</p></section>`;
  try {
    await renderShell(container, runtime);
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

/* ───────── helpers mapa / tiempo ───────── */

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
  if (m)
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}


/** Normaliza cualquier fecha a dd/mm/yyyy hh:mm:ss (canónico UI / registro). */
function fmtPE(v) {
  if (v == null || v === "" || v === "—") return "—";
  const t = parseAny(v);
  if (!Number.isFinite(t)) return String(v);
  const d = new Date(t);
  const z = (n) => String(n).padStart(2, "0");
  // parseAny usa UTC components; mostrar mismos componentes
  return `${z(d.getUTCDate())}/${z(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
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
  if (!mapRuntime.map || mapRuntime.host !== host) {
    mapRuntime.host = host;
    mapRuntime.map = new google.maps.Map(host, options);
  } else {
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
    mapRuntime.layers.push(
      new google.maps.Polyline({
        map,
        path,
        strokeColor: "#2563eb",
        strokeOpacity: 0.95,
        strokeWeight: 5,
      }),
    );
    mapRuntime.layers.push(
      new google.maps.Polyline({
        map,
        path: path.slice(-Math.min(3, path.length)),
        strokeColor: "#dc2626",
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 400,
      }),
    );
    [
      { p: pts[0], text: "I", color: "#16a34a", title: `INICIO · ${pts[0].fecha || "-"}` },
      { p: pts.at(-1), text: "F", color: "#2563eb", title: `FIN · ${pts.at(-1).fecha || "-"}` },
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
        title: `ÚLTIMA · ${ultimo.fecha || ""}`,
        icon: markerIcon("#111827", 11),
        zIndex: 450,
      }),
    );
  }

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
        `<div style="font:12px Segoe UI,Arial"><b>${isP ? "POSIBLE PERNOCTE" : "POSIBLE PAUSA"}</b><br>Inicio: ${esc(p.inicio)}<br>Fin: ${esc(p.fin)}<br>Duración: ${esc(formatDur(p.duracion_min))}<br>Zona: ${esc(p.geocerca || "FUERA DE GEOCERCA")}</div>`,
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
  setupHoursTool(map, pts);
  return {
    empty: pts.length < 2 && !ultimo,
    puntos: pts.length,
    candidatos: candidates.filter((x) => String(x.tipo).toUpperCase() === "PERNOCTE"),
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
        return `<div style="${index ? "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;" : ""}"><button type="button" data-copy-time="${value}" style="border:0;background:#EEF4FF;color:#174589;font:700 12px Segoe UI,Arial;padding:6px 10px;border-radius:6px;cursor:pointer">${value || "—"}</button>${range}</div>`;
      })
      .join("");
    const routeInfo = (mapRuntime.routeInfo ||= new google.maps.InfoWindow());
    routeInfo.setContent(
      `<div style="font-family:Segoe UI,Arial;min-width:160px"><b style="font-size:11px;color:#64748b">HORA EN PUNTO</b>${rows}<div style="margin-top:8px;font-size:10px;color:#94a3b8">Clic en la hora para copiar</div></div>`,
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

/* ───────── API ───────── */

async function fetchFaltantes() {
  return apiPost(API.report, { action: "pernoctes_sin_registro" });
}

async function fetchParadasEstado() {
  return apiPost(API.report, { action: "paradas_estado" });
}

async function loadRouteForItem(item) {
  // 1) Caché local (precarga / seguimiento): cero egress Supabase
  const cached = await readLegacyGPS(item.placa).catch(() => null);
  if (cached && (cached.puntos_gps?.length || cached.ok)) {
    return {
      ...cached,
      desde_cache_local: true,
      nota: cached.nota || "GPS desde caché local del navegador (sin Supabase)",
    };
  }
  // 2) Red solo si no hay puntos guardados
  if (!auth.currentUser) throw new Error("No hay sesión activa");
  const token = await auth.currentUser.getIdToken(true);
  const route = await queryClocator({
    endpoint: API.clocator,
        fallbackEndpoint: API.clocatorSupabase || "",
    token,
    placa: item.placa,
    tracto: item.codigo_tracto,
    desde: item.ventana_gps_desde,
    hasta: item.ventana_gps_hasta,
    includeMap: false,
  });
  try {
    await putLegacyGPS(item.placa, { ...route, run: "paradas" });
  } catch (_) {}
  return route;
}

async function registerPernocte(item, form) {
  const fd = new FormData(form);
  const inicio = fmtPE(String(fd.get("inicio") || "").trim()).replace(/^—$/, "");
  const fin = fmtPE(String(fd.get("fin") || "").trim()).replace(/^—$/, "");
  if (!inicio || !fin || inicio === "—" || fin === "—")
    throw new Error("Indique inicio y fin válidos (dd/mm/yyyy hh:mm:ss)");
  const geocerca = String(fd.get("geocerca") || "").trim();
  const descripcion = String(fd.get("descripcion") || "").trim();
  const lat = Number(fd.get("lat"));
  const lng = Number(fd.get("lng"));
  const t0 = parseAny(inicio);
  const t1 = parseAny(fin);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0)
    throw new Error("Indique inicio y fin válidos del pernocte");
  const duracion_min = (t1 - t0) / 60000;
  if (!(duracion_min > 240)) throw new Error("El pernocte debe ser mayor a 4 horas");
  if (
    new Date(t0).toISOString().slice(0, 10) ===
    new Date(t1).toISOString().slice(0, 10)
  )
    throw new Error("El pernocte debe cambiar de fecha");
  if (!geocerca) throw new Error("Indique el lugar / zona de pernocte");
  const llegadaRaw = String(fd.get("llegada_smcv") || "").trim();
  const llegada_smcv = llegadaRaw
    ? fmtPE(llegadaRaw).replace(/^—$/, "") || llegadaRaw
    : "";
  return apiPost(API.report, {
    action: "pernocte_registrar",
    entrega_sap: item.entrega_sap,
    placa: item.placa,
    codigo_tracto: item.codigo_tracto,
    conductor: item.conductor,
    fecha_carga: item.fecha_carga,
    llegada_smcv: llegada_smcv || undefined,
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

async function downloadReport(action, filename) {
  const x = await apiPost(API.report, { action }, { binary: true });
  if (!x?.blob || x.blob.size < 64) {
    throw new Error("El servidor no devolvió un Excel válido. Revise pendientes SI/NO o reintente.");
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(x.blob);
  a.download = x.name || filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2500);
  return x.name || filename;
}

/* ───────── shell + tabs ───────── */

async function renderShell(container, runtime) {
  container.innerHTML =
    moduleHead("Paradas", "Pernoctes: registro y validación") +
    `<nav class="cv-tabs" id="cv-paradas-tabs">
      <button type="button" data-tab="sin-registro" class="${activeTab === "sin-registro" ? "active" : ""}">SIN REGISTRO</button>
      <button type="button" data-tab="validacion" class="${activeTab === "validacion" ? "active" : ""}">VALIDACIÓN SI / NO</button>
    </nav>
    <div id="cv-paradas-panel"></div>
    <style>
      .cv-tabs{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap}
      .cv-tabs button{border:1px solid #1e3a5f;background:#0b1d30;color:#94a3b8;border-radius:999px;padding:8px 16px;font:800 11px/1 system-ui;letter-spacing:.04em;cursor:pointer}
      .cv-tabs button.active{background:#174589;color:#fff;border-color:#3b82f6}
      .cv-paradas-layout{display:grid;grid-template-columns:minmax(260px,32fr) minmax(360px,68fr);gap:12px;align-items:start}
      .cv-paradas-main{display:flex;flex-direction:column;gap:12px;min-width:0}
      .cv-paradas-rows{max-height:calc(100vh - 280px);overflow:auto;display:flex;flex-direction:column;gap:8px}
      .cv-pernocte-row{display:block;width:100%;text-align:left;border:1px solid #1e3a5f;background:#0b1d30;color:#e2e8f0;border-radius:8px;padding:10px 12px;cursor:pointer}
      .cv-pernocte-row.selected{border-color:#38bdf8;box-shadow:0 0 0 1px #38bdf8 inset}
      .cv-pernocte-row-top{display:flex;justify-content:space-between;gap:8px;font-weight:800}
      .cv-pernocte-row-mid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:8px;font-size:12px}
      .cv-pernocte-row-mid small{color:#94a3b8;font-size:10px}
      .cv-pernocte-row-bot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;font-size:11px}
      .badge.warn{background:#7c2d12;color:#ffedd5;border-radius:999px;padding:2px 8px;font-weight:800;font-size:10px}
      .cv-paradas-map-host{height:min(48vh,420px);min-height:280px;background:#0f172a;border-radius:8px;overflow:hidden}
      #cv-paradas-hours.active{background:#0ea5e9;color:#0b1d30;border-color:#38bdf8}
      .candidate-list{display:grid;gap:8px;margin-bottom:12px}
      .candidate{display:grid;width:100%;gap:4px;border-radius:8px;padding:10px 12px;text-align:left;font:inherit;cursor:pointer;border:1px solid #ef4444;background:#fff1f2;color:#991b1b}
      .candidate.selected{outline:3px solid rgba(220,38,38,.35)}
      .candidate b,.candidate span,.candidate strong{display:block;font-size:12px;line-height:1.35}
      .cv-paradas-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .cv-paradas-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:#94a3b8}
      .cv-paradas-form label.full{grid-column:1/-1}
      .cv-paradas-form input{border:1px solid #1e3a5f;background:#071525;color:#e2e8f0;border-radius:6px;padding:8px 10px;font-size:13px}
      .cv-paradas-form-actions{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:12px}
      .pernocte-toolbar{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
      .pernocte-toolbar .panel{padding:12px}
      .pernocte-toolbar h1{margin:4px 0;font-size:28px}
      .pernocte-pending-list{display:grid;gap:12px}
      .pernocte-validation-card{border:1px solid #1e3a5f;border-radius:10px;padding:14px;background:#0b1d30;color:#e2e8f0}
      .pernocte-validation-card header{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}
      .pernocte-validation-card h3{margin:0;font-size:15px}
      .pernocte-data{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-bottom:10px;font-size:12px}
      .pernocte-data b{display:block;font-size:10px;color:#94a3b8}
      .pernocte-data input{width:100%;box-sizing:border-box;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0;border-radius:6px;padding:6px 8px}
      .pernocte-validation-card textarea{width:100%;min-height:56px;box-sizing:border-box;border:1px solid #1e3a5f;background:#071525;color:#e2e8f0;border-radius:6px;padding:8px;margin-bottom:10px}
      .pernocte-decision{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .pernocte-decision button{border-radius:6px;padding:8px 14px;font:800 11px system-ui;cursor:pointer;border:1px solid transparent}
      .pernocte-decision button.yes{background:#166534;color:#fff}
      .pernocte-decision button.no{background:#991b1b;color:#fff}
      .pernocte-decision button.selected{outline:2px solid #38bdf8;outline-offset:2px}
      .pending-warning{background:#7c2d12;color:#ffedd5;padding:10px 12px;border-radius:8px;margin-bottom:12px}
      .pending-ok{background:#14532d;color:#bbf7d0;padding:10px 12px;border-radius:8px;margin-bottom:12px}
      .cv-ruta-guide{margin:0 0 14px;padding:12px 14px;border-radius:10px;border:1px solid #1e4a6e;background:linear-gradient(180deg,#0c1f33,#0a1828);color:#e2e8f0}
      .cv-ruta-guide-title{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between;margin-bottom:10px}
      .cv-ruta-guide-title b{font-size:12px;letter-spacing:.04em;color:#7dd3fc}
      .cv-ruta-guide-title small{font-size:11px;color:#94a3b8}
      .cv-ruta-guide-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
      .cv-ruta-step{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#12263a;border:1px solid #234;font-size:12px;font-weight:700;color:#f8fafc}
      .cv-ruta-step b{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#0369a1;color:#e0f2fe;font-size:10px}
      .cv-ruta-arrow{color:#38bdf8;font-weight:900;opacity:.85}
      .cv-ruta-guide-note{margin:10px 0 0;font-size:12px;color:#cbd5e1;line-height:1.45}
      .cv-ruta-guide-note b{color:#fde68a}
      
      .pernocte-proposal{border-radius:999px;padding:4px 10px;font-size:10px;font-weight:800}
      .pernocte-proposal.pendiente{background:#fef3c7;color:#92400e}
      @media(max-width:960px){.cv-paradas-layout,.pernocte-toolbar{grid-template-columns:1fr}.cv-paradas-form{grid-template-columns:1fr}}
    </style>`;

  const panel = container.querySelector("#cv-paradas-panel");
  const switchTab = async (tab) => {
    activeTab = tab;
    container.querySelectorAll("#cv-paradas-tabs [data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    if (tab === "sin-registro") await renderSinRegistro(panel, container);
    else await renderValidacion(panel, container);
  };

  container.querySelector("#cv-paradas-tabs")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-tab]");
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  await switchTab(activeTab);
}

/* ───────── Tab 1: sin registro ───────── */

function rowHtml(it, selected) {
  const sinLleg = it.sin_llegada_smcv || !it.llegada_smcv;
  return `<button type="button" class="cv-pernocte-row ${selected ? "selected" : ""}" data-key="${esc(itemKey(it))}">
    <div class="cv-pernocte-row-top"><b>${esc(it.codigo_tracto || "—")}</b><span>${esc(it.placa || "—")}</span></div>
    <div class="cv-pernocte-row-mid">
      <small>SALIDA CARACOTO</small><span>${esc(fmtPE(it.salida_caracoto))}</span>
      <small>LLEGADA SMCV</small><span>${sinLleg ? "SIN REGISTRAR (editable)" : esc(fmtPE(it.llegada_smcv))}</span>
    </div>
    <div class="cv-pernocte-row-bot">
      <span class="badge warn">SIN PERNOCTE REGISTRADO</span>
      ${sinLleg ? `<span class="badge warn" style="background:#334155">EXIGIBLE DESDE ${esc(it.exigible_desde || "06:30 día +1")}</span>` : ""}
      <span class="muted">${esc(it.ventana_gps_desde)} → ${esc(it.ventana_gps_hasta)}</span>
    </div>
  </button>`;
}

function candidatesHtml(list) {
  if (!list?.length)
    return `<p class="muted">Sin candidatos PERNOCTE en el análisis. Complete inicio/fin manualmente.</p>`;
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
  form.querySelector('[name="inicio"]').value = fmtPE(stop.inicio).replace(/^—$/, "") || stop.inicio || "";
  form.querySelector('[name="fin"]').value = fmtPE(stop.fin).replace(/^—$/, "") || stop.fin || "";
  form.querySelector('[name="geocerca"]').value = stop.geocerca || "";
  form.querySelector('[name="descripcion"]').value = stop.motivo || stop.descripcion || "";
  form.querySelector('[name="lat"]').value = stop.lat ?? "";
  form.querySelector('[name="lng"]').value = stop.lng ?? "";
  const dur = form.closest("#cv-paradas-panel")?.querySelector("#cv-paradas-dur");
  if (dur) dur.textContent = `Duración: ${formatDur(stop.duracion_min)}`;
}

async function renderSinRegistro(panel, root) {
  panel.innerHTML = `<section class="panel"><p class="muted">Cargando viajes sin registro…</p></section>`;
  let data;
  try {
    data = await fetchFaltantes();
  } catch (e) {
    panel.innerHTML = `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
    return;
  }
  itemsCache = data.items || [];
  const total = data.total ?? itemsCache.length;

  panel.innerHTML = `
    <section class="notice">
      <b>Sin registro:</b> pernocte <b>exigible desde las 06:30 del día siguiente</b> a la salida de Caracoto (hora Lima).
      <b>Salida y llegada el mismo día = no requiere pernocte</b> (no se lista).
      Sin llegada a SMCV, tras el umbral sí puede listar. <b>Llegada SMCV es editable</b>.
      Ventana GPS: ${esc(data.ventana || "20:00 → 08:00")}. Tras registrar → pestaña <b>Validación</b> SI/NO.
    </section>
    <section class="cv-paradas-layout">
      <aside class="panel">
        <div class="panel-title">
          <h2>Sin registro (${total})</h2>
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
        <div class="panel">
          <div class="panel-title">
            <h2>Mapa del tramo nocturno</h2>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" id="cv-paradas-hours" class="secondary">VER HORAS</button>
              <span id="cv-paradas-status" class="muted">Seleccione un viaje</span>
            </div>
          </div>
          <div id="cv-paradas-map" class="cv-paradas-map-host" data-placeholder="1">Seleccione un viaje de la lista.</div>
          <footer class="muted" style="padding:8px 10px;font-size:12px">AZUL recorrido · P candidato · VER HORAS puntos clicables</footer>
        </div>
        <div class="panel">
          <div class="panel-title"><h2>Registrar pernocte</h2></div>
          <div id="cv-paradas-candidates" class="candidate-list"><p class="muted">Seleccione un viaje.</p></div>
          <form id="cv-paradas-form" class="cv-paradas-form">
            <label><span>INICIO</span><input name="inicio" type="text" placeholder="dd/mm/yyyy hh:mm:ss" required></label>
            <label><span>FIN</span><input name="fin" type="text" placeholder="dd/mm/yyyy hh:mm:ss" required></label>
            <label class="full"><span>LUGAR / ZONA DE PERNOCTE</span>
              <input name="geocerca" list="cv-zonas-pernocte" required placeholder="AREQUIPA, PLANTA YURA…">
            </label>
            <label class="full"><span>LLEGADA A SMCV (editable)</span>
              <input name="llegada_smcv" type="text" placeholder="dd/mm/yyyy hh:mm:ss — opcional si aún en tránsito">
            </label>
            <label class="full"><span>OBSERVACIÓN</span><input name="descripcion" type="text"></label>
            <input type="hidden" name="lat"><input type="hidden" name="lng">
            <div class="cv-paradas-form-actions">
              <span id="cv-paradas-dur" class="muted">Duración: —</span>
              <button type="submit" class="primary" id="cv-paradas-save">REGISTRAR PERNOCTE</button>
            </div>
            <p id="cv-paradas-form-msg" class="muted"></p>
          </form>
          <datalist id="cv-zonas-pernocte">
            <option value="AREQUIPA"></option><option value="RACIEMSA"></option>
            <option value="PLANTA YURA"></option><option value="YURA"></option>
            <option value="CARACOTO"></option><option value="FUERA DE GEOCERCA"></option>
          </datalist>
        </div>
      </section>
    </section>`;

  const statusEl = panel.querySelector("#cv-paradas-status");
  const mapHost = panel.querySelector("#cv-paradas-map");
  const rowsHost = panel.querySelector("#cv-paradas-rows");
  const candHost = panel.querySelector("#cv-paradas-candidates");
  const form = panel.querySelector("#cv-paradas-form");
  const formMsg = panel.querySelector("#cv-paradas-form-msg");
  const hoursBtn = panel.querySelector("#cv-paradas-hours");

  hoursBtn?.addEventListener("click", () => toggleHours(hoursBtn));

  const selectStop = (stop) => {
    selectedStop = stop;
    fillFormFromStop(form, stop);
    candHost?.querySelectorAll(".candidate").forEach((btn) => {
      const id = stop?.id || `${stop?.inicio}|${stop?.fin}`;
      btn.classList.toggle("selected", btn.dataset.stopId === String(id));
    });
    const m = mapRuntime.stopMarkers?.get(stop?.id || `${stop?.inicio}|${stop?.fin}`);
    if (m && mapRuntime.map) {
      const pos = m.getPosition?.();
      if (pos) {
        mapRuntime.map.panTo(pos);
        if ((mapRuntime.map.getZoom() || 0) < 16) mapRuntime.map.setZoom(16);
      }
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
    if (form) {
      const lleg = form.querySelector('[name="llegada_smcv"]');
      if (lleg) {
        lleg.value =
          it.llegada_smcv && !it.sin_llegada_smcv
            ? fmtPE(it.llegada_smcv).replace(/^—$/, "")
            : "";
      }
    }
    if (formMsg) formMsg.textContent = "";
    if (candHost) candHost.innerHTML = `<p class="muted">Consultando GPS…</p>`;
    try {
      if (statusEl)
        statusEl.textContent = `Cargando ${it.placa} (caché local si existe)…`;
      if (mapHost.dataset.placeholder !== "0") {
        mapHost.textContent = "";
        mapHost.dataset.placeholder = "0";
      }
      const map = await ensureMap(mapHost, { lat: -16.4, lng: -71.55 }, 9);
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
          ? `Sin puntos · ${it.placa}`
          : `${drawn.puntos} pts · ${pernoctes.length} P · ${it.placa}${route?.desde_cache_local ? " · CACHÉ LOCAL" : ""}`;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || String(e);
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
      if (formMsg) formMsg.textContent = "Seleccione un viaje.";
      return;
    }
    const saveBtn = form.querySelector("#cv-paradas-save");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "REGISTRANDO…";
    }
    try {
      const out = await registerPernocte(currentItem, form);
      if (formMsg) {
        formMsg.textContent = out.ya_registrado
          ? "Ya estaba registrado."
          : `Registrado · id ${out.id}. Puede validar en la pestaña VALIDACIÓN.`;
        formMsg.style.color = "#86efac";
      }
      const prevKey = selectedKey;
      itemsCache = itemsCache.filter((x) => itemKey(x) !== prevKey);
      if (rowsHost) {
        rowsHost.innerHTML = itemsCache.length
          ? itemsCache.map((it) => rowHtml(it, false)).join("")
          : `<p class="muted">No hay viajes multi-día sin pernocte registrado.</p>`;
      }
      form.reset();
      if (itemsCache[0]) await selectItem(itemsCache[0]);
      else {
        currentItem = null;
        clearAllMap();
        if (statusEl) statusEl.textContent = "Sin pendientes · mapa listo";
        if (candHost)
          candHost.innerHTML = `<p class="muted">No quedan sin registro. Pase a la pestaña <b>Validación SI/NO</b> y pulse ACTUALIZAR / reabra la pestaña para ver los nuevos pendientes.</p>`;
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

  const updateDur = () => {
    const a = parseAny(form.querySelector('[name="inicio"]').value);
    const b = parseAny(form.querySelector('[name="fin"]').value);
    const el = panel.querySelector("#cv-paradas-dur");
    if (el && Number.isFinite(a) && Number.isFinite(b) && b > a)
      el.textContent = `Duración: ${formatDur((b - a) / 60000)}`;
  };
  form?.querySelector('[name="inicio"]')?.addEventListener("input", updateDur);
  form?.querySelector('[name="fin"]')?.addEventListener("input", updateDur);

  panel.querySelector("#cv-paradas-refresh")?.addEventListener("click", () =>
    renderSinRegistro(panel, root),
  );

  if (itemsCache[0]) selectItem(itemsCache[0]);
}

/* ───────── Tab 2: validación SI/NO ───────── */

function draftKey(x) {
  const eventId = Number(x?.evento_origen_id);
  if (Number.isFinite(eventId) && eventId > 0) return `E:${eventId}`;
  return `ENT:${String(x?.entrega_sap || "")}`;
}

function validationCard(x) {
  const key = draftKey(x);
  return `
    <article class="pernocte-validation-card batch-validation" data-key="${esc(key)}">
      <header>
        <div>
          <h3>${esc(x.codigo_tracto || "—")} · ${esc(x.placa || "—")}</h3>
          <small>ENTREGA ${esc(x.entrega_sap || "—")} · ${esc(x.conductor || "—")}</small>
        </div>
        <span class="pernocte-proposal pendiente">REVISIÓN MANUAL</span>
      </header>
      <div class="pernocte-data">
        <div><b>SALIDA CARACOTO</b><span>${esc(fmtPE(x.salida_caracoto))}</span></div>
        <div class="editable-zone">
          <b>LLEGADA SMCV (editable)</b>
          <input type="text" data-llegada value="${esc(x.llegada_smcv ? fmtPE(x.llegada_smcv).replace(/^—$/, "") : "")}" placeholder="dd/mm/yyyy hh:mm:ss" spellcheck="false">
        </div>
        <div><b>LÍMITE PERMITIDO</b><span>${esc(x.limite_permitido || "—")}</span></div>
        <div class="editable-zone">
          <b>PERNOCTÓ EN</b>
          <input type="text" data-zone value="${esc(x.zona_detectada || "")}" spellcheck="false">
        </div>
        <div><b>PERNOCTE</b><span>${esc(fmtPE(x.inicio))} → ${esc(fmtPE(x.fin))}</span></div>
      </div>
      <textarea data-obs placeholder="Observación opcional">${esc(x.observacion || "")}</textarea>
      <div class="pernocte-decision batch-decision">
        <button type="button" class="yes" data-decision="SI">SI</button>
        <button type="button" class="no" data-decision="NO">NO</button>
        <button type="button" data-decision="SIN REPORTE GPS" style="background:#475569;color:#fff">SIN REPORTE GPS</button>
        <span data-decision-state>SIN SELECCIONAR</span>
      </div>
    </article>`;
}

function sinGpsCard(x) {
  return `
    <article class="pernocte-validation-card" data-sin-gps-id="${esc(x.id)}">
      <header>
        <div>
          <h3>${esc(x.codigo_tracto || "—")} · ${esc(x.placa || "—")}</h3>
          <small>ENTREGA ${esc(x.entrega_sap || "—")} · ${esc(x.conductor || "—")}</small>
        </div>
        <span class="pernocte-proposal pendiente" style="background:#e2e8f0;color:#334155">SIN REPORTE GPS</span>
      </header>
      <div class="pernocte-data">
        <div><b>SALIDA CARACOTO</b><span>${esc(x.salida_caracoto || "—")}</span></div>
        <div><b>LÍMITE PERMITIDO</b><span>${esc(x.limite_permitido || "—")}</span></div>
        <div><b>PERNOCTÓ EN</b><span>${esc(x.pernocto_en || "SIN REGISTRO")}</span></div>
      </div>
      <div class="pernocte-decision">
        <button type="button" data-reopen style="background:#334155;color:#fff">REABRIR VALIDACIÓN</button>
      </div>
    </article>`;
}

async function renderValidacion(panel) {
  panel.innerHTML = `<section class="panel"><p class="muted">Cargando validaciones…</p></section>`;
  let s;
  try {
    s = await fetchParadasEstado();
  } catch (e) {
    panel.innerHTML = `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  const pending = s.pendientes || [];
  const revisables = s.sin_reporte_gps || [];
  validationDrafts = new Map();
  for (const x of pending) {
    const eventId = Number(x.evento_origen_id);
    validationDrafts.set(draftKey(x), {
      key: draftKey(x),
      evento_origen_id: Number.isFinite(eventId) && eventId > 0 ? eventId : null,
      entrega_sap: String(x.entrega_sap || ""),
      decision: "",
      zona: String(x.zona_detectada || ""),
      observacion: String(x.observacion || ""),
    });
  }

  panel.innerHTML = `
    <section class="notice">
      <b>Validación SI/NO:</b> solo pernoctes <b>ya registrados</b> que faltan de decisión.
      Los sin evento van a la pestaña <b>Sin registro</b>. Al guardar, salen de esta cola y baja el contador.
      Sin pendientes → <b>DESCARGAR ENVIABLE</b>.
    </section>
    ${rutaPernocteGuideHtml()}
    <section class="pernocte-toolbar">
      <article class="panel"><small>VALIDACIÓN PENDIENTE</small><h1>${pending.length}</h1><p>Requieren revisión manual.</p></article>
      <article class="panel">
        <small>REVISIÓN INTERNA</small><h1>${s.pernoctes_revision || 0}</h1>
        <p>Desde 01/09/2026</p>
        <button type="button" id="pernoctes-revision" class="secondary">DESCARGAR INTERNO</button>
      </article>
      <article class="panel">
        <small>ENVIABLE CLIENTE</small><h1>${s.pernoctes_enviable || 0}</h1>
        <p>Desde 09/09/2026 · maestro congelado · código R</p>
        <button type="button" id="pernoctes-enviable" class="primary" ${pending.length ? "disabled" : ""}>DESCARGAR ENVIABLE</button>
      </article>
    </section>
    ${
      pending.length
        ? `<div class="pending-warning"><b>${pending.length} pernocte(s) requieren revisión.</b></div>`
        : `<div class="pending-ok"><b>Sin pernoctes pendientes.</b> El ENVIABLE puede generarse.</div>`
    }
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>PERNOCTES POR VALIDAR</h2>
          <p class="muted">Seleccione SI/NO en cada caso y guarde una sola vez.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" id="cv-validar-refresh" class="secondary">ACTUALIZAR</button>
          <button type="button" id="cv-validar-guardar" class="primary" ${pending.length ? "" : "disabled"}>GUARDAR VALIDACIONES</button>
        </div>
      </div>
      <div class="pernocte-pending-list">
        ${pending.length ? pending.map(validationCard).join("") : `<div class="muted">No hay pernoctes pendientes de validación.</div>`}
      </div>
    </section>
    ${
      revisables.length
        ? `<section class="panel" style="margin-top:12px">
            <div class="panel-title"><h2>SIN REPORTE GPS (reabribles)</h2></div>
            <div class="pernocte-pending-list">${revisables.map(sinGpsCard).join("")}</div>
          </section>`
        : ""
    }
    <p id="cv-validacion-msg" class="muted" style="margin-top:10px"></p>`;

  // decision buttons
  panel.querySelectorAll(".batch-validation").forEach((card) => {
    const key = card.dataset.key;
    const draft = validationDrafts.get(key);
    if (!draft) return;
    const zone = card.querySelector("[data-zone]");
    const obs = card.querySelector("[data-obs]");
    const state = card.querySelector("[data-decision-state]");
    zone?.addEventListener("input", () => {
      draft.zona = zone.value;
    });
    obs?.addEventListener("input", () => {
      draft.observacion = obs.value;
    });
    card.querySelectorAll("[data-decision]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.decision = btn.dataset.decision;
        card.querySelectorAll("[data-decision]").forEach((b) =>
          b.classList.toggle("selected", b === btn),
        );
        if (state) state.textContent = draft.decision;
      });
    });
  });

  panel.querySelector("#cv-validar-refresh")?.addEventListener("click", () => renderValidacion(panel));

  panel.querySelector("#cv-validar-guardar")?.addEventListener("click", async () => {
    const rows = [...validationDrafts.values()]
      .filter((d) => d.decision)
      .map((d) => ({
        evento_origen_id: d.evento_origen_id,
        entrega_sap: d.entrega_sap,
        cumple_final: d.decision,
        observacion: (d.observacion || "").trim(),
        zona_detectada: (d.zona || "").trim(),
      }));
    const msg = panel.querySelector("#cv-validacion-msg");
    if (!rows.length) {
      if (msg) msg.textContent = "Seleccione al menos una decisión SI/NO.";
      return;
    }
    if (
      !confirm(
        `Se guardarán ${rows.length} validación(es). ¿Continuar?`,
      )
    )
      return;
    const btn = panel.querySelector("#cv-validar-guardar");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "GUARDANDO…";
    }
    try {
      // Persistir llegadas SMCV editadas antes del lote
      for (const card of panel.querySelectorAll(".batch-validation")) {
        const key = card.dataset.key;
        const draft = validationDrafts.get(key);
        const inp = card.querySelector("[data-llegada]");
        const val = (inp?.value || "").trim();
        if (draft && val) {
          try {
            await apiPost(API.report, {
              action: "actualizar_llegada_smcv",
              entrega_sap: draft.entrega_sap,
              llegada_smcv: fmtPE(val).replace(/^—$/, "") || val,
            });
          } catch (e) {
            console.warn("llegada_smcv", draft.entrega_sap, e);
          }
        }
      }
      const out = await apiPost(API.report, {
        action: "validar_pernoctes_lote",
        validaciones: rows,
      });
      if (msg) {
        msg.textContent = `${out.guardadas || 0} guardadas · ${out.manuales || 0} manuales · ${out.sin_reporte_gps || 0} sin GPS`;
        msg.style.color = "#86efac";
      }
      await renderValidacion(panel);
    } catch (e) {
      if (msg) {
        msg.textContent = e.message || String(e);
        msg.style.color = "#fca5a5";
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = "GUARDAR VALIDACIONES";
      }
    }
  });

  panel.querySelector("#pernoctes-revision")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    try {
      await downloadReport(
        "pernoctes_revision",
        "REPORTE_INTERNO_PERNOCTES_CERRO_VERDE.xlsx",
      );
    } catch (e) {
      alert(e.message || e);
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.textContent = "DESCARGAR INTERNO";
      }
    }
  });

  panel.querySelector("#pernoctes-enviable")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    const msg = panel.querySelector("#cv-validacion-msg");
    try {
      const name = await downloadReport(
        "pernoctes_enviable",
        "ENVIABLE_PERNOCTES_CERRO_VERDE_DESDE_09_09_2026.xlsx",
      );
      if (msg) {
        msg.textContent = `Descargado: ${name}`;
        msg.style.color = "#86efac";
      }
    } catch (e) {
      const text = e.message || String(e);
      if (msg) {
        msg.textContent = text;
        msg.style.color = "#fca5a5";
      }
      alert(text);
    } finally {
      if (b.isConnected) {
        b.disabled = pending.length > 0;
        b.textContent = "DESCARGAR ENVIABLE";
      }
    }
  });

  panel.querySelectorAll("[data-reopen]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-sin-gps-id]");
      const id = Number(card?.dataset.sinGpsId);
      if (!id) return;
      if (!confirm("¿Reabrir validación de este caso SIN REPORTE GPS?")) return;
      btn.disabled = true;
      try {
        await apiPost(API.report, { action: "reabrir_pernocte_sin_gps", id });
        await renderValidacion(panel);
      } catch (e) {
        alert(e.message || e);
        btn.disabled = false;
      }
    });
  });
}


