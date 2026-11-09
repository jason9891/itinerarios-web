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
import { moduleHead, esc, fechaPE } from "../api-client.js?v=tn30";
import { obtenerSnapshot, obtenerMapsKey } from "../worker-client.js?v=tn30";
import { API } from "../registry.js";
import { auth } from "../../shared/auth.js";
import { startPrecarga, loadMeta, currentRunId, getProgress, cacheIsFresh, tickPrecargaSiToca, TICK_MS, asegurarRuta, stopPrecarga, isDetenido, setDetenido, fueraDeVentanaRutas } from "../precarga-engine.js?v=tn32";
import { readGPS, gpsKey, limpiarRutas } from "../gps-cache.js";
import { fechaTurnoLima, ventanaTurno, parsePuntoMs, formatLima } from "../tiempo-lima.js";

const POLL_MS = 60 * 1000; // snapshot posiciones cada 1 min
const HALO_PX = 18; // radio en píxeles de los círculos amarillo/rojo (constante a cualquier zoom)
const STORAGE_KEY = "tn_clasificaciones_v1";
/** Datos de la unidad (vienen de la OC/maestros) que la persona puede corregir. No se copian, pegan ni limpian. */
const DATOS_UNIDAD = [
  { k: "piloto", id: "tn-d-piloto", etiqueta: "OPERADOR" },
  { k: "mercaderia", id: "tn-d-mercaderia", etiqueta: "MERCADERÍA" },
  { k: "acoplado", id: "tn-d-acoplado", etiqueta: "ACOPLADO" },
  { k: "tipo_acople", id: "tn-d-tipo", etiqueta: "TIPO ACOPLE" },
  { k: "gestor", id: "tn-d-gestor", etiqueta: "GESTOR" },
];

/** ¿La unidad dejó de reportar? (punto rojo o gris en el mapa) */
const dejoDeReportar = (u) => ["ROJO", "GRIS"].includes(String(u?.color_html || "").toUpperCase());
/** Fecha y hora (dd/mm/aaaa hh:mm) del último punto GPS de una ruta, o "". */
function ultimoPuntoTxt(pts) {
  for (let i = (pts?.length || 0) - 1; i >= 0; i--) {
    const f = String(pts[i]?.fecha || "").trim();
    if (f) return f.slice(0, 16);
  }
  return "";
}
/** Último reporte conocido por unidad (sobrevive a los refrescos del snapshot). */
const ultimoRepPorCodigo = new Map();
const ultimoRepDe = (u) => u?.ultimo_reporte || ultimoRepPorCodigo.get(u?.codigo) || "";
const textoUltimoReporte = (u) => (ultimoRepDe(u) ? `ÚLTIMO REPORTE ${ultimoRepDe(u)}` : "");
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
let precargaHandler = null;
let ventanaHandler = null;
let routeLayers = [];
let routeSeq = 0;
let clipboard = null;
let leafletReady = null;
let mapsKey = "";
let mapsPromise = null;
// Alertas: nivel de halo más alto ya avisado por unidad (nunca baja, para no repetir avisos)
let haloPrevio = new Map();
let alertasArmadas = false;
let alertasArmTimer = null;
let audioCtx = null;
let limpiarAvisosRef = null; // detiene sirena/avisos al salir del módulo

async function loadGoogleMaps(key) {
  if (window.google?.maps) return;
  if (!key) throw new Error("Falta GOOGLE_MAPS_API_KEY (Supabase secret)");
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

  const vt = ventanaTurno(fechaTurno);
  const corte22 = new Date(vt.corte22);
  const corte23 = new Date(vt.corte23);
  // Fin de ventana de análisis del turno (04:00 día siguiente)
  const corteFin = new Date(vt.fin);

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
  return fechaTurnoLima();
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
  const ms = parsePuntoMs(p);
  return ms == null ? null : new Date(ms);
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
  const corte = new Date(ventanaTurno(fechaTurno).corte22);
  const azul = [];
  const rojo = [];
  for (const p of puntos || []) {
    const ll = puntoLatLng(p);
    if (!ll) continue;
    const ft = parsePuntoFecha(p);
    const item = { ...ll, fecha: p.fecha || p.fechaFinToString || "" };
    if (!ft || ft < corte) azul.push(item);
    else {
      // El tramo rojo arranca en el último punto azul para que la línea sea continua
      if (!rojo.length && azul.length) rojo.push(azul[azul.length - 1]);
      rojo.push(item);
    }
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

/** Recorrido sin fitBounds ni pan (no redimensiona el mapa). */
function drawSplitRoute(azul, rojo) {
  if (!map || !window.google?.maps) return;
  clearRouteLayers();
  if (azul.length >= 2) {
    routeLayers.push(
      new google.maps.Polyline({
        path: azul.map((p) => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        strokeColor: "#2563EB",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
        zIndex: 200,
      }),
    );
  }
  if (rojo.length >= 2) {
    routeLayers.push(
      new google.maps.Polyline({
        path: rojo.map((p) => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        strokeColor: "#DC2626",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
        zIndex: 210,
      }),
    );
  }
}



export async function mount(container, runtime) {
  disposed = false;
  haloPrevio = new Map();
  alertasArmadas = false;
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
          ...Object.fromEntries(DATOS_UNIDAD.map((d) => [d.k, s[d.k] ?? u[d.k] ?? ""])),
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
          <button type="button" class="ghost" id="tn-alert-snd" title="Sonido y notificación del sistema cuando una unidad pasa a amarillo o rojo">🔔 SONIDO</button>
          <button type="button" class="ghost" id="tn-test-amarillo" title="Simula una alerta AMARILLA (no toca datos ni calificaciones)">🟡 PROBAR</button>
          <button type="button" class="ghost" id="tn-test-rojo" title="Simula una alerta ROJA (no toca datos ni calificaciones)">🔴 PROBAR</button>
          <button type="button" class="ghost" id="tn-refresh">REFRESCAR</button>
          <button type="button" class="ghost" id="tn-clear-cache" title="Borra la caché local (rutas, base del turno y avance) para volver a cargar las unidades del turno actual">LIMPIAR CACHÉ</button>
          <button type="button" class="ghost" id="tn-stop" title="Detiene la actualización de posiciones y la alimentación de rutas">DETENER</button>
        </div>
      </header>

      <details class="tn-precarga-panel" id="tn-pc-panel" style="margin:8px 0;background:#0b1626;border:1px solid #ffffff1d;border-radius:10px;padding:8px 12px">
        <summary style="cursor:pointer;font-weight:600">PRECARGA DE RUTAS · <span id="tn-pc-resumen" class="muted">—</span></summary>
        <div id="tn-pc-info" class="muted" style="font-size:12px;margin:6px 0"></div>
        <div style="max-height:320px;overflow:auto">
          <table class="tn-table" style="width:100%;font-size:12px">
            <thead><tr><th>UNIDAD</th><th>PLACA</th><th>CACHÉ</th><th>PUNTOS</th><th>1º PUNTO</th><th>ÚLT. PUNTO</th><th>HASTA</th><th>MOV 22–23</th><th>MOV ≥23</th><th>HALO CALC.</th><th>EN MAPA</th></tr></thead>
            <tbody id="tn-pc-body"></tbody>
          </table>
        </div>
      </details>

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
                <div class="tn-class-form tn-class-horizontal" style="margin-top:6px">
                  ${DATOS_UNIDAD.map((d) => `<label>${d.etiqueta}<input id="${d.id}" type="text" placeholder="Editable · no se copia"></label>`).join("")}
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
    // Volver a Base del turno (flujo natural) o home
    const btn =
      document.querySelector('nav button[data-route="base"]') ||
      document.querySelector('nav button[data-route="home"]');
    btn?.click();
  });


  function renderCounters() {
    if (!countersEl) return;
    const { p, c, r, t: tot } = contadores();
    countersEl.innerHTML = `
      <span class="tn-chip pend"><b>${p}</b> pend</span>
      <span class="tn-chip ok"><b>${c}</b> calif</span>
      <span class="tn-chip rev"><b>${r}</b> revisar</span>
      <span class="tn-chip"><b>${tot}</b> total</span>
    `;
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
            <b>${esc(u.codigo)}</b>
            <small>${esc(u.placa || "—")} · ${esc(u.piloto || "—")}</small>
          </span>
          <span class="tn-li-meta">
            <small title="T.Parada">${esc(u.t_parada || "—")}</small>
            ${dejoDeReportar(u) && ultimoRepDe(u) ? `<small style="color:#fca5a5;font-weight:700" title="Último reporte GPS">⏱ ${esc(ultimoRepDe(u).slice(0, 16))}</small>` : ""}
          </span>
        </button>`;
      })
      .join("");
  }

  // ── Alertas: aviso en pantalla (siempre) + sonido y notificación (si 🔔 está activo) ──
  // Se dispara cuando una unidad PASA a amarillo, a rojo, o de amarillo a rojo.
  // No necesita permisos para el aviso en pantalla; el sonido se habilita con el primer clic.
  const RANGO_HALO = { amarillo: 1, rojo: 2 };
  const ALERT_SND_KEY = "tn_alert_sonido_v1";

  function sonidoActivo() {
    try {
      return localStorage.getItem(ALERT_SND_KEY) !== "0"; // por defecto activado
    } catch {
      return true;
    }
  }

  function paintSonidoBtn() {
    const btn = container.querySelector("#tn-alert-snd");
    if (!btn) return;
    const on = sonidoActivo();
    btn.textContent = on ? "🔔 SONIDO: ON" : "🔕 SONIDO: OFF";
    btn.classList.toggle("primary", on);
  }

  function desbloquearAudio() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      /* ignore */
    }
  }

  /** Sirena: más fuerte y estridente (onda cuadrada con barrido). Rojo = 5 pulsos agudos; amarillo = 3. */
  function beepAlerta(urg) {
    if (!sonidoActivo()) return;
    try {
      desbloquearAudio();
      if (!audioCtx) return;
      const rojo = urg === "rojo";
      const pulsos = rojo ? 5 : 3;
      const t0 = audioCtx.currentTime;
      for (let i = 0; i < pulsos; i++) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "square";
        const ini = t0 + i * 0.32;
        const f1 = rojo ? 1250 : 880;
        const f2 = rojo ? 760 : 620;
        osc.frequency.setValueAtTime(f1, ini);
        osc.frequency.linearRampToValueAtTime(f2, ini + 0.26);
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.exponentialRampToValueAtTime(rojo ? 0.7 : 0.5, ini + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ini + 0.29);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(ini);
        osc.stop(ini + 0.3);
      }
    } catch {
      /* ignore */
    }
  }

  // ── Avisos PERSISTENTES: en primer plano, no se cierran solos; hay que CONFIRMAR ──
  const avisosPend = new Map(); // codigo → { u, urg, hora, el }
  let sirenaTimer = null;
  let tituloOriginal = null;
  let tituloTimer = null;

  function estiloAvisosUnaVez() {
    if (document.getElementById("tn-alert-style")) return;
    const st = document.createElement("style");
    st.id = "tn-alert-style";
    st.textContent = `
      @keyframes tnPulsoRojo{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.85),0 10px 40px rgba(0,0,0,.6);background:#450a0a}50%{box-shadow:0 0 0 14px rgba(239,68,68,0),0 10px 40px rgba(0,0,0,.6);background:#7f1d1d}}
      @keyframes tnPulsoAmarillo{0%,100%{box-shadow:0 0 0 0 rgba(234,179,8,.85),0 10px 40px rgba(0,0,0,.6);background:#422006}50%{box-shadow:0 0 0 14px rgba(234,179,8,0),0 10px 40px rgba(0,0,0,.6);background:#713f12}}
      #tn-alert-overlay{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;gap:10px;width:min(560px,94vw);max-height:92vh;overflow:auto;pointer-events:none}
      #tn-alert-overlay .tn-aviso{pointer-events:auto;color:#fff;border-radius:12px;padding:14px 16px;border:3px solid;font-family:inherit}
      #tn-alert-overlay .tn-aviso.rojo{border-color:#ef4444;animation:tnPulsoRojo .9s infinite}
      #tn-alert-overlay .tn-aviso.amarillo{border-color:#eab308;animation:tnPulsoAmarillo 1.2s infinite}
      #tn-alert-overlay .tn-aviso h3{margin:0 0 4px;font-size:20px;letter-spacing:.02em}
      #tn-alert-overlay .tn-aviso p{margin:2px 0;font-size:14px}
      #tn-alert-overlay .tn-aviso .tn-aviso-btns{display:flex;gap:8px;margin-top:10px}
      #tn-alert-overlay .tn-aviso button{flex:1;font-weight:800;font-size:14px;padding:10px 12px;border-radius:8px;border:0;cursor:pointer}
      #tn-alert-overlay .tn-aviso .ok{background:#fff;color:#111}
      #tn-alert-overlay .tn-aviso .ver{background:rgba(255,255,255,.18);color:#fff}`;
    document.head.appendChild(st);
  }

  function overlayAvisos() {
    estiloAvisosUnaVez();
    let ov = document.getElementById("tn-alert-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "tn-alert-overlay";
      ov.setAttribute("role", "alertdialog");
      ov.setAttribute("aria-live", "assertive");
      document.body.appendChild(ov);
    }
    return ov;
  }

  function actualizarSirenaYTitulo() {
    const hay = avisosPend.size > 0;
    const hayRojo = [...avisosPend.values()].some((a) => a.urg === "rojo");
    if (hay && !sirenaTimer) {
      sirenaTimer = setInterval(() => {
        const rojo = [...avisosPend.values()].some((a) => a.urg === "rojo");
        beepAlerta(rojo ? "rojo" : "amarillo");
      }, 4000);
    }
    if (!hay && sirenaTimer) {
      clearInterval(sirenaTimer);
      sirenaTimer = null;
    }
    if (hay && !tituloTimer) {
      tituloOriginal = document.title;
      let on = false;
      tituloTimer = setInterval(() => {
        on = !on;
        document.title = on ? `${hayRojo ? "🔴" : "🟡"} ¡ALERTA! ${avisosPend.size} unidad(es)` : tituloOriginal;
      }, 800);
    }
    if (!hay && tituloTimer) {
      clearInterval(tituloTimer);
      tituloTimer = null;
      if (tituloOriginal != null) document.title = tituloOriginal;
    }
    if (!hay) document.getElementById("tn-alert-overlay")?.remove();
  }

  function confirmarAviso(codigo) {
    const a = avisosPend.get(codigo);
    if (!a) return;
    a.el?.remove();
    avisosPend.delete(codigo);
    actualizarSirenaYTitulo();
  }

  /** Detiene todo (al salir del módulo). */
  function limpiarAvisos() {
    avisosPend.clear();
    if (sirenaTimer) clearInterval(sirenaTimer);
    sirenaTimer = null;
    if (tituloTimer) clearInterval(tituloTimer);
    tituloTimer = null;
    if (tituloOriginal != null) document.title = tituloOriginal;
    document.getElementById("tn-alert-overlay")?.remove();
  }

  function mostrarToastAlerta(u, urg, { prueba = false } = {}) {
    limpiarAvisosRef = limpiarAvisos;
    const ov = overlayAvisos();
    const key = prueba ? `PRUEBA·${u.codigo}` : u.codigo;
    const previo = avisosPend.get(key);
    if (previo) {
      if (previo.urg === "rojo" && urg !== "rojo") return; // no bajar de rojo a amarillo
      previo.el?.remove();
    }
    const hora = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
    const motivo = urg === "rojo" ? "EN MOVIMIENTO DESPUÉS DE LAS 23:00" : "En movimiento entre 22:00 y 23:00";
    const mov = u.movimiento_nocturno_m ? ` · ~${u.movimiento_nocturno_m} m` : "";
    const el = document.createElement("div");
    el.className = `tn-aviso ${urg === "rojo" ? "rojo" : "amarillo"}`;
    el.innerHTML = `
      <h3>${prueba ? "🧪 PRUEBA · " : ""}${urg === "rojo" ? "🔴 ALERTA ROJA" : "🟡 ALERTA"} · ${esc(u.codigo)}</h3>
      <p><b>${motivo}</b></p>
      <p style="opacity:.85">${esc(u.placa || "")} · ${hora}${mov}</p>
      ${prueba ? `<p style="opacity:.8;font-size:12px">Simulación: no modifica datos. ${sonidoActivo() ? "" : "⚠ El SONIDO está en OFF (actívalo con 🔔)."}</p>` : ""}
      <div class="tn-aviso-btns">
        <button type="button" class="ver" data-ver>VER EN MAPA</button>
        <button type="button" class="ok" data-ok>CONFIRMAR ✓</button>
      </div>`;
    el.querySelector("[data-ok]").addEventListener("click", () => confirmarAviso(key));
    el.querySelector("[data-ver]").addEventListener("click", () => selectUnit(u.codigo)); // NO cierra el aviso
    avisosPend.set(key, { u, urg, hora, el });
    ov.prepend(el);
    try {
      window.focus();
    } catch {
      /* ignore */
    }
    actualizarSirenaYTitulo();
  }

  function notificarSistema(lista) {
    try {
      if (!sonidoActivo() || document.visibilityState !== "hidden") return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const hayRojo = lista.some((a) => a.urg === "rojo");
      const titulo = hayRojo
        ? "🔴 Turno Amanecida: unidad en movimiento ≥23:00"
        : "🟡 Turno Amanecida: unidad en movimiento 22–23:00";
      const cuerpo =
        lista
          .slice(0, 6)
          .map((a) => a.u.codigo)
          .join(", ") + (lista.length > 6 ? ` y ${lista.length - 6} más` : "");
      const n = new Notification(titulo, { body: cuerpo, tag: "tn-alerta", requireInteraction: true });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        n.close();
      };
    } catch {
      /* ignore */
    }
  }

  function detectarAlertas() {
    const nuevas = [];
    for (const u of unidades) {
      const urg = urgenciaNocturna(u);
      const prev = haloPrevio.get(u.codigo) || null;
      if ((RANGO_HALO[urg] || 0) > (RANGO_HALO[prev] || 0)) {
        haloPrevio.set(u.codigo, urg);
        if (alertasArmadas) nuevas.push({ u, urg });
      }
    }
    if (!nuevas.length) return;
    nuevas.sort((a, b) => (RANGO_HALO[b.urg] || 0) - (RANGO_HALO[a.urg] || 0));
    for (const a of nuevas.slice(0, 5)) mostrarToastAlerta(a.u, a.urg);
    beepAlerta(nuevas[0].urg);
    notificarSistema(nuevas);
  }

  /** Fija la línea base (lo que ya estaba en amarillo/rojo no suena); desde aquí solo avisan los cambios. */
  function armarAlertas() {
    if (alertasArmadas || disposed) return;
    for (const u of unidades) haloPrevio.set(u.codigo, urgenciaNocturna(u));
    alertasArmadas = true;
  }

  /** Halo en PÍXELES (no en metros): mantiene su tamaño en pantalla a cualquier zoom. */
  function crearHalo(pos, urg) {
    const haloColor = urg === "rojo" ? "#ef4444" : "#eab308";
    return new google.maps.Marker({
      map,
      position: pos,
      clickable: false,
      optimized: false,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: HALO_PX,
        fillColor: haloColor,
        fillOpacity: 0.4,
        strokeColor: haloColor,
        strokeOpacity: 0.9,
        strokeWeight: 3,
      },
      zIndex: 100,
    });
  }

  /** Prueba SIN tocar datos: aviso persistente + sirena + halo 20 s sobre una unidad con coordenadas. */
  function probarAlerta(nivel = "rojo") {
    const urg = nivel === "amarillo" ? "amarillo" : "rojo";
    const u = unidades.find((x) => x.lat != null && x.lng != null) || unidades[0] || { codigo: "TEST-00", placa: "PRUEBA" };
    desbloquearAudio();
    mostrarToastAlerta(u, urg, { prueba: true });
    beepAlerta(urg);
    if (u.lat != null && u.lng != null && map && window.google?.maps) {
      const h = crearHalo({ lat: Number(u.lat), lng: Number(u.lng) }, urg);
      setTimeout(() => h.setMap(null), 20000);
    }
    return `Prueba ${urg} sobre ${u.codigo}`;
  }
  window.__tnProbar = probarAlerta; // también desde la consola: __tnProbar("rojo") / __tnProbar("amarillo")

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
    detectarAlertas();
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
        marker.__halo = crearHalo(pos, urg);
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

  function rutaMsg(txt, ms = 4000) {
    let el = container.querySelector("#tn-ruta-msg");
    if (!el) {
      const wrap = container.querySelector(".tn-map-wrap");
      if (!wrap) return;
      el = document.createElement("div");
      el.id = "tn-ruta-msg";
      el.style.cssText =
        "position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:5;background:#0f172a;color:#fff;padding:6px 14px;border-radius:999px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none";
      wrap.style.position = wrap.style.position || "relative";
      wrap.appendChild(el);
    }
    clearTimeout(el._t);
    if (!txt) {
      el.style.display = "none";
      return;
    }
    el.textContent = txt;
    el.style.display = "block";
    if (ms) el._t = setTimeout(() => (el.style.display = "none"), ms);
  }

  /** Guarda el último reporte en la unidad y lo deja por defecto en OBSERVACIONES (si está vacía y aún no se califica). */
  function aplicarUltimoReporte(u, txt, { mensaje = false } = {}) {
    if (!u) return;
    u.ultimo_reporte = txt || ultimoRepDe(u) || "";
    if (u.ultimo_reporte) ultimoRepPorCodigo.set(u.codigo, u.ultimo_reporte);
    const t = textoUltimoReporte(u) || (txt === "" ? "SIN REPORTES DESDE LAS 16:00" : "");
    if (mensaje && t && u.codigo === seleccion?.codigo) rutaMsg(`${u.codigo} · ${t}`, 0);
    if (u.codigo === seleccion?.codigo && t && !u.timestamp_clasificacion) {
      const obs = container.querySelector("#tn-obs");
      if (obs && (!obs.value.trim() || obs.dataset.auto === "1")) { obs.value = t; obs.dataset.auto = "1"; }
    }
  }

  async function mostrarRecorridoUnidad(u) {
    if (!u) return;
    const token = ++routeSeq; // el último clic gana; no bloquea clics siguientes
    try {
      const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
      const placaU = String(u.placa || "").trim().toUpperCase();
      const tractoU = String(u.codigo || "").trim().toUpperCase();
      const rid = currentRunId() || loadMeta()?.id;
      let cached = rid ? await readGPS(gpsKey(rid, tractoU, placaU)) : null;
      let pts = cached?.puntos_gps || [];
      if (token !== routeSeq) return;

      // Solo se consulta si NO hay entrada válida en caché (la precarga la deja siempre)
      if (!cached || cached.ok === false) {
        clearRouteLayers();
        rutaMsg(`Cargando ruta de ${tractoU || placaU}…`, 0);
        const r = await asegurarRuta(u, fechaVal);
        if (token !== routeSeq) return;
        pts = r.puntos_gps || [];
        if (!r.ok && !pts.length) {
          rutaMsg("No se pudo obtener la ruta (reintenta con otro clic)");
          return;
        }
      }
      if (dejoDeReportar(u)) aplicarUltimoReporte(u, ultimoPuntoTxt(pts), { mensaje: true });
      if (pts.length < 2) {
        clearRouteLayers();
        if (!dejoDeReportar(u)) rutaMsg(`${tractoU || placaU}: sin movimiento desde las 16:00`);
        u.movimiento_nocturno_m = 0;
        u.halo_nocturno = null;
        return;
      }
      rutaMsg("");
      const { azul, rojo } = partirRecorrido(pts, fechaVal);
      drawSplitRoute(azul, rojo);
      const ev = evaluarHaloNocturno(pts, fechaVal);
      if (ev.metros !== (u.movimiento_nocturno_m || 0) || ev.halo !== (u.halo_nocturno || null)) {
        u.movimiento_nocturno_m = ev.metros;
        u.halo_nocturno = ev.halo;
        syncMarkers();
      }
    } catch (err) {
      console.warn("[TN] recorrido", err);
      rutaMsg("Error al mostrar la ruta");
    }
  }

  async function refrescarPosiciones() {
    const data = await obtenerSnapshot();
    if (!data?.ok || !Array.isArray(data.unidades)) throw new Error(data?.error || "Snapshot falló");
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
      for (const d of DATOS_UNIDAD) {
        const el = container.querySelector(`#${d.id}`);
        if (el) el.value = u[d.k] || "";
      }
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
      ...Object.fromEntries(DATOS_UNIDAD.map((d) => [d.k, (container.querySelector(`#${d.id}`)?.value || "").trim()])),
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
    const obsEl = container.querySelector("#tn-obs");
    if (obsEl) {
      obsEl.dataset.auto = "";
      if (!obsEl.value.trim() && !u.timestamp_clasificacion && dejoDeReportar(u) && textoUltimoReporte(u)) {
        obsEl.value = textoUltimoReporte(u);
        obsEl.dataset.auto = "1";
      }
    }
    renderList();
    msgEl.textContent = "";
    if (dejoDeReportar(u) && textoUltimoReporte(u)) rutaMsg(`${u.codigo} · ${textoUltimoReporte(u)}`, 0);
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
      ...Object.fromEntries(DATOS_UNIDAD.map((d) => [d.k, seleccion[d.k] || ""])),
    });
    renderCounters();
    renderList();
    syncMarkers();
    selectUnit(seleccion.codigo);
    chequearTodasValidadas();

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

  container.querySelector("#tn-obs")?.addEventListener("input", (e) => { e.target.dataset.auto = ""; });

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
        ...Object.fromEntries(DATOS_UNIDAD.map((d) => [d.k, seleccion?.[d.k] || ""])),
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

  // ── Detener / reanudar la alimentación (posiciones + rutas) ──
  const fechaActual = () => container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
  const todasValidadas = () => unidades.length > 0 && unidades.every((u) => u.estado_clasificacion !== "PENDIENTE");
  function paintStop() {
    const btn = container.querySelector("#tn-stop");
    if (!btn) return;
    const det = isDetenido(fechaActual());
    const fuera = fueraDeVentanaRutas();
    btn.textContent = fuera ? "FUERA DE HORARIO" : det ? "REANUDAR" : "DETENER";
    btn.disabled = fuera;
    btn.title = fuera ? "Las rutas solo se cargan de 21:00 a 04:00 (hora de Lima)" : "";
    btn.classList.toggle("primary", det && !fuera);
    const txt = container.querySelector("#tn-live-txt");
    if (txt && fuera) txt.textContent = "Rutas detenidas · se cargan de 21:00 a 04:00";
    else if (txt && det) txt.textContent = "Actualización detenida";
  }
  // A las 04:00 (o al abrir fuera de horario) se corta solo, sin esperar a nadie
  if (ventanaHandler) window.removeEventListener("turno-amanecida:ventana-cerrada", ventanaHandler);
  ventanaHandler = () => {
    if (disposed) return;
    stopPrecarga();
    paintStop();
  };
  window.addEventListener("turno-amanecida:ventana-cerrada", ventanaHandler);
  function detenerAlimentacion(motivo) {
    setDetenido(fechaActual(), true);
    stopPrecarga();
    paintStop();
    msgEl.textContent = motivo;
  }
  function chequearTodasValidadas() {
    if (!isDetenido(fechaActual()) && todasValidadas()) {
      detenerAlimentacion("Todas las unidades validadas: se detuvo la alimentación de rutas. Ve a REPORTE.");
    }
  }
  container.querySelector("#tn-stop")?.addEventListener("click", () => {
    const f = fechaActual();
    if (fueraDeVentanaRutas()) { msgEl.textContent = "Fuera de horario: las rutas solo se cargan de 21:00 a 04:00."; return; }
    if (isDetenido(f)) {
      setDetenido(f, false);
      paintStop();
      msgEl.textContent = "Actualización reanudada";
      refrescarPosiciones().catch(() => {});
      startPrecarga(liveList(), f, { reason: "reanudar" }).catch(() => {});
    } else {
      detenerAlimentacion("Actualización detenida. Puedes reanudar cuando quieras.");
    }
  });
  paintStop();

  // Botón de sonido: el clic habilita el audio del navegador y pide (una vez) permiso de notificación
  paintSonidoBtn();
  container.addEventListener("pointerdown", desbloquearAudio, { once: true });
  container.querySelector("#tn-test-amarillo")?.addEventListener("click", () => probarAlerta("amarillo"));
  container.querySelector("#tn-test-rojo")?.addEventListener("click", () => probarAlerta("rojo"));
  container.querySelector("#tn-alert-snd")?.addEventListener("click", () => {
    const on = !sonidoActivo();
    try {
      localStorage.setItem(ALERT_SND_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    paintSonidoBtn();
    if (on) {
      desbloquearAudio();
      beepAlerta("amarillo"); // sonido de prueba
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
  });

  // Caché local vieja: avisa si la base guardada es de otro turno (p. ej. la de ayer)
  try {
    const b = JSON.parse(localStorage.getItem("tn_base_turno_v1") || "null");
    const tb = b?.generado_en ? fechaTurnoLima(Date.parse(b.generado_en)) : null;
    if (tb && tb !== fechaTurnoLima()) {
      msgEl.textContent = `La base guardada es del turno ${tb}, no del actual (${fechaTurnoLima()}). Usa LIMPIAR CACHÉ y genera la base nueva.`;
    }
  } catch { /* ignore */ }

  container.querySelector("#tn-clear-cache")?.addEventListener("click", async () => {
    if (!window.confirm(
      "Se borra la caché local de este navegador: rutas guardadas, avance de la precarga, la base del turno (las unidades) y la OC subida.\n" +
      "Las clasificaciones de turnos anteriores también; después te pregunto por las del turno actual.\n\n" +
      "Después hay que subir de nuevo el Excel de OC y generar la BASE DEL TURNO. ¿Continuar?")) return;
    msgEl.textContent = "Limpiando caché local…";
    try {
      stopPrecarga();
      await limpiarRutas();
      for (const k of ["tn_precarga_v1", "tn_detenido_v1", "tn_base_turno_v1", "tn_oc_ultima_v1"]) localStorage.removeItem(k);
      // La OC subida vive en sessionStorage: sin esto «limpiar» dejaba todas las OC del turno anterior
      for (const k of ["tn_oc_ultima_v1"]) sessionStorage.removeItem(k);
      // clasificaciones: solo se quitan las anteriores al turno actual (16:00 Lima)
      const ini = ventanaTurno(fechaTurnoLima()).inicio;
      const todas = loadClasificaciones();
      const delTurno = Object.entries(todas).filter(([, v]) => Date.parse(v?.timestamp_clasificacion || "") >= ini);
      let conservar = true;
      if (delTurno.length) {
        conservar = !window.confirm(
          `Hay ${delTurno.length} unidades ya calificadas en este turno (guardadas en este navegador).\n\n` +
          "ACEPTAR = borrarlas también y empezar en 0 calificadas.\nCANCELAR = conservarlas.");
      }
      const vigentes = {};
      if (conservar) for (const [cod, v] of delTurno) vigentes[cod] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vigentes));
      msgEl.textContent = "Caché limpia. Genera la base del turno…";
    } catch (e) {
      msgEl.textContent = `No se pudo limpiar la caché: ${e.message || e}`;
      return;
    }
    document.querySelector('nav button[data-route="base"]')?.click();
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

  // Google Maps — key desde secret GOOGLE_MAPS_API_KEY vía snapshot
  try {
    // Clave de Google Maps desde el Worker (cacheada en el navegador)
    const key = mapsKey || (await obtenerMapsKey());
    await loadGoogleMaps(key);
    // 2) Posiciones frescas (no bloquea el mapa si falla)
    try {
      const boot = await obtenerSnapshot();
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
      console.warn("[TN] boot snapshot", e);
    }
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
    if (disposed) return;
    const rid = currentRunId() || loadMeta()?.id;
    if (!rid) return;
    const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
    let changed = false;
    for (const u of unidades) {
      try {
        const cached = await readGPS(
          gpsKey(rid, String(u.codigo || "").toUpperCase(), String(u.placa || "").toUpperCase()),
        );
        if (!cached) continue;
        if (dejoDeReportar(u)) {
          const ur = ultimoPuntoTxt(cached.puntos_gps || []);
          if (ur) ultimoRepPorCodigo.set(u.codigo, ur);
          if (ur && ur !== u.ultimo_reporte) { u.ultimo_reporte = ur; changed = true; }
        }
        const ev = evaluarHaloNocturno(cached.puntos_gps || [], fechaVal);
        if (ev.metros !== (u.movimiento_nocturno_m || 0) || ev.halo !== (u.halo_nocturno || null)) {
          u.movimiento_nocturno_m = ev.metros;
          u.halo_nocturno = ev.halo;
          changed = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (changed) {
      renderList();
      syncMarkers();
    }
  }

  function enMapaTxt(u) {
    if (u.lat == null || u.lng == null) return "sin coordenadas";
    const mk = markersByCode.get(u.codigo);
    if (!mk) return "oculta por filtro";
    return mk.__halo ? `halo ${u.halo_nocturno || ""} dibujado` : u.halo_nocturno ? "⚠ halo NO dibujado" : "marcador (sin halo)";
  }

  async function renderPanelPrecarga() {
    const panel = container.querySelector("#tn-pc-panel");
    const body = container.querySelector("#tn-pc-body");
    if (!panel || !body) return;
    const fv = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
    const vt = ventanaTurno(fv);
    const rid = currentRunId() || loadMeta()?.id || `tn_${fv}`;
    const rows = [];
    let conCache = 0;
    let conMov = 0;
    let sinCache = 0;
    let errores = 0;
    for (const u of unidades) {
      const cod = String(u.codigo || "").toUpperCase();
      const pl = String(u.placa || "").toUpperCase();
      let c = null;
      try {
        c = await readGPS(gpsKey(rid, cod, pl));
      } catch {
        /* ignore */
      }
      const pts = c?.puntos_gps || [];
      const tms = pts.map((p) => parsePuntoMs(p)).filter((x) => x != null).sort((a, b) => a - b);
      const ev = evaluarHaloNocturno(pts, fv);
      let estado = "SIN CACHÉ";
      if (c) estado = c.ok === false ? "ERROR" : pts.length < 2 ? "SIN MOVIMIENTO" : "OK";
      if (!c) sinCache++;
      else if (c.ok === false) errores++;
      else conCache++;
      if (pts.length >= 2) conMov++;
      rows.push(
        `<tr data-code="${esc(u.codigo)}" style="cursor:pointer" title="${esc(c?.error || "Clic: ver ruta en el mapa")}">
          <td><b>${esc(u.codigo)}</b></td><td>${esc(u.placa || "—")}</td>
          <td>${estado}</td><td>${pts.length}</td>
          <td>${tms.length ? esc(formatLima(tms[0]).slice(11, 16)) : "—"}</td>
          <td>${tms.length ? esc(formatLima(tms[tms.length - 1]).slice(11, 16)) : "—"}</td>
          <td>${esc(String(c?.hasta || "—").slice(11, 16))}</td>
          <td>${ev.metros22} m</td><td>${ev.metros23} m</td>
          <td>${ev.halo === "rojo" ? "🔴 rojo" : ev.halo === "amarillo" ? "🟡 amarillo" : "—"}</td>
          <td>${enMapaTxt(u)}</td>
        </tr>`,
      );
    }
    body.innerHTML = rows.join("") || `<tr><td colspan="11" class="muted">Sin unidades</td></tr>`;
    container.querySelector("#tn-pc-resumen").textContent =
      `${conCache}/${unidades.length} en caché · ${conMov} con movimiento · ${errores} error · ${sinCache} sin caché`;
    container.querySelector("#tn-pc-info").textContent =
      `Turno ${fv} · ventana ${formatLima(vt.inicio).slice(0, 16)} → ${formatLima(vt.fin).slice(0, 16)} (Lima) · cortes 22:00 / 23:00 · umbral 100 m · caché ${rid}`;
  }
  container.querySelector("#tn-pc-body")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-code]");
    if (!tr) return;
    const u = unidades.find((x) => String(x.codigo) === tr.dataset.code);
    if (u) {
      selectUnit(u.codigo);
      const mk = markersByCode.get(u.codigo);
      try {
        if (mk && map) {
          map.panTo(mk.getPosition());
          if (map.getZoom() < 13) map.setZoom(13);
        }
      } catch {
        /* ignore */
      }
    }
  });
  container.querySelector("#tn-pc-panel")?.addEventListener("toggle", (e) => {
    if (e.target.open) renderPanelPrecarga();
  });

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
  if (precargaHandler) window.removeEventListener("turno-amanecida:precarga", precargaHandler);
  precargaHandler = () => {
    if (disposed) return;
    paintPrecarga();
    if (container.querySelector("#tn-pc-panel")?.open) renderPanelPrecarga();
    enriquecerMovimientoDesdeCache();
  };
  window.addEventListener("turno-amanecida:precarga", precargaHandler);

  const liveList = () => unidades.map((u) => ({ codigo: u.codigo, placa: u.placa, lat: u.lat, lng: u.lng }));
  const unitList = liveList();
  // Si el caché del mismo día está fresco (<3 min) → solo leer, no relanzar Comsatel
  chequearTodasValidadas(); // si ya está todo validado, no se alimentan más rutas
  if (unitList.length && !isDetenido(fechaVal)) {
    const go = cacheIsFresh(fechaVal)
      ? Promise.resolve(loadMeta()).then(() => enriquecerMovimientoDesdeCache())
      : startPrecarga(unitList, fechaVal, { reason: "entrada-monitoreo" }).then(() => {
          paintPrecarga();
          return enriquecerMovimientoDesdeCache();
        });
    go.catch(() => {}).finally(armarAlertas);
  } else {
    armarAlertas();
  }
  // Respaldo: si la precarga tarda demasiado, igual se arman las alertas a los 3 min
  alertasArmTimer = setTimeout(armarAlertas, 3 * 60 * 1000);

  renderCounters();
  renderList();
  syncMarkers({ fitOnce: true });
  pulseLive();

  // Poll placeholder (3 min) — refresca “vivo” cuando exista monitor API
    pollTimer = setInterval(() => {
    if (isDetenido(fechaActual())) return;
    refrescarPosiciones().catch(() => pulseLive());
    (document.visibilityState === "hidden" ? Promise.resolve(null) : tickPrecargaSiToca(liveList(), fechaVal))
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
  if (precargaHandler) {
    window.removeEventListener("turno-amanecida:precarga", precargaHandler);
    precargaHandler = null;
  }
  if (ventanaHandler) {
    window.removeEventListener("turno-amanecida:ventana-cerrada", ventanaHandler);
    ventanaHandler = null;
  }
  document.body.classList.remove("tn-fs-monitoreo");
  if (alertasArmTimer) {
    clearTimeout(alertasArmTimer);
    alertasArmTimer = null;
  }
  delete window.__tnProbar;
  limpiarAvisosRef?.();
  limpiarAvisosRef = null;
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
