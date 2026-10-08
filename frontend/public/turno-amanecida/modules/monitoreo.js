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
import { moduleHead, esc, fechaPE } from "../api-client.js";
import { queryClocator, clocatorEndpoint } from "../../shared/clocator-client.js";
import { auth } from "../../shared/auth.js";
import { startPrecarga, loadMeta, currentRunId, getProgress } from "../precarga-engine.js";
import { readGPS, gpsKey } from "../gps-cache.js";

const POLL_MS = 3 * 60 * 1000;
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
/** null = hora real Lima; number 0-23 fuerza umbral nocturno (pruebas). */
let simHora = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("No se pudo cargar Leaflet"));
    document.head.appendChild(s);
  });
  return leafletReady;
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

/** Hora actual en Perú (0–23). */
function horaLima() {
  if (simHora != null && Number.isFinite(simHora)) return simHora;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  } catch {
    return new Date().getHours();
  }
}

/**
 * Halo nocturno SOLO para tránsito activo (MOVIMIENTO).
 * No aplica a detenidas / GPS perdido / toda la flota a la 1 AM.
 *  - 22:00–22:59 → amarillo
 *  - 23:00–03:59 → rojo
 * El punto central sigue siendo COLOR_HTML del snapshot (verde/amarillo/rojo/plomo).
 */
/** Metros desplazados después de las 22:00 (ancla = última pos ≤22:00). */
function calcularMovimientoNocturno(puntos, fechaTurno) {
  if (!puntos?.length) return 0;
  const dia = parseFechaTurno(fechaTurno);
  const corte = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 22, 0, 0);
  const pts = [];
  for (const p of puntos) {
    const ll = puntoLatLng(p);
    if (!ll) continue;
    pts.push({ ...ll, t: parsePuntoFecha(p) });
  }
  if (pts.length < 2) return 0;
  let ancla = null;
  for (const p of pts) {
    if (p.t && p.t <= corte) ancla = p;
  }
  if (!ancla) ancla = pts[0];
  let maxD = 0;
  for (const p of pts) {
    if (p.t && p.t < corte) continue;
    const d = haversineM(ancla.lat, ancla.lng, p.lat, p.lng);
    if (d != null && d > maxD) maxD = d;
  }
  return maxD;
}

function urgenciaNocturna(u) {
  // Halo solo si hubo desplazamiento real ≥100 m después de las 22:00
  if (!u.movimiento_nocturno_m || u.movimiento_nocturno_m < 100) return null;
  const h = horaLima();
  if (h >= 23 || h < 4) return "rojo";
  if (h >= 22) return "amarillo";
  return null;
}

function markerHtml(u) {
  const c = colorHtmlHex(u.color_html);
  const urg = urgenciaNocturna(u);
  const ring =
    urg === "rojo"
      ? "#ef4444"
      : urg === "amarillo"
        ? "#eab308"
        : u.estado_clasificacion === "CALIFICADA"
          ? "#22c55e"
          : u.estado_clasificacion === "REVISAR"
            ? "#f59e0b"
            : "#38bdf8";
  const haloClass =
    urg === "rojo" ? "halo-rojo" : urg === "amarillo" ? "halo-amarillo" : "";
  const title = urg
    ? `${u.codigo} · tránsito nocturno (${urg === "rojo" ? ">23:00" : ">22:00"})`
    : u.codigo;
  return `<div class="tn-marker ${haloClass}" style="--c:${c};--ring:${ring}" title="${esc(title)}">
    <i class="tn-halo" aria-hidden="true"></i>
    <span class="tn-dot"></span>
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
      map?.removeLayer(layer);
    } catch {
      /* ignore */
    }
  }
  routeLayers = [];
}

function drawSplitRoute(azul, rojo) {
  if (!map || !window.L) return;
  clearRouteLayers();
  const bounds = [];
  if (azul.length >= 2) {
    const line = L.polyline(
      azul.map((p) => [p.lat, p.lng]),
      { color: "#2563EB", weight: 4, opacity: 0.9 },
    ).addTo(map);
    routeLayers.push(line);
    azul.forEach((p) => bounds.push([p.lat, p.lng]));
    const start = L.circleMarker([azul[0].lat, azul[0].lng], {
      radius: 7,
      color: "#1e40af",
      fillColor: "#2563EB",
      fillOpacity: 1,
      weight: 2,
    }).bindTooltip("Inicio 16:00–22:00");
    start.addTo(map);
    routeLayers.push(start);
  }
  if (rojo.length >= 2) {
    const line = L.polyline(
      rojo.map((p) => [p.lat, p.lng]),
      { color: "#DC2626", weight: 4, opacity: 0.9 },
    ).addTo(map);
    routeLayers.push(line);
    rojo.forEach((p) => bounds.push([p.lat, p.lng]));
  } else if (rojo.length === 1) {
    const m = L.circleMarker([rojo[0].lat, rojo[0].lng], {
      radius: 6,
      color: "#991b1b",
      fillColor: "#DC2626",
      fillOpacity: 1,
    }).bindTooltip("Post 22:00");
    m.addTo(map);
    routeLayers.push(m);
    bounds.push([rojo[0].lat, rojo[0].lng]);
  }
  if (bounds.length) {
    try {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } catch {
      /* ignore */
    }
  }
}


export async function mount(container, runtime) {
  disposed = false;
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
        <div class="tn-track-title">
          <p class="eyebrow">TURNO AMANECIDA · DESDE LAS 22:00</p>
          <h1>Tránsitos de la noche</h1>
          <p class="muted">Base del turno (snapshot real + OC local) · tránsitos fuera de punto conocido · clasificar riesgo/pernocte</p>
        </div>
        <div class="tn-track-meta">
          <label class="tn-field">
            <span>FECHA TURNO</span>
            <input type="date" id="tn-fecha" value="${fechaTurnoDefault()}">
          </label>
          <div class="tn-counters" id="tn-counters"></div>
          <div class="tn-live">
            <span class="tn-live-dot" id="tn-live-dot"></span>
            <span id="tn-live-txt">Poll 3 min</span>
          </div>
          <span class="tn-chip" id="tn-precarga">Rutas: —</span>
          <label class="tn-field">
            <span>HALO NOCTURNO</span>
            <select id="tn-sim-hora" title="Hora para umbral 22h/23h (pruebas o revisión diurna)">
              <option value="">Hora real (Lima)</option>
              <option value="21">21:00 · sin halo</option>
              <option value="22">22:30 · amarillo</option>
              <option value="23">23:30 · rojo</option>
              <option value="1">01:00 · rojo</option>
            </select>
          </label>
          <button type="button" class="ghost" id="tn-refresh">REFRESCAR</button>
        </div>
      </header>

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
            <span><i class="halo-leg am"></i> ≥100m post-22h</span>
            <span><i class="halo-leg ro"></i> ≥100m post-23h</span>
            <span><i style="background:#2563eb;width:14px;height:3px;border-radius:1px"></i> 16–22h</span>
            <span><i style="background:#dc2626;width:14px;height:3px;border-radius:1px"></i> post-22h</span>
          </div>
        </div>
        <aside class="tn-list-panel">
          <div class="tn-list-head">
            <b>UNIDADES</b>
            <small id="tn-list-count">0</small>
          </div>
          <div class="tn-list" id="tn-list"></div>
        </aside>
      </div>

      <section class="tn-detail" id="tn-detail">
        <div class="tn-detail-empty" id="tn-detail-empty">
          Selecciona una unidad en la lista o en el mapa para clasificarla.
        </div>
        <div class="tn-detail-body hidden" id="tn-detail-body">
          <div class="tn-detail-top">
            <div>
              <p class="eyebrow" id="tn-sel-code">—</p>
              <h2 id="tn-sel-title">—</h2>
              <p class="muted" id="tn-sel-sub">—</p>
            </div>
            <div class="tn-detail-badges" id="tn-sel-badges"></div>
          </div>
          <div class="tn-detail-grid" id="tn-sel-facts"></div>

          <div class="tn-class-form">
            <div class="tn-class-title">CLASIFICACIÓN</div>
            <div class="tn-class-row">
              <label>STATUS
                <select id="tn-status">${STATUS_OPTS.map((o) => `<option value="${esc(o)}">${esc(o || "—")}</option>`).join("")}</select>
              </label>
              <div class="tn-riesgo">
                <span>RIESGO</span>
                <div class="tn-riesgo-btns">
                  <button type="button" data-r="BAJO" class="r-bajo">BAJO</button>
                  <button type="button" data-r="MEDIO" class="r-medio">MEDIO</button>
                  <button type="button" data-r="ALTO" class="r-alto">ALTO</button>
                </div>
              </div>
            </div>
            <div class="tn-class-row">
              <label>PUNTO AUTORIZADO
                <select id="tn-aut"><option value="">—</option><option>SI</option><option>NO</option><option>-</option></select>
              </label>
              <label>COBERTURA GPS
                <select id="tn-gps"><option value="">—</option><option>SI</option><option>NO</option><option>-</option></select>
              </label>
              <label class="grow">TIPO DE LUGAR
                <input id="tn-lugar" type="text" placeholder="Patio, grifo, vía…">
              </label>
            </div>
            <div class="tn-class-row">
              <label class="grow">PUNTO DE PERNOCTE
                <input id="tn-pernocte" type="text" placeholder="Nombre o referencia del punto">
              </label>
            </div>
            <div class="tn-class-row">
              <label class="grow">OBSERVACIONES
                <input id="tn-obs" type="text" placeholder="Notas del controlador">
              </label>
            </div>
            <div class="tn-class-actions">
              <button type="button" class="primary" id="tn-save">GUARDAR</button>
              <button type="button" class="ghost" id="tn-copy">COPIAR</button>
              <button type="button" class="ghost" id="tn-paste">PEGAR</button>
              <button type="button" class="ghost" id="tn-clear">LIMPIAR</button>
              <button type="button" class="tn-btn-nova" id="tn-nova">NO VA</button>
              <button type="button" class="ghost" id="tn-track" disabled title="Recorrido 16:00→ahora (azul hasta 22:00, rojo después)">VER RECORRIDO</button>
              <span id="tn-save-msg" class="muted"></span>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  const listEl = container.querySelector("#tn-list");
  const countersEl = container.querySelector("#tn-counters");
  const listCount = container.querySelector("#tn-list-count");
  const emptyEl = container.querySelector("#tn-detail-empty");
  const bodyEl = container.querySelector("#tn-detail-body");
  const msgEl = container.querySelector("#tn-save-msg");

  function renderCounters() {
    const { p, c, r, t } = contadores();
    countersEl.innerHTML = `
      <span class="tn-chip pend"><b>${p}</b> pend</span>
      <span class="tn-chip ok"><b>${c}</b> calif</span>
      <span class="tn-chip rev"><b>${r}</b> revisar</span>
      <span class="tn-chip"><b>${t}</b> total</span>
    `;
  }

  function renderList() {
    const rows = unidadesFiltradas();
    listCount.textContent = String(rows.length);
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
            <span class="tn-badge" style="background:${colorHtmlHex(u.color_html)}33;color:${colorHtmlHex(u.color_html)}" title="${esc(u.clase_html || u.reporte_gps || "")}">${esc(u.color_html || "—")}</span>
            <small title="T.Parada / último reporte">${esc(u.t_parada || "—")}</small>
            <small>${u.movimiento_nocturno_m >= 100 ? `↔${u.movimiento_nocturno_m}m` : ""}</small>
          </span>
        </button>`;
      })
      .join("");
  }

  function syncMarkers() {
    if (!map || !window.L) return;
    markersLayer.clearLayers();
    markersByCode.clear();
    const rows = unidadesFiltradas();
    const bounds = [];
    for (const u of rows) {
      if (u.lat == null || u.lng == null) continue;
      const icon = L.divIcon({
        className: "tn-marker-wrap",
        html: markerHtml(u),
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const m = L.marker([u.lat, u.lng], { icon });
      m.on("click", () => selectUnit(u.codigo));
      m.bindTooltip(`${u.codigo} · ${u.placa || ""}`, { direction: "top", offset: [0, -8] });
      markersLayer.addLayer(m);
      markersByCode.set(u.codigo, m);
      bounds.push([u.lat, u.lng]);
    }
    if (bounds.length && !seleccion) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      } catch {
        /* ignore */
      }
    }
  }

  function fillForm(u) {
    container.querySelector("#tn-status").value = u.status === "-" ? "" : u.status || "";
    container.querySelector("#tn-aut").value = u.punto_autorizado === "-" ? "" : u.punto_autorizado || "";
    container.querySelector("#tn-gps").value = u.cobertura_gps === "-" ? "" : u.cobertura_gps || "";
    container.querySelector("#tn-lugar").value = u.tipo_lugar || "";
    container.querySelector("#tn-pernocte").value = u.punto_pernocte || "";
    container.querySelector("#tn-obs").value = u.observaciones || "";
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) => {
      b.classList.toggle("active", b.dataset.r === u.riesgo);
    });
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
    container.querySelector("#tn-sel-sub").textContent =
      `${u.ruta || "Sin ruta"} · ${u.mercaderia || ""}`;

    container.querySelector("#tn-sel-badges").innerHTML = `
      <span class="tn-badge" style="background:${colorClasif(u.estado_clasificacion)}33;color:#e2e8f0">${esc(u.estado_clasificacion)}</span>
      <span class="tn-badge" style="background:${colorEstado(u.estado_monitoreo)}33;color:#e2e8f0">${esc(u.estado_monitoreo)}</span>
      <span class="tn-badge">${esc(u.zona || "—")}</span>
    `;

    container.querySelector("#tn-sel-facts").innerHTML = [
      ["Acople", u.acoplado],
      ["Tipo", u.tipo_acople],
      ["Gestor", u.gestor],
      ["T. parada", u.t_parada || "—"],
      ["GPS", u.lat != null ? `${Number(u.lat).toFixed(5)}, ${Number(u.lng).toFixed(5)}` : "—"],
      ["Clasificado", u.timestamp_clasificacion ? fechaPE(u.timestamp_clasificacion) : "—"],
    ]
      .map(
        ([k, v]) =>
          `<div class="tn-fact"><small>${esc(k)}</small><b>${esc(v || "—")}</b></div>`,
      )
      .join("");

    fillForm(u);
    renderList();
    msgEl.textContent = "";
    const trackBtn = container.querySelector("#tn-track");
    if (trackBtn) trackBtn.disabled = !(u.placa || u.codigo);

    const m = markersByCode.get(codigo);
    if (m && map) {
      map.panTo(m.getLatLng());
      m.openTooltip();
    }
  }

  function readForm() {
    const riesgoBtn = container.querySelector(".tn-riesgo-btns button.active");
    return {
      status: container.querySelector("#tn-status").value || "-",
      riesgo: riesgoBtn?.dataset.r || "-",
      punto_autorizado: container.querySelector("#tn-aut").value || "-",
      cobertura_gps: container.querySelector("#tn-gps").value || "-",
      tipo_lugar: container.querySelector("#tn-lugar").value.trim(),
      punto_pernocte: container.querySelector("#tn-pernocte").value.trim(),
      observaciones: container.querySelector("#tn-obs").value.trim(),
    };
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
  container.querySelector("#tn-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-f]");
    if (!btn) return;
    filtro = btn.dataset.f;
    container.querySelectorAll("#tn-filters button").forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    renderList();
    syncMarkers();
  });

  container.querySelector("#tn-search").addEventListener("input", (e) => {
    busqueda = e.target.value || "";
    renderList();
    syncMarkers();
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-code]");
    if (btn) selectUnit(btn.dataset.code);
  });

  container.querySelector(".tn-riesgo-btns").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-r]");
    if (!btn) return;
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
  });

  container.querySelector("#tn-save").addEventListener("click", () => {
    if (!seleccion) return;
    applyToSelected(readForm());
    msgEl.textContent = "Guardado";
  });

  container.querySelector("#tn-copy").addEventListener("click", () => {
    clipboard = readForm();
    msgEl.textContent = "Clasificación copiada";
  });

  container.querySelector("#tn-paste").addEventListener("click", () => {
    if (!clipboard || !seleccion) {
      msgEl.textContent = "Nada en portapapeles";
      return;
    }
    fillForm({ ...seleccion, ...clipboard });
    msgEl.textContent = "Pegado en formulario (guarda para aplicar)";
  });

  container.querySelector("#tn-clear").addEventListener("click", () => {
    fillForm({
      status: "",
      riesgo: "",
      punto_autorizado: "",
      cobertura_gps: "",
      tipo_lugar: "",
      punto_pernocte: "",
      observaciones: "",
    });
    container.querySelectorAll(".tn-riesgo-btns button").forEach((b) =>
      b.classList.remove("active"),
    );
  });

  container.querySelector("#tn-nova").addEventListener("click", () => {
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


  container.querySelector("#tn-sim-hora")?.addEventListener("change", (e) => {
    const v = e.target.value;
    simHora = v === "" ? null : Number(v);
    syncMarkers();
    pulseLive();
    const h = horaLima();
    const urg = h >= 23 || h < 4 ? "rojo ≥23:00" : h >= 22 ? "amarillo ≥22:00" : "sin halo (<22:00)";
    msgEl.textContent = `Umbral nocturno: ${urg}`;
  });

  container.querySelector("#tn-refresh").addEventListener("click", () => {
    // Futuro: snapshot/monitor API. Hoy re-sincroniza clasificaciones locales.
    const saved = loadClasificaciones();
    unidades = unidades.map((u) => {
      const s = saved[u.codigo];
      if (!s) return u;
      const m = { ...u, ...s };
      m.estado_clasificacion = estadoClasificacion(m);
      return m;
    });
    renderCounters();
    renderList();
    syncMarkers();
    msgEl.textContent = "Lista actualizada";
    pulseLive();
  });

  function pulseLive() {
    const dot = container.querySelector("#tn-live-dot");
    const txt = container.querySelector("#tn-live-txt");
    if (!dot) return;
    dot.classList.add("pulse");
    txt.textContent = `Actualizado ${new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}`;
    setTimeout(() => dot.classList.remove("pulse"), 800);
  }

  // Map
  try {
    await loadLeaflet();
    if (disposed) return;
    map = L.map(container.querySelector("#tn-map"), {
      zoomControl: true,
      attributionControl: true,
    }).setView([-16.4, -71.5], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
  } catch (e) {
    container.querySelector("#tn-map").innerHTML =
      `<div class="tn-map-error">Mapa no disponible: ${esc(e.message)}</div>`;
  }


  container.querySelector("#tn-track")?.addEventListener("click", async () => {
    if (!seleccion || routeLoading) return;
    const placa = String(seleccion.placa || "").trim();
    const tracto = String(seleccion.codigo || "").trim();
    if (!placa && !tracto) {
      msgEl.textContent = "Unidad sin placa/código";
      return;
    }
    routeLoading = true;
    const btn = container.querySelector("#tn-track");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "CARGANDO…";
    }
    msgEl.textContent = "Consultando recorrido CLocator…";
    try {
      const fechaVal = container.querySelector("#tn-fecha")?.value || fechaTurnoDefault();
      const placaU = placa.toUpperCase();
      const tractoU = tracto.toUpperCase();
      let pts = [];
      let fuente = "live";

      // 1) Caché de precarga
      const rid = currentRunId() || loadMeta()?.id;
      if (rid) {
        const cached = await readGPS(gpsKey(rid, tractoU, placaU));
        if (cached?.puntos_gps?.length) {
          pts = cached.puntos_gps;
          fuente = "caché";
        }
      }

      // 2) Fallback consulta puntual
      if (!pts.length) {
        const dia = parseFechaTurno(fechaVal);
        const desdeDt = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 16, 0, 0);
        const hastaDt = new Date();
        const limite = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1, 4, 0, 0);
        const hasta = hastaDt > limite ? limite : hastaDt;
        const user = auth.currentUser;
        if (!user) throw new Error("Sin sesión");
        const token = await user.getIdToken(true);
        const data = await queryClocator({
          endpoint: clocatorEndpoint("cemento"),
          token,
          placa: placa || tracto,
          tracto,
          desde: formatPE(desdeDt),
          hasta: formatPE(hasta),
          includeMap: false,
          timeoutMs: 60000,
        });
        pts = data.puntos_gps || data.puntos || [];
        fuente = "live";
      }

      const { azul, rojo } = partirRecorrido(pts, fechaVal);
      drawSplitRoute(azul, rojo);
      const mov = calcularMovimientoNocturno(pts, fechaVal);
      seleccion.movimiento_nocturno_m = Math.round(mov);
      syncMarkers();
      renderList();
      msgEl.textContent = `Recorrido (${fuente}): ${azul.length} azules · ${rojo.length} post-22h · mov noct. ${Math.round(mov)} m`;
    } catch (e) {
      msgEl.textContent = `Recorrido: ${e.message || e}`;
      clearRouteLayers();
    } finally {
      routeLoading = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "VER RECORRIDO";
      }
    }
  });


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
        const m = Math.round(calcularMovimientoNocturno(cached.puntos_gps, fechaVal));
        if (m !== (u.movimiento_nocturno_m || 0)) {
          u.movimiento_nocturno_m = m;
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

  function paintPrecarga() {
    const m = loadMeta();
    const g = getProgress();
    if (!precargaEl) return;
    if (g.running || m?.running) {
      precargaEl.textContent = `Rutas: ${m?.done || g.done || 0}/${m?.total || g.total || unidades.length}`;
    } else if (m?.completo) {
      precargaEl.textContent = `Rutas: ${m.ok || 0}/${m.total || 0} OK`;
      precargaEl.classList.add("ok");
    } else {
      precargaEl.textContent = "Rutas: en cola";
    }
  }
  paintPrecarga();
  window.addEventListener("turno-amanecida:precarga", () => {
    paintPrecarga();
    enriquecerMovimientoDesdeCache();
  });
  if (unidades.length) {
    startPrecarga(
      unidades.map((u) => ({ codigo: u.codigo, placa: u.placa })),
      fechaVal,
    )
      .then(() => {
        paintPrecarga();
        return enriquecerMovimientoDesdeCache();
      })
      .catch(() => {});
  }

  renderCounters();
  renderList();
  syncMarkers();
  pulseLive();

  // Poll placeholder (3 min) — refresca “vivo” cuando exista monitor API
  pollTimer = setInterval(() => {
    if (disposed) return;
    pulseLive();
    // runtime.bus.emit("turno-amanecida:poll", { at: Date.now() });
  }, POLL_MS);

  if (runtime?.bus) {
    runtime.bus.emit("turno-amanecida:monitoreo-ready", { total: unidades.length });
  }
}

export function unmount() {
  disposed = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearRouteLayers();
  if (map) {
    map.remove();
    map = null;
  }
  markersLayer = null;
  markersByCode.clear();
  seleccion = null;
}
