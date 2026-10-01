import { initializeApp } from "/vendor/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
} from "/vendor/firebase-auth.js";
const firebaseConfig = {
    apiKey: "AIzaSyAeTPLS3r-199T__22TKrPMpZVZFe8IZI8",
    authDomain: "itinerarios-2fa6f.firebaseapp.com",
    projectId: "itinerarios-2fa6f",
    storageBucket: "itinerarios-2fa6f.firebasestorage.app",
    messagingSenderId: "436339112360",
    appId: "1:436339112360:web:ed48a2b8941572a77ec59d",
    measurementId: "G-39WNFBRYSK",
  },
  API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-consulta",
  CLOCATOR_API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-clocator",
  TRACK_API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-seguimiento",
  REPORT_API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-reporte",
  SAP_API = "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-sap",
  ADMIN_API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-admin",
  MANUAL_API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-manual";
const auth = getAuth(initializeApp(firebaseConfig)),
  provider = new GoogleAuthProvider(),
  $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
provider.setCustomParameters({ prompt: "select_account" });
function fechaPE(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .format(d)
        .replace(",", "");
}
async function api(path) {
  const r = await fetch(`${API}/${path}`, {
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      },
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function clocatorTest(
  placa = "AKU-861",
  tracto = "20-R-752",
  includeMap = true,
  desde = "",
  hasta = "",
  signal,
) {
  const r = await fetch(CLOCATOR_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        placa,
        tracto,
        include_map: includeMap,
        desde,
        hasta,
      }),
      signal,
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
function gpsDB() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("cemento-gps-temporal", 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("recorridos"))
        db.createObjectStore("recorridos");
      if (!db.objectStoreNames.contains("sap_archivos"))
        db.createObjectStore("sap_archivos");
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}
async function cacheGPS(data, key = `${data.tracto}|${data.placa}`) {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recorridos", "readwrite");
    tx.objectStore("recorridos").put(
      { ...data, guardado_en: new Date().toISOString() },
      key,
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
async function readGPS(key) {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recorridos", "readonly"),
      r = tx.objectStore("recorridos").get(key);
    r.onsuccess = () => {
      db.close();
      resolve(r.result || null);
    };
    r.onerror = () => reject(r.error);
  });
}
function nowPEString() {
  const q = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${q.day}/${q.month}/${q.year} ${q.hour}:${q.minute}:${q.second}`;
}
async function trackApi(body) {
  const r = await fetch(TRACK_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function allGPS() {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction("recorridos", "readonly")
      .objectStore("recorridos")
      .getAll();
    r.onsuccess = () => {
      db.close();
      resolve(r.result || []);
    };
    r.onerror = () => reject(r.error);
  });
}
async function clearStore(name) {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
async function purgeGPSExcept(runId) {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recorridos", "readwrite"),
      store = tx.objectStore("recorridos"),
      cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const value = c.value || {};
      if (!runId || value.run_id !== runId) c.delete();
      c.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
async function saveSAPCache(record) {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sap_archivos", "readwrite"),
      store = tx.objectStore("sap_archivos");
    store.clear();
    store.put({ ...record, guardado_en: new Date().toISOString() }, "actual");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
async function readSAPCache() {
  const db = await gpsDB();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction("sap_archivos", "readonly")
      .objectStore("sap_archivos")
      .get("actual");
    r.onsuccess = () => {
      db.close();
      resolve(r.result || null);
    };
    r.onerror = () => reject(r.error);
  });
}
async function sapApi(body) {
  const r = await fetch(SAP_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || `HTTP ${r.status}`);
  return d;
}
const nplate = (v) =>
  String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
function field(p, k) {
  const s = String(p?.[k] ?? "").trim();
  if (!s) return "";
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : s;
}
function formData(card) {
  const id = card.dataset.id,
    out = {},
    ids = {
      salida_planta: "salida",
      llegada_destino: "llegada",
      inicio_retorno: "retorno",
      fin_de_ciclo: "fin",
      carga_retorno: "carga",
      observaciones: "obs",
      ubicacion: "ubi",
      estado_fisico: "estado",
    };
  for (const [k, s] of Object.entries(ids)) {
    const el = $(`f-${id}-${s}`),
      before = String(el.dataset.original ?? "").trim(),
      now = String(el.value ?? "").trim();
    if (now === before || (!now && !before)) continue;
    out[k] = now || null;
  }
  return out;
}
function pasteField(id) {
  navigator.clipboard
    .readText()
    .then((x) => {
      $(id).value = x;
      $(id).dispatchEvent(new Event("input"));
    })
    .catch(() => alert("El navegador no permitió leer el portapapeles."));
}
function ocCreationDate(payload) {
  const value = field(
    payload,
    payload?.["Fecha de Orden"]
      ? "Fecha de Orden"
      : payload?.["Fecha Carga Real"]
        ? "Fecha Carga Real"
        : payload?.FecIniReal
          ? "FecIniReal"
          : "Creado el",
  );
  return value ? value.split(" ")[0] : "SIN FECHA REGISTRADA";
}
function ocHtml(x) {
  const p = x.payload,
    o = x.original_payload || p,
    id = x.id,
    states = [
      "",
      "ESTACIONADO CARGADO",
      "ESTACIONADO VACÍO",
      "TRANSITO CARGADO",
      "TRANSITO VACÍO",
    ];
  if (p.ESTADO && !states.includes(p.ESTADO)) states.push(p.ESTADO);
  const inp = (s, l, k) =>
    `<label><span>${l}</span><div class="paste-input"><input id="f-${id}-${s}" data-original="${esc(field(o, k))}" value="${esc(field(p, k))}"><button data-paste="f-${id}-${s}">📋</button></div></label>`;
  return `<article class="track-oc" data-id="${id}"><header><div><b>OC ${esc(x.orden_carga)}</b><strong>${esc(p.Ruta || "—")}</strong><small>${esc(p.CARGA || "")}</small><span class="oc-created">CREADA: ${esc(ocCreationDate(p))}</span></div><em>${x.borrador ? x.borrador.accion : ""}</em></header><div class="track-fields">${inp("salida", "SALIDA PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}${inp("llegada", "LLEGADA DESTINO", "FECHA LLEGADA A DESTINO")}${inp("retorno", "INICIO RETORNO", "FECHA INICIO DE RETORNO")}${inp("fin", "FIN DE CICLO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}</div><label><span>CARGA DE RETORNO</span><input id="f-${id}-carga" data-original="${esc(field(o, "CARGA DE RETORNO"))}" value="${esc(field(p, "CARGA DE RETORNO"))}"></label><label><span>OBSERVACIONES</span><textarea id="f-${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}">${esc(field(p, "OBSERVACIONES"))}</textarea></label>${inp("ubi", "UBICACIÓN", "UBICACIÓN")}<div class="track-actions"><select id="f-${id}-estado" data-original="${esc(field(o, "ESTADO"))}">${states.map((s) => `<option value="${esc(s)}" ${s === field(p, "ESTADO") ? "selected" : ""}>${esc(s || "-")}</option>`).join("")}</select><button data-save="${id}">GUARDAR OC</button><button class="danger" data-close="${id}">CERRAR OC</button></div></article>`;
}
let trackState = {
  list: [],
  index: 0,
  reviewed: new Set(),
  map: null,
  overlays: [],
  inspectionMarkers: [],
  inspectionEnabled: false,
  infoWindow: null,
  mapConfig: null,
  currentGps: null,
};
async function cachedForPlate(plate) {
  const all = await allGPS(),
    key = nplate(plate),
    runId = activeMeta()?.id,
    matches = all
      .filter((x) => x.ok && x.run_id === runId && nplate(x.placa) === key)
      .sort((a, b) =>
        String(b.guardado_en).localeCompare(String(a.guardado_en)),
      );
  return matches[0] || null;
}
async function initTrackingMap() {
  const r = await fetch(CLOCATOR_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "map_config" }),
    }),
    cfg = await r.json();
  if (!r.ok) throw Error(cfg.error || "No se pudo cargar configuración del mapa");
  await loadMaps(cfg.google_maps_api_key);
  trackState.mapConfig = cfg;
  trackState.map = new google.maps.Map($("tracking-map"), {
    center: { lat: -16.4, lng: -71.5 },
    zoom: 9,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: "greedy",
  });
  // VERSIÓN 2: la cartografía sigue participando en el análisis del servidor,
  // pero el mapa operativo muestra únicamente el recorrido GPS de la unidad.
}
function normalizeGpsPoint(p, index) {
  const lat = Number(p?.lat),
    lng = Number(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, fecha: String(p?.fecha || p?.fecha_hora || ""), index }
    : null;
}
function distanceMeters(a, b) {
  const R = 6371000,
    rad = (x) => (x * Math.PI) / 180,
    p1 = rad(a.lat),
    p2 = rad(b.lat),
    dp = rad(b.lat - a.lat),
    dl = rad(b.lng - a.lng),
    h =
      Math.sin(dp / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function parseGpsDate(v) {
  const s = String(v || "").trim(),
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}
function clearInspection() {
  for (const x of trackState.inspectionMarkers || []) x.setMap(null);
  trackState.inspectionMarkers = [];
  trackState.infoWindow?.close();
}
function setInspection(enabled) {
  trackState.inspectionEnabled = !!enabled;
  clearInspection();
  const b = $("view-hours");
  if (b) {
    b.textContent = enabled ? "OCULTAR HORAS" : "VER HORAS";
    b.classList.toggle("active", !!enabled);
  }
  if (!enabled || !trackState.map) return;
  const data = trackState.currentGps || [],
    step = data.length > 2500 ? 3 : data.length > 1200 ? 2 : 1;
  for (let i = 0; i < data.length; i += step) {
    const p = data[i],
      m = new google.maps.Marker({
        map: trackState.map,
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
    m.addListener("click", () => showRouteTime({ lat: p.lat, lng: p.lng }));
    trackState.inspectionMarkers.push(m);
  }
}
function nearbyPasses(pos) {
  const near = (trackState.currentGps || [])
      .map((p) => ({ ...p, distance: distanceMeters(pos, p) }))
      .filter((p) => p.distance <= 22 && p.fecha)
      .sort((a, b) => a.index - b.index),
    groups = [];
  let current = [];
  for (const p of near) {
    if (!current.length) {
      current = [p];
      continue;
    }
    const prev = current.at(-1),
      a = parseGpsDate(prev.fecha),
      b = parseGpsDate(p.fecha),
      newPass =
        a && b ? Math.abs(b - a) / 60000 > 10 : p.index - prev.index > 20;
    if (newPass) {
      groups.push(current);
      current = [p];
    } else current.push(p);
  }
  if (current.length) groups.push(current);
  return groups.map((g) => ({
    closest: g.reduce((a, b) => (!a || b.distance < a.distance ? b : a), null),
    first: g[0],
    last: g.at(-1),
  }));
}
function showRouteTime(pos) {
  const passes = nearbyPasses(pos);
  if (!passes.length || !trackState.map) return;
  trackState.map.panTo(pos);
  if ((trackState.map.getZoom() || 0) < 16) trackState.map.setZoom(16);
  trackState.infoWindow ??= new google.maps.InfoWindow();
  const nativeHeader =
      typeof trackState.infoWindow.setHeaderContent === "function",
    box = document.createElement("div");
  box.className = "route-time-popup";
  box.innerHTML = `${nativeHeader ? "" : "<b>FECHA / HORA</b>"}${passes.map((p, i) => `<div class="route-pass"><button data-route-time="${esc(p.closest.fecha)}">${esc(p.closest.fecha)}</button>${p.first.fecha !== p.last.fecha ? `<small>PASADA ${i + 1} · ${esc(p.first.fecha)} → ${esc(p.last.fecha)}</small>` : passes.length > 1 ? `<small>PASADA ${i + 1}</small>` : ""}</div>`).join("")}<em>Haz clic sobre una fecha para copiarla.</em>`;
  box.querySelectorAll("[data-route-time]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.routeTime);
          const old = b.textContent;
          b.textContent = "COPIADO";
          setTimeout(() => (b.textContent = old), 850);
        } catch {}
      }),
  );
  if (nativeHeader) {
    const h = document.createElement("div");
    h.className = "route-time-header";
    h.textContent = "FECHA / HORA";
    trackState.infoWindow.setHeaderContent(h);
  }
  trackState.infoWindow.setContent(box);
  trackState.infoWindow.setPosition(pos);
  trackState.infoWindow.open({ map: trackState.map });
}
function drawTracking(gps) {
  for (const x of trackState.overlays) x.setMap(null);
  trackState.overlays = [];
  setInspection(false);
  const data = (gps?.puntos_gps || []).map(normalizeGpsPoint).filter(Boolean);
  trackState.currentGps = data;
  if (!data.length) {
    $("map-caption").textContent = "Sin recorrido temporal en este navegador.";
    return;
  }
  $("map-caption").textContent =
    `${data.length} puntos · ${gps.desde} → ${gps.hasta}`;
  if (!trackState.map) return;
  const path = data.map((p) => ({ lat: p.lat, lng: p.lng })),
    bounds = new google.maps.LatLngBounds(),
    arrow = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 3.5,
      strokeColor: "#7c3aed",
      strokeWeight: 2,
      fillColor: "#7c3aed",
      fillOpacity: 1,
    },
    line = new google.maps.Polyline({
      map: trackState.map,
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
  line.addListener("click", (e) => {
    if (trackState.inspectionEnabled && e?.latLng)
      showRouteTime({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  });
  trackState.overlays.push(line);
  path.forEach((p) => bounds.extend(p));
  [
    [path[0], "I", "#2563eb"],
    [path.at(-1), "F", "#dc2626"],
  ].forEach(([p, l, c]) => {
    const m = new google.maps.Marker({
      map: trackState.map,
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
    });
    trackState.overlays.push(m);
  });
  const last3 = path.slice(-3),
    redArrow = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 4,
      strokeColor: "#dc2626",
      strokeWeight: 2,
      fillColor: "#dc2626",
      fillOpacity: 1,
    },
    red = new google.maps.Polyline({
      map: trackState.map,
      path: last3,
      geodesic: true,
      strokeColor: "#dc2626",
      strokeOpacity: 1,
      strokeWeight: 7,
      zIndex: 400,
      icons: [{ icon: redArrow, offset: "100%" }],
    });
  trackState.overlays.push(red);
  trackState.map.fitBounds(bounds);
}
async function copyTrackingValue(button) {
  const value = button.dataset.copy || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const t = document.createElement("textarea");
    t.value = value;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  const old = button.dataset.label || button.textContent;
  button.dataset.label = old;
  button.textContent = "COPIADO";
  setTimeout(() => (button.textContent = old), 900);
}
function renderEvents(gps) {
  const visits = gps?.analisis?.visitas_confirmadas || [];
  const involved = [
    ...new Map(visits.map((v) => [v.geocerca_id || v.geocerca, v])).values(),
  ];
  const events = visits
    .flatMap((v) => [
      `<article class="gps-event"><b>INGRESO ${esc(v.geocerca)}</b><button class="gps-time" data-copy="${esc(v.ingreso)}">${esc(v.ingreso)}</button><em>${v.permanencia_minutos} min · ${v.puntos_dentro} puntos</em></article>`,
      v.salida
        ? `<article class="gps-event"><b>SALIDA ${esc(v.geocerca)}</b><button class="gps-time" data-copy="${esc(v.salida)}">${esc(v.salida)}</button></article>`
        : "",
    ])
    .join("");
  const network = gps?.analisis?.ubicacion_red || gps?.analisis?.ubicacion_tramo || "—";
  const source = String(gps?.analisis?.fuente_ubicacion_red || "—").replaceAll("_", " ");
  const candidates = gps?.analisis?.rutas_candidatas || [];
  const audit = candidates.length > 1
    ? `<div class="route-candidates"><small>RUTAS CANDIDATAS · DESEMPATE POR DISTANCIA</small>${candidates.slice(0, 5).map((r) => `<div><b>${esc(r.name)}</b><span>${esc(r.distancia_m)} m</span></div>`).join("")}</div>`
    : "";
  $("gps-events").innerHTML =
    `<div class="gps-summary"><small>ESTADO GPS</small><b>${esc(gps?.analisis?.estado_final || "—")}</b><small>ÚLTIMA GEOCERCA</small><b>${esc(gps?.analisis?.ultima_geocerca || "—")}</b><small>UBICACIÓN EN RED</small><b>${esc(network)}</b><small>FUENTE DEL ANÁLISIS</small><b>${esc(source)}</b></div>${audit}${involved.length ? `<div class="geofence-involved"><small>GEOCERCAS INVOLUCRADAS · CLIC PARA COPIAR</small>${involved.map((v) => `<button data-copy="${esc(v.geocerca)}">${esc(v.geocerca)}</button>`).join("")}</div>` : ""}<div class="gps-sequence-title">SECUENCIA GPS · CLIC EN LA HORA PARA COPIAR</div>${events || "<p>Sin visitas confirmadas.</p>"}`;
  document
    .querySelectorAll("#gps-events [data-copy]")
    .forEach((b) => (b.onclick = () => copyTrackingValue(b)));
}
async function loadTrackingUnit(i) {
  trackState.index = (i + trackState.list.length) % trackState.list.length;
  paintStrip();
  const u = trackState.list[trackState.index],
    d = await trackApi({ action: "detalle", placa: u.placa }),
    gps = await cachedForPlate(u.placa);
  $("unit-name").textContent = d.tracto || d.placa;
  $("unit-sub").textContent = `${d.placa} · ${d.ocs.length} OC abiertas`;
  $("last-closed").textContent = d.ultima_oc_cerrada
    ? `OC ${d.ultima_oc_cerrada.orden_carga} · ${d.ultima_oc_cerrada.ruta}`
    : "Sin OC cerrada registrada";
  $("oc-list").innerHTML = d.ocs.map(ocHtml).join("");
  document
    .querySelectorAll("[data-paste]")
    .forEach((b) => (b.onclick = () => pasteField(b.dataset.paste)));
  document.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = async () => {
        const card = b.closest(".track-oc");
        b.disabled = true;
        try {
          await trackApi({
            action: "guardar",
            id: +b.dataset.save,
            datos: formData(card),
          });
          b.textContent = "PREPARADO";
        } finally {
          b.disabled = false;
        }
      }),
  );
  document.querySelectorAll("[data-close]").forEach(
    (b) =>
      (b.onclick = async () => {
        const card = b.closest(".track-oc");
        b.disabled = true;
        try {
          await trackApi({
            action: "cerrar",
            id: +b.dataset.close,
            datos: formData(card),
          });
          b.textContent = "CIERRE PREPARADO";
        } finally {
          b.disabled = false;
        }
      }),
  );
  drawTracking(gps);
  renderEvents(gps);
}
function paintStrip() {
  const h = $("plate-strip"),
    n = trackState.list.length,
    i = trackState.index;
  if (!h || !n) return;
  h.innerHTML = [-1, 0, 1]
    .map((d) => {
      const ix = (i + d + n) % n,
        u = trackState.list[ix];
      return `<button class="${d === 0 ? "selected" : ""} ${trackState.reviewed.has(nplate(u.placa)) ? "reviewed" : ""}" data-i="${ix}">${esc(u.tracto || u.placa)}</button>`;
    })
    .join("");
  h.querySelectorAll("button").forEach(
    (b) => (b.onclick = () => (trackState.v2 ? loadTrackingUnitV2(+b.dataset.i) : loadTrackingUnit(+b.dataset.i))),
  );
  if ($("plate-position"))
    $("plate-position").textContent = `PLACA ${i + 1}/${n}`;
  $("review-count").textContent = `REVISADAS ${trackState.reviewed.size}/${n}`;
}
let mapsPromise;
function loadMaps(key) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!key)
    return Promise.reject(
      new Error("Falta GOOGLE_MAPS_API_KEY en los secretos de Supabase"),
    );
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => resolve(window.google.maps);
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return mapsPromise;
}
async function paintMap(x) {
  await loadMaps(x.google_maps_api_key);
  const points = x.puntos_gps.map((p) => ({ lat: +p.lat, lng: +p.lng })),
    map = new google.maps.Map($("route-map"), {
      center: points.at(-1) || { lat: -16.4, lng: -71.5 },
      zoom: 9,
      mapTypeId: "roadmap",
    }),
    bounds = new google.maps.LatLngBounds();
  x.geocercas.forEach((g) => {
    const polys =
      g.geometry.type === "Polygon"
        ? [g.geometry.coordinates]
        : g.geometry.coordinates;
    polys.forEach((poly) => {
      const paths = poly.map((r) => r.map((c) => ({ lat: +c[1], lng: +c[0] })));
      new google.maps.Polygon({
        map,
        paths,
        strokeColor: "#2bc3ff",
        strokeOpacity: 0.55,
        strokeWeight: 1,
        fillColor: "#2bc3ff",
        fillOpacity: 0.08,
      });
      paths[0].forEach((p) => bounds.extend(p));
    });
  });
  for (const r of x.rutas_madre || []) {
    const lines = r.geometry?.type === "LineString"
      ? [r.geometry.coordinates]
      : r.geometry?.coordinates || [];
    for (const routeLine of lines)
      new google.maps.Polyline({
        map,
        path: routeLine.map((c) => ({ lat: +c[1], lng: +c[0] })),
        strokeColor: "#f59e0b",
        strokeOpacity: 0.24,
        strokeWeight: 2,
        clickable: false,
      });
  }
  new google.maps.Polyline({
    map,
    path: points,
    strokeColor: "#ffb12b",
    strokeOpacity: 0.95,
    strokeWeight: 4,
  });
  points.forEach((p) => bounds.extend(p));
  if (!bounds.isEmpty()) map.fitBounds(bounds);
  new google.maps.Marker({
    map,
    position: points[0],
    label: "I",
    title: "Inicio",
  });
  new google.maps.Marker({
    map,
    position: points.at(-1),
    label: "F",
    title: "Último punto",
  });
}
function loading() {
  $("content").innerHTML =
    '<section class="loading">Consultando Supabase…</section>';
}
function head(k, t, s) {
  return `<section class="module-head"><div><p class="eyebrow">${k}</p><h1>${t}</h1><p>${s}</p></div><span class="pill ok">● SISTEMA ACTIVO</span></section>`;
}
function lock(t) {
  return `<div class="lock">🔒 ${t} se habilitará en su propia prueba controlada.</div>`;
}
function navState(r) {
  if (r !== "seguimiento") document.body.classList.remove("tracking-active");
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.route === r));
}
async function home() {
  navState("home");
  loading();
  const d = await api("resumen");
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 09",
      "Seguimiento y control operativo",
      `Última actualización: ${fechaPE(d.ultima_actividad)}`,
    ) +
    `<section class="notice">Consulta real en modo seguro. No modifica SAP, Seguimiento, GPS ni reportes.</section><section class="metrics"><article><span>UNIDADES</span><strong>${d.unidades}</strong><small>con OC abierta</small></article><article><span>OCs ABIERTAS</span><strong>${d.ocs_abiertas}</strong><small>por evaluar</small></article><article><span>RANGO GPS</span><strong class="small-value">${esc(d.rango_gps_desde)}</strong><small>desde último reporte</small></article><article><span>PRECARGA</span><strong class="small-value">${esc(d.precarga?.estado || "—")}</strong><small>${d.precarga?.completas || 0}/${d.precarga?.total_unidades || 0} unidades</small></article></section><section class="panel"><div class="panel-title"><h2>Última actividad GPS</h2><span class="pill">INCREMENTAL</span></div><div class="activity"><div><small>DESDE</small><b>${esc(d.precarga?.desde_base || "—")}</b></div><div><small>HASTA</small><b>${esc(d.precarga?.hasta_solicitado || "—")}</b></div><div><small>ERRORES</small><b>${d.precarga?.errores ?? 0}</b></div></div><p class="muted">${esc(d.precarga?.mensaje || "Sin precargas")}</p></section>`;
}
let preloadStop = false;
async function precarga() {
  navState("precarga");
  loading();
  const daily = await api("seguimiento"),
    units = [
      ...new Map(
        daily.registros
          .filter((x) => x.placa || x.tracto)
          .map((x) => [
            (x.placa || x.tracto).toUpperCase().replace(/[^A-Z0-9]/g, ""),
            { placa: x.placa || x.tracto, tracto: x.tracto || x.placa },
          ]),
      ).values(),
    ],
    saved = JSON.parse(
      localStorage.getItem("cemento_precarga_activa") || "null",
    );
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 12",
      "Precarga real de flota",
      `${units.length} unidades abiertas · análisis incremental y reanudable.`,
    ) +
    `<section class="notice">Los recorridos permanecen únicamente en IndexedDB de este navegador. Supabase no almacena coordenadas GPS.</section><section class="panel"><div class="panel-title"><div><h2>Control de precarga</h2><p id="run-range" class="muted">${saved ? `Ejecución pendiente hasta ${esc(saved.hasta)}` : "Lista para iniciar desde 09/09/2026 11:00:00"}</p></div><div><button id="start-preload">${saved ? "REANUDAR" : "INICIAR PRECARGA"}</button> <button id="stop-preload" disabled>DETENER</button></div></div><div class="activity"><div><small>ESTADO</small><b id="batch-state">LISTO</b></div><div><small>PROGRESO</small><b id="batch-count">0/${units.length}</b></div><div><small>ERRORES</small><b id="batch-errors">0</b></div></div><div class="progress"><span id="batch-progress" style="width:0%"></span></div></section><section class="panel"><div class="panel-title"><h2>Unidades de la ejecución</h2><span>resultado inmediato por placa</span></div><div class="table-wrap"><table><thead><tr><th>TRACTO</th><th>PLACA</th><th>PUNTOS</th><th>VISITAS</th><th>ESTADO</th></tr></thead><tbody id="batch-rows">${units.map((u, i) => `<tr><td>${esc(u.tracto)}</td><td><b>${esc(u.placa)}</b></td><td id="p-${i}">—</td><td id="v-${i}">—</td><td id="s-${i}"><span class="state">PENDIENTE</span></td></tr>`).join("")}</tbody></table></div></section>`;
  const paint = (i, status, data) => {
    $(`s-${i}`).innerHTML = `<span class="state">${esc(status)}</span>`;
    if (data) {
      $(`p-${i}`).textContent = data.puntos ?? 0;
      $(`v-${i}`).textContent = data.analisis?.visitas_confirmadas?.length ?? 0;
    }
  };
  const run = async () => {
    preloadStop = false;
    $("start-preload").disabled = true;
    $("stop-preload").disabled = false;
    let meta = JSON.parse(
      localStorage.getItem("cemento_precarga_activa") || "null",
    );
    if (!meta) {
      meta = {
        id: crypto.randomUUID(),
        desde: "09/09/2026 11:00:00",
        hasta: nowPEString(),
      };
      localStorage.setItem("cemento_precarga_activa", JSON.stringify(meta));
    }
    $("run-range").textContent = `Rango fijo: ${meta.desde} → ${meta.hasta}`;
    let done = 0,
      errors = 0;
    for (let i = 0; i < units.length; i++) {
      if (preloadStop) break;
      const u = units[i],
        key = `${meta.id}|${u.tracto}|${u.placa}`,
        cached = await readGPS(key);
      if (cached?.ok) {
        done++;
        paint(i, "COMPLETO", cached);
      } else {
        paint(i, "PROCESANDO");
        try {
          const x = await clocatorTest(u.placa, u.tracto, false, meta.hasta);
          await cacheGPS({ ...x, run_id: meta.id }, key);
          done++;
          paint(i, x.puntos ? "COMPLETO" : "SIN PUNTOS", x);
        } catch (e) {
          errors++;
          paint(i, "ERROR");
          $(`s-${i}`).innerHTML +=
            `<small class="cell-error">${esc(e.message)}</small>`;
        }
      }
      $("batch-count").textContent = `${done}/${units.length}`;
      $("batch-errors").textContent = errors;
      $("batch-progress").style.width =
        `${Math.round((100 * (done + errors)) / units.length)}%`;
    }
    const complete = done + errors === units.length;
    if (complete && errors === 0) {
      localStorage.removeItem("cemento_precarga_activa");
      $("batch-state").textContent = "COMPLETO";
    } else
      $("batch-state").textContent = preloadStop
        ? "DETENIDO"
        : "COMPLETO CON ERRORES";
    $("start-preload").disabled = false;
    $("start-preload").textContent = complete ? "NUEVA PRECARGA" : "REANUDAR";
    $("stop-preload").disabled = true;
  };
  $("start-preload").onclick = run;
  $("stop-preload").onclick = () => {
    preloadStop = true;
    $("batch-state").textContent = "DETENIENDO…";
  };
}
async function seguimiento() {
  navState("seguimiento");
  document.body.classList.add("tracking-active");
  loading();
  const data = await trackApi({ action: "lista" });
  trackState = {
    list: data.placas,
    index: 0,
    reviewed: new Set(),
    map: null,
    overlays: [],
    mapConfig: null,
  };
  $("content").innerHTML =
    `<section class="desktop-tracking"><header><div><b>CEMENTO · SEGUIMIENTO</b><small>Mapa único durante toda la sesión</small></div><span id="review-count">REVISADAS 0/${data.placas.length}</span><button id="save-all">GUARDAR TODO</button><button id="exit-track">SALIR</button></header><main><section class="track-left"><div class="plate-nav"><button id="prev">◀</button><div id="plate-strip"></div><button id="next">▶</button></div><button id="view-hours">VER HORAS</button><div id="tracking-map"></div><footer><b>RECORRIDO ANALIZADO</b><span id="map-caption">Buscando caché temporal…</span></footer></section><section class="track-center"><div class="unit-head"><div><small>TRACTO</small><strong id="unit-name">—</strong><span id="unit-sub">—</span></div><button id="reviewed">MARCAR REVISADA</button></div><div class="last-closed"><small>ÚLTIMA OC CERRADA</small><b id="last-closed">—</b></div><div id="oc-list"></div></section><section class="track-right"><header><b>SECUENCIA DE EVENTOS GPS</b></header><div id="gps-events"></div></section></main></section>`;
  $("prev").onclick = () => loadTrackingUnit(trackState.index - 1);
  $("next").onclick = () => loadTrackingUnit(trackState.index + 1);
  $("reviewed").onclick = () => {
    trackState.reviewed.add(nplate(trackState.list[trackState.index].placa));
    paintStrip();
    if (trackState.reviewed.size < trackState.list.length)
      loadTrackingUnit(trackState.index + 1);
  };
  $("save-all").onclick = async () => {
    const b = $("save-all");
    b.disabled = true;
    b.textContent = "CONSOLIDANDO…";
    try {
      const x = await trackApi({ action: "consolidar" });
      alert(
        `Guardado completo: ${x.guardadas} actualizadas y ${x.cerradas} cerradas.`,
      );
      await seguimiento();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "GUARDAR TODO";
    }
  };
  $("exit-track").onclick = () => {
    document.body.classList.remove("tracking-active");
    go("home");
  };
  try {
    await initTrackingMap();
    if (data.placas.length) await loadTrackingUnit(0);
  } catch (e) {
    $("tracking-map").innerHTML =
      `<div class="map-error">${esc(e.message)}</div>`;
    if (data.placas.length) await loadTrackingUnit(0);
  }
}
async function archivos() {
  navState("archivos");
  loading();
  const d = await api("archivos");
  $("content").innerHTML =
    head("CEMENTO", "Archivos", "Salidas oficiales conservadas como Excel.") +
    lock("La generación y descarga de archivos") +
    `<section class="file-grid">${d.archivos.map((x) => `<article class="file-card"><div>▣</div><h2>${esc(x.nombre)}</h2><p>${esc(x.descripcion)}</p><span>${x.registros} registros</span><button disabled>PRÓXIMA VALIDACIÓN</button></article>`).join("")}</section>`;
}
async function reporte() {
  navState("reporte");
  loading();
  const d = await api("reporte");
  $("content").innerHTML =
    head("CEMENTO", "Crear reporte", "Formato final ENVIAR2022.") +
    lock("La generación del reporte final") +
    `<section class="panel report"><div class="report-icon">▥</div><div><h2>Motor validado preservado</h2><p>${esc(d.mensaje)}</p><b>${d.diario} registros disponibles.</b></div></section>`;
}
const routes = { home, precarga, seguimiento, archivos, reporte };
async function go(r) {
  history.replaceState(null, "", `#/${r}`);
  try {
    await (routes[r] || home)();
  } catch (e) {
    $("content").innerHTML =
      `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
  }
}
document
  .querySelectorAll("nav button")
  .forEach((b) => (b.onclick = () => go(b.dataset.route)));
const LOGIN_ALIASES = { PRUEBA: "satelitalaqprac@gmail.com" };
async function loginUsuario() {
  const usuario = String($("login-user")?.value || "")
      .trim()
      .toUpperCase(),
    password = String($("login-password")?.value || "");
  $("login-message").textContent = "";
  const email = LOGIN_ALIASES[usuario];
  if (!email) {
    $("login-message").textContent = "Usuario o contraseña incorrectos.";
    return;
  }
  if (!password) {
    $("login-message").textContent = "Ingrese la contraseña.";
    return;
  }
  const b = $("user-login");
  b.disabled = true;
  b.textContent = "INGRESANDO…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    console.error(e);
    $("login-message").textContent = "Usuario o contraseña incorrectos.";
  } finally {
    b.disabled = false;
    b.textContent = "INGRESAR";
  }
}
$("user-login").onclick = loginUsuario;
$("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginUsuario();
});
$("login-user").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("login-password").focus();
});
$("google-login").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked")
      return signInWithRedirect(auth, provider);
    $("login-message").textContent = e.message;
  }
};
onAuthStateChanged(auth, async (u) => {
  $("login").classList.toggle("hidden", !!u);
  $("workspace").classList.toggle("hidden", !u);
  document.body.classList.remove("auth-pending");
  if (u) {
    await syncAdminNav();
    await go(location.hash.slice(2) || "home");
  } else {
    if ($("admin-nav")) $("admin-nav").classList.add("hidden");
    $("login-password").value = "";
  }
});
document.addEventListener("click", (e) => {
  if (e.target?.id === "view-hours")
    setInspection(!trackState.inspectionEnabled);
});

const preloadBg = {
  running: false,
  stop: false,
  controller: null,
  units: [],
  meta: null,
};
const PRELOAD_TIMEOUT_MS = 120000;
const activeMeta = () =>
  JSON.parse(localStorage.getItem("cemento_precarga_activa") || "null");
function saveMeta(m) {
  preloadBg.meta = m;
  localStorage.setItem("cemento_precarga_activa", JSON.stringify(m));
  syncTrackingOrder(m);
  setTimeout(renderPreloadControls, 0);
}
function renderPreloadControls() {
  const start = $("start-preload"),
    stop = $("stop-preload");
  if (start) {
    start.disabled = preloadBg.running;
    start.textContent = preloadBg.meta?.completo
      ? "NUEVA PRECARGA"
      : "REANUDAR";
  }
  if (stop) stop.disabled = !preloadBg.running;
}
function syncTrackingOrder(m) {
  if (
    !document.body.classList.contains("tracking-active") ||
    !trackState.list?.length
  )
    return;
  const current = nplate(trackState.list[trackState.index]?.placa),
    rank = (u) => {
      const s = m?.resultados?.[nplate(u.placa)]?.estado;
      if (s === "SIN MOVIMIENTO") {
        const key = nplate(u.placa);
        if (!trackState.reviewed.has(key)) {
          trackState.reviewed.add(key);
          if (trackState.v2) persistReviewedV2(u.placa).catch(() => {});
        }
        return 2;
      }
      return s === "COMPLETO" ? 0 : 1;
    };
  for (const u of trackState.list) rank(u);
  if (!trackState.orderLocked) {
    trackState.list.sort((a, b) => rank(a) - rank(b));
    trackState.index = Math.max(
      0,
      trackState.list.findIndex((u) => nplate(u.placa) === current),
    );
  }
  if ($("plate-strip")) (trackState.v2 ? paintStripV2() : paintStrip());
}
async function requestPersistentStorage() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
async function preloadUnits() {
  const daily = await api("seguimiento");
  return [
    ...new Map(
      daily.registros
        .filter((x) => x.placa || x.tracto)
        .map((x) => [
          nplate(x.placa || x.tracto),
          { placa: x.placa || x.tracto, tracto: x.tracto || x.placa },
        ]),
    ).values(),
  ];
}
function bgCounts() {
  const m = preloadBg.meta || activeMeta() || {},
    r = m.resultados || {},
    vals = Object.values(r);
  return {
    done: vals.filter((x) =>
      ["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS"].includes(x.estado),
    ).length,
    retry: vals.filter((x) => x.estado === "REINTENTO").length,
    errors: vals.filter((x) => x.estado === "ERROR FINAL").length,
    total: preloadBg.units.length || m.total || 0,
  };
}
function renderBg() {
  const c = bgCounts(),
    label = preloadBg.running
      ? `PRECARGA ${c.done}/${c.total}${c.retry ? ` · ${c.retry} REINTENTO` : ""}`
      : c.total
        ? `PRECARGA ${c.done}/${c.total}${c.errors ? ` · ${c.errors} ERROR` : ""}`
        : "PRECARGA LISTA";
  for (const id of ["preload-global", "batch-state"]) {
    const n = $(id);
    if (n) n.textContent = label;
  }
  const count = $("batch-count");
  if (count) count.textContent = `${c.done}/${c.total}`;
  const er = $("batch-errors");
  if (er) er.textContent = c.errors;
  const bar = $("batch-progress");
  if (bar)
    bar.style.width = `${c.total ? Math.round((100 * (c.done + c.errors)) / c.total) : 0}%`;
  for (let i = 0; i < preloadBg.units.length; i++) {
    const x = preloadBg.meta?.resultados?.[nplate(preloadBg.units[i].placa)],
      cell = $(`s-${i}`);
    if (cell && x)
      cell.innerHTML = `<span class="state">${esc(x.estado)}</span>${x.mensaje ? `<small class="cell-error">${esc(x.mensaje)}</small>` : ""}`;
    if (x) {
      const p = $(`p-${i}`),
        v = $(`v-${i}`);
      if (p) p.textContent = x.puntos ?? "—";
      if (v) v.textContent = x.visitas ?? "—";
    }
  }
}
async function movementState(data) {
  const pts = (data?.puntos_gps || []).map(normalizeGpsPoint).filter(Boolean);
  if (pts.length < 2) return "SIN MOVIMIENTO";
  const first = pts[0];
  return pts.some((p) => distanceMeters(first, p) >= 100)
    ? "COMPLETO"
    : "SIN MOVIMIENTO";
}
async function runPreload(units, { newRun = false, desde = "" } = {}) {
  if (preloadBg.running) return;
  await requestPersistentStorage();
  preloadBg.units = units;
  let m = !newRun && activeMeta();
  if (!m || m.completo || newRun) {
    const start = desde || localStorage.getItem("cemento_rango_desde") || "";
    if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(start))
      throw Error(
        "Defina primero la fecha y hora de último seguimiento en INICIO",
      );
    m = {
      id: crypto.randomUUID(),
      desde: start,
      hasta: nowPEString(),
      total: units.length,
      intentos: {},
      resultados: {},
      completo: false,
    };
    await purgeGPSExcept(m.id);
  }
  m.intentos ||= {};
  m.resultados ||= {};
  m.total = units.length;
  saveMeta(m);
  preloadBg.running = true;
  preloadBg.stop = false;
  const summary = async (x) => ({
      estado: await movementState(x),
      puntos: x.puntos ?? 0,
      visitas: x.analisis?.visitas_confirmadas?.length ?? 0,
    }),
    first = [],
    retry = [];
  for (const u of units) {
    const k = nplate(u.placa),
      cache = await readGPS(`${m.id}|${u.tracto}|${u.placa}`);
    if (cache?.ok) {
      m.resultados[k] = await summary(cache);
      continue;
    }
    const tries = Number(m.intentos[k] || 0);
    if (tries === 0) first.push(u);
    else if (tries === 1) retry.push(u);
    else
      m.resultados[k] = {
        estado: "ERROR FINAL",
        mensaje: m.resultados[k]?.mensaje || "Revisar manualmente",
      };
  }
  saveMeta(m);
  renderBg();
  const process = async (queue, second) => {
    for (const u of queue) {
      if (preloadBg.stop) break;
      const k = nplate(u.placa),
        key = `${m.id}|${u.tracto}|${u.placa}`;
      if ((await readGPS(key))?.ok) continue;
      m.resultados[k] = { estado: second ? "SEGUNDO INTENTO" : "PROCESANDO" };
      saveMeta(m);
      renderBg();
      const controller = new AbortController();
      preloadBg.controller = controller;
      const timer = setTimeout(
        () => controller.abort("timeout"),
        PRELOAD_TIMEOUT_MS,
      );
      try {
        const x = await clocatorTest(
          u.placa,
          u.tracto,
          false,
          m.desde,
          m.hasta,
          controller.signal,
        );
        clearTimeout(timer);
        const cachedResult = { ...x, run_id: m.id };
        await cacheGPS(cachedResult, key);
        m.intentos[k] = (m.intentos[k] || 0) + 1;
        m.resultados[k] = await summary(x);
        await maybeRefreshTrackingV2(u.placa, cachedResult);
      } catch (e) {
        clearTimeout(timer);
        if (preloadBg.stop && controller.signal.aborted) {
          m.resultados[k] = {
            estado: "PENDIENTE",
            mensaje: "Detenido por el operador",
          };
          saveMeta(m);
          break;
        }
        m.intentos[k] = (m.intentos[k] || 0) + 1;
        const msg = controller.signal.aborted
          ? "Tiempo de respuesta agotado"
          : String(e.message || e);
        if (!second && m.intentos[k] === 1) {
          m.resultados[k] = { estado: "REINTENTO", mensaje: msg };
          retry.push(u);
        } else m.resultados[k] = { estado: "ERROR FINAL", mensaje: msg };
      } finally {
        preloadBg.controller = null;
        saveMeta(m);
        renderBg();
      }
    }
  };
  await process(first, false);
  if (!preloadBg.stop)
    await process(
      [...new Map(retry.map((u) => [nplate(u.placa), u])).values()],
      true,
    );
  preloadBg.running = false;
  m.completo =
    !preloadBg.stop &&
    units.every((u) =>
      ["COMPLETO", "SIN MOVIMIENTO", "SIN PUNTOS", "ERROR FINAL"].includes(
        m.resultados[nplate(u.placa)]?.estado,
      ),
    );
  saveMeta(m);
  renderBg();
}
async function hydratePreload(units) {
  preloadBg.units = units;
  const m = activeMeta();
  if (!m) {
    renderBg();
    return;
  }
  m.intentos ||= {};
  m.resultados ||= {};
  preloadBg.meta = m;
  for (const u of units) {
    const k = nplate(u.placa),
      cached = await readGPS(`${m.id}|${u.tracto}|${u.placa}`);
    if (cached?.ok)
      m.resultados[k] = {
        estado: await movementState(cached),
        puntos: cached.puntos ?? 0,
        visitas: cached.analisis?.visitas_confirmadas?.length ?? 0,
      };
  }
  saveMeta(m);
  renderBg();
}
async function precarga14() {
  navState("precarga");
  loading();
  const units = await preloadUnits();
  preloadBg.units = units;
  const saved = activeMeta();
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 15",
      "Precarga real de flota",
      `${units.length} unidades · segundo plano y doble intento controlado.`,
    ) +
    `<section class="notice">IndexedDB persistente. Cada placa se intenta como máximo dos veces: una en la cola y una al final.</section><section class="panel"><div class="panel-title"><div><h2>Control de precarga</h2><p id="run-range" class="muted">${saved ? `Rango: ${esc(saved.desde)} → ${esc(saved.hasta)}` : "Lista para una nueva precarga"}</p></div><div><button id="start-preload">${saved && !saved.completo ? "REANUDAR" : "NUEVA PRECARGA"}</button> <button id="stop-preload" ${preloadBg.running ? "" : "disabled"}>DETENER</button></div></div><div class="activity"><div><small>ESTADO</small><b id="batch-state">LISTO</b></div><div><small>PROGRESO</small><b id="batch-count">0/${units.length}</b></div><div><small>ERRORES FINALES</small><b id="batch-errors">0</b></div></div><div class="progress"><span id="batch-progress"></span></div></section><section class="panel"><div class="panel-title"><h2>Unidades de la ejecución</h2><span>primera vuelta + un reintento final</span></div><div class="table-wrap"><table><thead><tr><th>TRACTO</th><th>PLACA</th><th>PUNTOS</th><th>VISITAS</th><th>ESTADO</th></tr></thead><tbody>${units.map((u, i) => `<tr><td>${esc(u.tracto)}</td><td><b>${esc(u.placa)}</b></td><td id="p-${i}">—</td><td id="v-${i}">—</td><td id="s-${i}"><span class="state">PENDIENTE</span></td></tr>`).join("")}</tbody></table></div></section>`;
  await hydratePreload(units);
  $("start-preload").onclick = () => {
    const current = activeMeta();
    runPreload(units, { newRun: !current || current.completo });
    $("start-preload").disabled = true;
    $("stop-preload").disabled = false;
  };
  $("stop-preload").onclick = () => {
    preloadBg.stop = true;
    preloadBg.controller?.abort("operator");
    $("stop-preload").disabled = true;
  };
  renderBg();
}

function appConfirm(message, options = {}) {
  const {
    okText = "ACEPTAR",
    cancelText = "CANCELAR",
    danger = false,
  } = options;

  return new Promise((resolve) => {
    document.getElementById("app-confirm-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "app-confirm-overlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:100000",
      "background:rgba(15,23,42,.55)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
    ].join(";");

    const box = document.createElement("div");
    box.style.cssText = [
      "width:min(520px,96vw)",
      "background:#fff",
      "border-radius:14px",
      "box-shadow:0 24px 70px rgba(15,23,42,.30)",
      "padding:22px",
      "font-family:inherit",
    ].join(";");

    const text = document.createElement("div");
    text.textContent = String(message || "");
    text.style.cssText = [
      "white-space:pre-line",
      "font-size:16px",
      "line-height:1.45",
      "font-weight:600",
      "color:#0f172a",
    ].join(";");

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:22px;flex-wrap:wrap";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelText;
    cancel.style.cssText = "padding:10px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:700;cursor:pointer";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = okText;
    ok.style.cssText = `padding:10px 16px;border-radius:8px;border:0;background:${danger ? "#dc2626" : "#2563eb"};color:#fff;font-weight:800;cursor:pointer`;

    const finish = (value) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    };

    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    overlay.onclick = (e) => {
      if (e.target === overlay) finish(false);
    };
    document.addEventListener("keydown", onKey);

    actions.append(cancel, ok);
    box.append(text, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    ok.focus();
  });
}

function visibleUnsaved() {
  return [...document.querySelectorAll(".track-oc")].filter(
    (c) => Object.keys(formData(c)).length,
  );
}
async function seguimiento14() {
  await seguimiento();
  const indicator = document.createElement("span");
  indicator.id = "preload-global";
  $("review-count").before(indicator);
  const pause = $("exit-track"),
    finish = $("save-all");
  pause.textContent = "PAUSAR Y VOLVER";
  finish.textContent = "TERMINAR SEGUIMIENTO";
  pause.onclick = () => {
    if (visibleUnsaved().length)
      return alert("La OC visible tiene cambios sin GUARDAR OC.");
    document.body.classList.remove("tracking-active");
    go("home");
  };
  finish.onclick = async () => {
    finish.disabled = true;
    finish.textContent = "TERMINANDO…";
    try {
      for (const card of visibleUnsaved())
        await trackApi({
          action: "guardar",
          id: +card.dataset.id,
          datos: formData(card),
        });
      const x = await trackApi({ action: "consolidar" });
      alert(
        `Seguimiento terminado: ${x.guardadas} editadas y ${x.cerradas} cerradas.`,
      );
      document.body.classList.remove("tracking-active");
      await go("home");
    } catch (e) {
      alert(e.message);
      finish.disabled = false;
      finish.textContent = "TERMINAR SEGUIMIENTO";
    }
  };
  const cached = await allGPS(),
    latest = new Map();
  for (const x of cached.filter((x) => x.ok))
    if (
      !latest.has(nplate(x.placa)) ||
      String(x.guardado_en) > String(latest.get(nplate(x.placa)).guardado_en)
    )
      latest.set(nplate(x.placa), x);
  const moving = [],
    unknown = [],
    still = [];
  for (const u of trackState.list) {
    const gps = latest.get(nplate(u.placa));
    if (!gps) unknown.push(u);
    else if ((await movementState(gps)) === "SIN MOVIMIENTO") {
      still.push(u);
      trackState.reviewed.add(nplate(u.placa));
    } else moving.push(u);
  }
  trackState.list = [...moving, ...unknown, ...still];
  trackState.index = 0;
  paintStrip();
  if (trackState.list.length) await loadTrackingUnit(0);
  renderBg();
}
routes.precarga = precarga14;
routes.seguimiento = seguimiento14;
async function seguimientoFinal() {
  await seguimiento14();
  const reviewKey = `cemento_revisadas_${activeMeta()?.id || "sesion"}`,
    saved = JSON.parse(localStorage.getItem(reviewKey) || "[]");
  saved.forEach((x) => trackState.reviewed.add(x));
  syncTrackingOrder(activeMeta());
  const reviewedBtn = $("reviewed");
  reviewedBtn.onclick = () => {
    trackState.reviewed.add(nplate(trackState.list[trackState.index].placa));
    localStorage.setItem(reviewKey, JSON.stringify([...trackState.reviewed]));
    paintStrip();
    if (trackState.reviewed.size < trackState.list.length)
      loadTrackingUnit(trackState.index + 1);
  };
  const finish = $("save-all"),
    finishAction = finish.onclick;
  finish.onclick = async () => {
    await finishAction();
    if (!document.body.classList.contains("tracking-active"))
      localStorage.removeItem(reviewKey);
  };
  renderBg();
}
routes.seguimiento = seguimientoFinal;
async function seguimiento15() {
  await seguimientoFinal();
  if (!$("plate-position")) {
    const position = document.createElement("span");
    position.id = "plate-position";
    $("review-count").before(position);
  }
  trackState.orderLocked = true;
  paintStrip();
  const finish = $("save-all"),
    reviewKey = `cemento_revisadas_${activeMeta()?.id || "sesion"}`;
  finish.onclick = async () => {
    if (trackState.reviewed.size !== trackState.list.length)
      return alert(
        `Seguimiento incompleto: ${trackState.reviewed.size}/${trackState.list.length} placas revisadas.`,
      );
    finish.disabled = true;
    finish.textContent = "TERMINANDO…";
    try {
      for (const card of visibleUnsaved())
        await trackApi({
          action: "guardar",
          id: +card.dataset.id,
          datos: formData(card),
        });
      const x = await trackApi({
        action: "consolidar",
        revisadas: [...trackState.reviewed],
      });
      localStorage.removeItem(reviewKey);
      alert(
        `Seguimiento terminado: ${x.revisadas}/${x.total_placas} placas revisadas, ${x.guardadas} editadas y ${x.cerradas} cerradas.`,
      );
      document.body.classList.remove("tracking-active");
      await go("reporte");
    } catch (e) {
      alert(e.message);
      finish.disabled = false;
      finish.textContent = "TERMINAR SEGUIMIENTO";
    }
  };
}
routes.seguimiento = seguimiento15;

async function reportApi(body, binary = false) {
  const r = await fetch(REPORT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw Error(d.error || `HTTP ${r.status}`);
  }
  if (!binary) return r.json();
  const cd = r.headers.get("content-disposition") || "",
    name = cd.match(/filename="([^"]+)"/)?.[1] || "archivo.xlsx";
  return { blob: await r.blob(), name };
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
async function downloadReportZip(files, zipName, folderName) {
  if (!window.JSZip) throw Error("No se pudo cargar el empaquetador ZIP");
  const zip = new window.JSZip();
  const folder = zip.folder(folderName || zipName.replace(/\.zip$/i, "")) || zip;
  files.forEach((file) => folder.file(file.name, file.blob));
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, zipName);
}
async function downloadFromReport(button, body) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = "GENERANDO…";
  try {
    const x = await reportApi(body, true);
    downloadBlob(x.blob, x.name);
  } catch (e) {
    alert(e.message);
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
async function archivos15() {
  navState("archivos");
  loading();
  const d = await api("archivos"),
    files = d.archivos.filter((x) => x.nombre !== "SAP_HISTORICO.xlsx");
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17",
      "Archivos",
      "Dos respaldos Excel disponibles bajo demanda.",
    ) +
    `<section class="notice"><b>EGRESS CONTROLADO:</b> esta pantalla solo consulta el número de registros. El Excel no se genera ni se transfiere hasta que usted pulse DESCARGAR EXCEL.</section><section class="file-grid two-files">${files.map((x) => `<article class="file-card"><div>▣</div><h2>${esc(x.nombre)}</h2><p>${esc(x.descripcion)}</p><span>${x.registros} registros</span><button data-export="${x.nombre.includes("DIARIO") ? "DIARIO" : "HISTORICO"}">DESCARGAR EXCEL</button></article>`).join("")}</section>`;
  document.querySelectorAll("[data-export]").forEach(
    (b) =>
      (b.onclick = () =>
        downloadFromReport(b, {
          action: "archivo",
          origen: b.dataset.export,
        })),
  );
}
function rounded(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function textCanvas(
  ctx,
  text,
  x,
  y,
  w,
  h,
  size = 14,
  color = "#26364D",
  bold = false,
  align = "left",
) {
  ctx.font = `${bold ? 700 : 400} ${size}px Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  let t = String(text ?? "");
  while (ctx.measureText(t).width > w && t.length > 2) t = t.slice(0, -2) + "…";
  ctx.fillText(
    t,
    align === "center" ? x + w / 2 : align === "right" ? x + w : x,
    y + h / 2,
  );
}
function reportCanvasData(s) {
  const rows = s.rutas || [],
    bases = s.bases || [],
    c = document.createElement("canvas");
  c.width = 1600;
  c.height = Math.max(720, 220 + rows.length * 62);
  const x = c.getContext("2d"),
    sx = 40,
    sy = 120,
    routeWidths = [560, 150, 150, 150],
    routeTotal = routeWidths.reduce((a, b) => a + b, 0),
    baseX = 1085,
    baseW = 470,
    headerBlue = "#2F66B5",
    edge = "#D8E1EE";
  x.fillStyle = "#FFFFFF";
  x.fillRect(0, 0, c.width, c.height);
  textCanvas(x, "RESUMEN GENERAL UNIDADES · RACIEMSA ZONA SUR", 45, 26, 1480, 42, 28, "#173B75", true);
  textCanvas(x, "CARGADAS = en ruta o en destino · VACÍAS = retorno o en base según última OC", 45, 70, 1480, 24, 13, "#61708A");

  rounded(x, sx, sy, routeTotal, 52, 10, headerBlue);
  let tx = sx;
  ["RUTA", "CARGADAS", "VACÍAS", "TOTAL"].forEach((label, i) => {
    textCanvas(x, label, tx + 6, sy, routeWidths[i] - 12, 52, 13, "#FFFFFF", true, "center");
    tx += routeWidths[i];
  });

  let y = sy + 60;
  rows.forEach((row, i) => {
    rounded(x, sx, y, routeTotal, 44, 6, i % 2 ? "#F7FAFD" : "#FFFFFF", edge);
    textCanvas(x, row.ruta, sx + 12, y, routeWidths[0] - 24, 44, 12, "#243854");
    let px = sx + routeWidths[0];
    [row.cargadas, row.vacias, row.total].forEach((value, idx) => {
      textCanvas(x, value, px, y, routeWidths[idx + 1], 44, 13, "#173B75", true, "center");
      px += routeWidths[idx + 1];
    });
    y += 52;
  });

  rounded(x, sx, y + 8, routeTotal, 48, 6, "#FFF4E5", "#F0C77B");
  textCanvas(x, "TOTAL DE UNIDADES ASIGNADAS A UNA OPERACION", sx + 12, y + 8, routeWidths[0] + routeWidths[1] + routeWidths[2] - 24, 48, 13, "#8A4B00", true);
  textCanvas(x, s.total_asignadas || 0, sx + routeWidths[0] + routeWidths[1] + routeWidths[2], y + 8, routeWidths[3], 48, 16, "#8A4B00", true, "center");

  let by = sy;
  rounded(x, baseX, by, baseW, 52, 10, headerBlue);
  textCanvas(x, "UNIDADES EN BASE", baseX + 8, by, baseW - 16, 52, 14, "#FFFFFF", true, "center");
  by += 60;
  const baseCols = [210, 110, 100, 50],
    baseHeaders = ["BASE", "CARGADAS", "VACÍAS", "TOTAL"];
  let bx = baseX;
  baseHeaders.forEach((label, i) => {
    rounded(x, bx, by, baseCols[i], 46, 4, "#EFF4FA", edge);
    textCanvas(x, label, bx + 6, by, baseCols[i] - 12, 46, 12, "#173B75", true, "center");
    bx += baseCols[i];
  });
  by += 54;
  bases.forEach((row) => {
    let cx = baseX;
    [row.base, row.cargadas, row.vacias, row.total].forEach((val, i) => {
      rounded(x, cx, by, baseCols[i], 48, 4, "#FFFFFF", edge);
      textCanvas(x, val, cx + 10, by, baseCols[i] - 20, 48, 12, "#173B75", i > 0, i === 0 ? "left" : "center");
      cx += baseCols[i];
    });
    by += 56;
  });
  rounded(x, baseX, by + 8, baseW, 52, 6, "#EEF4FD", "#B7C9E6");
  textCanvas(x, "TOTAL EN BASE", baseX + 12, by + 8, baseW - 100, 52, 13, "#173B75", true);
  textCanvas(x, s.total_en_base || 0, baseX + baseW - 90, by + 8, 70, 52, 16, "#173B75", true, "center");
  return c;
}

function reportCanvasBars(s) {
  const rows = s.rutas || [],
    c = document.createElement("canvas");
  c.width = 1600;
  c.height = 880;
  const x = c.getContext("2d"),
    chartX = 80,
    chartY = 175,
    chartW = 1060,
    chartH = 560,
    dark = "#1E4FA3",
    light = "#8EC1F7",
    grid = "#D9E1EC";
  x.fillStyle = "#FFFFFF";
  x.fillRect(0, 0, c.width, c.height);
  textCanvas(x, "RESUMEN POR RUTA · CARGADAS Y VACÍAS", 45, 24, 1480, 44, 31, "#173B75", true);
  textCanvas(x, "Cada ruta mantiene 2 barras: CARGADAS y VACÍAS.", 45, 76, 1480, 22, 12, "#61708A");
  textCanvas(x, "Si salió de Yura y aún no salió de planta destino, cuenta como CARGADA. Si ya salió de planta destino o ya llegó a Yura en su última OC, cuenta como VACÍA.", 45, 104, 1480, 22, 12, "#61708A");
  rounded(x, 22, 145, 1120, 650, 10, "#FFFFFF", grid);
  const max = Math.max(1, ...rows.flatMap((r) => [r.cargadas, r.vacias]));
  for (let i = 0; i <= 6; i++) {
    const gy = chartY + chartH - (chartH * i) / 6;
    x.strokeStyle = grid;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(chartX, gy);
    x.lineTo(chartX + chartW, gy);
    x.stroke();
    textCanvas(x, Math.round((max * i) / 6), 35, gy - 12, 35, 24, 12, "#61708A", false, "right");
  }
  x.strokeStyle = "#98A7BD";
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(chartX, chartY);
  x.lineTo(chartX, chartY + chartH);
  x.lineTo(chartX + chartW, chartY + chartH);
  x.stroke();

  const groupW = chartW / Math.max(1, rows.length);
  rows.forEach((row, i) => {
    const cx = chartX + i * groupW + groupW / 2;
    const barW = Math.min(42, groupW * 0.22);
    const gap = Math.min(12, groupW * 0.08);
    const h1 = (chartH * row.cargadas) / max;
    const h2 = (chartH * row.vacias) / max;
    rounded(x, cx - gap - barW, chartY + chartH - h1, barW, h1, 4, dark);
    rounded(x, cx + gap, chartY + chartH - h2, barW, h2, 4, light);
    textCanvas(x, row.cargadas, cx - gap - barW - 10, chartY + chartH - h1 - 28, barW + 20, 20, 12, dark, true, "center");
    textCanvas(x, row.vacias, cx + gap - 10, chartY + chartH - h2 - 28, barW + 20, 20, 12, "#4E86C9", true, "center");
    const label = String(row.ruta || "").replace(/\s+a\s+/g, " a ").replace(/\s+/g, " ");
    const parts = label.split(' ');
    const maxPerLine = 16;
    let line1 = '', line2 = '', line3 = '';
    for (const part of parts) {
      if ((line1 + ' ' + part).trim().length <= maxPerLine) line1 = (line1 + ' ' + part).trim();
      else if ((line2 + ' ' + part).trim().length <= maxPerLine) line2 = (line2 + ' ' + part).trim();
      else line3 = (line3 + ' ' + part).trim();
    }
    [line1, line2, line3].filter(Boolean).forEach((line, idx) => {
      textCanvas(x, line, cx - groupW/2 + 4, chartY + chartH + 12 + idx * 18, groupW - 8, 18, 11, "#243854", idx===0, "center");
    });
  });
  textCanvas(x, "NÚMERO DE UNIDADES", 18, chartY + chartH / 2 - 20, 30, 180, 12, "#61708A", true, "center");
  textCanvas(x, "RUTA", chartX + chartW / 2 - 50, 760, 100, 24, 12, "#61708A", true, "center");
  rounded(x, 500, 800, 28, 28, 5, dark);
  textCanvas(x, "CARGADAS", 540, 800, 140, 28, 12, "#243854", true);
  rounded(x, 680, 800, 28, 28, 5, light);
  textCanvas(x, "VACÍAS", 720, 800, 120, 28, 12, "#243854", true);

  const panelX = 1165, panelW = 390;
  rounded(x, panelX, 165, panelW, 54, 10, "#2F66B5");
  textCanvas(x, "TOTALES GENERALES", panelX + 8, 165, panelW - 16, 54, 14, "#FFFFFF", true, "center");
  const cards = [
    ["TOTAL CARGADAS", s.total_cargadas || 0, "#1E4FA3"],
    ["TOTAL VACÍAS", s.total_vacias || 0, "#4E86C9"],
    ["TOTAL OPERATIVO", s.total_asignadas || 0, "#173B75"],
  ];
  let cy = 235;
  cards.forEach(([label, value, color]) => {
    rounded(x, panelX, cy, panelW, 98, 10, "#F7FAFD", grid);
    textCanvas(x, label, panelX + 30, cy + 16, 210, 28, 13, "#173B75", true);
    textCanvas(x, value, panelX + 255, cy + 10, 100, 52, 26, color, true, "center");
    cy += 112;
  });
  return c;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("No se pudo generar la imagen"))),
      "image/png",
    ),
  );
}
async function reporte15() {
  navState("reporte");
  loading();
  const state = await reportApi({ action: "estado" });
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 15",
      "Crear reporte",
      "Excel final y dos imágenes para correo, desde Seguimiento Diario.",
    ) +
    `<section class="notice ${state.habilitado ? "report-ready" : "report-locked"}"><b>${state.habilitado ? "SEGUIMIENTO COMPLETO" : "REPORTE BLOQUEADO"}</b><br>${esc(state.mensaje)} · ${state.revisadas}/${state.total_placas} placas · ${state.diario} OCs abiertas.</section><div class="report-main-action"><button id="report-all" ${state.habilitado ? "" : "disabled"}>GENERAR REPORTE COMPLETO · 3 ARCHIVOS</button></div><section class="report-downloads"><article><div>▣</div><h2>Excel operativo</h2><p>Orden, columnas y formato autorizado de Cemento.</p><button id="report-xlsx" ${state.habilitado ? "" : "disabled"}>DESCARGAR EXCEL</button></article><article><div>▧</div><h2>Resumen de datos</h2><p>Rutas, unidades en base y total operativo validado.</p><button id="report-data" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article><article><div>▥</div><h2>Distribución por ruta</h2><p>Resumen gráfico por ruta: cargadas y vacías.</p><button id="report-bars" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article></section>`;
  if (!state.habilitado) return;
  $("report-xlsx").onclick = () =>
    downloadFromReport($("report-xlsx"), { action: "excel" });
  let data;
  const getData = async () => {
    if (data === undefined) data = await reportApi({ action: "datos" });
    return data;
  };
  $("report-data").onclick = async () => {
    const b = $("report-data"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(
        await canvasBlob(reportCanvasData(d.resumen)),
        "RESUMEN_CORREO_DATOS.png",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
  $("report-bars").onclick = async () => {
    const b = $("report-bars"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(
        await canvasBlob(reportCanvasBars(d.resumen)),
        "RESUMEN_CORREO_BARRAS.png",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
  $("report-all").onclick = async () => {
    const b = $("report-all"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO LOS 3 ARCHIVOS…";
    try {
      const [x, d] = await Promise.all([
        reportApi({ action: "excel" }, true),
        getData(),
      ]);
      downloadBlob(x.blob, x.name);
      downloadBlob(
        await canvasBlob(reportCanvasData(d.resumen)),
        "RESUMEN_CORREO_DATOS.png",
      );
      downloadBlob(
        await canvasBlob(reportCanvasBars(d.resumen)),
        "RESUMEN_CORREO_BARRAS.png",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
}
routes.archivos = archivos15;
routes.reporte = reporte15;

// PRUEBA 16 · carga SAP local, corte editable y ciclo temporal único.
const SAP_COLUMNS = [
  "FecIniReal",
  "Ord Carga",
  "UsuCrea OCRG",
  "Creado el",
  "Destino",
  "Ruta",
  "Proveedor Transporte",
  "Teléfono",
  "Nombre Piloto",
  "LicencCond",
  "Equipo",
  "Matrícula",
  "Acoplado 1",
  "PlacaAcop1",
  "Descripción Ruta",
  "Nombre Destino",
  "Observaciones",
  "por",
  "UMP",
  "Neto",
  "FechaCarga",
  "Estado",
  "Material",
  "Material de Servicio",
  "Tipo Presentación",
  "Dirección Destino",
  "Cliente",
  "Nom Client",
  "CE",
  "GESTOR",
];
const DATE_SAP = new Set(["FecIniReal", "Creado el", "FechaCarga"]);
const headerKey = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const SAP_ALIASES = new Map([
  ["FECINIREAL", "FecIniReal"],
  ["ORDCARGA", "Ord Carga"],
  ["USUCREAOCRG", "UsuCrea OCRG"],
  ["USCREAOCRG", "UsuCrea OCRG"],
  ["CREADOEL", "Creado el"],
  ["DESTINO", "Destino"],
  ["RUTA", "Ruta"],
  ["PROVEEDORTRANSPORTE", "Proveedor Transporte"],
  ["PROVTRANSP", "Proveedor Transporte"],
  ["TELEFONO", "Teléfono"],
  ["NOMBREPILOTO", "Nombre Piloto"],
  ["LICENCCOND", "LicencCond"],
  ["EQUIPO", "Equipo"],
  ["MATRICULA", "Matrícula"],
  ["ACOPLADO1", "Acoplado 1"],
  ["PLACAACOP1", "PlacaAcop1"],
  ["DESCRIPCIONRUTA", "Descripción Ruta"],
  ["NOMBREDESTINO", "Nombre Destino"],
  ["OBSERVACIONES", "Observaciones"],
  ["POR", "por"],
  ["NOGRR", "por"],
  ["UMP", "UMP"],
  ["NETO", "Neto"],
  ["FECHACARGA", "FechaCarga"],
  ["ESTADO", "Estado"],
  ["MATERIAL", "Material"],
  ["MATERIALDESERVICIO", "Material de Servicio"],
  ["TIPOPRESENTACION", "Tipo Presentación"],
  ["DIRECCIONDESTINO", "Dirección Destino"],
  ["CLIENTE", "Cliente"],
  ["DEUDOR", "Cliente"],
  ["NOMCLIENT", "Nom Client"],
  ["CE", "CE"],
  ["GESTOR", "GESTOR"],
]);
function excelColumnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "A";
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
function xmlElements(node, name) {
  return [...node.getElementsByTagName("*")].filter(
    (x) => x.localName === name,
  );
}
function excelSerialDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return d.toISOString().slice(0, 10) + "T00:00:00";
}
function normalizeSapDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || /^\d{5}(?:\.\d+)?$/.test(String(value)))
    return excelSerialDate(value);
  const s = String(value).trim(),
    m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return m
    ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00`
    : s;
}
async function parseXlsx(buffer) {
  if (!window.JSZip) throw Error("No se cargó el lector Excel local");
  const zip = await JSZip.loadAsync(buffer),
    shared = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const doc = new DOMParser().parseFromString(
      await sharedFile.async("string"),
      "application/xml",
    );
    for (const si of xmlElements(doc, "si"))
      shared.push(
        xmlElements(si, "t")
          .map((x) => x.textContent || "")
          .join(""),
      );
  }
  const workbook = zip.file("xl/workbook.xml"),
    rels = zip.file("xl/_rels/workbook.xml.rels");
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (workbook && rels) {
    const wdoc = new DOMParser().parseFromString(
        await workbook.async("string"),
        "application/xml",
      ),
      rdoc = new DOMParser().parseFromString(
        await rels.async("string"),
        "application/xml",
      ),
      sheet = xmlElements(wdoc, "sheet")[0],
      rid =
        sheet?.getAttribute("r:id") ||
        sheet?.getAttributeNS(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "id",
        ),
      rel = xmlElements(rdoc, "Relationship").find(
        (x) => x.getAttribute("Id") === rid,
      ),
      target = rel?.getAttribute("Target");
    if (target)
      sheetPath = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw Error("El Excel no contiene una hoja legible");
  const doc = new DOMParser().parseFromString(
      await sheetFile.async("string"),
      "application/xml",
    ),
    rows = [];
  for (const row of xmlElements(doc, "row")) {
    const values = [];
    for (const c of [...row.children].filter((x) => x.localName === "c")) {
      const index = excelColumnIndex(c.getAttribute("r")),
        type = c.getAttribute("t") || "",
        v = xmlElements(c, "v")[0]?.textContent ?? "",
        inline = xmlElements(c, "t")
          .map((x) => x.textContent || "")
          .join("");
      values[index] =
        type === "s"
          ? (shared[Number(v)] ?? "")
          : type === "inlineStr"
            ? inline
            : type === "b"
              ? v === "1"
              : v !== "" && Number.isFinite(Number(v))
                ? Number(v)
                : v;
    }
    rows.push(values);
  }
  return rows;
}
function parseSapText(buffer) {
  const text = new TextDecoder("windows-1252").decode(buffer);
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((row) => row.some((v) => String(v).trim()));
}
async function parseSapFile(file) {
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    hash = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join(""),
    rows = file.name.toLowerCase().endsWith(".xlsx")
      ? await parseXlsx(buffer)
      : parseSapText(buffer);
  const hi = rows.findIndex((r) => r.some((v) => headerKey(v) === "ORDCARGA"));
  if (hi < 0)
    throw Error("No se encontró la columna Ord Carga en el archivo SAP");
  const headers = rows[hi].map((v) => SAP_ALIASES.get(headerKey(v)) || ""),
    seen = new Set(),
    records = [],
    duplicates = [];
  for (const row of rows.slice(hi + 1)) {
    const p = {};
    headers.forEach((h, i) => {
      if (!h || !SAP_COLUMNS.includes(h)) return;
      let v = row[i] ?? "";
      if (DATE_SAP.has(h)) v = normalizeSapDate(v);
      p[h] = typeof v === "string" ? v.trim() : v;
    });
    const oc = String(p["Ord Carga"] ?? "")
      .replace(/\.0$/, "")
      .trim();
    if (!oc) continue;
    p["Ord Carga"] = oc;
    if (seen.has(oc)) {
      duplicates.push(oc);
      continue;
    }
    seen.add(oc);
    records.push(p);
  }
  if (!records.length)
    throw Error("El archivo no contiene órdenes de carga válidas");
  return {
    nombre: file.name,
    tamano: file.size,
    hash,
    filas_archivo: rows.length,
    encabezados: headers.filter(Boolean),
    registros: records,
    duplicadas: [...new Set(duplicates)],
  };
}
const SAP_WINDOW_DAYS = 7;
function sapTextKey(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function sapDateKey(value) {
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
function limaTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date()),
    p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftDateKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
async function loadSapRouteRules() {
  const d = await sapApi({ action: "reglas_rutas" }),
    rules = new Map(
      Object.entries(d.reglas || {}).map(([name, decision]) => [
        name,
        Boolean(decision),
      ]),
    );
  if (!rules.size) throw Error("rutas_sap de CEMENTO está vacío");
  return rules;
}
function peToInput(value) {
  const s = String(value || ""),
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const parts = fechaPE(d.toISOString()).match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
  );
  return parts
    ? `${parts[3]}-${parts[2]}-${parts[1]}T${parts[4]}:${parts[5]}`
    : "";
}
function inputToPE(value) {
  const m = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:00` : "";
}
let sapPending = null,
  sapParsedForReview = null,
  sapReopenDecisions = new Map();
function openSapReopenReview(details, parsed) {
  document.getElementById("sap-reopen-review")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "sap-reopen-review";
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:18px";
  const box = document.createElement("div");
  box.style.cssText = "width:min(1500px,98vw);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.35);padding:18px;color:#0f172a";
  const changedCell = (value, changed) => `<td style="${changed ? "background:#fff7ed;color:#9a3412;font-weight:800;" : ""}">${esc(value || "—")}</td>`;
  const decisionCell = (oc) => {
    const decision = sapReopenDecisions.get(String(oc)) || "";
    return `<td style="min-width:190px"><button type="button" data-reopen-oc="${esc(oc)}" data-reopen-decision="REABRIR" style="margin:2px;padding:7px 9px;${decision === "REABRIR" ? "background:#166534;color:#fff;border-color:#166534" : ""}">REABRIR</button><button type="button" data-reopen-oc="${esc(oc)}" data-reopen-decision="NO_REABRIR" style="margin:2px;padding:7px 9px;${decision === "NO_REABRIR" ? "background:#b91c1c;color:#fff;border-color:#b91c1c" : ""}">NO REABRIR</button></td>`;
  };
  const render = () => {
    const decided = details.filter((x) => sapReopenDecisions.has(String(x.orden_carga))).length;
    const yes = details.filter((x) => sapReopenDecisions.get(String(x.orden_carga)) === "REABRIR").length;
    const no = details.filter((x) => sapReopenDecisions.get(String(x.orden_carga)) === "NO_REABRIR").length;
    box.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h2 style="margin:0 0 6px">REVISAR OCs CERRADAS CON CAMBIOS</h2><p style="margin:0;color:#475569">Comparación del SAP histórico contra el SAP actual. <b>Esta pantalla no modifica Supabase ni reabre ninguna OC.</b></p></div><div style="font-weight:800">REVISADAS ${decided}/${details.length} · REABRIR ${yes} · NO REABRIR ${no}</div></div><div style="overflow:auto;margin-top:16px"><table style="border-collapse:collapse;min-width:1450px;width:100%;font-size:12px"><thead><tr><th>OC</th><th>FECHA ANTERIOR</th><th>FECHA SAP</th><th>CHOFER ANTERIOR</th><th>CHOFER SAP</th><th>LICENCIA ANT.</th><th>LICENCIA SAP</th><th>TRACTO ANT.</th><th>TRACTO SAP</th><th>CARRETA ANT.</th><th>CARRETA SAP</th><th>CAMBIO DETECTADO</th><th>DECISIÓN</th></tr></thead><tbody>${details.map((x) => { const c = new Set(x.cambios || []); return `<tr style="border-bottom:1px solid #e2e8f0"><td><b>${esc(x.orden_carga)}</b></td>${changedCell(x.anterior?.fecha,c.has("FECHA"))}${changedCell(x.actual?.fecha,c.has("FECHA"))}${changedCell(x.anterior?.chofer,c.has("CHOFER"))}${changedCell(x.actual?.chofer,c.has("CHOFER"))}${changedCell(x.anterior?.licencia,c.has("CHOFER"))}${changedCell(x.actual?.licencia,c.has("CHOFER"))}${changedCell(x.anterior?.tracto,c.has("TRACTO"))}${changedCell(x.actual?.tracto,c.has("TRACTO"))}${changedCell(x.anterior?.carreta,c.has("CARRETA"))}${changedCell(x.actual?.carreta,c.has("CARRETA"))}<td><b>${esc((x.cambios || []).join(" + ") || "—")}</b></td>${decisionCell(x.orden_carga)}</tr>`; }).join("")}</tbody></table></div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px"><button type="button" id="close-reopen-review">CERRAR REVISIÓN</button></div>`;
    box.querySelectorAll("[data-reopen-oc]").forEach((button) => button.onclick = () => {
      sapReopenDecisions.set(String(button.dataset.reopenOc), String(button.dataset.reopenDecision));
      render();
    });
    box.querySelector("#close-reopen-review").onclick = async () => {
      overlay.remove();
      await analyzeSapForCemento(parsed);
    };
  };
  overlay.onclick = (e) => { if (e.target === overlay) box.querySelector("#close-reopen-review")?.click(); };
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  render();
}

async function analyzeSapForCemento(parsed) {
  const result = $("sap-result"),
    rules = await loadSapRouteRules(),
    hasta = limaTodayKey(),
    desde = shiftDateKey(hasta, -SAP_WINDOW_DAYS),
    withinRange = parsed.registros.filter((r) => {
      const d = sapDateKey(r.FecIniReal);
      return d && d >= desde && d <= hasta;
    }),
    outOfRange = parsed.registros.length - withinRange.length,
    unknown = [
      ...new Set(
        withinRange
          .map((r) =>
            String(r["Descripción Ruta"] || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter((x) => sapTextKey(x) && !rules.has(sapTextKey(x))),
      ),
    ],
    routeNo = withinRange.filter((r) => {
      const k = sapTextKey(r["Descripción Ruta"]);
      return !k || rules.get(k) === false;
    }),
    eligible = withinRange.filter(
      (r) => rules.get(sapTextKey(r["Descripción Ruta"])) === true,
    );
  const blocked = unknown.length > 0;
  const classification = blocked || !eligible.length
    ? { nuevas: [], vacias_reasignadas: [], con_informacion_reabiertas: [], reaperturas_detalle: [], abiertas_existentes: [], cerradas_sin_cambios: [] }
    : await sapApi({ action: "clasificar", filas: eligible });
  const reopenDetails = classification.reaperturas_detalle || [];
  const reopenKeys = new Set(reopenDetails.map((x) => String(x.orden_carga)));
  [...sapReopenDecisions.keys()].forEach((key) => { if (!reopenKeys.has(String(key))) sapReopenDecisions.delete(String(key)); });
  const pendingReopenReview = reopenDetails.filter((x) => !sapReopenDecisions.has(String(x.orden_carga)));
  const approvedReopens = reopenDetails.filter((x) => sapReopenDecisions.get(String(x.orden_carga)) === "REABRIR").map((x) => String(x.orden_carga));
  const rejectedReopens = reopenDetails.filter((x) => sapReopenDecisions.get(String(x.orden_carga)) === "NO_REABRIR").map((x) => String(x.orden_carga));
  const actionableKeys = new Set([
    ...(classification.nuevas || []),
    ...(classification.vacias_reasignadas || []),
    ...approvedReopens,
  ]);
  const actionable = eligible.filter((row) => actionableKeys.has(String(row["Ord Carga"])));
  sapPending = { ...parsed, actionable, desde, hasta, unknown, classification, approvedReopens, rejectedReopens };
  const emptyNotice = (classification.vacias_reasignadas || []).length
    ? `<section class="notice"><b>OC VACÍA REASIGNADA</b><br>${classification.vacias_reasignadas.map((x) => `OC ${esc(x)}`).join(" · ")}</section>` : "";
  const infoNotice = reopenDetails.length
    ? `<section class="notice warning-text"><b>${reopenDetails.length} OC CERRADAS TIENEN CAMBIOS</b><br>Revise FECHA, CHOFER, TRACTO y CARRETA antes de decidir una reapertura. <button type="button" id="review-reopens">VER ${reopenDetails.length} CON CAMBIOS</button><br><small>Revisadas: ${reopenDetails.length - pendingReopenReview.length}/${reopenDetails.length} · Reabrir: ${approvedReopens.length} · No reabrir: ${rejectedReopens.length}. La revisión no modifica Supabase.</small></section>` : "";
  const applyDisabled = blocked || pendingReopenReview.length > 0 || !actionable.length;
  const applyLabel = blocked ? "RESOLVER RUTAS NUEVAS" : pendingReopenReview.length ? `REVISAR ${pendingReopenReview.length} REAPERTURAS ANTES DE APLICAR` : `APLICAR ${actionable.length} OCs APROBADAS`;
  result.innerHTML = `<p class="muted"><b>Rango FecIniReal:</b> ${desde.split("-").reverse().join("/")} → ${hasta.split("-").reverse().join("/")} · reglas por Descripción Ruta</p><div class="sap-metrics"><article><small>OCs LEÍDAS</small><b>${parsed.registros.length}</b></article><article><small>FUERA DEL RANGO</small><b>${outOfRange}</b></article><article><small>RUTAS NO</small><b>${routeNo.length}</b></article><article><small>RUTAS SI</small><b>${eligible.length}</b></article><article><small>NUEVAS</small><b>${(classification.nuevas || []).length}</b></article><article><small>VACÍAS REASIGNADAS</small><b>${(classification.vacias_reasignadas || []).length}</b></article><article><small>CON INFORMACIÓN</small><b>${(classification.con_informacion_reabiertas || []).length}</b></article><article><small>YA ABIERTAS</small><b>${(classification.abiertas_existentes || []).length}</b></article><article><small>CERRADAS SIN CAMBIOS</small><b>${(classification.cerradas_sin_cambios || []).length}</b></article></div>${emptyNotice}${infoNotice}${parsed.duplicadas.length ? `<p class="warning-text">${parsed.duplicadas.length} OCs repetidas dentro del archivo fueron consolidadas localmente.</p>` : ""}${blocked ? `<section class="route-decisions"><h2>Rutas nuevas pendientes de decisión</h2><p>Indica si cada descripción pertenece al seguimiento de CEMENTO. La decisión quedará registrada para las siguientes cargas.</p>${unknown.map((x, i) => `<article><b>${esc(x)}</b><div><button data-route-index="${i}" data-route-use="true">SI · CONSIDERAR</button><button data-route-index="${i}" data-route-use="false" class="danger">NO · DESCARTAR</button></div></article>`).join("")}</section>` : ""}<button id="apply-sap" class="primary" ${applyDisabled ? "disabled" : ""}>${applyLabel}</button>`;
  const reviewButton = $("review-reopens");
  if (reviewButton) reviewButton.onclick = () => openSapReopenReview(reopenDetails, parsed);
  document.querySelectorAll("[data-route-index]").forEach(
    (button) =>
      (button.onclick = async () => {
        const description = unknown[Number(button.dataset.routeIndex)],
          usar = button.dataset.routeUse === "true";
        document
          .querySelectorAll("[data-route-index]")
          .forEach((x) => (x.disabled = true));
        try {
          await sapApi({
            action: "guardar_regla_ruta",
            descripcion: description,
            usar,
          });
          result.innerHTML =
            '<p class="loading-inline">Regla guardada. Recalculando el resumen…</p>';
          await analyzeSapForCemento(parsed);
        } catch (e) {
          alert(e.message);
          await analyzeSapForCemento(parsed);
        }
      }),
  );
  const apply = $("apply-sap");
  if (apply && !blocked) apply.onclick = applySapPending;
}
async function sap16() {
  navState("sap");
  loading();
  const cached = await readSAPCache();
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17",
      "Actualizar SAP",
      "El Excel completo permanece en este navegador; solo se envían las OCs faltantes.",
    ) +
    `<section class="notice"><b>FLUJO OPERATIVO:</b> seleccione el Excel SAP, valide el resumen y aplique. Una OC repetida se compara por fecha SAP, conductor y placas de tracto/carreta para detectar una reasignación real. Se aceptan .xlsx y el .xls de texto exportado por SAP.</section><section class="panel sap-upload"><div class="panel-title"><div><h2>Archivo SAP actualizado</h2><p class="muted">El archivo anterior del navegador se reemplaza automáticamente.</p></div><label class="file-button">SELECCIONAR EXCEL<input id="sap-file" type="file" accept=".xlsx,.xls"></label></div><div id="sap-current" class="sap-current">${cached ? `Temporal actual: <b>${esc(cached.nombre)}</b> · ${cached.registros?.length || 0} OCs · ${fechaPE(cached.guardado_en)}` : "No hay un SAP temporal cargado."}</div><div id="sap-result"></div></section>`;
  $("sap-file").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = $("sap-result");
    result.innerHTML =
      '<p class="loading-inline">Leyendo, filtrando rutas y comparando localmente…</p>';
    try {
      sapReopenDecisions.clear();
      sapParsedForReview = await parseSapFile(file);
      await saveSAPCache(sapParsedForReview);
      await analyzeSapForCemento(sapParsedForReview);
    } catch (err) {
      sapPending = null;
      sapParsedForReview = null;
      result.innerHTML = `<div class="error-box"><h2>No se pudo leer el SAP</h2><p>${esc(err.message || err)}</p></div>`;
    }
  };
}
function clearReviewCaches() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith("cemento_revisadas_")) localStorage.removeItem(key);
  }
}
async function applySapPending() {
  if (!sapPending) return;
  const b = $("apply-sap");
  b.disabled = true;
  b.textContent = "APLICANDO…";
  try {
    const x = await sapApi({
      action: "aplicar",
      nombre_archivo: sapPending.nombre,
      hash_sha256: sapPending.hash,
      filas_recibidas: sapPending.registros.length,
      filas: sapPending.actionable,
    });
    localStorage.removeItem("cemento_precarga_activa");
    clearReviewCaches();
    await purgeGPSExcept(null);
    const notices = [
      `SAP actualizado: ${x.agregadas_sap} nuevas en SAP histórico y ${x.agregadas_diario} incorporadas a Seguimiento Diario.`,
      ...(x.vacias_reasignadas || []).map((oc) => `OC ${oc} VACÍA REASIGNADA.`),
      ...(x.con_informacion_reabiertas || []).map((oc) => `OC ${oc} YA EXISTE CON INFORMACIÓN; SE REABRE PARA VALIDACIÓN.`),
    ];
    alert(notices.join("\n"));
    await go("home");
  } catch (e) {
    alert(e.message);
    b.disabled = false;
    b.textContent = `APLICAR ${sapPending.actionable.length} OCs APROBADAS`;
  }
}
async function home16() {
  navState("home");
  loading();
  const d = await api("resumen"),
    range = fechaPE(d.rango_gps_desde),
    localRange = localStorage.getItem("cemento_rango_desde") || range;
  if (!localStorage.getItem("cemento_rango_desde") && range !== "—")
    localStorage.setItem("cemento_rango_desde", range);
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17",
      "Seguimiento y control operativo",
      `Última actualización: ${fechaPE(d.ultima_actividad)}`,
    ) +
    `<section class="metrics"><article><span>UNIDADES</span><strong>${d.unidades}</strong><small>con OC abierta</small></article><article><span>OCs ABIERTAS</span><strong>${d.ocs_abiertas}</strong><small>por evaluar</small></article><article><span>SAP TEMPORAL</span><strong class="small-value" id="sap-home">CONSULTANDO…</strong><small>solo en este navegador</small></article><article><span>PRECARGA</span><strong class="small-value">${esc(activeMeta()?.completo ? "COMPLETA" : activeMeta() ? "PENDIENTE" : "LISTA")}</strong><small>${bgCounts().done}/${activeMeta()?.total || d.unidades} unidades</small></article></section><section class="panel cutoff-panel"><div><h2>Fecha y hora del último seguimiento confirmado</h2><p class="muted">Será el inicio exacto de la siguiente descarga CLocator.</p></div><div class="cutoff-editor"><input id="range-start" type="datetime-local" value="${esc(peToInput(localRange))}"><button id="save-range">GUARDAR FECHA</button></div><p id="range-message" class="muted">Rango vigente: ${esc(localRange)}</p></section><section class="panel"><div class="panel-title"><h2>Flujo recomendado</h2><span class="pill">OPERATIVO</span></div><p class="muted">1. Actualizar SAP · 2. Precargar rutas · 3. Terminar Seguimiento · 4. Crear reporte.</p></section>`;
  readSAPCache().then((x) => {
    $("sap-home").textContent = x
      ? `${x.registros?.length || 0} OCs`
      : "SIN ARCHIVO";
  });
  $("save-range").onclick = async () => {
    const pe = inputToPE($("range-start").value);
    if (!pe) return alert("Ingrese una fecha y hora válidas");
    if (
      activeMeta() &&
      !(await appConfirm(
        "Cambiar el corte elimina el recorrido temporal actual de este navegador. ¿Continuar?",
        { okText: "CAMBIAR CORTE", danger: true },
      ))
    )
      return;
    const b = $("save-range");
    b.disabled = true;
    try {
      await sapApi({ action: "actualizar_corte", fecha_local: pe });
      localStorage.setItem("cemento_rango_desde", pe);
      localStorage.removeItem("cemento_precarga_activa");
      await purgeGPSExcept(null);
      $("range-message").textContent = `Rango vigente: ${pe}`;
      alert("Fecha de último seguimiento actualizada.");
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
    }
  };
}
async function precarga16() {
  navState("precarga");
  loading();
  const [units, resumen] = await Promise.all([preloadUnits(), api("resumen")]);
  preloadBg.units = units;
  const saved = activeMeta(),
    serverRange = fechaPE(resumen.rango_gps_desde),
    start =
      localStorage.getItem("cemento_rango_desde") ||
      (serverRange !== "—" ? serverRange : "");
  if (start) localStorage.setItem("cemento_rango_desde", start);
  await purgeGPSExcept(saved?.id || null);
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17",
      "Precarga real de flota",
      `${units.length} unidades · segundo plano y doble intento controlado.`,
    ) +
    `<section class="notice">Solo se conserva la ejecución actual en IndexedDB. Cada placa se intenta una vez y, si falla, una segunda vez al final.</section><section class="panel"><div class="panel-title"><div><h2>Control de precarga</h2><p id="run-range" class="muted">${saved ? `Rango: ${esc(saved.desde)} → ${esc(saved.hasta)}` : `Nuevo rango desde ${esc(start || "DEFINIR EN INICIO")}`}</p></div><div><button id="start-preload">${saved && !saved.completo ? "REANUDAR" : "NUEVA PRECARGA"}</button> <button id="stop-preload" ${preloadBg.running ? "" : "disabled"}>DETENER</button></div></div><div class="activity"><div><small>ESTADO</small><b id="batch-state">LISTO</b></div><div><small>PROGRESO</small><b id="batch-count">0/${units.length}</b></div><div><small>ERRORES FINALES</small><b id="batch-errors">0</b></div></div><div class="progress"><span id="batch-progress"></span></div></section><section class="panel"><div class="panel-title"><h2>Unidades de la ejecución</h2><span>primera vuelta + un reintento final</span></div><div class="table-wrap"><table><thead><tr><th>TRACTO</th><th>PLACA</th><th>PUNTOS</th><th>VISITAS</th><th>ESTADO</th></tr></thead><tbody>${units.map((u, i) => `<tr><td>${esc(u.tracto)}</td><td><b>${esc(u.placa)}</b></td><td id="p-${i}">—</td><td id="v-${i}">—</td><td id="s-${i}"><span class="state">PENDIENTE</span></td></tr>`).join("")}</tbody></table></div></section>`;
  await hydratePreload(units);
  $("start-preload").onclick = () => {
    const current = activeMeta();
    runPreload(units, {
      newRun: !current || current.completo,
      desde: start,
    }).catch((e) => alert(e.message));
    $("start-preload").disabled = true;
    $("stop-preload").disabled = false;
  };
  $("stop-preload").onclick = () => {
    preloadBg.stop = true;
    preloadBg.controller?.abort("operator");
    $("stop-preload").disabled = true;
  };
  renderBg();
}
async function seguimiento16() {
  await purgeGPSExcept(activeMeta()?.id || null);
  await seguimiento15();
}
async function reporte16() {
  navState("reporte");
  loading();
  const state = await reportApi({ action: "estado" });
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17",
      "Crear reporte",
      "Excel final y dos imágenes para correo, desde Seguimiento Diario.",
    ) +
    `<section class="notice ${state.habilitado ? "report-ready" : "report-locked"}"><b>${state.habilitado ? "SEGUIMIENTO COMPLETO" : "REPORTE BLOQUEADO"}</b><br>${esc(state.mensaje)} · ${state.revisadas}/${state.total_placas} placas · ${state.diario} OCs abiertas.</section><div class="report-main-action"><button id="report-all" ${state.habilitado ? "" : "disabled"}>GENERAR REPORTE COMPLETO · 3 ARCHIVOS</button></div><section class="report-downloads"><article><div>▣</div><h2>Excel operativo</h2><p>31 columnas y formato autorizado de Cemento.</p><button id="report-xlsx" ${state.habilitado ? "" : "disabled"}>DESCARGAR EXCEL</button></article><article><div>▧</div><h2>Resumen de datos</h2><p>Rutas, unidades en base y total operativo validado.</p><button id="report-data" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article><article><div>▥</div><h2>Distribución por ruta</h2><p>Resumen gráfico por ruta: cargadas y vacías.</p><button id="report-bars" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article></section>`;
  if (!state.habilitado) return;
  $("report-xlsx").onclick = () =>
    downloadFromReport($("report-xlsx"), { action: "excel" });
  let data;
  const getData = async () => {
    if (data === undefined) data = await reportApi({ action: "datos" });
    return data;
  };
  $("report-data").onclick = async () => {
    const b = $("report-data"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(
        await canvasBlob(reportCanvasData(d.resumen)),
        "RESUMEN_CORREO_DATOS.png",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
  $("report-bars").onclick = async () => {
    const b = $("report-bars"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(
        await canvasBlob(reportCanvasBars(d.resumen)),
        "RESUMEN_CORREO_BARRAS.png",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
  $("report-all").onclick = async () => {
    const b = $("report-all"),
      old = b.textContent;
    b.disabled = true;
    b.textContent = "GENERANDO LOS 3 ARCHIVOS…";
    try {
      const [x, d] = await Promise.all([
        reportApi({ action: "excel" }, true),
        getData(),
      ]);
      downloadBlob(x.blob, x.name);
      downloadBlob(
        await canvasBlob(reportCanvasData(d.resumen)),
        "RESUMEN_CORREO_DATOS.png",
      );
      downloadBlob(
        await canvasBlob(reportCanvasBars(d.resumen)),
        "RESUMEN_CORREO_BARRAS.png",
      );
      const completed = activeMeta()?.hasta || nowPEString();
      await sapApi({ action: "actualizar_corte", fecha_local: completed });
      localStorage.setItem("cemento_rango_desde", completed);
      localStorage.removeItem("cemento_precarga_activa");
      clearReviewCaches();
      await Promise.all([clearStore("sap_archivos"), purgeGPSExcept(null)]);
      alert(
        "Reporte completo generado. Se liberaron el SAP y los recorridos temporales; el siguiente rango iniciará al cierre de esta validación.",
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };
}
routes.home = home16;
routes.sap = sap16;
routes.precarga = precarga16;
routes.seguimiento = seguimiento16;
routes.reporte = reporte16;

// =============================================================================
// PRUEBA 17.1 · ADMINISTRACION SOLO CUOTAS + SEGUIMIENTO MANUAL OPERATIVO
// =============================================================================
async function adminApi(body) {
  const r = await fetch(ADMIN_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function manualApi(body) {
  const r = await fetch(MANUAL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function syncAdminNav() {
  const b = $("admin-nav");
  try {
    const p = await api("perfil");
    if (b) b.classList.toggle("hidden", p?.usuario?.rol !== "ADMIN");
    return p;
  } catch {
    if (b) b.classList.add("hidden");
    return null;
  }
}
function fmtBytes(v) {
  const n = Number(v) || 0;
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let x = n / 1024,
    i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)} ${u[i]}`;
}
function quotaCard(title, used, limit, note = "") {
  const u = Number(used) || 0,
    l = Number(limit) || 0,
    p = l ? Math.min(100, (u / l) * 100) : 0;
  return `<article class="quota-card"><small>${esc(title)}</small><strong>${fmtBytes(u)} / ${fmtBytes(l)}</strong><em>${esc(note || `${p.toFixed(1)}% utilizado`)}</em><div class="quota-bar"><span style="width:${p.toFixed(2)}%"></span></div></article>`;
}
const MANUAL_HEADERS = new Map([
  ["VIAJE", "Viaje"],
  ["FECHACARGAREAL", "Fecha Carga Real"],
  ["FECHADEORDEN", "Fecha de Orden"],
  ["ORDENDECARGA", "Orden de Carga"],
  ["CONDUCTOR", "CONDUCTOR"],
  ["CELULAR", "Celular"],
  ["TRACTO", "TRACTO"],
  ["PLACATRACTO", "Placa Tracto"],
  ["CODIGOCARRETA", "Código Carreta"],
  ["PLACACARRETA", "Placa Carreta"],
  ["RUTA", "Ruta"],
  ["CARGA", "CARGA"],
  ["DESTINO", "DESTINO"],
  ["PRESENTACION", "PRESENTACION"],
  ["GESTOR", "GESTOR"],
  ["USUARIOSAP", "USUARIO SAP"],
  ["FECHADESALIDAPLANTAYURACARACOTO", "FECHA DE SALIDA PLANTA YURA/CARACOTO"],
  ["FECHALLEGADAADESTINO", "FECHA LLEGADA A DESTINO"],
  ["TIEMPOTOTALDEIDA", "Tiempo Total de Ida"],
  ["FECHAINICIODERETORNO", "FECHA INICIO DE RETORNO"],
  ["FECHAFINDERETORNOAQPYURACRCT", "FECHA FIN DE RETORNO AQP/YURA/CRCT"],
  ["TIEMPOTOTALDERETORNO", "Tiempo Total de Retorno"],
  ["TIEMPOTOTALDEVIAJE", "Tiempo Total de Viaje"],
  ["TIEMPODEDESCARGA", "Tiempo de descarga"],
  ["CARGADERETORNO", "CARGA DE RETORNO"],
  ["OBSERVACIONES", "OBSERVACIONES"],
  ["DIASPARADOPLANTA", "DIAS PARADO PLANTA"],
  ["FECHA", "FECHA"],
  ["HORA", "HORA"],
  ["UBICACION", "UBICACIÓN"],
  ["ESTADO", "ESTADO"],
]);
async function parseManualFile(file) {
  const buffer = await file.arrayBuffer(),
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    hash = [...digest].map((x) => x.toString(16).padStart(2, "0")).join(""),
    rows = await parseXlsx(buffer),
    hi = rows.findIndex(
      (r) =>
        r.some((v) => headerKey(v) === "ORDENDECARGA") &&
        r.some((v) => headerKey(v) === "VIAJE"),
    );
  if (hi < 0)
    throw Error("No se encontraron las columnas Viaje y Orden de Carga");
  const headers = rows[hi].map((v) => MANUAL_HEADERS.get(headerKey(v)) || ""),
    byOc = new Map();
  let omitidas = 0;
  for (const row of rows.slice(hi + 1)) {
    const payload = {};
    headers.forEach((h, i) => {
      if (!h) return;
      let v = row[i] ?? "";
      if (typeof v === "string") v = v.trim();
      if (
        (MANUAL_DATE_ONLY.has(h) || MANUAL_DATE_TIME.has(h)) &&
        (typeof v === "number" || /^\d{5}(?:\.\d+)?$/.test(String(v)))
      )
        v = manualExcelDate(v, MANUAL_DATE_TIME.has(h));
      payload[h] = v;
    });
    const oc = String(payload["Orden de Carga"] ?? "")
      .replace(/\.0+$/g, "")
      .trim();
    if (!oc) {
      omitidas++;
      continue;
    }
    const viaje = String(payload.Viaje ?? "")
      .trim()
      .toUpperCase();
    payload["Orden de Carga"] = oc;
    payload.Viaje = viaje;
    payload["ESTADO OC"] = viaje === "F" ? "CERRADO" : "ABIERTO";
    byOc.set(oc, { orden_carga: oc, viaje, payload });
  }
  const filas = [...byOc.values()],
    cerradas = filas.filter((x) => x.viaje === "F").length;
  return {
    nombre: file.name,
    hash,
    filas,
    cerradas,
    abiertas: filas.length - cerradas,
    omitidas,
    duplicadas: Math.max(0, rows.length - hi - 1 - omitidas - filas.length),
  };
}
const MANUAL_DATE_ONLY = new Set([
    "Fecha Carga Real",
    "Fecha de Orden",
    "FECHA",
  ]),
  MANUAL_DATE_TIME = new Set([
    "FECHA DE SALIDA PLANTA YURA/CARACOTO",
    "FECHA LLEGADA A DESTINO",
    "FECHA INICIO DE RETORNO",
    "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  ]);
function manualExcelDate(value, withTime = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)),
    z = (x) => String(x).padStart(2, "0"),
    base = `${z(d.getUTCDate())}/${z(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return withTime
    ? `${base} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`
    : base;
}
let manualPending = null;
async function admin17() {
  navState("admin");
  loading();
  const d = await adminApi({ action: "cuotas" }),
    g = d.cuotas?.global || {},
    items = d.cuotas?.itinerarios || [],
    limits = d.limites || {
      database: 524288000,
      egress: 5368709120,
      storage: 1073741824,
    };
  $("content").innerHTML =
    head(
      "ADMIN · PRUEBA 17.1",
      "Control de Supabase",
      "Visible solo para cuentas ADMIN.",
    ) +
    `<section class="notice"><b>CUOTAS:</b> Esta sección es exclusivamente informativa. Base de datos y Storage muestran uso vivo estimado desde Supabase. El Egress mostrado por itinerario es el tráfico pesado registrado por la aplicación desde PRUEBA 17.</section><section class="quota-grid">${quotaCard("BASE DE DATOS", g.database_total_bytes, limits.database, "Proyecto Supabase · cuota de referencia")}${quotaCard("EGRESS APP · MES", g.egress_app_bytes_mes, limits.egress, "Registro interno PRUEBA 17")}${quotaCard("STORAGE ACTUAL", g.storage_total_bytes, limits.storage, "Objetos presentes en Storage")}</section><section class="panel admin-panel"><div class="panel-title"><div><h2>Consumo estimado por itinerario</h2><p class="muted">Datos de filas, Storage por bucket y Egress pesado registrado.</p></div><button id="refresh-quotas">ACTUALIZAR</button></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>ITINERARIO</th><th>BD APROX.</th><th>EGRESS MES</th><th>STORAGE</th></tr></thead><tbody>${items.map((x) => `<tr><td><b>${esc(x.itinerario)}</b></td><td>${fmtBytes(x.database_row_bytes)}</td><td>${fmtBytes(x.egress_bytes_mes)}</td><td>${fmtBytes(x.storage_bytes)}</td></tr>`).join("") || '<tr><td colspan="4">Sin datos</td></tr>'}</tbody></table></div><p class="admin-note">La suma por itinerario mide filas con campo ITINERARIO; no incluye índices, WAL ni sobrecarga interna. Por eso puede ser menor que el tamaño global de la base.</p></section>`;
  $("refresh-quotas").onclick = () => go("admin");
}
async function manual17() {
  navState("manual");
  loading();
  manualPending = null;
  const d = await manualApi({ action: "estado" });
  $("content").innerHTML =
    head(
      "CEMENTO · PRUEBA 17.1",
      "Seguimiento manual",
      "Disponible para todos los usuarios activos con acceso a CEMENTO.",
    ) +
    `<section class="notice"><b>REGLA OPERATIVA:</b> Viaje = F → SEGUIMIENTO_HISTORICO. Cualquier otro valor (IDA, RETORNO, PARADA, etc.) → SEGUIMIENTO_DIARIO.</section><section class="panel manual-panel"><div class="panel-title"><div><h2>Importar seguimiento manual</h2><p class="muted">El Excel se lee localmente en el navegador; el archivo completo no se almacena en Supabase.</p></div><label class="file-button">SELECCIONAR XLSX<input id="manual-file" type="file" accept=".xlsx"></label></div><div id="manual-result" class="admin-import-result">${d.ultima_importacion ? `Última importación: <b>${esc(d.ultima_importacion.nombre_archivo)}</b> · ${fechaPE(d.ultima_importacion.creado_en)} · usuario ${esc(d.ultima_importacion.usuario || "—")}` : "Sin importaciones manuales registradas."}</div></section>`;
  $("manual-file").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const box = $("manual-result");
    box.innerHTML = '<p class="loading-inline">Leyendo Excel localmente…</p>';
    try {
      manualPending = await parseManualFile(file);
      box.innerHTML = `<div class="admin-file-summary"><b>${esc(manualPending.nombre)}</b><p>${manualPending.filas.length} OCs válidas · <b>${manualPending.cerradas} cerradas (F)</b> · <b>${manualPending.abiertas} abiertas</b></p>${manualPending.duplicadas ? `<p>${manualPending.duplicadas} OCs duplicadas se consolidaron localmente.</p>` : ""}${manualPending.omitidas ? `<p>${manualPending.omitidas} filas sin OC se omitieron.</p>` : ""}<div class="admin-actions"><button id="apply-manual" class="primary">APLICAR A SUPABASE</button></div></div>`;
      $("apply-manual").onclick = applyManual17;
    } catch (err) {
      manualPending = null;
      box.innerHTML = `<div class="error-box"><h2>No se pudo leer el archivo</h2><p>${esc(err.message || err)}</p></div>`;
    }
  };
}
async function applyManual17() {
  if (!manualPending) return;
  if (
    !(await appConfirm(
      `Se sincronizarán ${manualPending.filas.length} OCs.\n\nF = HISTÓRICO\nOTROS = DIARIO\n\n¿Continuar?`,
      { okText: "APLICAR A SUPABASE" },
    ))
  )
    return;
  const b = $("apply-manual");
  b.disabled = true;
  b.textContent = "APLICANDO…";
  try {
    const x = await manualApi({
      action: "importar_manual",
      nombre_archivo: manualPending.nombre,
      hash_sha256: manualPending.hash,
      filas: manualPending.filas,
    });
    localStorage.removeItem("cemento_precarga_activa");
    clearReviewCaches();
    await purgeGPSExcept(null);
    alert(
      `Seguimiento manual aplicado.\nCerradas: ${x.cerradas}\nAbiertas: ${x.abiertas}\nInsertadas: ${x.insertadas}\nActualizadas: ${x.actualizadas}\nMovidas: ${x.movidas}`,
    );
    manualPending = null;
    await go("manual");
  } catch (e) {
    alert(e.message);
    b.disabled = false;
    b.textContent = "APLICAR A SUPABASE";
  }
}
routes.admin = admin17;
routes.manual = manual17;

// =============================================================================
// ITINERARIOS WEB · VERSIÓN 2
// Seguimiento persistente + actualización manual de recorrido Y análisis.
// =============================================================================
const reviewPersistingV2 = new Map();
const trackingDraftsV2 = new Map();

function captureTrackingDraftV2(plateKey = trackState.currentPlateKey) {
  const key = nplate(plateKey);
  if (!key) return;
  const draft = trackingDraftsV2.get(key) || { ocs: {}, route: {} };
  const box = $("oc-list");
  if (box) {
    box.querySelectorAll(".track-oc[data-id]").forEach((card) => {
      const values = {};
      card.querySelectorAll("input,textarea,select").forEach((el) => {
        if (el.id) values[el.id] = el.value;
      });
      draft.ocs[String(card.dataset.id || "")] = values;
    });
  }
  const from = $("route-from"),
    to = $("route-to");
  if (from) draft.route.from = from.value;
  if (to) draft.route.to = to.value;
  trackingDraftsV2.set(key, draft);
}

function restoreTrackingDraftV2(plateKey = trackState.currentPlateKey) {
  const key = nplate(plateKey),
    draft = trackingDraftsV2.get(key);
  if (!key || !draft) return;
  for (const values of Object.values(draft.ocs || {})) {
    for (const [id, value] of Object.entries(values || {})) {
      const el = $(id);
      if (el) el.value = value;
    }
  }
  const from = $("route-from"),
    to = $("route-to");
  if (from && draft.route?.from != null) from.value = draft.route.from;
  if (to && draft.route?.to != null) to.value = draft.route.to;
}

function peToInputV2(value) {
  const s = String(value || "").trim(),
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
  return "";
}
function inputToPEV2(value) {
  const m = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : "";
}
function peMillisV2(value) {
  const m = String(value || "").match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  return m
    ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime()
    : NaN;
}
async function persistReviewedV2(plate) {
  const key = nplate(plate);
  if (!key || reviewPersistingV2.has(key)) return reviewPersistingV2.get(key);
  const job = trackApi({ action: "marcar_revisada", placa: plate }).finally(() =>
    reviewPersistingV2.delete(key),
  );
  reviewPersistingV2.set(key, job);
  return job;
}
function paintStripV2() {
  const h = $("plate-strip"),
    n = trackState.list.length,
    i = trackState.index;
  if (!h || !n) return;
  h.innerHTML = [-1, 0, 1]
    .map((d) => {
      const ix = (i + d + n) % n,
        u = trackState.list[ix],
        reviewed = trackState.reviewed.has(nplate(u.placa));
      return `<button class="${d === 0 ? "selected" : ""} ${reviewed ? "reviewed" : ""}" data-i="${ix}">${esc(u.tracto || u.placa)}</button>`;
    })
    .join("");
  h.querySelectorAll("button").forEach(
    (b) => (b.onclick = () => loadTrackingUnitV2(+b.dataset.i)),
  );
  if ($("plate-position")) $("plate-position").textContent = `PLACA ${i + 1}/${n}`;
  if ($("review-count"))
    $("review-count").textContent = `REVISADAS ${trackState.reviewed.size}/${n}`;
  updateReviewedButtonV2();
}
function updateReviewedButtonV2() {
  const b = $("reviewed"),
    u = trackState.list?.[trackState.index];
  if (!b || !u) return;
  const yes = trackState.reviewed.has(nplate(u.placa));
  b.textContent = "REVISADA";
  b.classList.toggle("done", yes);
  b.title = yes ? "Unidad ya revisada y almacenada en el temporal" : "Marcar unidad como revisada";
}
async function markReviewedV2(plate, advance = true) {
  const key = nplate(plate);
  if (!key) return;
  await persistReviewedV2(plate);
  trackState.reviewed.add(key);
  paintStripV2();
  if (!advance || trackState.reviewed.size >= trackState.list.length) return;
  const n = trackState.list.length;
  for (let step = 1; step <= n; step++) {
    const ix = (trackState.index + step) % n,
      u = trackState.list[ix];
    if (!trackState.reviewed.has(nplate(u.placa))) {
      await loadTrackingUnitV2(ix);
      break;
    }
  }
}
function isPreparedClosedV2(oc) {
  return String(oc?.borrador?.accion || "").toUpperCase() === "CERRAR";
}
function renderOcListV2(detail, plateKey = trackState.currentPlateKey) {
  captureTrackingDraftV2(trackState.currentPlateKey);
  trackState.currentDetail = detail;
  trackState.currentPlateKey = nplate(
    plateKey || trackState.list?.[trackState.index]?.placa || "",
  );
  const all = detail?.ocs || [],
    closed = all.filter(isPreparedClosedV2),
    visible = trackState.showClosed ? all : all.filter((x) => !isPreparedClosedV2(x)),
    box = $("oc-list"),
    toggle = $("toggle-closed");
  if (toggle) {
    toggle.classList.toggle("hidden", closed.length === 0);
    toggle.textContent = trackState.showClosed
      ? "OCULTAR CERRADAS"
      : `MOSTRAR CERRADAS (${closed.length})`;
  }
  box.innerHTML = visible.length
    ? visible.map(ocHtml).join("")
    : `<div class="track-empty-ocs"><b>SIN OC ABIERTAS VISIBLES</b><span>${closed.length ? `${closed.length} OC preparada${closed.length === 1 ? "" : "s"} para cierre.` : "No hay OCs pendientes para mostrar."}</span></div>`;
  for (const oc of visible.filter(isPreparedClosedV2)) {
    const card = box.querySelector(`.track-oc[data-id="${oc.id}"]`);
    if (!card) continue;
    card.classList.add("prepared-close");
    card.querySelectorAll("input,textarea,select,button").forEach((x) => (x.disabled = true));
    const em = card.querySelector("header em");
    if (em) em.textContent = "CIERRE PREPARADO";
  }
  box.querySelectorAll("[data-paste]").forEach(
    (b) => (b.onclick = () => pasteField(b.dataset.paste)),
  );
  box.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = async () => {
        const card = b.closest(".track-oc"),
          old = b.textContent;
        b.disabled = true;
        b.textContent = "GUARDANDO…";
        try {
          await trackApi({ action: "guardar", id: +b.dataset.save, datos: formData(card) });
          const oc = all.find((x) => +x.id === +b.dataset.save);
          if (oc) oc.borrador = { ...(oc.borrador || {}), accion: "GUARDAR" };
          b.textContent = "PREPARADO";
        } catch (e) {
          alert(e.message);
          b.textContent = old;
        } finally {
          b.disabled = false;
        }
      }),
  );
  box.querySelectorAll("[data-close]").forEach(
    (b) =>
      (b.onclick = async () => {
        const card = b.closest(".track-oc"),
          id = +b.dataset.close;
        if (!(await appConfirm(
          "¿Preparar el cierre de esta OC? Se ocultará de la vista para continuar el seguimiento.",
          { okText: "CERRAR OC", danger: true },
        ))) return;
        b.disabled = true;
        b.textContent = "CERRANDO…";
        try {
          await trackApi({ action: "cerrar", id, datos: formData(card) });
          const oc = all.find((x) => +x.id === id);
          if (oc) oc.borrador = { ...(oc.borrador || {}), accion: "CERRAR" };
          renderOcListV2(detail);
        } catch (e) {
          alert(e.message);
          b.disabled = false;
          b.textContent = "CERRAR OC";
        }
      }),
  );
  restoreTrackingDraftV2(trackState.currentPlateKey);
}
async function loadTrackingUnitV2(i) {
  if (!trackState.list.length) return;
  captureTrackingDraftV2(trackState.currentPlateKey);
  trackState.index = (i + trackState.list.length) % trackState.list.length;
  paintStripV2();
  const u = trackState.list[trackState.index];
  try {
    const [d, gps] = await Promise.all([
      trackApi({ action: "detalle", placa: u.placa }),
      cachedForPlate(u.placa),
    ]);
    $("unit-name").textContent = d.tracto || d.placa;
    $("unit-sub").textContent = `${d.placa} · ${d.ocs.length} OC abiertas`;
    $("last-closed").textContent = d.ultima_oc_cerrada
      ? `OC ${d.ultima_oc_cerrada.orden_carga} · ${d.ultima_oc_cerrada.ruta}`
      : "Sin OC cerrada registrada";
    trackState.showClosed = false;
    renderOcListV2(d, u.placa);
    drawTracking(gps);
    renderEvents(gps);
    const meta = activeMeta(),
      from = gps?.desde || meta?.desde || localStorage.getItem("cemento_rango_desde") || "",
      to = gps?.hasta || meta?.hasta || nowPEString();
    if ($("route-from")) $("route-from").value = peToInputV2(from);
    if ($("route-to")) $("route-to").value = peToInputV2(to);
    if ($("route-update-status"))
      $("route-update-status").textContent = gps?.ok
        ? `ANÁLISIS LISTO · ${gps.puntos ?? 0} PUNTOS`
        : "SIN RECORRIDO PRECARGADO";
    restoreTrackingDraftV2(u.placa);
    updateReviewedButtonV2();
  } catch (e) {
    $("oc-list").innerHTML = `<div class="error-box"><p>${esc(e.message)}</p></div>`;
  }
}
async function maybeRefreshTrackingV2(plate, data) {
  if (!trackState.v2 || !document.body.classList.contains("tracking-active")) return;
  const current = trackState.list?.[trackState.index];
  if (!current || nplate(current.placa) !== nplate(plate)) return;
  drawTracking(data);
  renderEvents(data);
  if ($("route-from")) $("route-from").value = peToInputV2(data?.desde || "");
  if ($("route-to")) $("route-to").value = peToInputV2(data?.hasta || "");
  if ($("route-update-status"))
    $("route-update-status").textContent = `PRECARGA ACTUALIZADA · ${data?.puntos ?? 0} PUNTOS`;
}
async function refreshCurrentRouteV2() {
  const u = trackState.list?.[trackState.index],
    button = $("refresh-route"),
    status = $("route-update-status");
  if (!u || !button) return;
  const from = inputToPEV2($("route-from").value),
    to = inputToPEV2($("route-to").value);
  if (!from || !to) return alert("Ingrese un rango DESDE / HASTA válido.");
  if (peMillisV2(from) >= peMillisV2(to))
    return alert("La fecha DESDE debe ser anterior a HASTA.");
  button.disabled = true;
  button.textContent = "ACTUALIZANDO…";
  status.textContent = "DESCARGANDO RECORRIDO Y REPITIENDO ANÁLISIS…";
  try {
    // include_map=false evita descargar cartografía al navegador. El Edge Function
    // sí utiliza geocercas/rutas publicadas para repetir TODO el análisis.
    const x = await clocatorTest(u.placa, u.tracto, false, from, to);
    let meta = activeMeta();
    if (!meta) {
      meta = {
        id: crypto.randomUUID(),
        desde: from,
        hasta: to,
        total: trackState.list.length,
        intentos: {},
        resultados: {},
        completo: false,
        origen: "SEGUIMIENTO_VERSION_2",
      };
    }
    meta.resultados ||= {};
    meta.intentos ||= {};
    const key = `${meta.id}|${u.tracto}|${u.placa}`,
      cached = { ...x, run_id: meta.id };
    await cacheGPS(cached, key);
    const movement = await movementState(x);
    meta.resultados[nplate(u.placa)] = {
      estado: movement,
      puntos: x.puntos ?? 0,
      visitas: x.analisis?.visitas_confirmadas?.length ?? 0,
      actualizado_manual: new Date().toISOString(),
    };
    saveMeta(meta);
    drawTracking(cached);
    renderEvents(cached);
    if (movement === "SIN MOVIMIENTO" && !trackState.reviewed.has(nplate(u.placa)))
      await markReviewedV2(u.placa, false);
    status.textContent = `RECORRIDO + ANÁLISIS ACTUALIZADOS · ${x.puntos ?? 0} PUNTOS`;
  } catch (e) {
    status.textContent = "NO SE PUDO ACTUALIZAR";
    alert(e.message);
  } finally {
    button.disabled = false;
    button.textContent = "ACTUALIZAR RECORRIDO";
  }
}
/* === PRUEBA GRILLA 03 · FLUJO OPERATIVO === */

const plateGridDetailsV3 = new Map();

const gridReviewedPreviewV3 = new Set();
const gridClosedPreviewV3 = new Set();
const gridSavedPreviewV3 = new Set();

let plateGridRunV3 = 0;

let trackingSplitV3 = {
  mapa: 35,
  grilla: 50,
  gps: 15,
};

function gridPlateKeyV3(index) {
  const u = trackState.list[index];
  return u ? nplate(u.placa) : "";
}

function gridIsReviewedV3(index) {
  const key = gridPlateKeyV3(index);

  return (
    trackState.reviewed.has(key) ||
    gridReviewedPreviewV3.has(key)
  );
}

function plateGridStateOptionsV3(current = "") {
  const states = [
    "",
    "ESTACIONADO CARGADO",
    "ESTACIONADO VACÍO",
    "TRANSITO CARGADO",
    "TRANSITO VACÍO",
  ];

  if (current && !states.includes(current)) {
    states.push(current);
  }

  return states
    .map(
      (x) =>
        `<option value="${esc(x)}" ${
          x === current ? "selected" : ""
        }>${esc(x || "-")}</option>`,
    )
    .join("");
}

function pgPasteInputV3(id, label, value) {
  return `
    <label class="pg-field">
      <span>${label}</span>
      <div class="pg-input-paste">
        <input
          id="${id}"
          value="${esc(String(value ?? ""))}"
        >
        <button
          type="button"
          data-grid-paste="${id}"
          title="Pegar"
          aria-label="Pegar"
        >📋</button>
      </div>
    </label>`;
}

function pgNormalInputV3(label, value) {
  return `
    <label class="pg-field">
      <span>${label}</span>
      <input
        class="pg-normal-input"
        value="${esc(String(value ?? ""))}"
      >
    </label>`;
}


/* === PRUEBA GRILLA 04 · PESTAÑA Y OC REDONDEADA === */

function shortTractoV3(value) {
  const x = String(value || "—").trim();

  return x.replace(/^20-/i, "");
}


/* === PRUEBA GRILLA 06 · OC AMPLIADA + HISTORICO === */


/* === PRUEBA 07 FINAL · TARJETA OPERATIVA === */

let gridDirtyPreviewV3 = new Set();
let gridSavingPreviewV3 = new Set();
let gridReviewingPreviewV3 = new Set();

let gridMapIndexV3 = -1;


/* ------------------------------------------------------------
   PARIHUELAS
   ------------------------------------------------------------ */

function isParihuelasV3(payload) {
  const carga = String(
    payload?.CARGA || ""
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  return carga.includes("PARIHUELA");
}


/* ------------------------------------------------------------
   ESTADO EN DOS LÍNEAS
   ------------------------------------------------------------ */

function stateSelectV3(value, dataAttr = "") {
  const current =
    String(value || "-").trim() || "-";

  return `
    <div class="pg-state-select-wrap">

      <span class="pg-state-selected">
        ${esc(current)}
      </span>

      <select ${dataAttr}>
        ${plateGridStateOptionsV3(current)}
      </select>

    </div>`;
}

function syncStateSelectV3(select) {
  const wrap =
    select?.closest(
      ".pg-state-select-wrap"
    );

  const label =
    wrap?.querySelector(
      ".pg-state-selected"
    );

  if (!label) return;

  label.textContent =
    select.options[
      select.selectedIndex
    ]?.textContent ||
    select.value ||
    "-";
}


/* ------------------------------------------------------------
   OC ABIERTA
   ------------------------------------------------------------ */

function plateGridOcRowV3(
  index,
  x,
  ocIndex,
  totalOcs = 1
) {
  const u = trackState.list[index] || {};
  const p = x.payload || {};
  const id = Number(x.id);

  const reviewed =
    gridIsReviewedV3(index);

  const closed =
    gridClosedPreviewV3.has(id);

  const saved =
    gridSavedPreviewV3.has(id);

  const parihuelas =
    isParihuelasV3(p);

  const first =
    ocIndex === 0;

  const last =
    ocIndex === totalOcs - 1;

  const single =
    totalOcs === 1;

  const shapeClass =
    single
      ? "pg-single-oc"
      : first
        ? "pg-first-oc"
        : last
          ? "pg-last-oc"
          : "pg-middle-oc";

  const tab = first
    ? `
      <div
        class="
          pg-oc-tab
          ${reviewed ? "done" : ""}
        "
      >
        <b class="pg-tab-number">
          ${index + 1}
        </b>

        <button
          type="button"
          class="pg-unit-code"
          data-grid-select="${index}"
          title="${esc(u.placa || "")}"
        >
          ${esc(
            shortTractoV3(
              u.tracto || u.placa
            )
          )}
        </button>

        <button
          type="button"
          class="
            pg-review-action
            ${reviewed ? "done" : ""}
          "
          data-grid-review="${index}"
          title="Marcar placa revisada"
        >
          ✓
        </button>
      </div>`
    : "";

  return `
    <article
      class="
        pg-oc-row
        ${shapeClass}
        ${reviewed ? "pg-reviewed" : ""}
        ${closed ? "pg-closed" : ""}
        ${saved ? "pg-saved" : ""}
        ${parihuelas ? "pg-parihuelas" : ""}
      "
      data-grid-index="${index}"
      data-grid-oc-id="${id}"
    >

      ${tab}

      <div class="pg-oc-top">

        <div class="pg-oc-heading">
          <span>OC</span>

          <strong>
            ${esc(x.orden_carga || "—")}
          </strong>

          <b class="pg-route-inline">
            ${esc(p.Ruta || "—")}
          </b>
        </div>

        ${
          parihuelas
            ? `
              <span class="pg-special-tag">
                PARIHUELAS
              </span>`
            : ""
        }

        <div class="pg-top-actions">

          <button
            type="button"
            class="
              pg-save-action
              ${saved ? "done" : ""}
            "
            data-grid-save="${id}"
          >
            <b>💾</b>
            <span>GUARDAR</span>
          </button>

          <button
            type="button"
            class="
              pg-close-action
              ${closed ? "done" : ""}
            "
            data-grid-close="${id}"
          >
            <b>🚩</b>
            <span>FIN DE CICLO</span>
          </button>

        </div>

      </div>

      <div class="pg-state">

        <label>
          <span>ESTADO</span>

          ${stateSelectV3(
            field(p, "ESTADO")
          )}
        </label>

      </div>

      <div class="pg-salida">
        ${pgPasteInputV3(
          `pg-${id}-salida`,
          "SALIDA DE PLANTA",
          field(
            p,
            "FECHA DE SALIDA PLANTA YURA/CARACOTO"
          )
        )}
      </div>

      <div class="pg-llegada">
        ${pgPasteInputV3(
          `pg-${id}-llegada`,
          "LLEGADA A DESTINO",
          field(
            p,
            "FECHA LLEGADA A DESTINO"
          )
        )}
      </div>

      <div class="pg-return-load">
        ${pgNormalInputV3(
          "CARGA DE RETORNO",
          field(
            p,
            "CARGA DE RETORNO"
          )
        )}
      </div>

      <div class="pg-retorno">
        ${pgPasteInputV3(
          `pg-${id}-retorno`,
          "INICIO DE RETORNO",
          field(
            p,
            "FECHA INICIO DE RETORNO"
          )
        )}
      </div>

      <div class="pg-fin">
        ${pgPasteInputV3(
          `pg-${id}-fin`,
          "FIN DE RETORNO",
          field(
            p,
            "FECHA FIN DE RETORNO AQP/YURA/CRCT"
          )
        )}
      </div>

      <div class="pg-location">
        ${pgPasteInputV3(
          `pg-${id}-ubicacion`,
          "UBICACIÓN",
          field(p, "UBICACIÓN")
        )}
      </div>

      <label class="pg-observation">
        <span>OBSERVACIONES</span>

        <textarea>${esc(
          field(p, "OBSERVACIONES")
        )}</textarea>
      </label>

    </article>`;
}


function plateGridGroupV3(index, detail) {
  const ocs =
    detail?.ocs || [];

  return `
    <section
      class="pg-unit-group"
      data-grid-group="${index}"
    >
      <div class="pg-unit-ocs">
        ${
          ocs.length
            ? ocs
                .map((x, i) =>
                  plateGridOcRowV3(
                    index,
                    x,
                    i,
                    ocs.length
                  )
                )
                .join("")
            : `
              <div class="pg-empty">
                SIN OC ABIERTA
              </div>`
        }
      </div>
    </section>`;
}


/* ------------------------------------------------------------
   DATOS EDITADOS DE UNA OC ABIERTA
   ------------------------------------------------------------ */

function collectGridOcDataV3(row) {
  return {
    estado_fisico:
      row.querySelector(
        ".pg-state select"
      )?.value ?? "",

    salida_planta:
      row.querySelector(
        ".pg-salida input"
      )?.value ?? "",

    llegada_destino:
      row.querySelector(
        ".pg-llegada input"
      )?.value ?? "",

    carga_retorno:
      row.querySelector(
        ".pg-return-load input"
      )?.value ?? "",

    inicio_retorno:
      row.querySelector(
        ".pg-retorno input"
      )?.value ?? "",

    fin_de_ciclo:
      row.querySelector(
        ".pg-fin input"
      )?.value ?? "",

    ubicacion:
      row.querySelector(
        ".pg-location input"
      )?.value ?? "",

    observaciones:
      row.querySelector(
        ".pg-observation textarea"
      )?.value ?? ""
  };
}


async function saveGridOcV3(row) {
  if (!row) return false;

  const id =
    Number(
      row.dataset.gridOcId
    );

  if (!Number.isInteger(id))
    return false;

  if (
    gridSavingPreviewV3.has(id)
  ){
    return false;
  }

  const button =
    row.querySelector(
      "[data-grid-save]"
    );

  gridSavingPreviewV3.add(id);

  button?.classList.add(
    "saving"
  );

  try {

    await trackApi({
      action: "guardar",
      id,
      datos:
        collectGridOcDataV3(row)
    });

    gridDirtyPreviewV3.delete(id);
    gridSavedPreviewV3.add(id);

    row.classList.add(
      "pg-saved"
    );

    button?.classList.add(
      "done"
    );

    return true;

  } finally {

    gridSavingPreviewV3.delete(id);

    button?.classList.remove(
      "saving"
    );
  }
}


async function savePendingPlateV3(index) {
  const group =
    document.querySelector(
      `[data-grid-group="${index}"]`
    );

  if (!group) return true;

  const rows =
    [...group.querySelectorAll(
      ".pg-oc-row[data-grid-oc-id]"
    )];

  for (const row of rows) {

    const id =
      Number(
        row.dataset.gridOcId
      );

    if (
      !gridDirtyPreviewV3.has(id)
    ){
      continue;
    }

    const ok =
      await saveGridOcV3(row);

    if (!ok)
      return false;
  }

  return true;
}


/* ------------------------------------------------------------
   UNIDAD QUE ESTÁ MOSTRANDO EL MAPA
   ------------------------------------------------------------ */

function firstActiveGridIndexV3() {
  for(
    let i=0;
    i<trackState.list.length;
    i++
  ){
    if(
      gridPlateCategoryV3(i) ===
      "active"
    ){
      return i;
    }
  }

  return -1;
}


function ensureRouteUnitHeaderV3() {
  const left =
    document.querySelector(
      ".desktop-tracking.grid-03 .track-left"
    ) ||
    document.querySelector(
      ".desktop-tracking .track-left"
    );

  if (!left) return null;

  let bar =
    left.querySelector(
      ".route-unit-toolbar-v3"
    );

  if (bar) return bar;

  const route =
    left.querySelector(
      ".route-refresh"
    );

  if (!route) return null;

  bar =
    document.createElement("div");

  bar.className =
    "route-unit-toolbar-v3";

  const card =
    document.createElement("div");

  card.className =
    "route-unit-card-v3";

  card.innerHTML = `
    <strong>R---</strong>
  `;

  route.before(bar);

  bar.appendChild(card);
  bar.appendChild(route);

  return bar;
}


function highlightMapUnitGridV3() {
  document
    .querySelectorAll(
      ".pg-unit-group"
    )
    .forEach((group) => {

      const index =
        Number(
          group.dataset.gridGroup
        );

      group.classList.toggle(
        "pg-map-unit",
        index === gridMapIndexV3
      );
    });
}


function syncRouteMapUnitV3(index) {
  if (
    !Number.isInteger(index) ||
    !trackState.list[index]
  ){
    return;
  }

  gridMapIndexV3 =
    index;

  const u =
    trackState.list[index] || {};

  const bar =
    ensureRouteUnitHeaderV3();

  const label =
    bar?.querySelector(
      ".route-unit-card-v3 strong"
    );

  if (label) {
    label.textContent =
      shortTractoV3(
        u.tracto ||
        u.placa ||
        ""
      );
  }

  highlightMapUnitGridV3();
}

function plateGridSkeletonV3(index) {
  const u = trackState.list[index] || {};

  return `
    <section
      class="pg-unit-group pg-loading"
      data-grid-loading="${index}"
    >
      <header class="pg-unit-tag">
        <span>${esc(u.tracto || "—")}</span>
      </header>

      <div class="pg-loading-body">
        Cargando OCs…
      </div>
    </section>`;
}

function rerenderGridGroupV3(index) {
  const detail = plateGridDetailsV3.get(
    gridPlateKeyV3(index)
  );

  if (!detail) return;

  const current = document.querySelector(
    `[data-grid-group="${index}"]`
  );

  if (!current) return;

  current.outerHTML =
    plateGridGroupV3(index, detail);

  highlightPlateGridV3();
}

function highlightPlateGridV3() {
  document
    .querySelectorAll(".pg-unit-group")
    .forEach((group) => {
      group.classList.toggle(
        "pg-active-unit",
        Number(group.dataset.gridGroup) ===
          Number(trackState.index),
      );
    });
}


/* === PRUEBA GRILLA 05 · COLAS DE PLACAS === */

function gridOcIsClosedV3(x) {
  return (
    gridClosedPreviewV3.has(Number(x?.id)) ||
    String(x?.borrador?.accion || "").toUpperCase() === "CERRAR"
  );
}

function gridPlateCategoryV3(index) {
  const key = gridPlateKeyV3(index);
  const detail = plateGridDetailsV3.get(key);
  const ocs = detail?.ocs || [];

  /* CERRADA tiene prioridad:
     no queda ninguna OC abierta/en proceso. */
  if (
    ocs.length &&
    ocs.every((x) => gridOcIsClosedV3(x))
  ) {
    return "closed";
  }

  /* REVISADA:
     la placa ya fue evaluada, aunque aún tenga OC abierta. */
  if (gridIsReviewedV3(index)) {
    return "reviewed";
  }

  return "active";
}

function gridBodyV3(category) {
  if (category === "reviewed") {
    return $("pg-reviewed-body");
  }

  if (category === "closed") {
    return $("pg-closed-body");
  }

  return $("pg-active-body");
}

function gridNodeIndexV3(node) {
  const a = node.dataset.gridGroup;
  const b = node.dataset.gridLoading;

  return Number(a ?? b ?? 999999);
}

function gridInsertOrderedV3(body, node, index) {
  if (!body || !node) return;

  const before = [...body.children].find(
    (x) => gridNodeIndexV3(x) > index
  );

  body.insertBefore(node, before || null);
}

function gridUpdateCountsV3() {
  let active = 0;
  let reviewed = 0;
  let closed = 0;

  for (
    let index = 0;
    index < trackState.list.length;
    index++
  ) {
    const c = gridPlateCategoryV3(index);

    if (c === "closed") closed++;
    else if (c === "reviewed") reviewed++;
    else active++;
  }

  const a = $("pg-active-count");
  const r = $("pg-reviewed-count");
  const c = $("pg-closed-count");

  if (a) a.textContent = active;
  if (r) r.textContent = reviewed;
  if (c) c.textContent = closed;

  const top = $("pg-active-summary");

  if (top) {
    top.classList.toggle(
      "complete",
      active === 0
    );
  }
}

function gridPlaceUnitV3(index) {
  const category = gridPlateCategoryV3(index);
  const target = gridBodyV3(category);

  const node =
    document.querySelector(
      `[data-grid-group="${index}"]`
    ) ||
    document.querySelector(
      `[data-grid-loading="${index}"]`
    );

  if (!target || !node) {
    gridUpdateCountsV3();
    return;
  }

  gridInsertOrderedV3(
    target,
    node,
    index
  );

  gridUpdateCountsV3();
  highlightPlateGridV3();
}

function gridRefreshReviewVisualV3(index) {
  const group = document.querySelector(
    `[data-grid-group="${index}"]`
  );

  if (!group) return;

  const reviewed = gridIsReviewedV3(index);

  group
    .querySelectorAll(".pg-oc-row")
    .forEach((row) => {
      row.classList.toggle(
        "pg-reviewed",
        reviewed
      );
    });

  const tab =
    group.querySelector(".pg-oc-tab");

  const button =
    group.querySelector(
      "[data-grid-review]"
    );

  tab?.classList.toggle(
    "done",
    reviewed
  );

  button?.classList.toggle(
    "done",
    reviewed
  );
}

function gridToggleSectionV3(category) {
  const body = gridBodyV3(category);

  const button = document.querySelector(
    `[data-grid-section-toggle="${category}"]`
  );

  if (!body || !button) return;

  const willOpen =
    body.classList.contains("hidden");

  body.classList.toggle(
    "hidden",
    !willOpen
  );

  button.classList.toggle(
    "open",
    willOpen
  );

  const word =
    button.querySelector(
      ".pg-toggle-word"
    );

  if (word) {
    word.textContent =
      willOpen ? "OCULTAR ▲" : "VER ▼";
  }
}


/* === PRUEBA GRILLA 06.1 · AJUSTES VISUALES === */

let gridReviewDelayV3 = new Set();


let closedHistoryStateV3 = {
  key: "",
  tracto: "",
  ocs: [],
  shown: 0,
};


function historyTractoKeyV3(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^20-/, "")
    .replace(/\s+/g, "");
}


function historyInputV3(
  id,
  label,
  key,
  value,
  paste = false
) {
  return `
    <label class="pg-field">
      <span>${label}</span>

      <div class="
        ${paste
          ? "pg-input-paste"
          : "pg-history-normal"}
      ">
        <input
          id="${id}"
          data-history-key="${key}"
          value="${esc(
            String(value ?? "")
          )}"
        >

        ${
          paste
            ? `
              <button
                type="button"
                data-grid-paste="${id}"
                title="Pegar"
              >
                📋
              </button>`
            : ""
        }
      </div>
    </label>`;
}


function historicalOcCardV3(
  x,
  position
) {
  const p =
    x.payload || {};

  const parihuelas =
    isParihuelasV3(p);

  const id =
    Number(x.id);

  return `
    <article
      class="
        pg-history-card
        ${parihuelas
          ? "pg-parihuelas"
          : ""}
      "
      data-history-id="${id}"
    >

      <div class="pg-history-top">

        <div class="pg-history-title">
          <small>
            ${position}.
            ${esc(
              shortTractoV3(
                p.TRACTO || ""
              )
            )}
          </small>

          <span>OC</span>

          <strong>
            ${esc(
              x.orden_carga || "—"
            )}
          </strong>

          <b>
            ${esc(p.Ruta || "—")}
          </b>
        </div>

        ${
          parihuelas
            ? `
              <span class="pg-special-tag">
                PARIHUELAS
              </span>`
            : ""
        }

        <div class="pg-history-actions">

          <span class="pg-history-closed">
            CERRADA
          </span>

          <button
            type="button"
            class="pg-history-save"
            data-history-save="${id}"
          >
            💾 GUARDAR
          </button>

        </div>

      </div>


      <div class="pg-history-state">

        <label class="pg-field">
          <span>ESTADO</span>

          ${stateSelectV3(
            field(p, "ESTADO"),
            'data-history-key="estado_fisico"'
          )}
        </label>

      </div>


      <div class="pg-history-salida">
        ${historyInputV3(
          `ph-${id}-salida`,
          "SALIDA DE PLANTA",
          "salida_planta",
          field(
            p,
            "FECHA DE SALIDA PLANTA YURA/CARACOTO"
          ),
          true
        )}
      </div>


      <div class="pg-history-llegada">
        ${historyInputV3(
          `ph-${id}-llegada`,
          "LLEGADA A DESTINO",
          "llegada_destino",
          field(
            p,
            "FECHA LLEGADA A DESTINO"
          ),
          true
        )}
      </div>


      <div class="pg-history-carga">
        ${historyInputV3(
          `ph-${id}-carga`,
          "CARGA DE RETORNO",
          "carga_retorno",
          field(
            p,
            "CARGA DE RETORNO"
          )
        )}
      </div>


      <div class="pg-history-retorno">
        ${historyInputV3(
          `ph-${id}-retorno`,
          "INICIO DE RETORNO",
          "inicio_retorno",
          field(
            p,
            "FECHA INICIO DE RETORNO"
          ),
          true
        )}
      </div>


      <div class="pg-history-fin">
        ${historyInputV3(
          `ph-${id}-fin`,
          "FIN DE RETORNO",
          "fin_de_ciclo",
          field(
            p,
            "FECHA FIN DE RETORNO AQP/YURA/CRCT"
          ),
          true
        )}
      </div>


      <div class="pg-history-location">
        ${historyInputV3(
          `ph-${id}-ubicacion`,
          "UBICACIÓN",
          "ubicacion",
          field(
            p,
            "UBICACIÓN"
          ),
          true
        )}
      </div>


      <label class="pg-history-observation pg-field">

        <span>OBSERVACIONES</span>

        <textarea
          data-history-key="observaciones"
        >${esc(
          field(
            p,
            "OBSERVACIONES"
          )
        )}</textarea>

      </label>

    </article>`;
}


function collectHistoricalDataV3(card) {
  const datos = {};

  card
    .querySelectorAll(
      "[data-history-key]"
    )
    .forEach((el) => {
      datos[
        el.dataset.historyKey
      ] = el.value;
    });

  return datos;
}


async function saveHistoricalOcV3(button) {
  const card =
    button.closest(
      ".pg-history-card"
    );

  if (!card) return;

  const id =
    Number(
      card.dataset.historyId
    );

  if (!Number.isInteger(id))
    return;

  button.disabled = true;
  button.classList.add(
    "saving"
  );

  try {

    const result =
      await trackApi({
        action:
          "guardar_cerrada",

        id,

        datos:
          collectHistoricalDataV3(
            card
          )
      });

    card.classList.add(
      "pg-history-saved"
    );

    card.classList.remove(
      "pg-history-dirty"
    );

    button.classList.add(
      "done"
    );

    button.textContent =
      result.cambios
        ? "✓ GUARDADO"
        : "✓ SIN CAMBIOS";

  } catch (e) {

    alert(
      e?.message ||
      "No se pudo guardar la OC cerrada."
    );

  } finally {

    button.disabled = false;
    button.classList.remove(
      "saving"
    );
  }
}


function renderClosedHistoryV3() {
  const host =
    $("pg-history-results");

  const status =
    $("pg-history-status");

  const button =
    $("pg-history-show");

  if (
    !host ||
    !status ||
    !button
  ) return;

  const visible =
    closedHistoryStateV3.ocs.slice(
      0,
      closedHistoryStateV3.shown
    );

  host.innerHTML =
    visible
      .map((x, i) =>
        historicalOcCardV3(
          x,
          i + 1
        )
      )
      .join("");

  if (
    !closedHistoryStateV3.ocs.length
  ){
    status.textContent =
      closedHistoryStateV3.key
        ? "No se encontraron OCs cerradas para ese tracto."
        : "";

    button.textContent =
      "MOSTRAR";

    button.disabled =
      false;

    return;
  }

  status.textContent =
    `MOSTRANDO ${visible.length} DE ` +
    `${closedHistoryStateV3.ocs.length} OCs CERRADAS`;

  button.textContent =
    visible.length
      ? "MOSTRAR OTRA"
      : "MOSTRAR";

  button.disabled =
    visible.length >=
    closedHistoryStateV3.ocs.length;
}


async function loadNextClosedHistoryV3() {
  const input =
    $("pg-history-tracto");

  const button =
    $("pg-history-show");

  const status =
    $("pg-history-status");

  if (
    !input ||
    !button ||
    !status
  ) return;

  const tracto =
    input.value.trim();

  if (!tracto) {
    alert(
      "Ingrese un tracto, por ejemplo R-510."
    );

    input.focus();
    return;
  }

  const key =
    historyTractoKeyV3(
      tracto
    );

  button.disabled = true;

  try {

    if (
      closedHistoryStateV3.key !==
      key
    ){
      status.textContent =
        "Buscando OCs cerradas…";

      const data =
        await trackApi({
          action:
            "cerradas_por_tracto",

          tracto
        });

      closedHistoryStateV3 = {
        key,
        tracto,
        ocs:
          data.ocs || [],
        shown: 0
      };
    }

    if (
      closedHistoryStateV3.shown <
      closedHistoryStateV3.ocs.length
    ){
      closedHistoryStateV3.shown++;
    }

    renderClosedHistoryV3();

  } catch (e) {

    status.textContent =
      e?.message ||
      "No se pudo consultar el histórico.";

    button.disabled = false;
  }
}


function resetClosedHistoryV3() {
  closedHistoryStateV3 = {
    key: "",
    tracto: "",
    ocs: [],
    shown: 0
  };

  const input =
    $("pg-history-tracto");

  const results =
    $("pg-history-results");

  const status =
    $("pg-history-status");

  const button =
    $("pg-history-show");

  if (input)
    input.value = "";

  if (results)
    results.innerHTML = "";

  if (status)
    status.textContent = "";

  if (button) {
    button.disabled = false;
    button.textContent = "MOSTRAR";
  }
}


/* ------------------------------------------------------------
   AL EDITAR, GUARDAR VUELVE A PENDIENTE
   ------------------------------------------------------------ */

function gridMarkDirtyV3(target) {
  const row =
    target.closest(
      ".pg-oc-row[data-grid-oc-id]"
    );

  if (!row) return;

  const id =
    Number(
      row.dataset.gridOcId
    );

  if (!Number.isInteger(id))
    return;

  gridDirtyPreviewV3.add(id);
  gridSavedPreviewV3.delete(id);

  row.classList.remove(
    "pg-saved"
  );

  row
    .querySelector(
      "[data-grid-save]"
    )
    ?.classList.remove(
      "done"
    );
}


/* ------------------------------------------------------------
   RENDER GENERAL
   ------------------------------------------------------------ */

function renderPlateGridV3() {
  const host =
    $("plate-grid");

  if (!host) return;

  host.innerHTML = `
    <div class="pg-toolbar">

      <button
        type="button"
        id="pg-history-toggle"
        class="pg-history-toggle"
      >
        <span>
          REVISAR OCs CERRADAS
        </span>

        <strong id="pg-history-arrow">
          ▼
        </strong>
      </button>

      <div
        id="pg-active-summary"
        class="pg-active-summary"
      >
        ACTIVAS ·
        <strong id="pg-active-count">
          0
        </strong>
        PLACAS
      </div>

    </div>


    <div
      id="pg-history-panel"
      class="pg-history-panel hidden"
    >

      <div class="pg-history-search">

        <label>
          <span>TRACTO</span>

          <input
            id="pg-history-tracto"
            placeholder="R-510"
            autocomplete="off"
          >
        </label>

        <button
          type="button"
          id="pg-history-show"
        >
          MOSTRAR
        </button>

        <button
          type="button"
          id="pg-history-clear"
          class="secondary"
        >
          LIMPIAR
        </button>

      </div>

      <small class="pg-history-help">
        Cada clic en MOSTRAR agrega una OC cerrada anterior,
        desde la más reciente hacia atrás.
      </small>

      <div
        id="pg-history-status"
        class="pg-history-status"
      ></div>

      <div
        id="pg-history-results"
        class="pg-history-results"
      ></div>

    </div>


    <div class="plate-grid-scroll">

      <section
        class="
          pg-flow-section
          pg-section-active
        "
      >

        <header
          class="pg-flow-active-title"
        >
          <b>ACTIVAS</b>

          <span>
            <strong
              id="pg-active-count-secondary"
            >
              —
            </strong>

            SIGUIENTES POR REVISAR
          </span>
        </header>

        <div
          id="pg-active-body"
          class="pg-section-body"
        ></div>

      </section>


      <section
        class="
          pg-flow-section
          pg-section-reviewed
        "
      >

        <button
          type="button"
          class="
            pg-section-toggle
            reviewed
          "
          data-grid-section-toggle="reviewed"
        >
          <span>
            REVISADAS ·
            <b id="pg-reviewed-count">
              0
            </b>
            PLACAS
          </span>

          <span class="pg-toggle-line"></span>

          <strong class="pg-toggle-word">
            VER ▼
          </strong>
        </button>

        <div
          id="pg-reviewed-body"
          class="
            pg-section-body
            hidden
          "
        ></div>

      </section>


      <section
        class="
          pg-flow-section
          pg-section-closed
        "
      >

        <button
          type="button"
          class="
            pg-section-toggle
            closed
          "
          data-grid-section-toggle="closed"
        >
          <span>
            CERRADAS ·
            <b id="pg-closed-count">
              0
            </b>
            PLACAS
          </span>

          <span class="pg-toggle-line"></span>

          <strong class="pg-toggle-word">
            VER ▼
          </strong>
        </button>

        <div
          id="pg-closed-body"
          class="
            pg-section-body
            hidden
          "
        ></div>

      </section>

    </div>`;

  trackState.list.forEach(
    (_, index) => {

      const tmp =
        document.createElement(
          "div"
        );

      tmp.innerHTML =
        plateGridSkeletonV3(
          index
        ).trim();

      const node =
        tmp.firstElementChild;

      const target =
        gridBodyV3(
          gridPlateCategoryV3(
            index
          )
        );

      gridInsertOrderedV3(
        target,
        node,
        index
      );
    }
  );

  gridUpdateCountsV3();

  const secondary =
    $("pg-active-count-secondary");

  const primary =
    $("pg-active-count");

  if (
    secondary &&
    primary
  ){
    secondary.textContent =
      primary.textContent;
  }


  /* Por defecto el mapa corresponde
     a la primera ACTIVA. */

  gridMapIndexV3 =
    firstActiveGridIndexV3();

  if (
    gridMapIndexV3 < 0 &&
    trackState.list.length
  ){
    gridMapIndexV3 = 0;
  }

  ensureRouteUnitHeaderV3();
  syncRouteMapUnitV3(
    gridMapIndexV3
  );


  $("pg-history-toggle").onclick =
    () => {

      const panel =
        $("pg-history-panel");

      const arrow =
        $("pg-history-arrow");

      const open =
        panel.classList.contains(
          "hidden"
        );

      panel.classList.toggle(
        "hidden",
        !open
      );

      arrow.textContent =
        open ? "▲" : "▼";
    };


  $("pg-history-show").onclick =
    loadNextClosedHistoryV3;


  $("pg-history-clear").onclick =
    resetClosedHistoryV3;


  $("pg-history-tracto").onkeydown =
    (event) => {

      if (
        event.key === "Enter"
      ){
        event.preventDefault();

        loadNextClosedHistoryV3();
      }
    };


  host.oninput =
    (event) => {

      const history =
        event.target.closest(
          ".pg-history-card"
        );

      if (history) {
        history.classList.add(
          "pg-history-dirty"
        );

        const btn =
          history.querySelector(
            "[data-history-save]"
          );

        btn?.classList.remove(
          "done"
        );

        if (btn)
          btn.textContent =
            "💾 GUARDAR";

        return;
      }

      gridMarkDirtyV3(
        event.target
      );
    };


  host.onchange =
    (event) => {

      if (
        event.target.matches(
          ".pg-state-select-wrap select"
        )
      ){
        syncStateSelectV3(
          event.target
        );
      }

      const history =
        event.target.closest(
          ".pg-history-card"
        );

      if (history) {
        history.classList.add(
          "pg-history-dirty"
        );

        const btn =
          history.querySelector(
            "[data-history-save]"
          );

        btn?.classList.remove(
          "done"
        );

        if (btn)
          btn.textContent =
            "💾 GUARDAR";

        return;
      }

      gridMarkDirtyV3(
        event.target
      );
    };


  host.onclick =
    async (event) => {

      const toggle =
        event.target.closest(
          "[data-grid-section-toggle]"
        );

      if (toggle) {
        gridToggleSectionV3(
          toggle.dataset
            .gridSectionToggle
        );

        return;
      }


      const paste =
        event.target.closest(
          "[data-grid-paste]"
        );

      if (paste) {
        event.stopPropagation();

        await pasteField(
          paste.dataset.gridPaste
        );

        /*
         * pasteField dispara input
         * en la implementación actual.
         */
        return;
      }


      const historySave =
        event.target.closest(
          "[data-history-save]"
        );

      if (historySave) {
        event.stopPropagation();

        await saveHistoricalOcV3(
          historySave
        );

        return;
      }


      const review =
        event.target.closest(
          "[data-grid-review]"
        );

      if (review) {
        event.stopPropagation();

        const index =
          Number(
            review.dataset.gridReview
          );

        if (
          !Number.isInteger(index)
        ){
          return;
        }

        if (
          gridReviewingPreviewV3.has(
            index
          )
        ){
          return;
        }

        /*
         * Si ya está revisada,
         * no la desmarcamos por accidente.
         */
        if (
          gridIsReviewedV3(index)
        ){
          return;
        }

        const u =
          trackState.list[index];

        if (!u) return;

        gridReviewingPreviewV3.add(
          index
        );

        review.disabled = true;

        try {

          /*
           * REGLA:
           * antes de REVISAR,
           * guardar todas las OCs
           * modificadas de esa placa.
           */
          const saved =
            await savePendingPlateV3(
              index
            );

          if (!saved) {
            throw Error(
              "No se pudieron guardar todos los cambios."
            );
          }

          await trackApi({
            action:
              "marcar_revisada",

            placa:
              u.placa
          });

          const key =
            gridPlateKeyV3(index);

          gridReviewedPreviewV3.add(
            key
          );

          /*
           * Primero se ve el check verde.
           */
          gridRefreshReviewVisualV3(
            index
          );

          review.classList.add(
            "review-delay"
          );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                700
              )
          );

          /*
           * Recién después sale
           * de ACTIVAS.
           */
          gridPlaceUnitV3(
            index
          );

          /*
           * Si era la unidad en mapa,
           * pasamos automáticamente
           * a la siguiente ACTIVA.
           */
          if (
            gridMapIndexV3 === index
          ){
            const next =
              firstActiveGridIndexV3();

            if (
              next >= 0 &&
              next !== index
            ){
              await loadTrackingUnitV2(
                next
              );

              syncRouteMapUnitV3(
                next
              );
            }
          }

        } catch (e) {

          alert(
            e?.message ||
            "No se pudo marcar la placa como revisada."
          );

        } finally {

          review.disabled = false;

          review.classList.remove(
            "review-delay"
          );

          gridReviewingPreviewV3.delete(
            index
          );
        }

        return;
      }


      const save =
        event.target.closest(
          "[data-grid-save]"
        );

      if (save) {
        event.stopPropagation();

        const row =
          save.closest(
            ".pg-oc-row"
          );

        try {

          await saveGridOcV3(
            row
          );

        } catch (e) {

          alert(
            e?.message ||
            "No se pudo guardar la OC."
          );
        }

        return;
      }


      const close =
        event.target.closest(
          "[data-grid-close]"
        );

      if (close) {
        event.stopPropagation();

        const id =
          Number(
            close.dataset.gridClose
          );

        if (
          gridClosedPreviewV3.has(id)
        ){
          gridClosedPreviewV3.delete(
            id
          );
        } else {
          gridClosedPreviewV3.add(
            id
          );
        }

        const row =
          close.closest(
            ".pg-oc-row"
          );

        const closed =
          gridClosedPreviewV3.has(
            id
          );

        row?.classList.toggle(
          "pg-closed",
          closed
        );

        close.classList.toggle(
          "done",
          closed
        );

        const group =
          close.closest(
            "[data-grid-group]"
          );

        const index =
          Number(
            group?.dataset.gridGroup
          );

        if (
          Number.isInteger(index)
        ){
          gridPlaceUnitV3(
            index
          );
        }

        return;
      }


      const select =
        event.target.closest(
          "[data-grid-select]"
        );

      if (select) {
        event.stopPropagation();

        const index =
          Number(
            select.dataset.gridSelect
          );

        if (
          Number.isInteger(index)
        ){
          await loadTrackingUnitV2(
            index
          );

          syncRouteMapUnitV3(
            index
          );

          highlightPlateGridV3();
        }

        return;
      }


      if (
        event.target.closest(
          "input, textarea, select, button"
        )
      ){
        return;
      }


      const row =
        event.target.closest(
          "[data-grid-index]"
        );

      if (!row) return;

      const index =
        Number(
          row.dataset.gridIndex
        );

      if (
        !Number.isInteger(index)
      ){
        return;
      }

      await loadTrackingUnitV2(
        index
      );

      syncRouteMapUnitV3(
        index
      );

      highlightPlateGridV3();
    };
}


/* ------------------------------------------------------------
   CARGA DE DETALLES
   ------------------------------------------------------------ */

async function loadPlateGridDetailsV3(
  runId
) {
  const queue =
    trackState.list.map(
      (_, index) => index
    );

  async function worker() {

    while (queue.length) {

      if (
        runId !==
        plateGridRunV3
      ){
        return;
      }

      const index =
        queue.shift();

      const u =
        trackState.list[index];

      if (!u) continue;

      try {

        const detail =
          await trackApi({
            action: "detalle",
            placa: u.placa
          });

        if (
          runId !==
          plateGridRunV3
        ){
          return;
        }

        plateGridDetailsV3.set(
          nplate(u.placa),
          detail
        );

        const loading =
          document.querySelector(
            `[data-grid-loading="${index}"]`
          );

        if (loading) {

          const tmp =
            document.createElement(
              "div"
            );

          tmp.innerHTML =
            plateGridGroupV3(
              index,
              detail
            ).trim();

          loading.replaceWith(
            tmp.firstElementChild
          );
        }

        gridPlaceUnitV3(
          index
        );

        highlightMapUnitGridV3();

        const secondary =
          $("pg-active-count-secondary");

        const primary =
          $("pg-active-count");

        if (
          secondary &&
          primary
        ){
          secondary.textContent =
            primary.textContent;
        }

      } catch (e) {

        const loading =
          document.querySelector(
            `[data-grid-loading="${index}"]`
          );

        const body =
          loading?.querySelector(
            ".pg-loading-body"
          );

        if (body) {
          body.textContent =
            "ERROR AL CARGAR";
        }
      }
    }
  }

  await Promise.all([
    worker(),
    worker(),
    worker()
  ]);

  gridUpdateCountsV3();

  highlightPlateGridV3();
  highlightMapUnitGridV3();

  /*
   * Sin lista horizontal:
   * la primera ACTIVA es la unidad
   * inicial que carga el mapa.
   */
  const first =
    firstActiveGridIndexV3();

  if (first >= 0) {
    try {

      await loadTrackingUnitV2(
        first
      );

      syncRouteMapUnitV3(
        first
      );

    } catch (_) {}
  }
}

function resizeTrackingMapV3() {
  try {
    const map = trackState.map;

    if (!map) return;

    const center =
      typeof map.getCenter === "function"
        ? map.getCenter()
        : null;

    if (
      window.google?.maps?.event &&
      map
    ) {
      google.maps.event.trigger(
        map,
        "resize"
      );
    }

    if (
      typeof map.invalidateSize === "function"
    ) {
      map.invalidateSize();
    }

    if (
      center &&
      typeof map.setCenter === "function"
    ) {
      map.setCenter(center);
    }

  } catch (_) {}
}

function applyTrackingSplitV3() {
  const main =
    document.querySelector(
      ".desktop-tracking.grid-03 > main"
    );

  if (!main) return;

  main.style.gridTemplateColumns =
    `minmax(300px, ${trackingSplitV3.mapa}fr) ` +
    `7px ` +
    `minmax(580px, ${trackingSplitV3.grilla}fr) ` +
    `7px ` +
    `minmax(165px, ${trackingSplitV3.gps}fr)`;

  requestAnimationFrame(
    resizeTrackingMapV3
  );
}

function saveTrackingSplitV3() {
  try {
    localStorage.setItem(
      "cemento_tracking_split_v3",
      JSON.stringify(trackingSplitV3),
    );
  } catch (_) {}
}

function loadTrackingSplitV3() {
  try {
    const raw =
      localStorage.getItem(
        "cemento_tracking_split_v3"
      );

    if (!raw) return;

    const x = JSON.parse(raw);

    if (
      Number.isFinite(x?.mapa) &&
      Number.isFinite(x?.grilla) &&
      Number.isFinite(x?.gps)
    ) {
      trackingSplitV3 = {
        mapa: x.mapa,
        grilla: x.grilla,
        gps: x.gps,
      };
    }

  } catch (_) {}
}

function initTrackingSplitV3() {
  const shell =
    document.querySelector(
      ".desktop-tracking.grid-03"
    );

  const main =
    shell?.querySelector(":scope > main");

  const center =
    main?.querySelector(".track-center");

  const right =
    main?.querySelector(".track-right");

  if (!main || !center || !right) return;

  main
    .querySelectorAll(".tracking-splitter")
    .forEach((x) => x.remove());

  const split1 =
    document.createElement("div");

  split1.className =
    "tracking-splitter";

  split1.title =
    "Redimensionar mapa / grilla";

  const split2 =
    document.createElement("div");

  split2.className =
    "tracking-splitter";

  split2.title =
    "Redimensionar grilla / GPS";

  main.insertBefore(split1, center);
  main.insertBefore(split2, right);

  loadTrackingSplitV3();
  applyTrackingSplitV3();

  const startDrag = (which, event) => {

    event.preventDefault();

    document.body.classList.add(
      "tracking-resizing"
    );

    const move = (ev) => {

      const rect =
        main.getBoundingClientRect();

      const usable =
        rect.width - 14;

      if (usable <= 0) return;

      if (which === 1) {

        let mapa =
          ((ev.clientX - rect.left) /
            usable) *
          100;

        mapa =
          Math.max(
            24,
            Math.min(48, mapa),
          );

        let gps =
          trackingSplitV3.gps;

        let grilla =
          100 - mapa - gps;

        if (grilla < 36) {
          grilla = 36;
          mapa =
            100 - grilla - gps;
        }

        trackingSplitV3 = {
          mapa,
          grilla,
          gps,
        };

      } else {

        let gps =
          ((rect.right - ev.clientX) /
            usable) *
          100;

        gps =
          Math.max(
            10,
            Math.min(28, gps),
          );

        let mapa =
          trackingSplitV3.mapa;

        let grilla =
          100 - mapa - gps;

        if (grilla < 36) {
          grilla = 36;
          gps =
            100 - mapa - grilla;
        }

        trackingSplitV3 = {
          mapa,
          grilla,
          gps,
        };
      }

      applyTrackingSplitV3();
    };

    const stop = () => {

      document.body.classList.remove(
        "tracking-resizing"
      );

      document.removeEventListener(
        "pointermove",
        move,
      );

      document.removeEventListener(
        "pointerup",
        stop,
      );

      saveTrackingSplitV3();
      resizeTrackingMapV3();
    };

    document.addEventListener(
      "pointermove",
      move,
    );

    document.addEventListener(
      "pointerup",
      stop,
    );
  };

  split1.onpointerdown =
    (e) => startDrag(1, e);

  split2.onpointerdown =
    (e) => startDrag(2, e);
}

function initPlateGridV3() {
  plateGridRunV3++;

  const runId =
    plateGridRunV3;

  plateGridDetailsV3.clear();
  gridReviewedPreviewV3.clear();
  gridClosedPreviewV3.clear();
  gridSavedPreviewV3.clear();

  renderPlateGridV3();
  initTrackingSplitV3();

  loadPlateGridDetailsV3(runId);
}


async function seguimientoV2() {
  navState("seguimiento");
  document.body.classList.add("tracking-active");
  loading();
  const meta = activeMeta();
  await purgeGPSExcept(meta?.id || null);
  const data = await trackApi({ action: "lista" }),
    reviewed = new Set(),
    rank = (u) => {
      const state = meta?.resultados?.[nplate(u.placa)]?.estado;
      return state === "COMPLETO" ? 0 : state === "SIN MOVIMIENTO" ? 2 : 1;
    },
    list = [...(data.placas || [])].sort((a, b) => rank(a) - rank(b));
  trackState = {
    list,
    index: 0,
    reviewed,
    map: null,
    overlays: [],
    inspectionMarkers: [],
    inspectionEnabled: false,
    infoWindow: null,
    mapConfig: null,
    currentGps: null,
    currentDetail: null,
    currentPlateKey: "",
    showClosed: false,
    orderLocked: true,
    v2: true,
    v3: true,
  };
  const firstPending = list.findIndex((u) => !reviewed.has(nplate(u.placa)));
  trackState.index = firstPending >= 0 ? firstPending : 0;
  $("content").innerHTML = `<section class="desktop-tracking v2 v3 grid-test grid-03"><header><div><b>CEMENTO · SEGUIMIENTO · VERSIÓN 3</b><small>Revisión persistente · corte parcial disponible</small></div><span id="preload-global">PRECARGA</span><span id="plate-position">PLACA 0/${list.length}</span><span id="review-count">REVISADAS ${reviewed.size}/${list.length}</span><button id="save-partial">GUARDAR PARCIAL</button><button id="save-all">TERMINAR SEGUIMIENTO</button><button id="exit-track">PAUSAR Y VOLVER</button></header><main><section class="track-left"><div class="plate-nav"><button id="prev">◀</button><div id="plate-strip"></div><button id="next">▶</button></div><div class="route-refresh"><label><span>DESDE</span><input id="route-from" type="datetime-local" step="1"></label><label><span>HASTA</span><input id="route-to" type="datetime-local" step="1"></label><button id="refresh-route">ACTUALIZAR RECORRIDO</button><small id="route-update-status">USA LA PRECARGA DISPONIBLE</small></div><div class="tracking-map-wrap"><div id="tracking-map"></div><button id="view-hours">VER HORAS</button></div><footer><b>RECORRIDO ANALIZADO</b><span id="map-caption">Buscando caché temporal…</span></footer></section><section class="track-center"><div class="unit-head"><div><small>TRACTO</small><strong id="unit-name">—</strong><span id="unit-sub">—</span></div><button id="reviewed">REVISADA</button></div><div class="last-closed"><small>ÚLTIMA OC CERRADA</small><b id="last-closed">—</b></div><div class="oc-view-tools"><button id="toggle-closed" class="hidden">MOSTRAR CERRADAS</button></div><div id="plate-grid"></div><div id="oc-list" class="grid-hidden-oc-list"></div></section><section class="track-right"><header><b>SECUENCIA DE EVENTOS GPS</b></header><div id="gps-events"></div></section></main></section>`;
  preloadBg.meta = meta;
  preloadBg.units = list;
  renderBg();
  paintStripV2();
  initPlateGridV3();
  $("prev").onclick = () => loadTrackingUnitV2(trackState.index - 1);
  $("next").onclick = () => loadTrackingUnitV2(trackState.index + 1);
  $("reviewed").onclick = async () => {
    const b = $("reviewed"),
      u = trackState.list[trackState.index];
    if (trackState.reviewed.has(nplate(u.placa))) return;
    b.disabled = true;
    try {
      await markReviewedV2(u.placa, true);
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      updateReviewedButtonV2();
    }
  };
  $("toggle-closed").onclick = () => {
    trackState.showClosed = !trackState.showClosed;
    renderOcListV2(trackState.currentDetail);
  };
  $("refresh-route").onclick = refreshCurrentRouteV2;
  $("exit-track").onclick = () => {
    captureTrackingDraftV2(trackState.currentPlateKey);
    if (visibleUnsaved().length)
      return alert("La OC visible tiene cambios sin GUARDAR OC.");
    document.body.classList.remove("tracking-active");
    go("home");
  };
  $("save-partial").onclick = async () => {
    captureTrackingDraftV2(trackState.currentPlateKey);
    const b = $("save-partial");
    const reviewedNow = trackState.reviewed.size;
    const totalNow = trackState.list.length;
    if (!(await appConfirm(
      `GUARDAR PARCIAL\n\nSe registrará un corte de ${reviewedNow}/${totalNow} placas revisadas.\n` +
      `Las ediciones y cierres preparados hasta este momento se consolidarán.\n\n` +
      `Después podrá generar un reporte parcial o continuar revisando.\n\n¿Continuar?`,
      { okText: "GUARDAR PARCIAL" },
    ))) return;
    b.disabled = true;
    b.textContent = "GUARDANDO…";
    try {
      for (const card of visibleUnsaved())
        await trackApi({ action: "guardar", id: +card.dataset.id, datos: formData(card) });
      const x = await trackApi({
        action: "guardar_parcial",
        revisadas: [...trackState.reviewed],
      });
      const when = new Date(x.guardado_en).toLocaleString("es-PE");
      const goReport = await appConfirm(
        `Guardado parcial registrado: ${x.revisadas}/${x.total_placas} placas revisadas.\n` +
        `Corte: ${when}\nEditadas: ${x.guardadas} · Cerradas: ${x.cerradas}\n\n` +
        `CREAR REPORTE ya está disponible.\n\n¿Ir ahora a Crear Reporte?`,
        { okText: "IR A REPORTE", cancelText: "SEGUIR REVISANDO" },
      );
      if (goReport) {
        document.body.classList.remove("tracking-active");
        await go("reporte");
      } else {
        await seguimientoV2();
      }
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "GUARDAR PARCIAL";
    }
  };
  $("save-all").onclick = async () => {
    captureTrackingDraftV2(trackState.currentPlateKey);
    if (trackState.reviewed.size !== trackState.list.length)
      return alert(
        `Seguimiento incompleto: ${trackState.reviewed.size}/${trackState.list.length} placas revisadas.`,
      );
    const b = $("save-all");
    b.disabled = true;
    b.textContent = "TERMINANDO…";
    try {
      for (const card of visibleUnsaved())
        await trackApi({ action: "guardar", id: +card.dataset.id, datos: formData(card) });
      const x = await trackApi({
        action: "consolidar",
        revisadas: [...trackState.reviewed],
      });
      clearReviewCaches();
      alert(
        `Seguimiento terminado: ${x.revisadas}/${x.total_placas} placas revisadas, ${x.guardadas} editadas y ${x.cerradas} cerradas.`,
      );
      document.body.classList.remove("tracking-active");
      await go("reporte");
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "TERMINAR SEGUIMIENTO";
    }
  };
  // Las unidades SIN MOVIMIENTO siguen siendo revisadas automáticamente, pero
  // ahora la marca también se guarda en el temporal de Supabase.
  for (const u of list) {
    if (meta?.resultados?.[nplate(u.placa)]?.estado === "SIN MOVIMIENTO" && !reviewed.has(nplate(u.placa))) {
      try {
        await markReviewedV2(u.placa, false);
      } catch (e) {
        console.warn("No se pudo persistir revisión automática", u.placa, e);
      }
    }
  }
  try {
    await initTrackingMap();
  } catch (e) {
    $("tracking-map").innerHTML = `<div class="map-error">${esc(e.message)}</div>`;
  }
  if (list.length) await loadTrackingUnitV2(trackState.index);
  else {
    $("oc-list").innerHTML = '<div class="track-empty-ocs"><b>SIN UNIDADES PENDIENTES</b></div>';
    $("gps-events").innerHTML = '<p>Sin unidades pendientes.</p>';
  }
}
routes.seguimiento = seguimientoV2;


// =============================================================================
// ITINERARIOS WEB · VERSIÓN 3
// Reporte habilitable con corte PARCIAL o COMPLETO.
// =============================================================================
async function confirmPartialReportV3(state) {
  if (state?.estado !== "PARCIAL") return true;
  const when = state.completado_en
    ? new Date(state.completado_en).toLocaleString("es-PE")
    : "sin fecha";
  return appConfirm(
    `SEGUIMIENTO PARCIAL\n\n` +
      `Se revisaron ${state.revisadas} de ${state.total_placas} placas con OC abiertas.\n` +
      `Último guardado parcial: ${when}.\n\n` +
      `El reporte se generará con el estado consolidado hasta ese corte.\n` +
      `La decisión de descargarlo es del operador.\n\n¿Desea continuar?`,
    { okText: "GENERAR DE TODAS FORMAS" },
  );
}
async function reporteV3() {
  navState("reporte");
  loading();
  const state = await reportApi({ action: "estado" });
  const partial = state.estado === "PARCIAL";
  const cutText = state.completado_en
    ? new Date(state.completado_en).toLocaleString("es-PE")
    : "—";
  const noticeClass = state.habilitado
    ? partial
      ? "report-partial"
      : "report-ready"
    : "report-locked";
  const title = state.habilitado
    ? partial
      ? "SEGUIMIENTO PARCIAL · REPORTE DISPONIBLE"
      : "SEGUIMIENTO COMPLETO"
    : "REPORTE PENDIENTE DE CORTE";
  $("content").innerHTML =
    head(
      "CEMENTO · VERSIÓN 3",
      "Crear reporte",
      "Excel final y dos imágenes para correo, desde el último corte guardado.",
    ) +
    `<section class="notice ${noticeClass}"><b>${title}</b><br>${esc(state.mensaje)} · ${state.revisadas}/${state.total_placas} placas revisadas · ${state.diario} OCs abiertas.${state.completado_en ? `<br><small>ÚLTIMO CORTE: ${esc(cutText)}</small>` : ""}</section>` +
    `<div class="report-main-action"><button id="report-all" ${state.habilitado ? "" : "disabled"}>${partial ? "GENERAR REPORTE PARCIAL" : "GENERAR REPORTE COMPLETO"} · 3 ARCHIVOS</button></div>` +
    `<section class="report-downloads"><article><div>▣</div><h2>Excel operativo</h2><p>31 columnas y formato autorizado de Cemento.</p><button id="report-xlsx" ${state.habilitado ? "" : "disabled"}>DESCARGAR EXCEL</button></article><article><div>▧</div><h2>Resumen de datos</h2><p>Rutas, unidades en base y total operativo validado.</p><button id="report-data" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article><article><div>▥</div><h2>Distribución por ruta</h2><p>Resumen gráfico por ruta: cargadas y vacías.</p><button id="report-bars" ${state.habilitado ? "" : "disabled"}>DESCARGAR IMAGEN</button></article></section>`;
  if (!state.habilitado) return;

  let data;
  const getData = async () => {
    if (data === undefined) data = await reportApi({ action: "datos" });
    return data;
  };
  $("report-xlsx").onclick = async () => {
    if (!(await confirmPartialReportV3(state))) return;
    await downloadFromReport($("report-xlsx"), { action: "excel" });
  };
  $("report-data").onclick = async () => {
    if (!(await confirmPartialReportV3(state))) return;
    const b = $("report-data"), old = b.textContent;
    b.disabled = true; b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(await canvasBlob(reportCanvasData(d.resumen)), "resumen_general_de_unidades_raciemsa.png");
    } catch (e) { alert(e.message); }
    finally { b.disabled = false; b.textContent = old; }
  };
  $("report-bars").onclick = async () => {
    if (!(await confirmPartialReportV3(state))) return;
    const b = $("report-bars"), old = b.textContent;
    b.disabled = true; b.textContent = "GENERANDO…";
    try {
      const d = await getData();
      downloadBlob(await canvasBlob(reportCanvasBars(d.resumen)), "resumen_de_unidades_por_ruta.png");
    } catch (e) { alert(e.message); }
    finally { b.disabled = false; b.textContent = old; }
  };
  $("report-all").onclick = async () => {
    if (!(await confirmPartialReportV3(state))) return;
    const b = $("report-all"), old = b.textContent;
    b.disabled = true; b.textContent = "GENERANDO LOS 3 ARCHIVOS…";
    try {
      const [x, d] = await Promise.all([
        reportApi({ action: "excel" }, true),
        getData(),
      ]);
      const resumenBlob = await canvasBlob(reportCanvasData(d.resumen));
      const barrasBlob = await canvasBlob(reportCanvasBars(d.resumen));
      const folderName = x.name.replace(/\.xlsx$/i, "");
      await downloadReportZip([
        { name: x.name, blob: x.blob },
        { name: "resumen_general_de_unidades_raciemsa.png", blob: resumenBlob },
        { name: "resumen_de_unidades_por_ruta.png", blob: barrasBlob },
      ], `${folderName}.zip`, folderName);

      if (state.estado === "COMPLETO") {
        const completed = activeMeta()?.hasta || nowPEString();
        await sapApi({ action: "actualizar_corte", fecha_local: completed });
        localStorage.setItem("cemento_rango_desde", completed);
        localStorage.removeItem("cemento_precarga_activa");
        clearReviewCaches();
        await Promise.all([clearStore("sap_archivos"), purgeGPSExcept(null)]);
        alert(
          "Reporte completo generado. Se liberaron el SAP y los recorridos temporales; el siguiente rango iniciará al cierre de esta validación.",
        );
      } else {
        alert(
          `Reporte parcial generado (${state.revisadas}/${state.total_placas} placas revisadas). ` +
          "El seguimiento, la precarga y los temporales se conservan para que pueda continuar la revisión.",
        );
      }
    } catch (e) { alert(e.message); }
    finally { b.disabled = false; b.textContent = old; }
  };
}
routes.reporte = reporteV3;



/* === MONTADOS WEB FINAL · CEMENTO === */

(function(){

  const ENDPOINT =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cemento-montados";

  const PANEL_ID =
    "cemento-montados-final-panel";

  const STYLE_ID =
    "cemento-montados-final-style";


  // =========================================================
  // UTILIDADES
  // =========================================================

  function clean(v){
    return String(v ?? "")
      .replace(/\u00a0/g," ")
      .replace(/\s+/g," ")
      .trim();
  }


  function esc(v){
    return String(v ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }


  function strip(v){
    return String(v ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"");
  }


  function normPlate(v){

    const m =
      clean(v)
        .toUpperCase()
        .match(/(?:20-)?R-\d+/);


    if(!m)
      return null;


    return (
      "20-" +
      m[0].replace(/^20-/,"")
    );
  }


  function parseUnit(v){

    const x =
      strip(clean(v))
        .toUpperCase()
        .replace(/\./g,"");


    const m = x.match(
      /(?:20\s*[- ]?\s*)?R\s*[- ]?\s*(\d+)\s*\/\s*(?:20\s*[- ]?\s*)?P\s*[- ]?\s*(\d+)/
    );


    if(!m)
      return null;


    return {
      tracto:
        "20-R-" + Number(m[1]),

      acople:
        "20-P-" + Number(m[2])
    };
  }


  function normRuta(v){

    return strip(clean(v))
      .toUpperCase()
      .replace(/\s*-\s*/g," - ")
      .replace(/\s*\/\s*/g,"/")
      .replace(/\s+/g," ")
      .trim();
  }


  function isRuta(v){

    const x =
      normRuta(v);


    return (
      x &&
      /^[A-Z0-9 ]+\s-\s[A-Z0-9 /]+$/.test(x)
    );
  }


  function fechaTexto(v){

    const x =
      clean(v);


    let m =
      x.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
      );


    if(m){

      return (
        String(Number(m[1])).padStart(2,"0") +
        "/" +
        String(Number(m[2])).padStart(2,"0") +
        "/" +
        m[3]
      );
    }


    m =
      x.match(
        /^(\d{4})-(\d{2})-(\d{2})/
      );


    if(m){

      return (
        m[3] +
        "/" +
        m[2] +
        "/" +
        m[1]
      );
    }


    return null;
  }


  function fechaIso(v){

    const x =
      clean(v);


    let m =
      x.match(
        /^(\d{4})-(\d{2})-(\d{2})/
      );


    if(m){

      return (
        m[1] +
        "-" +
        m[2] +
        "-" +
        m[3]
      );
    }


    m =
      x.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
      );


    if(m){

      return (
        m[3] +
        "-" +
        String(Number(m[2])).padStart(2,"0") +
        "-" +
        String(Number(m[1])).padStart(2,"0")
      );
    }


    return null;
  }


  function parseOc(v){

    const x =
      clean(v);


    if(
      !x ||
      x === "0"
    ){
      return null;
    }


    const d =
      x.replace(/[^\d]/g,"");


    return (
      d &&
      Number(d) !== 0
    )
      ? d
      : null;
  }


  // =========================================================
  // FIREBASE
  // =========================================================

  async function getToken(){

    let user = null;


    try{

      if(
        typeof auth !== "undefined" &&
        auth?.currentUser
      ){
        user =
          auth.currentUser;
      }

    }catch{}


    try{

      if(
        !user &&
        typeof firebase !== "undefined" &&
        firebase?.auth
      ){
        user =
          firebase.auth().currentUser;
      }

    }catch{}


    if(!user){

      throw new Error(
        "No se encontró la sesión Firebase."
      );
    }


    return await user.getIdToken();
  }


  async function api(body){

    const token =
      await getToken();


    const response =
      await fetch(
        ENDPOINT,
        {
          method:"POST",

          headers:{
            "content-type":
              "application/json",

            "authorization":
              "Bearer " + token
          },

          body:
            JSON.stringify(body)
        }
      );


    const data =
      await response.json()
        .catch(()=>({}));


    if(
      !response.ok ||
      data?.error
    ){

      throw new Error(
        data?.error ||
        "Error procesando Montados"
      );
    }


    return data;
  }


  // =========================================================
  // CTRL+C / CTRL+V
  // =========================================================

  function parseRow(line, number){

    const cells =
      String(line)
        .split("\t")
        .map(clean);


    /*
      RUTA REALIZADA
    */

    const routeIndex =
      cells.findIndex(
        isRuta
      );


    const ruta =
      routeIndex >= 0
        ? normRuta(
            cells[routeIndex]
          )
        : "";


    /*
      La fecha correcta es:
      FECHA DE INICIO DE RETORNO.

      En el pegado está inmediatamente
      antes de RUTA REALIZADA.

      Completion time se ignora.
    */

    const fecha =
      routeIndex > 0
        ? fechaTexto(
            cells[
              routeIndex - 1
            ]
          )
        : null;


    /*
      1ra unidad = ACOPLE CORTO = MONTADO
      2da unidad = ACOPLE LARGO = TRANSPORTA
    */

    const units = [];


    cells.forEach(
      (cell,index)=>{

        const u =
          parseUnit(cell);


        if(u){

          units.push({
            index,
            ...u
          });
        }
      }
    );


    const corto =
      units[0] || null;


    const largo =
      units[1] || null;


    /*
      OC se conserva únicamente
      como referencia histórica.
    */

    const ocs = [];


    if(routeIndex >= 0){

      const stop =
        corto
          ? corto.index
          : cells.length;


      for(
        let i =
          routeIndex + 1;

        i < stop;

        i++
      ){

        const x =
          cells[i]
            .replace(/\s/g,"");


        if(
          /^(?:0|\d{5,7})$/.test(x)
        ){
          ocs.push(x);
        }
      }
    }


    const ocCorto =
      ocs.length >= 1
        ? parseOc(ocs[0])
        : null;


    const ocLargo =
      ocs.length >= 2
        ? parseOc(ocs[1])
        : null;


    /*
      Guía:
      se conserva como referencia,
      pero NO aparece en Seguimiento.
    */

    let guia = null;


    if(
      largo &&
      largo.index + 1 < cells.length
    ){

      const x =
        clean(
          cells[
            largo.index + 1
          ]
        );


      if(
        x &&
        x !== "0" &&
        x !== "."
      ){
        guia = x;
      }
    }


    const errores = [];


    if(!fecha)
      errores.push(
        "FECHA"
      );


    if(!ruta)
      errores.push(
        "RUTA"
      );


    if(!corto)
      errores.push(
        "ACOPLE CORTO"
      );


    if(!largo)
      errores.push(
        "ACOPLE LARGO"
      );


    return {
      number,
      fecha,
      ruta,
      corto,
      largo,
      ocCorto,
      ocLargo,
      guia,
      errores,
      valida:
        errores.length === 0
    };
  }


  function parsePaste(text){

    const rows =
      String(text || "")
        .split(/\r?\n/)
        .filter(
          x => x.trim()
        )
        .map(
          (line,index)=>
            parseRow(
              line,
              index + 1
            )
        );


    /*
      Repetición exacta:
      fecha + ruta + largo + corto.

      No resolvemos conflictos.
      Si existen relaciones diferentes,
      el controlador las verá.
    */

    const seen =
      new Set();


    rows.forEach(r=>{

      r.duplicada =
        false;


      if(!r.valida)
        return;


      const key = [
        r.fecha,
        r.ruta,
        r.largo.tracto,
        r.corto.tracto
      ].join("|");


      if(
        seen.has(key)
      ){

        r.duplicada =
          true;

      }else{

        seen.add(key);
      }
    });


    return rows;
  }


  // =========================================================
  // ESTILOS
  // =========================================================

  function installStyles(){

    if(
      document.getElementById(
        STYLE_ID
      )
    ){
      return;
    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      STYLE_ID;


    style.textContent = `


      /*
       * Ocultar únicamente presentaciones
       * TEMPORALES anteriores de Montados.
       */

      #montados-seguimiento-preview,
      .mg4-tab,
      .mg5-tab,
      .mgw-tab{
        display:none !important;
      }



      /* ==============================================
         ACTUALIZAR SAP
         ============================================== */

      #${PANEL_ID}{
        margin-top:18px;

        padding:20px;

        border:
          1px solid #20384e;

        border-radius:12px;

        background:#0a1927;

        color:#eaf4fc;
      }


      #${PANEL_ID} h3{
        margin:0 0 5px;

        font-size:20px;

        color:#fff;
      }


      #${PANEL_ID} .mgf-help{
        margin-bottom:12px;

        color:#87a2b8;

        font-size:12px;

        line-height:1.5;
      }


      #mgf-paste{
        display:block;

        width:100%;
        min-height:110px;

        padding:12px;

        resize:vertical;

        border:
          1px dashed #2da9df;

        border-radius:7px;

        outline:none;

        background:#071522;

        color:#ddecf8;

        font-family:
          Consolas,
          monospace;
      }


      .mgf-actions{
        display:flex;

        gap:8px;

        flex-wrap:wrap;

        margin-top:10px;
      }


      .mgf-button{
        padding:
          9px 14px;

        border:0;

        border-radius:6px;

        font-weight:800;

        cursor:pointer;
      }


      #mgf-save{
        background:#2cafe4;
        color:#001725;
      }


      #mgf-clear{
        background:#193147;
        color:#dcecf7;
      }


      .mgf-summary{
        display:flex;

        gap:16px;

        flex-wrap:wrap;

        margin-top:11px;

        color:#88a6bd;

        font-size:11px;
      }


      .mgf-summary b{
        color:#fff;

        font-size:15px;
      }


      #mgf-message{
        margin-top:10px;

        font-size:11px;
      }


      .mgf-success{
        color:#61dfa0;
      }


      .mgf-error{
        color:#ff8c8c;
      }



      /* ==============================================
         SEGUIMIENTO

         A                         B

         [ n | R-XXX | ✓ ]        [ MONTADO ... ]

         MISMA FILA.
         B PEGADO AL EXTREMO DERECHO.
         ============================================== */

      .mgf-host{
        position:relative !important;
      }


      .mgf-follow-tab{
        position:absolute;

        right:0;

        display:flex;

        flex-direction:column;

        justify-content:center;

        min-width:280px;

        padding:
          5px 11px;

        box-sizing:border-box;

        border:
          1px solid #397e9e;

        border-radius:
          9px 9px 0 0;

        background:#102c40;

        z-index:30;

        box-shadow:
          0 1px 4px
          rgba(0,0,0,.18);
      }


      .mgf-relation{
        display:flex;

        align-items:center;

        justify-content:flex-end;

        gap:5px;

        min-height:18px;

        white-space:nowrap;

        font-size:10px;
      }


      .mgf-role{
        color:#61cef4;

        font-weight:900;
      }


      .mgf-relation.mounted
      .mgf-role{
        color:#efca55;
      }


      .mgf-unit{
        color:#fff;

        font-weight:900;
      }


      .mgf-route{
        color:#c3d1db;

        font-weight:700;
      }


      .mgf-date{
        color:#93a9ba;

        font-weight:800;
      }


      .mgf-dot{
        color:#5f778a;
      }


      @media(max-width:1100px){

        .mgf-follow-tab{
          min-width:220px;
        }


        .mgf-route{
          max-width:190px;

          overflow:hidden;

          text-overflow:ellipsis;
        }
      }

    `;


    document.head
      .appendChild(
        style
      );
  }


  // =========================================================
  // ACTUALIZAR SAP
  // =========================================================

  function findSapCard(){

    const headings =
      [
        ...document.querySelectorAll(
          "h1,h2,h3,h4"
        )
      ];


    const heading =
      headings.find(
        element =>
          /archivo sap actualizado/i
            .test(
              element.textContent ||
              ""
            )
      );


    if(!heading)
      return null;


    let element =
      heading;


    for(
      let i=0;

      i<7 &&
      element;

      i++,
      element =
        element.parentElement
    ){

      const text =
        element.innerText ||
        "";


      if(
        /archivo sap actualizado/i
          .test(text)
        &&
        /seleccionar excel/i
          .test(text)
      ){
        return element;
      }
    }


    return null;
  }


  function installSapPanel(){

    /*
      Si existe la implementación operativa
      anterior, no duplicamos el panel.
    */

    if(
      document.getElementById(
        PANEL_ID
      ) ||
      document.getElementById(
        "cemento-montados-operativo"
      )
    ){
      return;
    }


    const body =
      document.body?.innerText ||
      "";


    if(
      !/CEMENTO/i.test(body) ||
      !/ACTUALIZAR SAP/i.test(body)
    ){
      return;
    }


    const sap =
      findSapCard();


    if(!sap)
      return;


    const panel =
      document.createElement(
        "section"
      );


    panel.id =
      PANEL_ID;


    panel.innerHTML = `

      <h3>
        GUÍAS DE MONTADOS
      </h3>


      <div class="mgf-help">

        Copia las filas visibles desde
        el Excel corporativo y pega con
        <b>Ctrl + V</b>.

        <br>

        No necesitas encabezados ni
        mostrar columnas ocultas.

        <br>

        <b>
          ACOPLE LARGO → TRANSPORTA →
          ACOPLE CORTO
        </b>

      </div>


      <textarea
        id="mgf-paste"
        placeholder="HAZ CLIC AQUÍ Y PEGA LAS FILAS CON CTRL + V"></textarea>


      <div class="mgf-actions">

        <button
          id="mgf-save"
          class="mgf-button"
          type="button">

          GUARDAR MONTADOS

        </button>


        <button
          id="mgf-clear"
          class="mgf-button"
          type="button">

          LIMPIAR

        </button>

      </div>


      <div class="mgf-summary">

        <span>
          FILAS
          <b id="mgf-total">0</b>
        </span>

        <span>
          VÁLIDAS
          <b id="mgf-valid">0</b>
        </span>

        <span>
          DUPLICADAS
          <b id="mgf-dup">0</b>
        </span>

        <span>
          REVISAR
          <b id="mgf-bad">0</b>
        </span>

      </div>


      <div
        id="mgf-message">
      </div>

    `;


    sap.insertAdjacentElement(
      "afterend",
      panel
    );


    const textarea =
      document.getElementById(
        "mgf-paste"
      );


    function analyse(){

      const rows =
        parsePaste(
          textarea?.value ||
          ""
        );


      const valid =
        rows.filter(
          r =>
            r.valida &&
            !r.duplicada
        );


      const duplicate =
        rows.filter(
          r =>
            r.duplicada
        );


      const bad =
        rows.filter(
          r =>
            !r.valida
        );


      document.getElementById(
        "mgf-total"
      ).textContent =
        String(
          rows.length
        );


      document.getElementById(
        "mgf-valid"
      ).textContent =
        String(
          valid.length
        );


      document.getElementById(
        "mgf-dup"
      ).textContent =
        String(
          duplicate.length
        );


      document.getElementById(
        "mgf-bad"
      ).textContent =
        String(
          bad.length
        );


      return {
        rows,
        valid
      };
    }


    textarea?.addEventListener(
      "paste",
      ()=>
        setTimeout(
          analyse,
          40
        )
    );


    textarea?.addEventListener(
      "input",
      analyse
    );


    document.getElementById(
      "mgf-clear"
    )?.addEventListener(
      "click",
      ()=>{

        textarea.value =
          "";


        [
          "mgf-total",
          "mgf-valid",
          "mgf-dup",
          "mgf-bad"
        ].forEach(
          id => {

            const element =
              document.getElementById(
                id
              );


            if(element)
              element.textContent =
                "0";
          }
        );


        const message =
          document.getElementById(
            "mgf-message"
          );


        if(message)
          message.textContent =
            "";
      }
    );


    document.getElementById(
      "mgf-save"
    )?.addEventListener(
      "click",
      async ()=>{

        const message =
          document.getElementById(
            "mgf-message"
          );


        try{

          const parsed =
            analyse();


          if(
            !parsed.valid.length
          ){
            throw new Error(
              "No existen filas válidas para guardar."
            );
          }


          message.className =
            "";


          message.textContent =
            "Guardando Montados...";


          const result =
            await api({
              action:"guardar",

              rows:
                parsed.valid.map(
                  r => ({

                    fecha:
                      r.fecha,

                    ruta:
                      r.ruta,

                    largo:
                      r.largo,

                    corto:
                      r.corto,

                    ocLargo:
                      r.ocLargo,

                    ocCorto:
                      r.ocCorto,

                    guia:
                      r.guia
                  })
                )
            });


          message.className =
            "mgf-success";


          message.textContent =
            "Montados guardados: " +
            String(
              result.guardadas ??
              0
            );


          window.dispatchEvent(
            new CustomEvent(
              "cemento-montados-actualizados"
            )
          );

        }catch(error){

          message.className =
            "mgf-error";


          message.textContent =
            error?.message ||
            String(error);
        }
      }
    );

  }


  // =========================================================
  // RANGO REAL DE SEGUIMIENTO
  // =========================================================

  function getSeguimientoRange(){

    /*
      Primero buscamos inputs cerca de
      DESDE / HASTA.
    */

    const inputs =
      [
        ...document.querySelectorAll(
          "input"
        )
      ];


    let desde = null;
    let hasta = null;


    for(const input of inputs){

      const value =
        fechaIso(
          input.value
        );


      if(!value)
        continue;


      const context =
        clean(
          [
            input.id,
            input.name,
            input.placeholder,
            input.parentElement?.innerText,
            input.parentElement
              ?.parentElement
              ?.innerText
          ].join(" ")
        );


      if(
        !desde &&
        /\bDESDE\b/i.test(
          context
        )
      ){
        desde =
          value;

        continue;
      }


      if(
        !hasta &&
        /\bHASTA\b/i.test(
          context
        )
      ){
        hasta =
          value;
      }
    }


    if(
      desde &&
      hasta
    ){

      return {
        desde,
        hasta
      };
    }


    /*
      Respaldo:
      panel de recorrido.
    */

    const route =
      document.querySelector(
        ".route-refresh"
      ) ||
      document.querySelector(
        ".route-unit-toolbar-v3"
      );


    if(route){

      const values =
        [
          ...route.querySelectorAll(
            "input"
          )
        ]
          .map(
            input =>
              fechaIso(
                input.value
              )
          )
          .filter(Boolean);


      if(
        values.length >= 2
      ){

        return {
          desde:
            values[0],

          hasta:
            values[1]
        };
      }
    }


    return null;
  }


  // =========================================================
  // ENCONTRAR A:
  //
  // [ n | R-XXX | ✓ ]
  //
  // =========================================================

  function findBaseTabs(){

    const candidates =
      [
        ...document.querySelectorAll(
          "div,span,button,strong,b"
        )
      ];


    const result = [];
    const used = new Set();


    for(const label of candidates){

      const text =
        clean(
          label.textContent
        );


      if(
        !/^(?:20-)?R-\d+$/i
          .test(text)
      ){
        continue;
      }


      const plate =
        normPlate(text);


      if(!plate)
        continue;


      /*
        Confirmar que pertenece a una tarjeta
        de Seguimiento y no al mapa.
      */

      let context =
        label;

      let isGrid =
        false;


      for(
        let i=0;

        i<8 &&
        context;

        i++,
        context =
          context.parentElement
      ){

        const contextText =
          context.innerText ||
          "";


        if(
          /\bOC\s+\d+/i
            .test(contextText)
          &&
          /GUARDAR/i
            .test(contextText)
        ){

          isGrid =
            true;

          break;
        }
      }


      if(!isGrid)
        continue;


      /*
        Encontrar A completo:
        número + R-XXX + check.
      */

      let base =
        label;


      for(
        let i=0;

        i<7 &&
        base;

        i++,
        base =
          base.parentElement
      ){

        const baseText =
          clean(
            base.textContent
          );


        if(
          baseText.includes(
            text
          )
          &&
          baseText.includes(
            "✓"
          )
          &&
          baseText.length <= 40
        ){
          break;
        }
      }


      if(
        !base ||
        used.has(base)
      ){
        continue;
      }


      /*
        Encontrar el encabezado/tarjeta ancha
        que contiene A.

        B se ubicará al extremo DERECHO
        de este contenedor.
      */

      let host =
        base.parentElement;


      while(host){

        const hr =
          host.getBoundingClientRect();


        const br =
          base.getBoundingClientRect();


        const hostText =
          host.innerText ||
          "";


        if(
          hr.width >
            br.width + 250
          &&
          /\bOC\s+\d+/i
            .test(hostText)
          &&
          /GUARDAR/i
            .test(hostText)
        ){
          break;
        }


        host =
          host.parentElement;
      }


      if(!host)
        continue;


      used.add(base);


      result.push({
        plate,
        base,
        host
      });
    }


    return result;
  }


  // =========================================================
  // MONTADOS DEL RANGO
  // =========================================================

  let montados = [];
  let rangeKey = "";
  let loading = false;


  function renderMontados(){

    /*
      Limpiar únicamente nuestro render.
    */

    document
      .querySelectorAll(
        ".mgf-follow-tab"
      )
      .forEach(
        element =>
          element.remove()
      );


    document
      .querySelectorAll(
        ".mgf-host"
      )
      .forEach(
        element =>
          element.classList.remove(
            "mgf-host"
          )
      );


    if(!montados.length)
      return;


    const tabs =
      findBaseTabs();


    tabs.forEach(item=>{

      /*
        IMPORTANTE:

        SOLO filtramos por la unidad.

        Ruta y fecha ya vienen dentro
        del rango DESDE/HASTA y se muestran
        PARA QUE EL CONTROLADOR DECIDA.

        NO elegimos OC.
      */

      const relations = [];


      montados.forEach(row=>{

        const largo =
          normPlate(
            row.tracto_largo
          );


        const corto =
          normPlate(
            row.tracto_corto
          );


        if(
          largo === item.plate
        ){

          relations.push({

            tipo:
              "TRANSPORTA",

            relacionado:
              corto,

            ruta:
              row.ruta,

            fecha:
              row.fecha_texto
          });
        }


        if(
          corto === item.plate
        ){

          relations.push({

            tipo:
              "MONTADO",

            relacionado:
              largo,

            ruta:
              row.ruta,

            fecha:
              row.fecha_texto
          });
        }
      });


      if(!relations.length)
        return;


      item.host.classList.add(
        "mgf-host"
      );


      const hostRect =
        item.host
          .getBoundingClientRect();


      const baseRect =
        item.base
          .getBoundingClientRect();


      const box =
        document.createElement(
          "div"
        );


      box.className =
        "mgf-follow-tab";


      /*
        MISMA ALTURA DE A.
      */

      box.style.top =
        Math.max(
          0,
          baseRect.top -
          hostRect.top
        ) + "px";


      /*
        Espacio disponible sin tocar A.

        A -------- espacio -------- B
      */

      const available =
        Math.max(
          220,
          hostRect.width -
          baseRect.width -
          80
        );


      box.style.maxWidth =
        available +
        "px";


      box.innerHTML =
        relations
          .map(
            relation => `

              <div class="
                mgf-relation
                ${
                  relation.tipo ===
                  "MONTADO"

                    ? "mounted"
                    : ""
                }
              ">

                <span class="mgf-role">

                  ${
                    relation.tipo ===
                    "TRANSPORTA"

                      ? "MONTANDO"
                      : "MONTADO EN"
                  }

                </span>


                <span class="mgf-unit">

                  ${esc(
                    relation.relacionado
                  )}

                </span>


                <span class="mgf-dot">
                  ·
                </span>


                <span class="mgf-route">

                  ${esc(
                    relation.ruta
                  )}

                </span>


                <span class="mgf-dot">
                  ·
                </span>


                <span class="mgf-date">

                  ${esc(
                    relation.fecha
                  )}

                </span>

              </div>

            `
          )
          .join("");
    });
  }


  async function loadSeguimiento(
    force=false
  ){

    if(loading)
      return;


    const hasGrid =
      document.querySelector(
        ".plate-grid-scroll"
      ) ||
      document.querySelector(
        ".plate-grid"
      );


    if(!hasGrid)
      return;


    const range =
      getSeguimientoRange();


    if(
      !range?.desde ||
      !range?.hasta
    ){
      return;
    }


    const key =
      range.desde +
      "|" +
      range.hasta;


    if(
      !force &&
      key === rangeKey
    ){

      renderMontados();

      return;
    }


    loading =
      true;


    try{

      const result =
        await api({
          action:
            "listar",

          desde:
            range.desde,

          hasta:
            range.hasta
        });


      montados =
        Array.isArray(
          result.rows
        )
          ? result.rows
          : [];


      rangeKey =
        key;


      renderMontados();

    }catch(error){

      console.error(
        "CEMENTO Montados:",
        error
      );

    }finally{

      loading =
        false;
    }
  }


  // =========================================================
  // INICIALIZACIÓN
  // =========================================================

  installStyles();


  let pending =
    false;


  const observer =
    new MutationObserver(()=>{

      if(pending)
        return;


      pending =
        true;


      requestAnimationFrame(()=>{

        pending =
          false;


        installSapPanel();


        loadSeguimiento(
          false
        );
      });
    });


  observer.observe(
    document.documentElement,
    {
      childList:true,
      subtree:true
    }
  );


  /*
    DESDE / HASTA cambia.
  */

  document.addEventListener(
    "change",
    event=>{

      if(
        event.target?.tagName ===
        "INPUT"
      ){

        setTimeout(
          ()=>
            loadSeguimiento(
              true
            ),
          80
        );
      }
    },
    true
  );


  /*
    ACTUALIZAR RECORRIDO.
  */

  document.addEventListener(
    "click",
    event=>{

      const text =
        clean(
          event.target?.textContent
        );


      if(
        /ACTUALIZAR RECORRIDO/i
          .test(text)
      ){

        setTimeout(
          ()=>
            loadSeguimiento(
              true
            ),
          200
        );
      }
    },
    true
  );


  window.addEventListener(
    "cemento-montados-actualizados",
    ()=>{

      rangeKey =
        "";


      setTimeout(
        ()=>
          loadSeguimiento(
            true
          ),
        100
      );
    }
  );


  if(
    document.readyState ===
    "loading"
  ){

    document.addEventListener(
      "DOMContentLoaded",
      ()=>{

        installSapPanel();

        loadSeguimiento(
          true
        );
      }
    );

  }else{

    installSapPanel();

    loadSeguimiento(
      true
    );
  }

})();


