/**
 * MONITOREO + CLASIFICACIÓN — identificar tránsitos después de las 22:00.
 * Layout (como VentanaMapa del desktop):
 *   cabecera (fecha, contadores, filtros, poll)
 *   mapa (izq) + lista unidades (der)
 *   ficha unidad + formulario de clasificación (abajo)
 *
 * Persistencia local de clasificaciones mientras no exista backend de snapshot.
 * Cuando exista base/snapshot, runtime.state / API alimentarán `unidades`.
 */
import { moduleHead, esc, fechaPE, apiPost } from "../api-client.js";
import { API } from "../registry.js";
import { queryClocator, clocatorEndpoint } from "../../shared/clocator-client.js";
import { auth } from "../../shared/auth.js";
import { startPrecarga, loadMeta, currentRunId, getProgress, cacheIsFresh, tickPrecargaSiToca, TICK_MS } from "../precarga-engine.js";
import { readGPS, gpsKey, cacheGPS } from "../gps-cache.js";

const POLL_MS = 60 * 1000; // snapshot posiciones cada 1 min
const STORAGE_KEY = "tn_clasificaciones_v1";
const STATUS_OPTS = [
  "",
  "TRANSITO CARGADO",
  "TRANSITO VACIO",
  "ESTACIONADO CARGADO",
  "ESTACIONADO VACIO",
];

let disposed = false;
let map = null;
let markersLayer = null;
let markersByCode = new Map();
let unidades = [];
let seleccion = null;
let filtro = "Pendientes";
let busqueda = "";
let pollTimer = null;
let routeLayers = [];
let routeLoading = false;
let clipboard = null;
let leafletReady = null;
let mapsKey = "";
let mapsPromise = null;

async function loadGoogleMaps(key) {
  if (window.google?.maps) return;
  if (!key) throw new Error("Falta GOOGLE_MAPS_API_KEY (Worker clocator-proxy)");
  mapsKey = key;
  mapsPromise ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = ok;
    s.onerror = () => no(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

function gMarkerIcon(color, scale = 7) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#0b1928",
    strokeWeight: 2,
  };
}

/** Halo en píxeles (proporcional al punto, visible a cualquier zoom). */
function gHaloIcon(urg) {
  const rojo = urg === "rojo";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    // Punto scale 7 → anillo ~5× visible en zoom regional
    scale: rojo ? 34 : 28,
    fillColor: rojo ? "#ef4444" : "#eab308",
    fillOpacity: rojo ? 0.22 : 0.2,
    strokeColor: rojo ? "#ff3b3b" : "#fbbf24",
    strokeOpacity: 1,
    strokeWeight: 5,
  };
}


function loadClasificaciones() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveClasificacion(codigo, data) {
  const all = loadClasificaciones();
  all[codigo] = { ...data, timestamp_clasificacion: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function estadoClasificacion(u) {
  if (u.observaciones === "NO VA" || u.status === "NO VA") return "REVISAR";
  const filled =
    (u.status && u.status !== "-") ||
    (u.riesgo && u.riesgo !== "-") ||
    (u.punto_autorizado && u.punto_autorizado !== "-");
  return filled ? "CALIFICADA" : "PENDIENTE";
}

/** Unidades de demostración centradas en Arequipa / macro sur (hasta tener snapshot). */
function demoUnidades() {
  const saved = loadClasificaciones();
  const base = [
    {
      codigo: "20-R-799",
      placa: "APK811",
      piloto: "LARICO COCHON DANY",
      acoplado: "20-P-238",
      tipo_acople: "TOLVA HIDRAULICA",
      gestor: "CARLOS YARI",
      mercaderia: "TRANSP. CAL VIVA A GRANEL (C)",
      ruta: "PUN Caracoto a ICA Marcona",
      zona: "Transito",
      lat: -16.3989,
      lng: -71.535,
      estado_monitoreo: "DETENIDA",
      t_parada: "01:42:00",
      color_html: "ROJO",
    },
    {
      codigo: "20-R-697",
      placa: "BYW706",
      piloto: "SUYCO PANTA URIEL",
      acoplado: "20-T-199",
      tipo_acople: "TOLVA",
      gestor: "OPERACIONES SUR",
      mercaderia: "CAL VIVA A GRANEL",
      ruta: "Yura - Caracoto",
      zona: "Cesur_Caracoto_TN",
      lat: -15.5735,
      lng: -70.1055,
      estado_monitoreo: "DETENIDA",
      t_parada: "03:10:00",
      color_html: "AMARILLO",
    },
    {
      codigo: "20-R-586",
      placa: "CHF759",
      piloto: "HUACASI TICONA HUBERT",
      acoplado: "20-T-329",
      tipo_acople: "TOLVA",
      gestor: "CARLOS YARI",
      mercaderia: "CEMENTO",
      ruta: "Planta Gloria - Majes",
      zona: "Transito",
      lat: -16.41,
      lng: -71.55,
      estado_monitoreo: "MOVIMIENTO",
      t_parada: "",
      color_html: "VERDE",
    },
    {
      codigo: "20-R-904",
      placa: "V8L852",
      piloto: "SARAVIA MAMANI NILTON",
      acoplado: "20-T-254",
      tipo_acople: "TOLVA",
      gestor: "BASE MOQUEGUA",
      mercaderia: "CAL VIVA",
      ruta: "Moquegua - Tacna",
      zona: "Base_Mpquegua_TN",
      lat: -17.194,
      lng: -70.935,
      estado_monitoreo: "DETENIDA",
      t_parada: "02:05:00",
      color_html: "ROJO",
    },
    {
      codigo: "20-R-160",
      placa: "CHD788",
      piloto: "JAEN SALAZAR MIGUEL",
      acoplado: "20-T-201",
      tipo_acople: "TOLVA",
      gestor: "RACIEMSA",
      mercaderia: "TRANSP. GRANEL",
      ruta: "Arequipa - Juliaca",
      zona: "Transito",
      lat: -16.25,
      lng: -71.35,
      estado_monitoreo: "PERDIDA_GPS",
      t_parada: "",
      color_html: "GRIS",
    },
  ];
  return base.map((u) => {
    const s = saved[u.codigo] || {};
    const merged = {
      ...u,
      status: s.status ?? "-",
      riesgo: s.riesgo ?? "-",
      punto_autorizado: s.punto_autorizado ?? "-",
      cobertura_gps: s.cobertura_gps ?? "-",
      tipo_lugar: s.tipo_lugar ?? "",
      punto_pernocte: s.punto_pernocte ?? "",
      observaciones: s.observaciones ?? "",
      timestamp_clasificacion: s.timestamp_clasificacion || "",
    };
    merged.estado_clasificacion = estadoClasificacion(merged);
    return merged;
  });
}

function colorClasif(est) {
  if (est === "CALIFICADA") return "#166534";
  if (est === "REVISAR") return "#854d0e";
  return "#334155";
}

/** Color del punto = COLOR_HTML del snapshot CLocator (no el estado). */
function reporteDesdeColorLocal(colorHtml) {
  const c = String(colorHtml || "").toUpperCase();
  if (c === "VERDE") return "REPORTA";
  if (c === "ROJO") return "NO_REPORTA";
  if (c === "GRIS") return "NO_REPORTA_LARGO";
  if (c === "AMARILLO") return "ALERTA_REPORTE";
  return "SIN_DATOS";
}

function colorHtmlHex(colorHtml) {
  const c = String(colorHtml || "").toUpperCase();
  if (c === "VERDE") return "#22c55e";
  if (c === "AMARILLO") return "#eab308";
  if (c === "ROJO") return "#ef4444";
  if (c === "GRIS" || c === "PLOMO") return "#94a3b8";
  return "#64748b";
}

/** Badge de estado operativo (MOVIMIENTO / DETENIDA / PERDIDA_GPS). */
function colorEstado(est) {
  if (est === "MOVIMIENTO") return "#38bdf8";
  if (est === "DETENIDA") return "#a3e635";
  if (est === "PERDIDA_GPS") return "#f97316";
  return "#94a3b8";
}

function haversineM(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Si hay posición previa y se movió ≥100 m → MOVIMIENTO (regla desktop). */
function aplicarRegla100m(u, prev) {
  if (!prev || prev.lat == null || prev.lng == null || u.lat == null || u.lng == null) return u;
  const d = haversineM(Number(prev.lat), Number(prev.lng), Number(u.lat), Number(u.lng));
  if (d != null && d >= 100) {
    return { ...u, estado_monitoreo: "MOVIMIENTO", movimiento_m: Math.round(d) };
  }
  return u;
}

/**
 * Halo nocturno — SOLO dos estados, según movimiento REAL ≥100 m:
 *
 *   AMARILLO: se movió ≥100 m entre 22:00 y 23:00
 *             (referencia = última posición ≤22:00)
 *   ROJO:     se movió ≥100 m a partir de las 23:00
 *             (referencia = última posición ≤23:00)
 *
 * Una unidad detenida desde antes de las 22:00 → sin halo.
 * Si solo se movió hasta ~22:20 → solo amarillo (no rojo).
 * No depende de la hora actual del reloj.
 */
function evaluarHaloNocturno(puntos, fechaTurno) {
  if (!puntos?.length) return { metros: 0, metros22: 0, metros23: 0, halo: null };

  const dia = parseFechaTurno(fechaTurno);
  const corte22 = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 22, 0, 0);
  const corte23 = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 23, 0, 0);
  // Fin de ventana de análisis del turno (04:00 día siguiente)
  const corteFin = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1, 4, 0, 0);

  const pts = [];
  for (const p of puntos) {
    const ll = puntoLatLng(p);
    if (!ll) continue;
    const ft = parsePuntoFecha(p);
    if (!ft) continue; // sin hora no se puede clasificar ventana
    pts.push({ lat: ll.lat, lng: ll.lng, t: ft });
  }
  pts.sort((a, b) => a.t - b.t);
  if (!pts.length) return { metros: 0, metros22: 0, metros23: 0, halo: null };

  function maxDesplazamiento(ref, lista) {
    if (!ref || !lista.length) return 0;
    let maxD = 0;
    for (const p of lista) {
      const d = haversineM(ref.lat, ref.lng, p.lat, p.lng);
      if (d != null && d > maxD) maxD = d;
    }
    return maxD;
  }

  // Referencia a las 22:00 = último punto con t ≤ 22:00
  let ref22 = null;
  for (const p of pts) {
    if (p.t <= corte22) ref22 = p;
  }
  // Puntos en [22:00, 23:00)
  const en22 = pts.filter((p) => p.t >= corte22 && p.t < corte23);
  // Si no hay ref22, usar el primer punto de la ventana 22–23 como base
  if (!ref22 && en22.length) ref22 = en22[0];

  const metros22 = maxDesplazamiento(ref22, en22);

  // Referencia a las 23:00 = último punto con t ≤ 23:00
  let ref23 = null;
  for (const p of pts) {
    if (p.t <= corte23) ref23 = p;
  }
  // Puntos en [23:00, 04:00)
  const en23 = pts.filter((p) => p.t >= corte23 && p.t < corteFin);
  if (!ref23 && en23.length) ref23 = en23[0];

  const metros23 = maxDesplazamiento(ref23, en23);

  let halo = null;
  if (metros23 >= 100) halo = "rojo";
  else if (metros22 >= 100) halo = "amarillo";

  return {
    metros: Math.round(Math.max(metros22, metros23)),
    metros22: Math.round(metros22),
    metros23: Math.round(metros23),
    halo,
  };
}

function calcularMovimientoNocturno(puntos, fechaTurno) {
  return evaluarHaloNocturno(puntos, fechaTurno).metros;
}

/** Solo usa halo_nocturno calculado; sin fallback por hora del reloj. */
function urgenciaNocturna(u) {
  if (u.halo_nocturno === "rojo") return "rojo";
  if (u.halo_nocturno === "amarillo") return "amarillo";
  return null;
}



function markerHtml(u) {
  const c = colorHtmlHex(u.color_html);
  const urg = urgenciaNocturna(u);
  const haloClass =
    urg === "rojo" ? "halo-rojo" : urg === "amarillo" ? "halo-amarillo" : "";
  const title =
    urg === "rojo"
      ? `${u.codigo} · tránsito ≥23:00 (≥100m)`
      : urg === "amarillo"
        ? `${u.codigo} · tránsito 22:00–23:00 (≥100m)`
        : `${u.codigo}`;
  return `<div class="tn-marker ${haloClass}" style="--c:${c}" title="${esc(title)}">
    <i class="tn-halo" aria-hidden="true"></i>
    <i class="tn-dot" aria-hidden="true"></i>
  </div>`;
}

/** Prioridad operativa: en movimiento → detenida (más tiempo) → GPS perdido → resto. */
function prioridadTransit(u) {
  const est = u.estado_monitoreo || "";
  if (est === "MOVIMIENTO") return 0;
  if (est === "DETENIDA") return 1;
  if (est === "PERDIDA_GPS") return 2;
  return 3;
}

function parseParadaMin(t) {
  if (!t) return 0;
  const m = String(t).match(/(\d+):(\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function unidadesFiltradas() {
  const q = busqueda.trim().toUpperCase();
  const rows = unidades.filter((u) => {
    if (filtro === "Pendientes" && u.estado_clasificacion !== "PENDIENTE") return false;
    if (filtro === "Calificadas" && u.estado_clasificacion !== "CALIFICADA") return false;
    if (filtro === "Revisar" && u.estado_clasificacion !== "REVISAR") return false;
    if (filtro === "En transito" && u.estado_monitoreo !== "MOVIMIENTO") return false;
    if (filtro === "Detenidas" && u.estado_monitoreo !== "DETENIDA") return false;
    if (filtro === "Fuera zona" && String(u.zona || "") !== "Transito") return false;
    if (!q) return true;
    return [u.codigo, u.placa, u.piloto, u.ruta, u.zona]
      .join(" ")
      .toUpperCase()
      .includes(q);
  });
  return rows.sort((a, b) => {
    const pa = prioridadTransit(a);
    const pb = prioridadTransit(b);
    if (pa !== pb) return pa - pb;
    // Detenidas: más tiempo de parada primero
    if (pa === 1) return parseParadaMin(b.t_parada) - parseParadaMin(a.t_parada);
    return String(a.codigo).localeCompare(String(b.codigo));
  });
}

function contadores() {
  let p = 0,
    c = 0,
    r = 0;
  for (const u of unidades) {
    if (u.estado_clasificacion === "PENDIENTE") p++;
    else if (u.estado_clasificacion === "CALIFICADA") c++;
    else if (u.estado_clasificacion === "REVISAR") r++;
  }
  return { p, c, r, t: unidades.length };
}

function fechaTurnoDefault() {
  const now = new Date();
  // Si es antes de las 12, el turno “es” de la noche anterior
  const d = new Date(now);
  if (now.getHours() < 12) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}


/** Fecha del turno desde el input (YYYY-MM-DD) → Date local Lima aproximado. */
function parseFechaTurno(val) {
  if (!val) return new Date();
  const [y, m, d] = String(val).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatPE(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function parsePuntoFecha(p) {
  const raw = p.fecha || p.fechaFinToString || p.fechaInicioToString || p.time || "";
  if (!raw) return null;
  // dd/MM/yyyy HH:mm:ss
  let m = String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
    );
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

function puntoLatLng(p) {
  const lat = Number(p.lat ?? p.latitud);
  const lng = Number(p.lng ?? p.lon ?? p.longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Partición del recorrido:
 *  - azul: desde 16:00 del día del turno hasta 22:00
 *  - rojo: después de las 22:00 (tránsito nocturno)
 */
function partirRecorrido(puntos, fechaTurno) {
  const dia = parseFechaTurno(fechaTurno);
  const corte = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 22, 0, 0);
  const azul = [];
  const rojo = [];
  for (const p of puntos || []) {
    const ll = puntoLatLng(p);
    if (!ll) continue;
    const ft = parsePuntoFecha(p);
    const item = { ...ll, fecha: p.fecha || p.fechaFinToString || "" };
    if (!ft || ft < corte) azul.push(item);
    else rojo.push(item);
  }
  return { azul, rojo };
}

function clearRouteLayers() {
  for (const layer of routeLayers) {
    try {
      if (layer.setMap) layer.setMap(null);
    } catch {
      /* ignore */
    }
  }
  routeLayers = [];
}

/** Recorrido 16:00→último punto: azul ≤22h, rojo >22h. Sin fitBounds. */
function drawSplitRoute(azul, rojo) {
  if (!map || !window.google?.maps) return;
  clearRouteLayers();
  // Unir en el corte para que no quede hueco visual
  let pathAzul = azul.map((p) => ({ lat: p.lat, lng: p.lng }));
  let pathRojo = rojo.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (pathAzul.length && pathRojo.length) {
    pathRojo = [pathAzul[pathAzul.length - 1], ...pathRojo];
  }
  if (pathAzul.length >= 2) {
    routeLayers.push(
      new google.maps.Polyline({
        path: pathAzul,
        geodesic: true,
        strokeColor: "#2563EB",
        strokeOpacity: 0.95,
        strokeWeight: 5,
        map,
        zIndex: 200,
      }),
    );
  }
  if (pathRojo.length >= 2) {
    routeLayers.push(
      new google.maps.Polyline({
        path: pathRojo,
        geodesic: true,
        strokeColor: "#DC2626",
        strokeOpacity: 0.95,
        strokeWeight: 5,
        map,
        zIndex: 210,
      }),
    );
  }
  // Fallback: si el split dejó tramos cortos pero hay ≥2 pts en total
  if (routeLayers.length === 0) {
    const all = [...pathAzul, ...pathRojo];
    if (all.length >= 2) {
      routeLayers.push(
        new google.maps.Polyline({
          path: all,
          geodesic: true,
          strokeColor: "#2563EB",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          map,
          zIndex: 200,
        }),
      );
    } else if (all.length === 1) {
      routeLayers.push(
        new google.maps.Marker({
          position: all[0],
          map,
          icon: gMarkerIcon("#2563EB", 6),
          zIndex: 220,
        }),
      );
    }
  }
}



export async function mount(container, runtime) {
  disposed = false;
  document.body.classList.add("tn-fs-monitoreo");
  // Preferir base real del turno (snapshot + match OC local)
  try {
    const base = JSON.parse(localStorage.getItem("tn_base_turno_v1") || "null");
    if (base?.unidades?.length) {
      const saved = loadClasificaciones();
      unidades = base.unidades.map((u) => {
        const s = saved[u.codigo] || {};
        const merged = {
          ...u,
          movimiento_nocturno_m: u.movimiento_nocturno_m || 0,
          reporte_gps: u.reporte_gps || reporteDesdeColorLocal(u.color_html),
          status: s.status ?? u.status ?? "-",
          riesgo: s.riesgo ?? u.riesgo ?? "-",
          punto_autorizado: s.punto_autorizado ?? u.punto_autorizado ?? "-",
          cobertura_gps: s.cobertura_gps ?? u.cobertura_gps ?? "-",
          tipo_lugar: s.tipo_lugar ?? u.tipo_lugar ?? "",
          punto_pernocte: s.punto_pernocte ?? u.punto_pernocte ?? "",
          observaciones: s.observaciones ?? u.observaciones ?? "",
          ruta: s.ruta ?? u.ruta ?? "",
          timestamp_clasificacion: s.timestamp_clasificacion || "",
        };
        merged.estado_clasificacion = estadoClasificacion(merged);
        return merged;
      });
    } else {
      unidades = demoUnidades();
    }
  } catch {
    unidades = demoUnidades();
  }

  container.innerHTML = `
    <div class="tn-track">
      <header class="tn-track-head">
        <div class="tn-track-title" style="display:flex;align-items:center;gap:12px">
          <button type="button" class="tn-btn-back" id="tn-back">← VOLVER</button>
          <div>
            <p class="eyebrow">MAPA · UNIDADES MONITOREADAS</p>
            <h1>TURNO AMANECIDA</h1>
          </div>
        </div>
        <div class="tn-track-meta">
          <label class="tn-field">
            <span>FECHA TURNO</span>
            <input type="date" id="tn-fecha" value="${fechaTurnoDefault()}">
          </label>
          <div class="tn-counters" id="tn-counters"></div>
          <div class="tn-live">
            <span class="tn-live-dot" id="tn-live-dot"></span>
            <span id="tn-live-txt">Posiciones 1 min</span>
          </div>
          <span class="tn-chip" id="tn-precarga">Rutas: —</span>
          <button type="button" class="ghost" id="tn-refresh">REFRESCAR</button>
        </div>
      </header>

      <div class="tn-alerts" id="tn-alerts" aria-live="polite"></div>
      <div class="tn-track-toolbar">
        <div class="tn-filters" id="tn-filters">
          <button type="button" data-f="Pendientes" class="active">POR CLASIFICAR</button>
          <button type="button" data-f="En transito">EN TRÁNSITO</button>
          <button type="button" data-f="Detenidas">DETENIDAS</button>
          <button type="button" data-f="Fuera zona">ZONA TRÁNSITO</button>
          <button type="button" data-f="Calificadas">CALIFICADAS</button>
          <button type="button" data-f="Revisar">REVISAR</button>
          <button type="button" data-f="Todas">TODAS</button>
        </div>
        <input class="search" id="tn-search" placeholder="Buscar código, placa, piloto, ruta…">
      </div>

      <div class="tn-track-main">
        <div class="tn-map-wrap">
          <div id="tn-map" class="tn-map"></div>
          <div class="tn-map-legend">
            <span><i style="background:#22c55e"></i> Reporta</span>
            <span><i style="background:#eab308"></i> Alerta GPS</span>
            <span><i style="background:#ef4444"></i> No reporta</span>
            <span><i style="background:#94a3b8"></i> Plomo</span>
            <span><i class="halo-leg am"></i> Tránsito 22–23h</span>
            <span><i class="halo-leg ro"></i> Tránsito ≥23h</span>
            <span><i style="background:#2563eb;width:14px;height:3px;border-radius:1px"></i> 16–22h</span>
            <span><i style="background:#dc2626;width:14px;height:3px;border-radius:1px"></i> post-22h</span>
          </div>
        </div>
        <div class="tn-right">
          <aside class="tn-list-panel">
            <div class="tn-list-head">
              <b>UNIDADES</b>
              <small id="tn-list-count">0</small>
            </div>
            <div class="tn-list" id="tn-list"></div>
          </aside>
          <section class="tn-detail" id="tn-detail">
            <div class="tn-detail-empty" id="tn-detail-empty">
              Selecciona una unidad en la lista o en el mapa para clasificarla.
            </div>
            <div class="tn-detail-body hidden" id="tn-detail-body">
              <div class="tn-detail-top">
                <div class="tn-id-line">
                  <b id="tn-sel-code">—</b>
                  <span id="tn-sel-title">—</span>
                  <label class="tn-ruta-inline">RUTA
                    <input id="tn-ruta" type="text" placeholder="Editable · no se copia">
                  </label>
                </div>
              </div>
              <div class="tn-class-form tn-class-horizontal">
                <label>STATUS
                  <select id="tn-status"></select>
                </label>
                <div class="tn-riesgo">
                  <span>RIESGO</span>
                  <div class="tn-riesgo-btns">
                    <button type="button" data-r="BAJO" class="r-bajo">BAJO</button>
                    <button type="button" data-r="MEDIO" class="r-medio">MEDIO</button>
                    <button type="button" data-r="ALTO" class="r-alto">ALTO</button>
                  </div>
                </div>
                <div class="tn-sino-field">
                  <span>PUNTO AUTORIZADO</span>
                  <div class="tn-sino" id="tn-aut">
                    <button type="button" data-v="SI">SI</button>
                    <button type="button" data-v="NO">NO</button>
                  </div>
                </div>
                <div class="tn-sino-field">
                  <span>COBERTURA GPS</span>
                  <div class="tn-sino" id="tn-gps">
                    <button type="button" data-v="SI">SI</button>
                    <button type="button" data-v="NO">NO</button>
                  </div>
                </div>
                <label>TIPO LUGAR
                  <input id="tn-lugar" type="text" placeholder="Patio, grifo…">
                </label>
                <label class="grow">PUNTO PERNOCTE
                  <input id="tn-pernocte" type="text" placeholder="Referencia">
                </label>
                <label class="grow">OBSERVACIONES
                  <input id="tn-obs" type="text" placeholder="Notas">
                </label>
              </div>
              <div class="tn-class-actions tn-class-actions-bottom">
                <button type="button" class="primary" id="tn-save">GUARDAR</button>
                <button type="button" class="ghost" id="tn-copy">COPIAR</button>
                <button type="button" class="ghost" id="tn-paste">PEGAR</button>
                <button type="button" class="ghost" id="tn-clear">LIMPIAR</button>
                <button type="button" class="tn-btn-nova" id="tn-nova">NO VA</button>
                <span id="tn-save-msg" class="muted"></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  // Status options (evitar template anidado frágil)
  const statusSel = container.querySelector("#tn-status");
  if (statusSel) {
    statusSel.innerHTML = STATUS_OPTS.map(
      (o) => `<option value="${esc(o)}">${esc(o || "—")}</option>`,
    ).join("");
  }

  const listEl = container.querySelector("#tn-list");
  const countersEl = container.querySelector("#tn-counters");
  const listCount = container.querySelector("#tn-list-count");
  const emptyEl = container.querySelector("#tn-detail-empty");
  const bodyEl = container.querySelector("#tn-detail-body");
  const msgEl = container.querySelector("#tn-save-msg");

  container.querySelector("#tn-back")?.addEventListener("click", () => {
    document.body.classList.remove("tn-fs-monitoreo");
    const btn =
      document.querySelector('nav button[data-route="base"]') ||
      document.querySelector('nav button[data-route="home"]');
    btn?.click();
  });

  // Alertas: Lista / Desestimar / Ir a unidad (delegación; sobrevive a re-paint)
  container.querySelector("#tn-alerts")?.addEventListener("click", (e) => {
    const dis = e.target.closest("[data-dismiss]");
    if (dis) {
      e.preventDefault();
      e.stopPropagation();
      dismissAlert(dis.getAttribute("data-dismiss"));
      return;
    }
    const go = e.target.closest(".tn-alert-goto");
    if (go?.dataset?.code) {
      e.preventDefault();
      selectUnit(go.dataset.code);
      return;
    }
    const tog = e.target.closest("#tn-alerts-toggle, .tn-alerts-toggle");
    if (tog) {
      e.preventDefault();
      const box = container.querySelector("#tn-alerts");
      if (!box) return;
      box.dataset.userToggled = "1";
      box.classList.toggle("open");
      const open = box.classList.contains("open");
      const btn = container.querySelector("#tn-alerts-toggle");
      if (btn) btn.textContent = open ? "Ocultar" : "Lista";
    }
  });

  const ALERTS_DISMISS_KEY = "tn_alerts_dismissed_v1";

  function fechaAlertas() {
    return container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
  }

  function loadDismissed() {
    try {
      const all = JSON.parse(localStorage.getItem(ALERTS_DISMISS_KEY) || "{}");
      return all[fechaAlertas()] || {};
    } catch {
      return {};
    }
  }

  function saveDismissed(map) {
    try {
      const all = JSON.parse(localStorage.getItem(ALERTS_DISMISS_KEY) || "{}");
      all[fechaAlertas()] = map;
      localStorage.setItem(ALERTS_DISMISS_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }

  function dismissAlert(id) {
    const m = loadDismissed();
    m[id] = { at: new Date().toISOString() };
    saveDismissed(m);
    paintAlerts();
  }

  /** Lista de alertas activas (no desestimadas). Persisten hasta desestimar. */
  function buildAlertList() {
    const dismissed = loadDismissed();
    const list = [];
    for (const u of unidades) {
      const code = u.codigo;
      if (u.halo_nocturno === "rojo") {
        const id = `${code}|grave`;
        if (!dismissed[id]) {
          list.push({
            id,
            nivel: "grave",
            codigo: code,
            placa: u.placa || "",
            texto: `Tránsito ≥23h · ${u.movimiento_nocturno_m || "?"} m`,
          });
        }
      } else if (u.halo_nocturno === "amarillo") {
        const id = `${code}|leve`;
        if (!dismissed[id]) {
          list.push({
            id,
            nivel: "leve",
            codigo: code,
            placa: u.placa || "",
            texto: `Tránsito 22–23h · ${u.movimiento_nocturno_m || "?"} m`,
          });
        }
      }
      const col = String(u.color_html || u.reporte_gps || "").toUpperCase();
      if (col.includes("ROJO") || col === "NO_REPORTA" || u.clase_html === "fila-rojo-opaco") {
        const id = `${code}|gps`;
        if (!dismissed[id]) {
          list.push({
            id,
            nivel: "gps",
            codigo: code,
            placa: u.placa || "",
            texto: "Sin reporte GPS (rojo/plomo largo)",
          });
        }
      }
    }
    // graves primero
    list.sort((a, b) => {
      const o = { grave: 0, leve: 1, gps: 2 };
      return (o[a.nivel] ?? 9) - (o[b.nivel] ?? 9) || a.codigo.localeCompare(b.codigo);
    });
    return list;
  }

  function paintAlerts() {
    const el = container.querySelector("#tn-alerts");
    if (!el) return;
    const wasOpen = el.classList.contains("open");
    const list = buildAlertList();
    const nGrave = list.filter((x) => x.nivel === "grave").length;
    const nLeve = list.filter((x) => x.nivel === "leve").length;
    const nGps = list.filter((x) => x.nivel === "gps").length;

    const summary = [];
    if (nGrave) summary.push(`<span class="tn-alert tn-alert-grave"><b>${nGrave}</b> ≥23h</span>`);
    if (nLeve) summary.push(`<span class="tn-alert tn-alert-leve"><b>${nLeve}</b> 22–23h</span>`);
    if (nGps) summary.push(`<span class="tn-alert tn-alert-gps"><b>${nGps}</b> sin GPS</span>`);

    if (!list.length) {
      el.innerHTML = `<div class="tn-alerts-head"><span class="tn-alerts-label">ALERTAS</span><span class="tn-alert tn-alert-ok">Sin alertas pendientes</span></div>`;
      el.classList.remove("has-list", "open");
      return;
    }

    const rows = list
      .map(
        (a) => `
      <div class="tn-alert-row nivel-${esc(a.nivel)}" data-alert-id="${esc(a.id)}">
        <button type="button" class="tn-alert-goto" data-code="${esc(a.codigo)}" title="Ir a unidad">
          <b>${esc(a.codigo)}</b>
          <small>${esc(a.placa)}</small>
          <span>${esc(a.texto)}</span>
        </button>
        <button type="button" class="tn-alert-dismiss" data-dismiss="${esc(a.id)}" title="Desestimar">DESESTIMAR</button>
      </div>`,
      )
      .join("");

    // Lista abierta por defecto la primera vez; respeta si el usuario la cerró
    const open = wasOpen || !el.dataset.userToggled;
    el.innerHTML = `
      <div class="tn-alerts-head">
        <span class="tn-alerts-label">ALERTAS · ${list.length}</span>
        ${summary.join("")}
        <button type="button" class="tn-alerts-toggle" id="tn-alerts-toggle">${open ? "Ocultar" : "Lista"}</button>
      </div>
      <div class="tn-alerts-list" id="tn-alerts-list">${rows}</div>`;
    el.classList.add("has-list");
    el.classList.toggle("open", open);
  }

  function renderCounters() {
    if (!countersEl) return;
    const { p, c, r, t: tot } = contadores();
    countersEl.innerHTML = `
      <span class="tn-chip pend"><b>${p}</b> pend</span>
      <span class="tn-chip ok"><b>${c}</b> calif</span>
      <span class="tn-chip rev"><b>${r}</b> revisar</span>
      <span class="tn-chip"><b>${tot}</b> total</span>
    `;
    paintAlerts();
  }

  function renderList() {
    if (!listEl) return;
    const rows = unidadesFiltradas();
    if (listCount) listCount.textContent = String(rows.length);
    listEl.innerHTML = rows
      .map((u) => {
        const active = seleccion?.codigo === u.codigo ? "active" : "";
        return `
        <button type="button" class="tn-list-item ${active}" data-code="${esc(u.codigo)}">
          <span class="tn-li-status" style="background:${colorClasif(u.estado_clasificacion)}"></span>
          <span class="tn-li-main">
            <b>${esc(u.codigo)}${
              u.halo_nocturno === "rojo"
                ? '<i class="tn-pip grave" title="Tránsito ≥23h"></i>'
                : u.halo_nocturno === "amarillo"
                  ? '<i class="tn-pip leve" title="Tránsito 22–23h"></i>'
                  : ""
            }</b>
            <small>${esc(u.placa || "—")} · ${esc(u.piloto || "—")}</small>
          </span>
          <span class="tn-li-meta">
            <small title="T.Parada">${esc(u.t_parada || "—")}</small>
          </span>
        </button>`;
      })
      .join("");
  }

  function clearMarkers() {
    for (const mk of markersByCode.values()) {
      try {
        mk.setMap?.(null);
        mk.__halo?.setMap?.(null);
      } catch {
        /* ignore */
      }
    }
    markersByCode.clear();
  }

  function syncMarkers({ fitOnce = false } = {}) {
    if (!map || !window.google?.maps) return;
    clearMarkers();
    const rows = unidadesFiltradas();
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const u of rows) {
      if (u.lat == null || u.lng == null) continue;
      const pos = { lat: Number(u.lat), lng: Number(u.lng) };
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;
      const color = colorHtmlHex(u.color_html);
      const urg = urgenciaNocturna(u);
      const marker = new google.maps.Marker({
        map,
        position: pos,
        title: u.codigo,
        icon: gMarkerIcon(color, 7),
        zIndex: urg ? 300 : 200,
      });
      marker.addListener("click", () => selectUnit(u.codigo));
      if (urg) {
        // Contorno en píxeles (no metros): se ve a zoom lejano, proporción al punto
        marker.__halo = new google.maps.Marker({
          map,
          position: pos,
          icon: gHaloIcon(urg),
          clickable: false,
          zIndex: 140,
          optimized: false,
          title: urg === "rojo" ? "Tránsito ≥23h" : "Tránsito 22–23h",
        });
      }
      markersByCode.set(u.codigo, marker);
      bounds.extend(pos);
      any = true;
    }
    if (fitOnce && any && !seleccion) {
      try {
        map.fitBounds(bounds, 48);
        if (map.getZoom() > 11) map.setZoom(11);
      } catch {
        /* ignore */
      }
    }
  }

  async function mostrarRecorridoUnidad(u) {
    if (!u) return;
    // Solo caché de precarga (16:00 → hora de proceso + ticks). NUNCA Comsatel al click.
    try {
      const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
      const placaU = String(u.placa || "").trim().toUpperCase();
      const tractoU = String(u.codigo || "").trim().toUpperCase();
      let pts = [];
      const meta = loadMeta();
      const ids = [
        currentRunId(),
        meta?.id,
        meta?.fecha ? `tn_${meta.fecha}` : null,
        fechaVal ? `tn_${String(fechaVal).slice(0, 10)}` : null,
      ].filter(Boolean);
      const keyPairs = [
        [tractoU, placaU],
        [tractoU, ""],
        ["", placaU],
      ];
      for (const rid of ids) {
        if (pts.length) break;
        for (const [c, pl] of keyPairs) {
          try {
            const cached = await readGPS(gpsKey(rid, c, pl));
            if (cached?.puntos_gps?.length) {
              pts = cached.puntos_gps;
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!pts.length) {
        clearRouteLayers();
        const m = loadMeta();
        if (m?.running) {
          if (msgEl) msgEl.textContent = "Recorrido en precarga… espera a que termine el lote";
        } else {
          if (msgEl) {
            msgEl.textContent =
              "Sin recorrido en caché. Genera base del turno o espera la precarga (16:00→ahora).";
          }
        }
        return;
      }

      const { azul, rojo } = partirRecorrido(pts, fechaVal);
      drawSplitRoute(azul, rojo);
      const ev = evaluarHaloNocturno(pts, fechaVal);
      u.movimiento_nocturno_m = ev.metros;
      u.halo_nocturno = ev.halo;
      if (msgEl) {
        msgEl.textContent = `Recorrido precargado: ${pts.length} pts · azul ${azul.length} · rojo ${rojo.length}`;
      }
    } catch (err) {
      console.warn("[TN] recorrido", err);
      if (msgEl) msgEl.textContent = `Recorrido: ${err.message || err}`;
      clearRouteLayers();
    }
  }

  async function refrescarPosiciones() {
    const data = await apiPost(API.snapshot, { action: "snapshot" });
    if (!data?.ok || !Array.isArray(data.unidades)) throw new Error(data?.error || "Snapshot falló");
    if (data.google_maps_api_key || data.googleMapsApiKey || data.maps_api_key) mapsKey = data.google_maps_api_key || data.googleMapsApiKey || data.maps_api_key;
    const byCode = new Map(data.unidades.map((x) => [x.codigo, x]));
    let moved = 0;
    for (const u of unidades) {
      const n = byCode.get(u.codigo);
      if (!n) continue;
      if (n.lat != null && n.lng != null) {
        const d = haversineM(Number(u.lat), Number(u.lng), Number(n.lat), Number(n.lng));
        if (d != null && d >= 1) moved += 1;
        u.lat = n.lat;
        u.lng = n.lng;
      }
      if (n.color_html) u.color_html = n.color_html;
      if (n.clase_html) u.clase_html = n.clase_html;
      if (n.reporte_gps) u.reporte_gps = n.reporte_gps;
      if (n.t_parada != null) u.t_parada = n.t_parada;
    }
    try {
      const raw = localStorage.getItem("tn_base_turno_v1");
      if (raw) {
        const base = JSON.parse(raw);
        base.unidades = unidades;
        base.generado_en = new Date().toISOString();
        localStorage.setItem("tn_base_turno_v1", JSON.stringify(base));
      }
    } catch {
      /* ignore */
    }
    syncMarkers();
    msgEl.textContent = `Posiciones OK · ${moved} con cambio · snap ${data.unidades.length}`;
    pulseLive();
    return data;
  }


  function setSino(id, val) {
    const v = String(val || "").toUpperCase();
    container.querySelectorAll(`#${id} button`).forEach((b) => {
      b.classList.toggle("active", b.dataset.v === v);
    });
  }
  function readSino(id) {
    return container.querySelector(`#${id} button.active`)?.dataset.v || "-";
  }

  function fillForm(u, { includeRuta = true } = {}) {
    container.querySelector("#tn-status").value = u.status === "-" ? "" : u.status || "";
    setSino("tn-aut", u.punto_autorizado);
    setSino("tn-gps", u.cobertura_gps);
    container.querySelector("#tn-lugar").value = u.tipo_lugar || "";
    container.querySelector("#tn-pernocte").value = u.punto_pernocte || "";
    container.querySelector("#tn-obs").value = u.observaciones || "";
    if (includeRuta) {
      const r = container.querySelector("#tn-ruta");
      if (r) r.value = u.ruta || "";
    }
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) => {
      b.classList.toggle("active", b.dataset.r === (u.riesgo === "-" ? "" : u.riesgo));
    });
  }

  /** Solo campos de clasificación (NO incluye ruta). */
  function readClasificacion() {
    const riesgoBtn = container.querySelector(".tn-riesgo-btns button.active");
    return {
      status: container.querySelector("#tn-status").value || "-",
      riesgo: riesgoBtn?.dataset.r || "-",
      punto_autorizado: readSino("tn-aut"),
      cobertura_gps: readSino("tn-gps"),
      tipo_lugar: container.querySelector("#tn-lugar").value.trim(),
      punto_pernocte: container.querySelector("#tn-pernocte").value.trim(),
      observaciones: container.querySelector("#tn-obs").value.trim(),
    };
  }

  function readForm() {
    return {
      ...readClasificacion(),
      ruta: (container.querySelector("#tn-ruta")?.value || "").trim(),
    };
  }

  function selectUnit(codigo) {
    const u = unidades.find((x) => x.codigo === codigo);
    if (!u) return;
    seleccion = u;
    emptyEl.classList.add("hidden");
    bodyEl.classList.remove("hidden");

    container.querySelector("#tn-sel-code").textContent = u.codigo;
    container.querySelector("#tn-sel-title").textContent =
      `${u.placa || "S/P"} · ${u.piloto || "Sin piloto"}`;

    fillForm(u);
    renderList();
    msgEl.textContent = "";
    mostrarRecorridoUnidad(u);
  }

  function applyToSelected(data, { advance = true } = {}) {
    if (!seleccion) return;
    Object.assign(seleccion, data);
    seleccion.estado_clasificacion = estadoClasificacion(seleccion);
    saveClasificacion(seleccion.codigo, {
      status: seleccion.status,
      riesgo: seleccion.riesgo,
      punto_autorizado: seleccion.punto_autorizado,
      cobertura_gps: seleccion.cobertura_gps,
      tipo_lugar: seleccion.tipo_lugar,
      punto_pernocte: seleccion.punto_pernocte,
      observaciones: seleccion.observaciones,
      ruta: seleccion.ruta || "",
    });
    renderCounters();
    renderList();
    syncMarkers();
    selectUnit(seleccion.codigo);

    if (advance) {
      const rows = unidadesFiltradas();
      const idx = rows.findIndex((x) => x.codigo === seleccion.codigo);
      const next = rows[idx + 1] || rows.find((x) => x.estado_clasificacion === "PENDIENTE");
      if (next && next.codigo !== seleccion.codigo) selectUnit(next.codigo);
    }
  }

  // Filters
  container.querySelector("#tn-filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-f]");
    if (!btn) return;
    filtro = btn.dataset.f;
    container.querySelectorAll("#tn-filters button").forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    renderList();
    syncMarkers();
  });

  container.querySelector("#tn-search")?.addEventListener("input", (e) => {
    busqueda = e.target.value || "";
    renderList();
    syncMarkers();
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-code]");
    if (btn) selectUnit(btn.dataset.code);
  });

  container.querySelector(".tn-riesgo-btns")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-r]");
    if (!btn) return;
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
  });
  container.querySelectorAll(".tn-sino").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-v]");
      if (!btn) return;
      group.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  container.querySelector("#tn-save")?.addEventListener("click", () => {
    if (!seleccion) return;
    applyToSelected(readForm());
    clearRouteLayers(); // recorrido desaparece al guardar
    msgEl.textContent = "Guardado · recorrido limpiado";
  });

  container.querySelector("#tn-copy")?.addEventListener("click", () => {
    // Solo clasificación — sin ruta
    clipboard = readClasificacion();
    msgEl.textContent = "Clasificación copiada (sin ruta)";
  });

  container.querySelector("#tn-paste")?.addEventListener("click", () => {
    if (!clipboard || !seleccion) {
      msgEl.textContent = "Nada en portapapeles";
      return;
    }
    // No pisa la ruta de la unidad
    fillForm({ ...seleccion, ...clipboard }, { includeRuta: false });
    msgEl.textContent = "Pegado (ruta no modificada)";
  });

  container.querySelector("#tn-clear")?.addEventListener("click", () => {
    fillForm(
      {
        status: "",
        riesgo: "",
        punto_autorizado: "",
        cobertura_gps: "",
        tipo_lugar: "",
        punto_pernocte: "",
        observaciones: "",
        ruta: seleccion?.ruta || "",
      },
      { includeRuta: true },
    );
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) =>
      b.classList.remove("active"),
    );
  });

  container.querySelector("#tn-nova")?.addEventListener("click", () => {
    if (!seleccion) return;
    applyToSelected({
      status: "-",
      riesgo: "-",
      punto_autorizado: "-",
      cobertura_gps: "-",
      tipo_lugar: "",
      punto_pernocte: "",
      observaciones: "NO VA",
    });
    msgEl.textContent = "Marcado NO VA";
  });

  container.querySelector("#tn-refresh")?.addEventListener("click", async () => {
    msgEl.textContent = "Actualizando posiciones…";
    try {
      await refrescarPosiciones();
    } catch (e) {
      msgEl.textContent = `Refresh: ${e.message || e}`;
    }
  });

  function pulseLive() {
    const dot = container.querySelector("#tn-live-dot");
    const txt = container.querySelector("#tn-live-txt");
    if (!dot) return;
    dot.classList.add("pulse");
    txt.textContent = `Actualizado ${new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}`;
    setTimeout(() => dot.classList.remove("pulse"), 800);
  }

  // Google Maps — key desde Worker clocator-proxy (secret GOOGLE_MAPS_API_KEY ya en Work)
  try {
    let key = mapsKey;

    function pickMapsKey(j) {
      if (!j || typeof j !== "object") return "";
      return (
        j.google_maps_api_key ||
        j.googleMapsApiKey ||
        j.maps_api_key ||
        j.mapsApiKey ||
        j.GOOGLE_MAPS_API_KEY ||
        (j.config && (j.config.google_maps_api_key || j.config.maps_api_key)) ||
        ""
      );
    }

    async function workerPost(body) {
      const user = auth.currentUser;
      if (!user) throw new Error("Sin sesión");
      const r = await fetch(API.clocator, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken(false)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(j.error || j.message || `HTTP ${r.status}`);
        err.status = r.status;
        err.data = j;
        throw err;
      }
      return j;
    }

    /** Extrae key del Worker sin inventar endpoints nuevos. */
    async function fetchMapsKeyFromWork() {
      // 1) Acciones livianas que el Worker puede soportar
      for (const action of ["map_config", "config", "health"]) {
        try {
          const j = await workerPost({ action });
          const k = pickMapsKey(j);
          if (k) return k;
        } catch (e) {
          console.warn("[TN] worker action", action, e.message || e);
        }
      }
      // 2) Recorrido mínimo con include_map (mismo patrón del proxy: trae la key)
      const u0 = unidades.find((u) => u.placa) || unidades[0];
      if (u0?.placa) {
        try {
          const j = await workerPost({
            placa: String(u0.placa).trim().toUpperCase(),
            tracto: String(u0.codigo || "").trim().toUpperCase(),
            include_map: true,
            // ventana mínima para no saturar
            desde: "01/01/2020 00:00:00",
            hasta: "01/01/2020 00:05:00",
          });
          const k = pickMapsKey(j);
          if (k) return k;
        } catch (e) {
          console.warn("[TN] worker include_map key", e.message || e);
        }
      }
      return "";
    }

    try {
      const boot = await apiPost(API.snapshot, { action: "snapshot" });
      const kBoot = pickMapsKey(boot);
      if (kBoot) {
        key = kBoot;
        mapsKey = key;
      }
      if (boot?.ok && Array.isArray(boot.unidades)) {
        const byCode = new Map(boot.unidades.map((x) => [x.codigo, x]));
        for (const u of unidades) {
          const n = byCode.get(u.codigo);
          if (!n) continue;
          if (n.lat != null) u.lat = n.lat;
          if (n.lng != null) u.lng = n.lng;
          if (n.color_html) u.color_html = n.color_html;
          if (n.clase_html) u.clase_html = n.clase_html;
          if (n.t_parada != null) u.t_parada = n.t_parada;
        }
      }
    } catch (e) {
      console.warn("[TN] boot snapshot Work", e);
    }

    if (!key) {
      try {
        key = await fetchMapsKeyFromWork();
        if (key) mapsKey = key;
      } catch (e) {
        console.warn("[TN] key Work", e);
      }
    }

    if (!key) {
      throw new Error(
        "Sin GOOGLE_MAPS_API_KEY en respuestas del Worker clocator-proxy (secret existe; el Worker debe incluirla en snapshot o en include_map).",
      );
    }
    await loadGoogleMaps(key);
    if (disposed) return;
    map = new google.maps.Map(container.querySelector("#tn-map"), {
      center: { lat: -16.4, lng: -71.5 },
      zoom: 8,
      mapTypeId: "hybrid",
      fullscreenControl: true,
      streetViewControl: false,
      mapTypeControl: true,
      gestureHandling: "greedy",
    });
  } catch (e) {
    const mapEl = container.querySelector("#tn-map");
    if (mapEl) {
      mapEl.innerHTML = `<div class="tn-map-error">Mapa no disponible: ${esc(e.message || e)}</div>`;
    } else {
      console.error("[TN] #tn-map no existe", e);
      container.insertAdjacentHTML(
        "beforeend",
        `<div class="tn-map-error" style="padding:24px">Mapa no disponible: ${esc(e.message || e)}</div>`,
      );
    }
  }




  // Precarga de rutas en caché (16:00→ahora) — no bloquea la UI
  const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
  const precargaEl = container.querySelector("#tn-precarga");
  async function enriquecerMovimientoDesdeCache() {
    const rid = currentRunId() || loadMeta()?.id;
    if (!rid) return;
    const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
    let changed = false;
    for (const u of unidades) {
      try {
        const cached = await readGPS(
          gpsKey(rid, String(u.codigo || "").toUpperCase(), String(u.placa || "").toUpperCase()),
        );
        if (!cached?.puntos_gps?.length) continue;
        const ev = evaluarHaloNocturno(cached.puntos_gps, fechaVal);
        if (ev.metros !== (u.movimiento_nocturno_m || 0) || ev.halo !== (u.halo_nocturno || null)) {
          u.movimiento_nocturno_m = ev.metros;
          u.halo_nocturno = ev.halo;
          changed = true;
        }
      } catch {
        /* ignore */
      }
    }
    renderList();
    paintAlerts();
    // Siempre re-sincronizar marcadores para aplicar/quitar halos tras precarga
    syncMarkers();
  }

  function paintPrecarga() {
    const m = loadMeta();
    const g = getProgress();
    if (!precargaEl) return;
    if (g.running || m?.running) {
      const sk = m?.skipped || g.skipped || 0;
      precargaEl.textContent = `Rutas: ${m?.done || g.done || 0}/${m?.total || g.total || unidades.length} (omit ${sk})`;
      precargaEl.classList.remove("ok");
    } else if (m?.completo) {
      const parts = [];
      if (m.full) parts.push(`${m.full} full`);
      if (m.incremental) parts.push(`${m.incremental} incr`);
      if (m.skipped) parts.push(`${m.skipped} caché`);
      precargaEl.textContent = `Rutas OK ${m.ok || 0}/${m.total || 0}` + (parts.length ? ` · ${parts.join(" · ")}` : "");
      precargaEl.classList.add("ok");
      precargaEl.title = `Último lote: ${m.finished_at || ""} · motivo: ${m.reason || ""} · próximo tick ~${Math.round(TICK_MS / 60000)} min`;
    } else {
      precargaEl.textContent = "Rutas: en cola";
    }
  }
  paintPrecarga();
  window.addEventListener("turno-amanecida:precarga", () => {
    paintPrecarga();
    enriquecerMovimientoDesdeCache();
    // Cuando avanza la precarga, si hay unidad seleccionada pintar su ruta
    if (seleccion) mostrarRecorridoUnidad(seleccion);
  });

  const unitList = unidades
    .map((u) => ({ codigo: u.codigo, placa: u.placa }))
    .filter((u) => u.placa || u.codigo);
  // Precarga batch 16:00→ahora al entrar (solo se omite si el lote está completo y fresco)
  if (unitList.length) {
    if (cacheIsFresh(fechaVal)) {
      enriquecerMovimientoDesdeCache();
      if (seleccion) mostrarRecorridoUnidad(seleccion);
    } else {
      if (precargaEl) precargaEl.textContent = "Rutas: precargando 16:00→ahora…";
      startPrecarga(unitList, fechaVal, { reason: "entrada-monitoreo" })
        .then(() => {
          paintPrecarga();
          return enriquecerMovimientoDesdeCache();
        })
        .then(() => {
          if (seleccion) return mostrarRecorridoUnidad(seleccion);
        })
        .catch((e) => {
          console.warn("[TN] precarga", e);
          if (precargaEl) precargaEl.textContent = `Rutas: error ${e.message || e}`;
        });
    }
  }

  renderCounters();
  renderList();
  syncMarkers({ fitOnce: true });
  pulseLive();

  // Poll placeholder (3 min) — refresca “vivo” cuando exista monitor API
    pollTimer = setInterval(() => {
    refrescarPosiciones().catch(() => pulseLive());
    tickPrecargaSiToca(unitList, fechaVal)
      .then((meta) => {
        if (meta) {
          paintPrecarga();
          return enriquecerMovimientoDesdeCache();
        }
      })
      .catch(() => {});
  }, POLL_MS);

  if (runtime?.bus) {
    runtime.bus.emit("turno-amanecida:monitoreo-ready", { total: unidades.length });
  }
}

export function unmount() {
  disposed = true;
  document.body.classList.remove("tn-fs-monitoreo");
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearRouteLayers();
  clearRouteLayers();
  for (const mk of markersByCode.values()) {
    try {
      mk.setMap?.(null);
      mk.__halo?.setMap?.(null);
    } catch {
      /* ignore */
    }
  }
  markersByCode.clear();
  markersLayer = null;
  map = null;
  seleccion = null;
}
