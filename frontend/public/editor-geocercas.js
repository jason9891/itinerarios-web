import { initializeApp } from "./vendor/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
} from "./vendor/firebase-auth.js";

const FIREBASE = {
  apiKey: "AIzaSyAeTPLS3r-199T__22TKrPMpZVZFe8IZI8",
  authDomain: "itinerarios-2fa6f.firebaseapp.com",
  projectId: "itinerarios-2fa6f",
  storageBucket: "itinerarios-2fa6f.firebasestorage.app",
  messagingSenderId: "436339112360",
  appId: "1:436339112360:web:ed48a2b8941572a77ec59d",
};
const API =
  "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/editor-geocercas";
const TYPES = ["geocercas", "rutas_madre", "geocerca_tramo"];
const TYPE_LABEL = {
  geocercas: "Geocerca",
  rutas_madre: "Ruta madre",
  geocerca_tramo: "Geocerca de ruta",
};
const TYPE_PLURAL = {
  geocercas: "geocercas",
  rutas_madre: "rutas madre",
  geocerca_tramo: "geocercas de ruta",
};
const SCOPE_LABEL = { MAESTRO: "Maestro general", CEMENTO: "Cemento", "CERRO VERDE": "Cerro Verde", "TURNO AMANECIDA": "T. Amanecida" };
const ABBR = {
  CEMENTO: "CEM",
  "CERRO VERDE": "CV",
  "TURNO AMANECIDA": "TA",
};
const COLORS = {
  geocercas: "#38bdf8",
  rutas_madre: "#fb923c",
  geocerca_tramo: "#a78bfa",
  assigned: "#22c55e",
  protectedStroke: "#f59e0b",
  idle: "#64748b",
  selected: "#ffffff",
};
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

const auth = getAuth(initializeApp(FIREBASE)),
  provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const state = {
  master: null,
  itinerarios: [],
  scope: "MAESTRO",
  type: "geocercas",
  selected: null,
  map: null,
  overlays: new Map(), // id -> overlays[]
  visible: new Set(),
  drawing: null,
  draftPath: [],
  draftOverlay: null,
  dirty: false,
  role: "",
  status: "SIN_BORRADOR",
  version: 0,
  protegidas: {},
  filtro: "",
  chip: "todas",
  geomOriginal: new Map(), // id -> geometría al primer cambio de la sesión
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

async function api(body) {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}

function toast(text, kind = "info") {
  const box = $("geo-toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 4500);
}
const message = (text, error = false) => toast(text, error ? "error" : "info");

function modal({ title, body = "", ok = "Aceptar", cancel = "Cancelar", danger = false, hideCancel = false }) {
  return new Promise((resolve) => {
    const root = $("geo-modal");
    $("gm-title").textContent = title;
    $("gm-body").innerHTML = body;
    const okBtn = $("gm-ok"),
      cancelBtn = $("gm-cancel");
    okBtn.textContent = ok;
    cancelBtn.textContent = cancel;
    cancelBtn.classList.toggle("hidden", hideCancel);
    okBtn.classList.toggle("danger", danger);
    root.classList.remove("hidden");
    const first = $("gm-body").querySelector("input");
    (first || okBtn).focus();
    first?.select?.();
    const done = (value) => {
      root.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = null;
      root.onkeydown = null;
      resolve(value);
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    root.onkeydown = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
        e.preventDefault();
        done(true);
      }
    };
  });
}
const confirmModal = (title, body, ok, danger = false) =>
  modal({ title, body, ok, danger });

async function askName({ title, value, extra = "" }) {
  const accepted = await modal({
    title,
    ok: "Crear",
    body: `<label class="gm-field"><span>NOMBRE</span><input id="gm-name" value="${esc(value)}" maxlength="120"></label>${extra}`,
  });
  if (!accepted) return null;
  const name = $("gm-name").value.trim();
  return name || null;
}

async function action(button, work) {
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    toast(
      error instanceof Error ? error.message : "No se pudo completar la acción",
      "error",
    );
  } finally {
    button.disabled = false;
    paintCommand();
  }
}

/* ------------------------------------------------------------------ */
/* Modelo                                                               */
/* ------------------------------------------------------------------ */

const masterObjects = (type = state.type) => state.master?.objetos?.[type] || [];
const allObjects = () =>
  TYPES.flatMap((t) => masterObjects(t).map((o) => ({ ...o, __type: t })));
function findObject(id) {
  for (const type of TYPES) {
    const o = masterObjects(type).find((x) => x.id === id);
    if (o) return { obj: o, type };
  }
  return null;
}
const isItinerary = () => state.scope !== "MAESTRO";
const assignmentsOf = (it = state.scope) => state.master?.asignaciones?.[it] || [];
const assignment = (id, it = state.scope) =>
  assignmentsOf(it).find((x) => x.maestro_id === id);
const isAssigned = (id, it = state.scope) => !!assignment(id, it)?.activa;
const protectedRole = (id, it = state.scope) =>
  state.protegidas?.[it]?.[id] || null;
const protectedIn = (id) =>
  Object.entries(state.protegidas || {})
    .filter(([, m]) => m && m[id])
    .map(([it]) => it);
const usedIn = (id) =>
  Object.keys(state.master?.asignaciones || {}).filter((it) =>
    isAssigned(id, it),
  );

function counts(it = state.scope) {
  const rows = assignmentsOf(it).filter((x) => x.activa);
  const out = { geocercas: 0, rutas_madre: 0, geocerca_tramo: 0, protegidas: 0, adicionales: 0 };
  for (const a of rows) {
    out[a.tipo] = (out[a.tipo] || 0) + 1;
    if (a.tipo === "geocercas") {
      if (protectedRole(a.maestro_id, it)) out.protegidas++;
      else out.adicionales++;
    }
  }
  return out;
}

function markDirty() {
  state.dirty = true;
  paintCommand();
}

/* ------------------------------------------------------------------ */
/* Geometría                                                            */
/* ------------------------------------------------------------------ */

const coordsPath = (path) => path.map((c) => ({ lat: +c[1], lng: +c[0] }));
function pathCoords(path) {
  const out = [];
  for (let i = 0; i < path.getLength(); i++) {
    const p = path.getAt(i);
    out.push([+p.lng().toFixed(7), +p.lat().toFixed(7)]);
  }
  return out;
}
function overlayParts(obj) {
  const g = obj.geometry || {};
  if (g.type === "Polygon")
    return [{ shape: "polygon", paths: g.coordinates.map(coordsPath) }];
  if (g.type === "MultiPolygon")
    return g.coordinates.map((poly) => ({
      shape: "polygon",
      paths: poly.map(coordsPath),
    }));
  if (g.type === "LineString")
    return [{ shape: "line", path: coordsPath(g.coordinates) }];
  if (g.type === "MultiLineString")
    return g.coordinates.map((line) => ({ shape: "line", path: coordsPath(line) }));
  return [];
}
function ringsOf(overlay) {
  if (overlay instanceof google.maps.Polygon) {
    const rings = [];
    for (let i = 0; i < overlay.getPaths().getLength(); i++)
      rings.push(overlay.getPaths().getAt(i));
    return rings;
  }
  return [overlay.getPath()];
}
function geometryStats(id) {
  const list = state.overlays.get(id) || [];
  let vertices = 0,
    area = 0,
    length = 0;
  for (const overlay of list) {
    const rings = ringsOf(overlay);
    for (const ring of rings) {
      vertices += ring.getLength();
      if (window.google?.maps?.geometry) {
        if (overlay instanceof google.maps.Polygon)
          area += google.maps.geometry.spherical.computeArea(ring);
        else length += google.maps.geometry.spherical.computeLength(ring);
      }
    }
    // Los anillos interiores restan; el exterior es el primero.
    if (overlay instanceof google.maps.Polygon && rings.length > 1 && window.google?.maps?.geometry) {
      for (const hole of rings.slice(1)) area -= 2 * google.maps.geometry.spherical.computeArea(hole);
    }
  }
  return { vertices, area: Math.abs(area), length };
}
const fmtArea = (m2) =>
  m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} km²` : `${(m2 / 1e4).toFixed(2)} ha`;
const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

function syncGeometry(id) {
  const found = findObject(id);
  const list = state.overlays.get(id) || [];
  if (!found || !list.length) return;
  if (!state.geomOriginal.has(id))
    state.geomOriginal.set(id, structuredClone(found.obj.geometry));
  if (list[0] instanceof google.maps.Polygon) {
    const polys = list.map((overlay) =>
      ringsOf(overlay).map((ring) => pathCoords(ring)),
    );
    found.obj.geometry = {
      type: polys.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: polys.length === 1 ? polys[0] : polys,
    };
  } else {
    const lines = list.map((overlay) => pathCoords(overlay.getPath()));
    found.obj.geometry = {
      type: lines.length === 1 ? "LineString" : "MultiLineString",
      coordinates: lines.length === 1 ? lines[0] : lines,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                 */
/* ------------------------------------------------------------------ */

async function loadMaps(key) {
  if (window.google?.maps) return;
  if (!key) throw Error("Falta GOOGLE_MAPS_API_KEY en Supabase");
  await new Promise((resolve, reject) => {
    window.__editorMapsReady = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=geometry&callback=__editorMapsReady`;
    script.async = true;
    script.onerror = () => reject(Error("No se pudo cargar Google Maps"));
    document.head.append(script);
  });
}
function initMap() {
  if (state.map) return;
  state.map = new google.maps.Map($("geo-map"), {
    center: { lat: -16.4, lng: -71.53 },
    zoom: 9,
    mapTypeId: "roadmap",
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: "greedy",
  });
  state.map.addListener("click", (event) => {
    if (!state.drawing) return;
    state.draftPath.push({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    paintDraft();
  });
}

function styleFor(id, type) {
  const selected = id === state.selected;
  let color = COLORS[type],
    fill = 0.13,
    weight = type === "rutas_madre" ? 4 : 2,
    opacity = 0.9;
  if (isItinerary()) {
    if (protectedRole(id)) {
      color = COLORS.protectedStroke;
      fill = 0.2;
    } else if (isAssigned(id)) {
      color = COLORS.assigned;
      fill = 0.2;
    } else {
      color = COLORS.idle;
      fill = 0.05;
      opacity = 0.7;
      weight = 1;
    }
  } else if (protectedIn(id).length) {
    color = COLORS.protectedStroke;
  }
  if (selected) {
    weight += 2;
    fill = Math.max(fill, 0.28);
    opacity = 1;
  }
  return {
    strokeColor: selected ? COLORS.selected : color,
    strokeOpacity: opacity,
    strokeWeight: weight,
    fillColor: color,
    fillOpacity: fill,
    zIndex: selected ? 10 : 1,
  };
}
function styleAll() {
  for (const [id, list] of state.overlays) {
    const f = findObject(id);
    if (!f) continue;
    const s = styleFor(id, f.type);
    for (const overlay of list) {
      overlay.setOptions(
        overlay instanceof google.maps.Polygon
          ? s
          : { strokeColor: s.strokeColor, strokeOpacity: s.strokeOpacity, strokeWeight: s.strokeWeight, zIndex: s.zIndex },
      );
      overlay.setMap(state.visible.has(id) ? state.map : null);
    }
  }
}
function attachEditing(overlay, id, minPoints) {
  for (const path of ringsOf(overlay))
    for (const event of ["set_at", "insert_at", "remove_at"])
      path.addListener(event, () => {
        if (isItinerary() || state.drawing) return;
        syncGeometry(id);
        markDirty();
        paintProps();
      });
  overlay.addListener("contextmenu", (e) => {
    if (isItinerary() || state.selected !== id || e.vertex == null) return;
    const ring =
      overlay instanceof google.maps.Polygon && e.path != null
        ? overlay.getPaths().getAt(e.path)
        : ringsOf(overlay)[0];
    if (ring.getLength() <= minPoints)
      return toast(`Se requieren al menos ${minPoints} puntos.`, "error");
    ring.removeAt(e.vertex);
  });
}
function renderMap() {
  for (const list of state.overlays.values())
    for (const overlay of list) overlay.setMap(null);
  state.overlays.clear();
  for (const obj of masterObjects()) {
    const list = [];
    const minPoints = state.type === "rutas_madre" ? 2 : 3;
    for (const part of overlayParts(obj)) {
      const common = { map: null, clickable: true, editable: false };
      const overlay =
        part.shape === "polygon"
          ? new google.maps.Polygon({ ...common, paths: part.paths })
          : new google.maps.Polyline({ ...common, path: part.path });
      overlay.addListener("click", () => {
        if (!state.drawing) selectObject(obj.id, false);
      });
      attachEditing(overlay, obj.id, minPoints);
      list.push(overlay);
    }
    state.overlays.set(obj.id, list);
  }
  applyEditable();
  styleAll();
}
function applyEditable() {
  for (const [id, list] of state.overlays)
    for (const overlay of list)
      overlay.setEditable(!isItinerary() && !state.drawing && id === state.selected);
}
function centerObject(id = state.selected) {
  const list = state.overlays.get(id) || [];
  if (!list.length) return;
  const bounds = new google.maps.LatLngBounds();
  for (const overlay of list)
    for (const ring of ringsOf(overlay)) ring.forEach((p) => bounds.extend(p));
  if (!bounds.isEmpty()) state.map.fitBounds(bounds, 60);
}

/* ------------------------------------------------------------------ */
/* Selección                                                            */
/* ------------------------------------------------------------------ */

function selectObject(id, center = true) {
  const found = findObject(id);
  if (!found) return;
  if (found.type !== state.type) {
    state.type = found.type;
    renderMap();
    paintTypes();
  }
  state.selected = id;
  state.visible.add(id);
  applyEditable();
  styleAll();
  paintTree();
  paintProps();
  if (center) centerObject(id);
}
function deselect() {
  state.selected = null;
  applyEditable();
  styleAll();
  paintTree();
  paintProps();
}

/* ------------------------------------------------------------------ */
/* Asignaciones                                                         */
/* ------------------------------------------------------------------ */

function nameTaken(name, type, exceptId, it = state.scope) {
  if (type === "rutas_madre") return false;
  const key = norm(name);
  return assignmentsOf(it).some(
    (a) =>
      a.activa &&
      a.tipo === type &&
      a.maestro_id !== exceptId &&
      norm(a.nombre_operativo) === key,
  );
}
function setAssigned(id, on, { silent = false, it = state.scope } = {}) {
  if (it === "MAESTRO") return false;
  const found = findObject(id);
  if (!found) return false;
  const role = protectedRole(id, it);
  if (role && !on) {
    if (!silent)
      toast(`${found.obj.name} es una geocerca protegida (${role.toLowerCase()}): no se puede quitar del itinerario.`, "error");
    return false;
  }
  const list = (state.master.asignaciones[it] ||= []);
  let a = assignment(id, it);
  if (on) {
    const name = a?.nombre_operativo || found.obj.name;
    if (nameTaken(name, found.type, id, it)) {
      if (!silent)
        toast(`Ya hay otra ${TYPE_LABEL[found.type].toLowerCase()} activa con el nombre "${name}" en ${it}. Cambia el nombre operativo desde ese itinerario.`, "error");
      return false;
    }
    if (!a) {
      a = { maestro_id: id, nombre_operativo: name, tipo: found.type, activa: true };
      list.push(a);
    } else a.activa = true;
  } else if (a) {
    // Se quita la fila completa: así no quedan asignaciones "fantasma".
    state.master.asignaciones[it] = list.filter((x) => x.maestro_id !== id);
  }
  markDirty();
  return true;
}
function bulkAssign(on) {
  const rows = listedObjects();
  let changed = 0,
    skipped = 0;
  for (const o of rows) {
    if (isAssigned(o.id) === on) continue;
    if (setAssigned(o.id, on, { silent: true })) changed++;
    else skipped++;
  }
  styleAll();
  paintTree();
  paintProps();
  paintSummary();
  toast(
    `${changed} ${on ? "asignadas" : "quitadas"}${skipped ? ` · ${skipped} no se pudieron cambiar (protegidas o nombre repetido)` : ""}.`,
    skipped ? "warn" : "ok",
  );
}

/* ------------------------------------------------------------------ */
/* Pintado de interfaz                                                  */
/* ------------------------------------------------------------------ */

function paintCommand() {
  const dirty = state.dirty;
  $("project-state").innerHTML =
    `<span class="dot ${dirty ? "dirty" : "clean"}"></span>${esc(state.status)} · versión ${state.version}${dirty ? " · <b>cambios sin guardar</b>" : ""}`;
  const saved = !dirty,
    validated = ["VALIDADO", "PUBLICADO"].includes(state.status);
  $("save-draft").classList.toggle("pending", dirty);
  $("save-draft").disabled = !dirty && state.status !== "SIN_BORRADOR";
  $("validate-draft").disabled = dirty || state.status === "VALIDADO" || state.status === "PUBLICADO";
  $("validate-draft").classList.toggle("pending", saved && state.status === "BORRADOR");
  const canPublish = isItinerary() && saved && validated;
  $("publish").disabled = !canPublish;
  $("publish").classList.toggle("pending", canPublish && state.status === "VALIDADO");
  $("publish-label").textContent = isItinerary() ? `Publicar ${state.scope}` : "Publicar (elige itinerario)";
  $("publish").title = !isItinerary()
    ? "Elige un itinerario para publicar sus asignaciones"
    : dirty
      ? "Primero guarda los cambios"
      : !validated
        ? "Primero valida el Maestro"
        : "Publicar las asignaciones de este itinerario";
  $("discard").disabled = !dirty;
}
function paintScopes() {
  const items = ["MAESTRO", ...state.itinerarios];
  $("scope-tabs").innerHTML = items
    .map(
      (it) =>
        `<button role="tab" data-scope="${esc(it)}" class="${it === state.scope ? "active" : ""}">${esc(SCOPE_LABEL[it] || it)}</button>`,
    )
    .join("");
}
function paintSummary() {
  const box = $("scope-summary");
  if (!isItinerary()) {
    const all = allObjects();
    const unused = all.filter((o) => !usedIn(o.id).length).length;
    box.innerHTML = `<b>Maestro general</b><span>${all.length} objetos · ${unused} sin asignar. Aquí se crean, editan y eliminan las geometrías.</span>`;
    return;
  }
  const c = counts();
  box.innerHTML = `<b>${esc(state.scope)}</b><span><em class="ok">${c.geocercas}</em> geocercas · <em class="warn">🔒 ${c.protegidas}</em> protegidas · <em>${c.adicionales}</em> adicionales${c.rutas_madre || c.geocerca_tramo ? ` · ${c.rutas_madre} rutas · ${c.geocerca_tramo} tramos` : ""}</span>`;
}
function paintTypes() {
  document
    .querySelectorAll("#type-tabs [data-type]")
    .forEach((b) => b.classList.toggle("active", b.dataset.type === state.type));
  $("new-object").textContent =
    `＋ Nueva ${TYPE_LABEL[state.type].toLowerCase()}${isItinerary() ? " en este itinerario" : ""}`;
}
function paintChips() {
  const defs = isItinerary()
    ? [["todas", "Todas"], ["asignadas", "Asignadas"], ["disponibles", "Disponibles"], ["protegidas", "🔒 Protegidas"]]
    : [["todas", "Todas"], ["protegidas", "🔒 Protegidas"], ["sinuso", "Sin asignar"]];
  if (!defs.some(([k]) => k === state.chip)) state.chip = "todas";
  $("filter-chips").innerHTML = defs
    .map(([k, l]) => `<button data-chip="${k}" class="${k === state.chip ? "active" : ""}">${l}</button>`)
    .join("");
  $("bulk-on").classList.toggle("hidden", !isItinerary());
  $("bulk-off").classList.toggle("hidden", !isItinerary());
}
function listedObjects() {
  const q = state.filtro.trim().toLowerCase();
  return masterObjects().filter((o) => {
    const a = isItinerary() ? assignment(o.id) : null;
    if (q && !`${o.name} ${a?.nombre_operativo || ""} ${o.id}`.toLowerCase().includes(q))
      return false;
    switch (state.chip) {
      case "asignadas": return isAssigned(o.id);
      case "disponibles": return !isAssigned(o.id);
      case "protegidas": return isItinerary() ? !!protectedRole(o.id) : protectedIn(o.id).length > 0;
      case "sinuso": return usedIn(o.id).length === 0;
      default: return true;
    }
  });
}
function paintTree() {
  const rows = listedObjects();
  const itin = isItinerary();
  $("object-tree").innerHTML =
    rows
      .map((o) => {
        const a = itin ? assignment(o.id) : null,
          assigned = !!a?.activa,
          role = itin ? protectedRole(o.id) : null,
          lockedIn = !itin ? protectedIn(o.id) : [];
        const badges = itin
          ? role
            ? `<span class="b lock">🔒 ${esc(role)}</span>`
            : assigned && state.type === "geocercas"
              ? `<span class="b extra">ADICIONAL</span>`
              : ""
          : [
              ...usedIn(o.id).map((x) => `<span class="b it">${esc(ABBR[x] || x)}</span>`),
              lockedIn.length ? `<span class="b lock">🔒</span>` : "",
            ].join("");
        return `<div class="gt-row${o.id === state.selected ? " selected" : ""}${assigned ? " assigned" : ""}${role ? " locked" : ""}" data-id="${esc(o.id)}">
  <button class="gt-eye${state.visible.has(o.id) ? " on" : ""}" data-act="eye" title="Mostrar u ocultar en el mapa">${state.visible.has(o.id) ? "◉" : "○"}</button>
  <button class="gt-main" data-act="select"><span class="gt-name">${esc(a?.nombre_operativo || o.name)}</span><span class="gt-badges">${badges}</span></button>
  <button class="gt-zoom" data-act="zoom" title="Centrar en el mapa">⌖</button>
  ${itin ? `<label class="switch${role ? " off" : ""}" title="${role ? "Protegida: siempre asignada" : assigned ? "Quitar del itinerario" : "Asignar al itinerario"}"><input type="checkbox" data-act="toggle" ${assigned ? "checked" : ""} ${role ? "disabled" : ""}><span></span></label>` : ""}
</div>`;
      })
      .join("") ||
    `<div class="gs-empty">${state.filtro || state.chip !== "todas" ? "Nada coincide con el filtro." : `No hay ${TYPE_PLURAL[state.type]} en el Maestro.`}</div>`;
}
function paintProps() {
  const box = $("props");
  const found = state.selected ? findObject(state.selected) : null;
  if (!found) {
    box.innerHTML = `<h2>Panel de edición</h2>
<div class="gp-empty">
  <p><b>Selecciona un objeto</b> en la lista o haz clic sobre él en el mapa.</p>
  <ol>
    <li><b>Maestro:</b> crea, mueve puntos, renombra o elimina geometrías.</li>
    <li><b>Itinerario:</b> activa el interruptor de cada geocerca para asignarla.</li>
    <li>Guarda → Valida → Publica.</li>
  </ol>
  <p class="gp-legend"><i style="background:${COLORS.assigned}"></i>Asignada <i style="background:${COLORS.protectedStroke}"></i>Protegida <i style="background:${COLORS.idle}"></i>No asignada</p>
</div>`;
    return;
  }
  const { obj, type } = found;
  const itin = isItinerary();
  const lockedIn = protectedIn(obj.id);
  const role = itin ? protectedRole(obj.id) : null;
  const a = itin ? assignment(obj.id) : null;
  const stats = geometryStats(obj.id);
  const uso = usedIn(obj.id);
  const modified = state.geomOriginal.has(obj.id);
  let html = `<h2>${esc(TYPE_LABEL[type])}</h2>
<div class="gp-title">${esc(a?.nombre_operativo || obj.name)}</div>
<div class="gp-id">${esc(obj.id)}</div>`;
  if (lockedIn.length)
    html += `<div class="gp-lock">🔒 <b>Geocerca operativa protegida</b> (${esc(lockedIn.join(", "))}). Se puede <b>editar su geometría</b>, pero no quitarla del itinerario ni eliminarla.</div>`;
  html += `<div class="gp-assign"><small>ASIGNAR A ITINERARIOS · clic para activar o quitar</small><div class="gp-chips">${state.itinerarios
    .map((x) => {
      const on = uso.includes(x),
        lock = !!protectedRole(obj.id, x);
      return `<button type="button" data-assign="${esc(x)}" class="chip${on ? " on" : ""}${lock ? " lock" : ""}" title="${lock ? "Protegida en este itinerario: no se puede quitar" : on ? `Quitar de ${esc(x)}` : `Asignar a ${esc(x)}`}" ${lock ? "disabled" : ""}>${lock ? "🔒" : on ? "✓" : "＋"} ${esc(SCOPE_LABEL[x] || x)}</button>`;
    })
    .join("")}</div></div>`;
  html += `<div class="gp-stats"><div><small>${type === "rutas_madre" ? "LONGITUD" : "ÁREA"}</small><b>${type === "rutas_madre" ? fmtLen(stats.length) : fmtArea(stats.area)}</b></div><div><small>PUNTOS</small><b>${stats.vertices}</b></div></div>`;

  if (itin) {
    html += `<section class="gp-card"><h3>Asignación a ${esc(state.scope)}</h3>
<label class="gp-switch"><span class="switch${role ? " off" : ""}"><input id="p-assigned" type="checkbox" ${a?.activa ? "checked" : ""} ${role ? "disabled" : ""}><span></span></span><b>${a?.activa ? "Asignada al itinerario" : "No asignada"}</b></label>
<label class="gm-field"><span>NOMBRE OPERATIVO</span><input id="p-opname" value="${esc(a?.nombre_operativo || obj.name)}" ${role || !a?.activa ? "disabled" : ""} maxlength="120"></label>
<small class="gp-hint">${role ? "El nombre de las protegidas es fijo porque el análisis las busca por identificador." : a?.activa ? "Cada itinerario puede llamarla distinto. Enter para aplicar." : "Asígnala para poder darle un nombre operativo."}</small>
</section>
<div class="gp-actions">
  <button id="p-geom" class="gp-btn">✎ Editar geometría en el Maestro</button>
  <button id="p-zoom" class="gp-btn">⌖ Centrar en el mapa</button>
  ${a?.activa && !role ? `<button id="p-remove" class="gp-btn danger">Quitar de ${esc(state.scope)}</button>` : ""}
</div>`;
  } else {
    html += `<section class="gp-card"><h3>Nombre maestro</h3>
<label class="gm-field"><input id="p-name" value="${esc(obj.name)}" maxlength="120"></label>
<small class="gp-hint">Mueve los puntos en el mapa · arrastra un punto intermedio para agregar uno · clic derecho sobre un punto para borrarlo.</small></section>
<div class="gp-actions">
  <button id="p-zoom" class="gp-btn">⌖ Centrar en el mapa</button>
  <button id="p-dup" class="gp-btn">⧉ Duplicar</button>
  ${modified ? `<button id="p-restore" class="gp-btn">↺ Restaurar geometría original</button>` : ""}
  <button id="p-delete" class="gp-btn danger" ${lockedIn.length ? "disabled" : ""} title="${lockedIn.length ? "Geocerca protegida: no se puede eliminar" : "Eliminar del Maestro"}">🗑 Eliminar del Maestro</button>
</div>`;
  }
  box.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/* Dibujo                                                               */
/* ------------------------------------------------------------------ */

function startDrawing() {
  if (state.drawing) return;
  state.drawing = state.type;
  state.draftPath = [];
  state.draftOverlay?.setMap(null);
  state.draftOverlay = null;
  applyEditable();
  for (const list of state.overlays.values())
    for (const o of list) o.setOptions({ clickable: false });
  state.map.setOptions({ draggableCursor: "crosshair" });
  $("draw-bar").classList.remove("hidden");
  $("draw-title").textContent = state.type === "rutas_madre" ? "Dibujando línea" : "Dibujando polígono";
  paintDraft();
}
function stopDrawing() {
  state.drawing = null;
  state.draftPath = [];
  state.draftOverlay?.setMap(null);
  state.draftOverlay = null;
  for (const list of state.overlays.values())
    for (const o of list) o.setOptions({ clickable: true });
  state.map?.setOptions({ draggableCursor: null });
  $("draw-bar").classList.add("hidden");
  applyEditable();
}
function paintDraft() {
  state.draftOverlay?.setMap(null);
  const color = COLORS[state.drawing] || COLORS.geocercas;
  state.draftOverlay =
    state.drawing !== "rutas_madre"
      ? new google.maps.Polygon({
          map: state.map,
          paths: state.draftPath,
          strokeColor: color,
          fillColor: color,
          fillOpacity: 0.2,
          strokeWeight: 3,
          clickable: false,
        })
      : new google.maps.Polyline({
          map: state.map,
          path: state.draftPath,
          strokeColor: color,
          strokeWeight: 4,
          clickable: false,
        });
  const min = state.drawing === "rutas_madre" ? 2 : 3;
  const n = state.draftPath.length;
  $("draw-count").textContent = `${n} punto${n === 1 ? "" : "s"}${n < min ? ` · faltan ${min - n}` : ""}`;
  $("finish-draw").disabled = n < min;
  $("draw-undo").disabled = !n;
}
async function finishDrawing() {
  const type = state.drawing;
  const min = type === "rutas_madre" ? 2 : 3;
  if (!type || state.draftPath.length < min)
    return toast(`Se requieren al menos ${min} puntos.`, "error");
  const itin = isItinerary();
  const suggested = `NUEVA ${TYPE_LABEL[type].toUpperCase()}`;
  const extra = itin
    ? `<p class="gm-note">Se creará en el Maestro y quedará <b>asignada a ${esc(state.scope)}</b>${type === "geocercas" && state.scope === "CERRO VERDE" ? ", incluida en el análisis de pernoctes" : ""}.</p>`
    : `<p class="gm-note">Se creará en el Maestro. Luego puedes asignarla a los itinerarios que quieras.</p>`;
  const name = await askName({ title: `Nueva ${TYPE_LABEL[type].toLowerCase()}`, value: suggested, extra });
  if (!name) return;
  if (itin && nameTaken(name, type, null))
    return toast(`Ya hay otra ${TYPE_LABEL[type].toLowerCase()} activa con el nombre "${name}" en ${state.scope}.`, "error");
  const coords = state.draftPath.map((p) => [+p.lng.toFixed(7), +p.lat.toFixed(7)]);
  const obj = {
    id: `GEO_${crypto.randomUUID()}`,
    name,
    kind: type === "rutas_madre" ? "ruta_madre" : type === "geocerca_tramo" ? "geocerca_tramo" : "geocerca",
    geometry: {
      type: type === "rutas_madre" ? "LineString" : "Polygon",
      coordinates: type === "rutas_madre" ? coords : [[...coords, coords[0]]],
    },
  };
  state.master.objetos[type].push(obj);
  stopDrawing();
  renderMap();
  if (itin) setAssigned(obj.id, true, { silent: true });
  markDirty();
  state.visible.add(obj.id);
  state.type = type;
  paintTypes();
  selectObject(obj.id, true);
  paintSummary();
  toast(itin ? `"${name}" creada y asignada a ${state.scope}. Recuerda guardar.` : `"${name}" creada en el Maestro. Recuerda guardar.`, "ok");
}

/* ------------------------------------------------------------------ */
/* Acciones sobre objetos                                               */
/* ------------------------------------------------------------------ */

function renameMaster(id, name) {
  const found = findObject(id);
  if (!found) return;
  name = name.trim();
  if (!name) {
    toast("El nombre maestro no puede quedar vacío.", "error");
    return paintProps();
  }
  if (name === found.obj.name) return;
  found.obj.name = name;
  markDirty();
  paintTree();
  paintProps();
}
function renameOperational(id, name) {
  const a = assignment(id);
  const found = findObject(id);
  if (!a || !found) return;
  name = name.trim() || found.obj.name;
  if (name === a.nombre_operativo) return;
  if (nameTaken(name, found.type, id)) {
    toast(`Ya hay otra activa con el nombre "${name}" en ${state.scope}.`, "error");
    return paintProps();
  }
  a.nombre_operativo = name;
  markDirty();
  paintTree();
  paintProps();
}
async function deleteFromMaster(id) {
  const found = findObject(id);
  if (!found) return;
  const locked = protectedIn(id);
  if (locked.length)
    return toast(`${found.obj.name} es una geocerca operativa protegida (${locked.join(", ")}): no se puede eliminar.`, "error");
  const uso = usedIn(id);
  const ok = await confirmModal(
    "Eliminar del Maestro",
    `<p><b>${esc(found.obj.name)}</b> se eliminará con su geometría.</p>${
      uso.length
        ? `<p class="gm-warn">Está asignada en: <b>${esc(uso.join(", "))}</b>. Se quitará de esos itinerarios.</p>`
        : `<p>No está asignada a ningún itinerario.</p>`
    }<p class="gm-note">Después guarda, valida y publica los itinerarios afectados para que el cambio llegue a producción.</p>`,
    "Eliminar",
    true,
  );
  if (!ok) return;
  state.master.objetos[found.type] = masterObjects(found.type).filter((x) => x.id !== id);
  for (const it of Object.keys(state.master.asignaciones))
    state.master.asignaciones[it] = state.master.asignaciones[it].filter((x) => x.maestro_id !== id);
  state.geomOriginal.delete(id);
  state.visible.delete(id);
  markDirty();
  state.selected = null;
  renderMap();
  paintTree();
  paintProps();
  paintSummary();
  toast(`"${found.obj.name}" eliminada del Maestro. Recuerda guardar.`, "ok");
}
function duplicate(id) {
  const found = findObject(id);
  if (!found) return;
  const copy = structuredClone(found.obj);
  copy.id = `GEO_${crypto.randomUUID()}`;
  copy.name = `${found.obj.name} (copia)`;
  delete copy.meta;
  state.master.objetos[found.type].push(copy);
  markDirty();
  renderMap();
  state.visible.add(copy.id);
  selectObject(copy.id, true);
  paintSummary();
  toast("Copia creada en el Maestro. Muévela o renómbrala y guarda.", "ok");
}
function restoreGeometry(id) {
  const found = findObject(id);
  const original = state.geomOriginal.get(id);
  if (!found || !original) return;
  found.obj.geometry = structuredClone(original);
  state.geomOriginal.delete(id);
  const keep = state.selected;
  renderMap();
  state.selected = keep;
  applyEditable();
  styleAll();
  markDirty();
  paintProps();
  toast("Geometría restaurada a la de esta sesión.", "ok");
}

/* ------------------------------------------------------------------ */
/* Carga / guardado / publicación                                       */
/* ------------------------------------------------------------------ */

async function load() {
  const data = await api({ action: "leer_maestro" });
  state.master = structuredClone(data.maestro);
  state.role = data.rol;
  state.protegidas = data.protegidas || {};
  state.itinerarios = data.itinerarios || [];
  state.status = data.estado;
  state.version = data.version_publicada;
  state.dirty = !!data.actualizacion_version_2_pendiente;
  state.geomOriginal.clear();
  state.selected = null;
  if (!state.itinerarios.includes(state.scope)) state.scope = "MAESTRO";
  return data;
}
function enterScope(scope) {
  if (state.drawing) stopDrawing();
  if (scope === state.scope) return;
  state.scope = scope;
  state.selected = null;
  state.chip = "todas";
  state.visible.clear();
  renderMap();
  if (isItinerary())
    for (const o of masterObjects()) if (isAssigned(o.id)) state.visible.add(o.id);
  styleAll();
  paintAll();
}
function paintAll() {
  paintScopes();
  paintSummary();
  paintTypes();
  paintChips();
  paintTree();
  paintProps();
  paintCommand();
}
async function boot() {
  toast("Cargando Maestro…");
  const data = await load();
  await loadMaps(data.google_maps_api_key);
  initMap();
  renderMap();
  paintAll();
  toast(
    data.actualizacion_version_2_pendiente
      ? "VERSIÓN 2 preparada: guarda el Maestro y luego valida."
      : "Maestro cargado desde Supabase.",
    "ok",
  );
}
async function invalidateCementoGps() {
  localStorage.removeItem("cemento_precarga_activa");
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("cemento-gps-temporal");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

/* ------------------------------------------------------------------ */
/* Eventos                                                              */
/* ------------------------------------------------------------------ */

$("scope-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-scope]");
  if (b) enterScope(b.dataset.scope);
});
$("type-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]");
  if (!b || b.dataset.type === state.type) return;
  if (state.drawing) stopDrawing();
  state.type = b.dataset.type;
  state.selected = null;
  state.visible.clear();
  renderMap();
  if (isItinerary())
    for (const o of masterObjects()) if (isAssigned(o.id)) state.visible.add(o.id);
  styleAll();
  paintTypes();
  paintChips();
  paintTree();
  paintProps();
});
$("filter-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  if (!b) return;
  state.chip = b.dataset.chip;
  paintChips();
  paintTree();
});
$("object-search").addEventListener("input", (e) => {
  state.filtro = e.target.value;
  paintTree();
});
$("show-all").onclick = () => {
  for (const o of listedObjects()) state.visible.add(o.id);
  styleAll();
  paintTree();
};
$("hide-all").onclick = () => {
  for (const o of listedObjects()) if (o.id !== state.selected) state.visible.delete(o.id);
  styleAll();
  paintTree();
};
$("bulk-on").onclick = async () => {
  const n = listedObjects().filter((o) => !isAssigned(o.id)).length;
  if (!n) return toast("No hay geocercas por asignar en la lista.");
  if (await confirmModal("Asignar listadas", `<p>Se asignarán <b>${n}</b> ${TYPE_PLURAL[state.type]} a <b>${esc(state.scope)}</b>.</p><p class="gm-note">Solo se asigna lo que está en la lista filtrada.</p>`, "Asignar"))
    bulkAssign(true);
};
$("bulk-off").onclick = async () => {
  const rows = listedObjects().filter((o) => isAssigned(o.id));
  const quitables = rows.filter((o) => !protectedRole(o.id)).length;
  if (!quitables) return toast("No hay nada que se pueda quitar en la lista (las protegidas se conservan).");
  if (await confirmModal("Quitar listadas", `<p>Se quitarán <b>${quitables}</b> de <b>${esc(state.scope)}</b>.</p><p class="gm-note">Las geocercas protegidas se conservan. Las geometrías siguen en el Maestro.</p>`, "Quitar", true))
    bulkAssign(false);
};
$("object-tree").addEventListener("click", (e) => {
  const row = e.target.closest(".gt-row");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!row || !act || act === "toggle") return;
  const id = row.dataset.id;
  if (act === "select") selectObject(id, true);
  if (act === "zoom") {
    selectObject(id, false);
    centerObject(id);
  }
  if (act === "eye") {
    state.visible.has(id) ? state.visible.delete(id) : state.visible.add(id);
    styleAll();
    paintTree();
  }
});
$("object-tree").addEventListener("change", (e) => {
  const input = e.target.closest('input[data-act="toggle"]');
  if (!input) return;
  const id = input.closest(".gt-row").dataset.id;
  const ok = setAssigned(id, input.checked);
  if (!ok) input.checked = !input.checked;
  if (ok && input.checked) state.visible.add(id);
  styleAll();
  paintTree();
  paintProps();
  paintSummary();
});
$("new-object").onclick = () => {
  if (state.drawing) return;
  startDrawing();
};
$("draw-undo").onclick = () => {
  state.draftPath.pop();
  paintDraft();
};
$("draw-cancel").onclick = stopDrawing;
$("finish-draw").onclick = finishDrawing;

$("props").addEventListener("click", async (e) => {
  const id = state.selected;
  const btn = e.target.closest("button");
  if (!id || !btn) return;
  if (btn.dataset.assign) {
    const it = btn.dataset.assign;
    const now = isAssigned(id, it);
    if (setAssigned(id, !now, { it })) {
      toast(`${findObject(id).obj.name} ${now ? "quitada de" : "asignada a"} ${it}. Recuerda guardar.`, "ok");
      styleAll();
      paintTree();
      paintProps();
      paintSummary();
    }
    return;
  }
  if (btn.id === "p-zoom") centerObject(id);
  if (btn.id === "p-geom") {
    const keep = id;
    enterScope("MAESTRO");
    selectObject(keep, true);
    toast("Estás en el Maestro: mueve los puntos en el mapa y guarda.");
  }
  if (btn.id === "p-remove" && setAssigned(id, false)) {
    styleAll();
    paintTree();
    paintProps();
    paintSummary();
  }
  if (btn.id === "p-dup") duplicate(id);
  if (btn.id === "p-restore") restoreGeometry(id);
  if (btn.id === "p-delete") await deleteFromMaster(id);
});
$("props").addEventListener("change", (e) => {
  const id = state.selected;
  if (!id) return;
  if (e.target.id === "p-assigned") {
    const ok = setAssigned(id, e.target.checked);
    if (ok && e.target.checked) state.visible.add(id);
    styleAll();
    paintTree();
    paintProps();
    paintSummary();
  }
  if (e.target.id === "p-name") renameMaster(id, e.target.value);
  if (e.target.id === "p-opname") renameOperational(id, e.target.value);
});

document.addEventListener("keydown", (e) => {
  if (!state.drawing || !$("geo-modal").classList.contains("hidden")) return;
  const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
  if (e.key === "Escape") stopDrawing();
  else if (e.key === "Enter" && !typing) finishDrawing();
  else if (!typing && (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey)))) {
    e.preventDefault();
    state.draftPath.pop();
    paintDraft();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

$("save-draft").onclick = () =>
  action($("save-draft"), async () => {
    for (const id of state.overlays.keys()) if (state.geomOriginal.has(id)) syncGeometry(id);
    const data = await api({ action: "guardar_maestro", maestro: state.master });
    // El servidor devuelve el Maestro normalizado en la siguiente lectura;
    // aquí solo se actualiza el estado.
    state.status = data.estado;
    state.dirty = false;
    toast("Maestro guardado. Las publicaciones vigentes no cambiaron. Ahora valida.", "ok");
  });
$("validate-draft").onclick = () =>
  action($("validate-draft"), async () => {
    if (state.dirty) return toast("Guarda el Maestro antes de validarlo.", "error");
    const data = await api({ action: "validar_maestro" });
    state.status = data.estado;
    toast("Maestro validado. Ya puedes publicar un itinerario.", "ok");
  });
$("discard").onclick = async () => {
  if (!state.dirty) return;
  if (!(await confirmModal("Descartar cambios", "<p>Se perderán los cambios que no hayas guardado y se recargará el último Maestro guardado.</p>", "Descartar", true))) return;
  if (state.drawing) stopDrawing();
  await action($("discard"), async () => {
    await load();
    state.visible.clear();
    renderMap();
    if (isItinerary())
      for (const o of masterObjects()) if (isAssigned(o.id)) state.visible.add(o.id);
    styleAll();
    paintAll();
    toast("Cambios descartados.", "ok");
  });
};
$("publish").onclick = () =>
  action($("publish"), async () => {
    if (!isItinerary())
      return toast("Elige un itinerario (Cemento, Cerro Verde o Turno Amanecida) para publicar.", "error");
    if (state.dirty) return toast("Guarda el Maestro y valida los cambios antes de publicar.", "error");
    const c = counts();
    const clear =
      state.scope === "CEMENTO"
        ? `<p class="gm-warn">La precarga GPS vigente de Cemento se invalidará para recalcular la ubicación con la nueva red.</p>`
        : "";
    const ok = await modal({
      title: `Publicar ${state.scope}`,
      ok: "Publicar",
      body: `<ul class="gm-list"><li><b>${c.geocercas}</b> geocercas (${c.protegidas} protegidas · ${c.adicionales} adicionales)</li><li><b>${c.rutas_madre}</b> rutas madre</li><li><b>${c.geocerca_tramo}</b> geocercas de ruta</li></ul><p class="gm-note">Se reemplazará la cartografía publicada de este itinerario por estas asignaciones.</p>${clear}`,
    });
    if (!ok) return;
    const data = await api({ action: "publicar_maestro", itinerario: state.scope });
    if (state.scope === "CEMENTO") await invalidateCementoGps();
    state.status = data.estado;
    state.version = data.version_publicada;
    await modal({
      title: "Publicación realizada",
      ok: "Listo",
      hideCancel: true,
      body: `<p><b>${esc(data.mensaje || `Itinerario ${data.itinerario} actualizado`)}</b></p><ul class="gm-list"><li>${data.publicacion.geocercas} geocercas</li><li>${data.publicacion.rutas_madre} rutas madre</li><li>${data.publicacion.geocercas_ruta} geocercas de ruta</li></ul>${data.itinerario === "CEMENTO" ? `<p class="gm-note">Precarga GPS invalidada: la próxima ejecución recalculará el análisis.</p>` : ""}`,
    });
  });

$("google-login").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-blocked") return signInWithRedirect(auth, provider);
    $("login-message").textContent = error.message;
  }
};
onAuthStateChanged(auth, async (user) => {
  $("login").classList.toggle("hidden", !!user);
  $("editor").classList.toggle("hidden", !user);
  document.body.classList.remove("auth-pending");
  if (!user) return;
  try {
    await boot();
  } catch (error) {
    toast(error.message, "error");
  }
});
