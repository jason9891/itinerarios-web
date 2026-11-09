/**
 * Módulo QUELLAVECO · Seguimiento GPS
 *
 * Cruza los despachos cargados (tracto de cada entrega) con las posiciones actuales de CLocator
 * (Worker de Cloudflare, solo lectura) y las muestra en mapa + tabla.
 * Las posiciones quedan en runtime.state("posiciones") para que el Reporte las use.
 */
import { esc, fechaPE, moduleHead, formatPlaca, irA } from "../api-client.js";
import { leerDespachos } from "../store.js";
import { obtenerMapsKey, obtenerPosiciones } from "../worker-client.js";

const AUTO_MS = 60 * 1000;
const COLOR = {
  VERDE: "#22c55e",
  AMARILLO: "#eab308",
  ROJO: "#ef4444",
  GRIS: "#94a3b8",
};
const BADGE = { VERDE: "ok", AMARILLO: "warn", ROJO: "err", GRIS: "gris" };

let disposed = false;
let timer = null;
let map = null;
let markers = new Map(); // tracto → google.maps.Marker
let mapsPromise = null;

function loadGoogleMaps(key) {
  if (window.google?.maps) return Promise.resolve();
  mapsPromise ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = ok;
    s.onerror = () => no(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

export async function mount(container, runtime) {
  disposed = false;
  markers = new Map();
  map = null;
  const carga = leerDespachos();

  if (!carga?.despachos?.length) {
    container.innerHTML = `
      ${moduleHead("Seguimiento", "Despachos de Quellaveco en el mapa")}
      <section class="panel">
        <div class="qv-aviso">Primero carga el Excel SAP en <b>Despachos</b>: sin despachos no hay unidades que seguir.</div>
        <div class="qv-actions"><button type="button" class="primary" id="qv-go-desp">IR A DESPACHOS</button></div>
      </section>`;
    container.querySelector("#qv-go-desp").addEventListener("click", () => irA("despachos"));
    return;
  }

  const despachos = carga.despachos;
  container.innerHTML = `
    ${moduleHead("Seguimiento", "Despachos de Quellaveco en el mapa · posiciones de CLocator")}
    <section class="panel qv-track">
      <div class="qv-actions" style="margin-top:0">
        <button type="button" class="primary" id="qv-refresh">ACTUALIZAR POSICIONES</button>
        <label class="muted" style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" id="qv-auto"> Actualizar cada 1 min
        </label>
        <input id="qv-buscar" class="qv-search" placeholder="Buscar entrega, placa, destino…">
        <span id="qv-status" class="muted"></span>
      </div>
      <div id="qv-counters" class="qv-grid" style="margin:6px 0"></div>
      <div class="qv-legend">
        <span><i style="background:#22c55e"></i> Reporta</span>
        <span><i style="background:#eab308"></i> Alerta GPS</span>
        <span><i style="background:#ef4444"></i> No reporta</span>
        <span><i style="background:#94a3b8"></i> Sin reporte prolongado</span>
        <span><i style="background:#475569"></i> Sin posición</span>
      </div>
      <div class="qv-track-main">
        <div id="qv-map" class="qv-map"><p class="qv-map-msg">Cargando mapa…</p></div>
        <div class="qv-table-wrap" style="max-height:none">
          <table class="qv-table">
            <thead><tr><th>ENTREGA</th><th>TRACTO</th><th>DESTINO</th><th>GPS</th><th>T. PARADA</th></tr></thead>
            <tbody id="qv-body"></tbody>
          </table>
        </div>
      </div>
    </section>`;

  const $ = (sel) => container.querySelector(sel);
  const status = $("#qv-status");
  let seleccion = null; // tracto
  let primeraVez = true;

  const posiciones = () => runtime.state.get("posiciones") || null;

  function pintar() {
    const p = posiciones();
    const q = ($("#qv-buscar").value || "").trim().toUpperCase();
    const filas = despachos.filter(
      (d) =>
        !q || [d.Entrega, d.tracto, d.carreta, d.Destino, d.Cliente].join(" ").toUpperCase().includes(q),
    );

    const conPos = despachos.filter((d) => p?.porPlaca.get(d.tracto)?.lat != null).length;
    $("#qv-counters").innerHTML = `
      <div class="qv-card"><small>DESPACHOS</small><b>${despachos.length}</b></div>
      <div class="qv-card ok"><small>CON POSICIÓN</small><b>${p ? conPos : "—"}</b></div>
      <div class="qv-card ${p && despachos.length - conPos ? "warn" : ""}"><small>SIN POSICIÓN</small><b>${p ? despachos.length - conPos : "—"}</b></div>`;

    $("#qv-body").innerHTML = filas
      .map((d) => {
        const pos = p?.porPlaca.get(d.tracto);
        const gps = !p
          ? `<span class="qv-badge">—</span>`
          : pos
            ? `<span class="qv-badge ${BADGE[pos.color] || ""}">${esc(pos.reporte)}</span>`
            : `<span class="qv-badge gris">SIN POSICIÓN</span>`;
        return `<tr data-tracto="${esc(d.tracto)}" class="${seleccion === d.tracto ? "sel" : ""}" style="cursor:pointer">
          <td>${esc(d.Entrega)}</td><td><b>${esc(formatPlaca(d.tracto))}</b></td>
          <td>${esc(d.Destino)}</td><td>${gps}</td><td>${esc(pos?.t_parada || "")}</td></tr>`;
      })
      .join("");

    pintarMarcadores(p);
  }

  function pintarMarcadores(p) {
    if (!map || !window.google?.maps) return;
    for (const m of markers.values()) m.setMap(null);
    markers.clear();
    if (!p) return;
    const bounds = new google.maps.LatLngBounds();
    let hay = false;
    for (const d of despachos) {
      if (markers.has(d.tracto)) continue;
      const pos = p.porPlaca.get(d.tracto);
      if (!pos || pos.lat == null || pos.lng == null) continue;
      const ll = { lat: Number(pos.lat), lng: Number(pos.lng) };
      const m = new google.maps.Marker({
        map,
        position: ll,
        title: `${formatPlaca(d.tracto)} · ${pos.reporte}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: seleccion === d.tracto ? 10 : 7,
          fillColor: COLOR[pos.color] || "#64748b",
          fillOpacity: 1,
          strokeColor: "#0b1928",
          strokeWeight: 2,
        },
        zIndex: seleccion === d.tracto ? 300 : 200,
      });
      m.addListener("click", () => seleccionar(d.tracto, false));
      markers.set(d.tracto, m);
      bounds.extend(ll);
      hay = true;
    }
    if (hay && primeraVez) {
      primeraVez = false;
      try {
        map.fitBounds(bounds, 48);
        if (map.getZoom() > 12) map.setZoom(12);
      } catch {
        /* ignore */
      }
    }
  }

  function seleccionar(tracto, centrar = true) {
    seleccion = tracto;
    pintar();
    const m = markers.get(tracto);
    if (m && centrar) {
      map.panTo(m.getPosition());
      if (map.getZoom() < 12) map.setZoom(12);
    }
    container.querySelector(`tr[data-tracto="${CSS.escape(tracto)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  async function actualizar() {
    const btn = $("#qv-refresh");
    btn.disabled = true;
    status.textContent = "Consultando CLocator…";
    try {
      const p = await obtenerPosiciones();
      if (disposed) return;
      runtime.state.set("posiciones", p);
      runtime.bus.emit("quellaveco:posiciones-actualizadas", { total: p.total });
      status.textContent = `Actualizado ${fechaPE(p.generado_en)} · ${p.total} unidades en CLocator`;
      pintar();
    } catch (e) {
      if (!disposed) status.textContent = `⚠ ${e.message || e}`;
    } finally {
      if (!disposed) btn.disabled = false;
    }
  }

  $("#qv-refresh").addEventListener("click", actualizar);
  $("#qv-buscar").addEventListener("input", pintar);
  $("#qv-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-tracto]");
    if (tr) seleccionar(tr.dataset.tracto);
  });
  $("#qv-auto").addEventListener("change", (e) => {
    if (timer) clearInterval(timer);
    timer = e.target.checked ? setInterval(actualizar, AUTO_MS) : null;
  });

  pintar();

  // Mapa (clave de Google Maps desde el Worker); si falla, la tabla sigue funcionando
  try {
    const key = await obtenerMapsKey();
    await loadGoogleMaps(key);
    if (disposed) return;
    const el = $("#qv-map");
    el.innerHTML = "";
    map = new google.maps.Map(el, {
      center: { lat: -16.4, lng: -71.5 },
      zoom: 7,
      mapTypeControl: false,
      streetViewControl: false,
    });
    pintar();
  } catch (e) {
    if (!disposed) $("#qv-map").innerHTML = `<p class="qv-map-msg">Mapa no disponible: ${esc(e.message || e)}</p>`;
  }

  // Primera consulta automática si todavía no hay posiciones en esta sesión
  if (!posiciones()) actualizar();
  else status.textContent = `Posiciones de ${fechaPE(posiciones().generado_en)}`;
}

export function unmount() {
  disposed = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  for (const m of markers.values()) {
    try {
      m.setMap(null);
    } catch {
      /* ignore */
    }
  }
  markers.clear();
  map = null;
}
