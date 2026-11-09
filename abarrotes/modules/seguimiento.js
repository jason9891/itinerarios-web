/**
 * Módulo ABARROTES · Seguimiento
 *
 * Igual que en Cemento: se carga la ruta de cada unidad (GPS del Supabase del operador), el navegador analiza
 * las geocercas tocadas y SUGIERE salida, llegada, retorno, ubicación y estado; la persona revisa y marca REVISADA.
 * Arriba se ve cuántas unidades siguen SIN SEGUIMIENTO. Todo el análisis corre en el navegador.
 */
import { esc, moduleHead, formatPlaca, irA } from "../api-client.js";
import { contadores } from "../consolidado.js";
import { leerCarga, leerSeguimiento, guardarRegistro, borrarRegistro } from "../store.js";
import { cargarGeocercas, analizar, sugerir } from "../geo.js";
import { ESTADOS, ORIGEN_GEOCERCAS, geocercasDestino } from "../maestros.js";
import { CAMPOS, msAInput, msAPE, inputAMs, camposDeSugerencia, derivados, fmtDias, desdeConsulta } from "../seg-util.js";
import { obtenerMapsKey, consultarPuntos } from "../clocator.js";

const COLOR_ESTADO = { "ESTACIONADO CARGADO": "#f59e0b", "ESTACIONADO VACÍO": "#64748b", "TRANSITO CARGADO": "#16a34a", "TRANSITO VACIO": "#0ea5e9", "PROCESO DESCARGUIO": "#a855f7", "GPS NO ACTUALIZA": "#ef4444" };

let disposed = false;
let abort = null;
let map = null;
let capas = [];
let mapsPromise = null;
const gpsMem = new Map(); // id viaje → { puntos, analisis, sug, consultado_en } (solo memoria)

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
  map = null;
  capas = [];
  const carga = leerCarga();

  if (!carga?.viajes?.length) {
    container.innerHTML = `
      ${moduleHead("Seguimiento", "Unidades sin seguimiento · sugerencias por geocerca")}
      <section class="panel">
        <div class="ab-aviso">Primero sube el Excel SAP y/o la programación TD en <b>Carga</b>: sin viajes no hay unidades que seguir.</div>
        <div class="ab-actions"><button type="button" class="primary" id="ab-go">IR A CARGA</button></div>
      </section>`;
    container.querySelector("#ab-go").addEventListener("click", () => irA("despachos"));
    return;
  }

  const viajes = carga.viajes;
  const porId = new Map(viajes.map((v) => [v.id, v]));
  const fences = await cargarGeocercas();
  const seg = leerSeguimiento();
  let filtro = "sin"; // sin | gps | sug | rev | todos
  let seleccion = null;

  container.innerHTML = `
    ${moduleHead("Seguimiento", "Unidades sin seguimiento · sugerencias por geocerca")}
    <section class="panel ab-track">
      <div id="ab-counters" class="ab-grid" style="margin:0 0 8px"></div>
      <div class="ab-actions" style="margin-top:0">
        <label class="muted">GPS DESDE HACE <input id="ab-dias" type="number" min="1" max="15" value="5" class="ab-search" style="width:56px"> días máx.</label>
        <button type="button" class="primary" id="ab-batch">CONSULTAR GPS DE LAS SIN SEGUIMIENTO</button>
        <button type="button" class="ghost" id="ab-stop" disabled>DETENER</button>
        <select id="ab-origen" class="ab-search" style="width:auto">
          <option value="">Todos los orígenes</option><option value="AREQUIPA">Arequipa</option><option value="HUACHIPA">Huachipa</option><option value="OTRO">Otros</option>
        </select>
        <input id="ab-buscar" class="ab-search" placeholder="Buscar placa, OC, DT, ruta, piloto…">
        <span id="ab-status" class="muted"></span>
      </div>
      <div class="ab-track-main" style="grid-template-columns:minmax(420px,1fr) minmax(380px,1.1fr)">
        <div class="ab-table-wrap" style="max-height:78vh">
          <table class="ab-table">
            <thead><tr><th>ORIGEN</th><th>OC / DT</th><th>TRACTO</th><th>RUTA</th><th>ESTADO</th><th>SEGUIMIENTO</th></tr></thead>
            <tbody id="ab-body"></tbody>
          </table>
        </div>
        <div id="ab-detalle"></div>
      </div>
    </section>`;

  const $ = (s) => container.querySelector(s);
  const status = $("#ab-status");

  const estadoViaje = (v) => {
    const r = seg[v.id];
    return r?.revisada ? "rev" : r?.gps ? "sug" : "gps";
  };

  function pintarContadores() {
    const c = contadores(viajes, seg);
    const card = (k, titulo, n, cls = "") => `<div class="ab-card ${cls}" data-f="${k}" style="cursor:pointer;${filtro === k ? "outline:2px solid #1d4ed8" : ""}"><small>${titulo}</small><b>${n}</b></div>`;
    $("#ab-counters").innerHTML =
      card("todos", "TOTAL DE VIAJES", c.total) +
      card("sin", "SIN SEGUIMIENTO", c.sin_seguimiento, c.sin_seguimiento ? "warn" : "ok") +
      card("gps", "SIN GPS CONSULTADO", c.sin_gps, c.sin_gps ? "warn" : "") +
      card("sug", "CON SUGERENCIA · POR REVISAR", c.con_sugerencia) +
      card("rev", "REVISADAS", c.revisadas, "ok");
  }

  function visibles() {
    const q = ($("#ab-buscar").value || "").trim().toUpperCase();
    const org = $("#ab-origen").value;
    return viajes.filter((v) => {
      const e = estadoViaje(v);
      if (filtro === "sin" && e === "rev") return false;
      if (filtro === "gps" && e !== "gps") return false;
      if (filtro === "sug" && e !== "sug") return false;
      if (filtro === "rev" && e !== "rev") return false;
      if (org && v.origen !== org) return false;
      return !q || [v.tracto, v.carreta, v.oc, v.dt, v.ruta, v.piloto, v.destino, v.cliente, v.equipo].join(" ").toUpperCase().includes(q);
    });
  }

  function pintarLista() {
    const filas = visibles();
    $("#ab-body").innerHTML =
      filas
        .map((v) => {
          const r = seg[v.id];
          const e = r?.campos?.estado || "";
          const badge = r?.revisada ? `<span class="ab-badge ok">REVISADA</span>` : r?.gps ? `<span class="ab-badge warn">SUGERENCIA</span>` : `<span class="ab-badge gris">SIN SEGUIMIENTO</span>`;
          return `<tr data-id="${esc(v.id)}" class="${seleccion === v.id ? "sel" : ""}" style="cursor:pointer">
            <td>${esc(v.origen === "AREQUIPA" ? "AQP" : v.origen === "HUACHIPA" ? "LIM" : "OTRO")}</td>
            <td>${esc(v.oc || v.dt || "—")}</td><td><b>${esc(formatPlaca(v.tracto))}</b></td>
            <td>${esc(v.ruta)}</td>
            <td>${e ? `<span class="ab-badge" style="background:${COLOR_ESTADO[e] || "#94a3b8"};color:#fff">${esc(e)}</span>` : ""}</td>
            <td>${badge}</td></tr>`;
        })
        .join("") || `<tr><td colspan="6" class="muted" style="padding:14px">Nada en este filtro.</td></tr>`;
    pintarContadores();
  }

  // ───────── GPS + análisis ─────────
  async function consultarTracto(tracto, lista, diasMax) {
    const ahora = Date.now();
    const desde = Math.min(...lista.map((v) => desdeConsulta(v, diasMax, ahora)));
    const r = await consultarPuntos(tracto, msAPE(desde), msAPE(ahora), abort?.signal);
    for (const v of lista) {
      const d0 = desdeConsulta(v, diasMax, ahora);
      const pts = r.puntos.filter((p) => p.t >= d0);
      const analisis = analizar(pts, fences);
      const sug = sugerir(v, analisis, pts, ahora, r.ultimo_monitoreo);
      gpsMem.set(v.id, { puntos: pts, analisis, sug, consultado_en: ahora });
      const prev = seg[v.id] || {};
      const propios = prev.revisada ? prev.campos : null;
      const campos = propios || { ...(prev.campos || {}), ...camposDeSugerencia(sug) };
      if (!propios) {
        // lo ya escrito a mano (carga de retorno, observaciones) se conserva
        for (const k of ["carga_retorno", "observaciones"]) if (prev.campos?.[k]) campos[k] = prev.campos[k];
      }
      seg[v.id] = guardarRegistro(v.id, {
        campos,
        gps: { consultado_en: ahora, puntos: pts.length, via: r.via, visitas: analisis.visitas.map((x) => ({ geocerca: x.geocerca, ingreso: x.ingreso, salida: x.salida, min: x.permanencia_min })), notas: sug.notas },
      });
    }
  }

  async function consultarUno(id) {
    const v = porId.get(id);
    status.textContent = `Consultando ${formatPlaca(v.tracto)}…`;
    abort = new AbortController();
    try {
      await consultarTracto(v.tracto, viajes.filter((x) => x.tracto === v.tracto && !seg[x.id]?.revisada), Number($("#ab-dias").value) || 5);
      status.textContent = `✔ ${formatPlaca(v.tracto)} actualizado`;
    } catch (e) {
      status.textContent = `⚠ ${formatPlaca(v.tracto)}: ${e.message || e}`;
    }
    abort = null;
    pintarLista();
    if (seleccion) pintarDetalle();
  }

  async function consultarLote() {
    const pend = viajes.filter((v) => !seg[v.id]?.revisada);
    const porTracto = new Map();
    for (const v of pend) (porTracto.get(v.tracto) || porTracto.set(v.tracto, []).get(v.tracto)).push(v);
    const tractos = [...porTracto.keys()];
    if (!tractos.length) { status.textContent = "No hay unidades sin seguimiento."; return; }
    abort = new AbortController();
    $("#ab-batch").disabled = true;
    $("#ab-stop").disabled = false;
    const diasMax = Number($("#ab-dias").value) || 5;
    let hechas = 0, errores = 0, i = 0;
    const worker = async () => {
      while (i < tractos.length && !abort.signal.aborted && !disposed) {
        const t = tractos[i++];
        try { await consultarTracto(t, porTracto.get(t), diasMax); } catch { errores++; }
        hechas++;
        if (!disposed) { status.textContent = `Consultando GPS… ${hechas}/${tractos.length}${errores ? ` · ⚠ ${errores} con error` : ""}`; if (hechas % 5 === 0) pintarLista(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tractos.length) }, worker));
    if (disposed) return;
    status.textContent = `${abort.signal.aborted ? "Detenido" : "Listo"}: ${hechas} unidades consultadas${errores ? ` · ⚠ ${errores} con error` : ""}`;
    abort = null;
    $("#ab-batch").disabled = false;
    $("#ab-stop").disabled = true;
    pintarLista();
    if (seleccion) pintarDetalle();
  }

  // ───────── detalle ─────────
  function pintarDetalle() {
    const v = porId.get(seleccion);
    const host = $("#ab-detalle");
    if (!v) { host.innerHTML = `<div class="ab-aviso">Selecciona una unidad de la lista para ver sus sugerencias.</div>`; return; }
    const r = seg[v.id] || {};
    const c = r.campos || {};
    const mem = gpsMem.get(v.id);
    const d = derivados(c, v.ruta);
    const orig = (ORIGEN_GEOCERCAS[v.origen] || []).join(" / ") || "sin geocerca de origen";
    const dest = geocercasDestino(v.ruta, v.destino).join(" / ") || "sin geocerca de destino";
    const sugerido = (k) => (mem?.sug ? camposDeSugerencia(mem.sug)[k] : "");
    const campo = (f) => {
      const val = c[f.k] || "";
      const sg = sugerido(f.k);
      const hint = sg && sg !== val ? `<small class="muted" title="Sugerencia del GPS">sug.: ${esc(sg)}</small>` : "";
      const input =
        f.tipo === "estado"
          ? `<select data-k="${f.k}" class="ab-search" style="width:100%"><option value=""></option>${ESTADOS.map((e) => `<option ${e === val ? "selected" : ""}>${esc(e)}</option>`).join("")}</select>`
          : `<input data-k="${f.k}" class="ab-search" style="width:100%" value="${esc(val)}" placeholder="${f.tipo === "fecha" ? "dd/mm/aa HH:mm:ss" : ""}">`;
      return `<label style="display:block"><small style="font-weight:800">${f.etiqueta}</small>${input}${hint}</label>`;
    };
    const visitas = r.gps?.visitas || [];
    host.innerHTML = `
      <div class="ab-card" style="text-align:left">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div><b style="font-size:16px">${esc(formatPlaca(v.tracto))}</b> <span class="muted">carreta ${esc(formatPlaca(v.carreta) || "—")} · equipo ${esc(v.equipo || "—")}</span><br>
          <span class="muted" style="font-size:12px">${esc(v.piloto || "—")} ${v.telefono ? "· " + esc(v.telefono) : ""} · ${esc(v.fuente)} ${esc(v.oc ? "OC " + v.oc : "")} ${esc(v.dt ? "DT " + v.dt : "")}</span></div>
          <div style="text-align:right"><b>${esc(v.ruta)}</b><br><span class="muted" style="font-size:12px">${esc(v.cliente)} · ${esc(v.carga)}</span></div>
        </div>
        <p class="muted" style="font-size:12px;margin:6px 0">Geocercas: origen <b>${esc(orig)}</b> → destino <b>${esc(dest)}</b></p>
        <div class="ab-actions" style="margin:6px 0">
          <button type="button" class="primary" id="d-gps">${mem || r.gps ? "VOLVER A CONSULTAR GPS" : "CONSULTAR GPS"}</button>
          <button type="button" class="ghost" id="d-aplicar" ${mem ? "" : "disabled"}>APLICAR SUGERENCIAS</button>
          <button type="button" class="primary" id="d-ok" style="background:#16a34a">${r.revisada ? "GUARDAR CAMBIOS" : "MARCAR REVISADA"}</button>
          ${r.revisada ? `<button type="button" class="ghost" id="d-reabrir">REABRIR</button>` : ""}
        </div>
        ${r.gps ? `<p class="muted" style="font-size:12px;margin:0 0 6px">GPS consultado ${esc(msAInput(r.gps.consultado_en))} · ${r.gps.puntos} puntos · vía ${esc(r.gps.via)}</p>` : ""}
        ${(r.gps?.notas || []).map((n) => `<div class="ab-aviso" style="margin:4px 0">${esc(n)}</div>`).join("")}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">${CAMPOS.map(campo).join("")}</div>
        <div class="ab-grid" style="margin-top:8px">
          <div class="ab-card"><small>TIEMPO DE IDA</small><b style="font-size:15px">${fmtDias(d.ida)}</b></div>
          <div class="ab-card ${d.exceso ? "warn" : ""}"><small>PROMEDIO RUTA</small><b style="font-size:15px">${fmtDias(d.promedio)}</b>${d.exceso ? `<span class="muted" style="font-size:11px">EXCESO +20 %</span>` : ""}</div>
          <div class="ab-card"><small>RETORNO</small><b style="font-size:15px">${fmtDias(d.retorno)}</b></div>
          <div class="ab-card"><small>DÍAS PARADO</small><b style="font-size:15px">${d.dias_parado}</b></div>
        </div>
        <details style="margin-top:8px" ${visitas.length ? "open" : ""}><summary><b>Geocercas tocadas</b> (${visitas.length})</summary>
          ${visitas.map((x) => `<div style="font-size:12px;margin:2px 0"><b>${esc(x.geocerca)}</b> · ingreso ${esc(msAInput(x.ingreso))} · ${x.salida ? "salida " + esc(msAInput(x.salida)) : "sigue dentro"} · ${x.min} min</div>`).join("") || `<span class="muted">Sin visitas confirmadas (≥ 20 min).</span>`}
        </details>
        <div id="ab-map" class="ab-map" style="height:300px;margin-top:8px"><p class="ab-map-msg">${mem ? "Cargando mapa…" : "Consulta el GPS para ver el recorrido."}</p></div>
      </div>`;

    const leerForm = () => Object.fromEntries([...host.querySelectorAll("[data-k]")].map((e) => [e.dataset.k, e.value.trim()]));
    const validar = (campos) => {
      for (const f of CAMPOS.filter((x) => x.tipo === "fecha")) if (campos[f.k] && inputAMs(campos[f.k]) == null) return `${f.etiqueta}: use dd/mm/aa HH:mm:ss`;
      return "";
    };
    host.querySelector("#d-gps").addEventListener("click", () => consultarUno(v.id));
    host.querySelector("#d-aplicar")?.addEventListener("click", () => {
      seg[v.id] = guardarRegistro(v.id, { campos: { ...leerForm(), ...camposDeSugerencia(mem.sug) } });
      pintarLista(); pintarDetalle();
    });
    host.querySelector("#d-ok").addEventListener("click", () => {
      const campos = leerForm();
      const err = validar(campos);
      if (err) { status.textContent = `⚠ ${err}`; return; }
      seg[v.id] = guardarRegistro(v.id, { campos, revisada: true });
      status.textContent = `✔ ${formatPlaca(v.tracto)} revisada`;
      runtime.bus.emit("abarrotes:seguimiento-actualizado", {});
      pintarLista();
      // pasa a la siguiente unidad sin seguimiento
      const sig = visibles().find((x) => estadoViaje(x) !== "rev");
      seleccion = sig ? sig.id : v.id;
      pintarLista(); pintarDetalle();
    });
    host.querySelector("#d-reabrir")?.addEventListener("click", () => {
      seg[v.id] = guardarRegistro(v.id, { revisada: false });
      pintarLista(); pintarDetalle();
    });
    host.querySelectorAll("[data-k]").forEach((e) => e.addEventListener("change", () => {
      const campos = leerForm();
      if (!validar(campos)) { seg[v.id] = guardarRegistro(v.id, { campos }); pintarDetalle(); }
    }));
    pintarMapa(v);
  }

  async function pintarMapa(v) {
    const el = $("#ab-map");
    const mem = gpsMem.get(v.id);
    if (!el || !mem) return;
    try {
      if (!window.google?.maps) await loadGoogleMaps(await obtenerMapsKey());
      if (disposed || seleccion !== v.id) return;
      el.innerHTML = "";
      map = new google.maps.Map(el, { center: { lat: -14, lng: -74 }, zoom: 5, mapTypeControl: false, streetViewControl: false });
      capas = [];
      const bounds = new google.maps.LatLngBounds();
      const path = mem.puntos.map((p) => ({ lat: p.lat, lng: p.lng }));
      if (path.length) {
        capas.push(new google.maps.Polyline({ map, path, strokeColor: "#1d4ed8", strokeWeight: 3, strokeOpacity: 0.85 }));
        path.forEach((p) => bounds.extend(p));
        capas.push(new google.maps.Marker({ map, position: path.at(-1), title: "Último punto" }));
      }
      const claves = new Set([...(ORIGEN_GEOCERCAS[v.origen] || []), ...geocercasDestino(v.ruta, v.destino), ...mem.analisis.visitas.map((x) => x.key)]);
      for (const f of fences.filter((x) => claves.has(x.key))) {
        const ring = (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]).map(([lng, lat]) => ({ lat, lng }));
        capas.push(new google.maps.Polygon({ map, paths: ring, strokeColor: "#16a34a", fillColor: "#16a34a", fillOpacity: 0.12, strokeWeight: 2, title: f.name }));
        ring.forEach((p) => bounds.extend(p));
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, 32);
    } catch (e) {
      if (!disposed && el) el.innerHTML = `<p class="ab-map-msg">Mapa no disponible: ${esc(e.message || e)}</p>`;
    }
  }

  // ───────── eventos ─────────
  $("#ab-counters").addEventListener("click", (e) => {
    const c = e.target.closest("[data-f]");
    if (c) { filtro = c.dataset.f; pintarLista(); }
  });
  $("#ab-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) { seleccion = tr.dataset.id; pintarLista(); pintarDetalle(); }
  });
  $("#ab-buscar").addEventListener("input", pintarLista);
  $("#ab-origen").addEventListener("change", pintarLista);
  $("#ab-batch").addEventListener("click", consultarLote);
  $("#ab-stop").addEventListener("click", () => abort?.abort());

  pintarLista();
  pintarDetalle();
}

export function unmount() {
  disposed = true;
  abort?.abort();
  for (const c of capas) { try { c.setMap(null); } catch { /* ignore */ } }
  capas = [];
  map = null;
}
