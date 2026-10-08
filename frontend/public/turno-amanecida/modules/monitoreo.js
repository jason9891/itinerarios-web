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

function colorMonitor(est) {
  if (est === "MOVIMIENTO") return "#22c55e";
  if (est === "DETENIDA") return "#ef4444";
  if (est === "PERDIDA_GPS") return "#94a3b8";
  return "#64748b";
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
 * Halo de urgencia nocturna para tránsitos:
 *  - 22:00–22:59 → amarillo (tránsito pasadas las 22h)
 *  - 23:00–03:59 → rojo (ya pasó de las 23h)
 *  - resto del día → sin halo nocturno
 * Aplica a unidades en movimiento, detenidas o en zona Transito.
 */
function urgenciaNocturna(u) {
  const est = u.estado_monitoreo || "";
  const zona = String(u.zona || "");
  const enJuego =
    est === "MOVIMIENTO" || est === "DETENIDA" || est === "PERDIDA_GPS" || zona === "Transito";
  if (!enJuego) return null;
  const h = horaLima();
  if (h >= 23 || h < 4) return "rojo";
  if (h >= 22) return "amarillo";
  return null;
}

function markerHtml(u) {
  const c = colorMonitor(u.estado_monitoreo);
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

export async function mount(container, runtime) {
  disposed = false;
  unidades = demoUnidades();

  container.innerHTML = `
    <div class="tn-track">
      <header class="tn-track-head">
        <div class="tn-track-title">
          <p class="eyebrow">TURNO AMANECIDA · DESDE LAS 22:00</p>
          <h1>Tránsitos de la noche</h1>
          <p class="muted">Identificar unidades 20-R- en tránsito o detenidas fuera de punto conocido · clasificar riesgo y pernocte</p>
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
            <span><i style="background:#22c55e"></i> Movimiento</span>
            <span><i style="background:#ef4444"></i> Detenida</span>
            <span><i style="background:#94a3b8"></i> GPS perdido</span>
            <span><i class="halo-leg am"></i> Tránsito ≥22:00</span>
            <span><i class="halo-leg ro"></i> Tránsito ≥23:00</span>
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
              <button type="button" class="ghost" id="tn-track" disabled title="Próximo: recorrido CLocator">VER RECORRIDO</button>
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
            <span class="tn-badge" style="background:${colorMonitor(u.estado_monitoreo)}22;color:${colorMonitor(u.estado_monitoreo)}">${esc(u.estado_monitoreo)}</span>
            <small>${esc(u.t_parada || "—")}</small>
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
      <span class="tn-badge" style="background:${colorMonitor(u.estado_monitoreo)}33;color:#e2e8f0">${esc(u.estado_monitoreo)}</span>
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
  if (map) {
    map.remove();
    map = null;
  }
  markersLayer = null;
  markersByCode.clear();
  seleccion = null;
}
