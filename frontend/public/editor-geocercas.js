import { initializeApp } from "/vendor/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
} from "/vendor/firebase-auth.js";

const FIREBASE = {
  apiKey: "AIzaSyAeTPLS3r-199T__22TKrPMpZVZFe8IZI8",
  authDomain: "itinerarios-2fa6f.firebaseapp.com",
  projectId: "itinerarios-2fa6f",
  storageBucket: "itinerarios-2fa6f.firebasestorage.app",
  messagingSenderId: "436339112360",
  appId: "1:436339112360:web:ed48a2b8941572a77ec59d",
};
const API =
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/editor-geocercas",
  TYPES = ["geocercas", "rutas_madre", "geocerca_tramo"],
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
const auth = getAuth(initializeApp(FIREBASE)),
  provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
let state = {
  master: null,
  scope: "MAESTRO",
  type: "geocercas",
  selected: null,
  map: null,
  overlays: new Map(),
  visible: new Set(),
  drawing: null,
  draftPath: [],
  draftOverlay: null,
  dirty: false,
  role: "",
  status: "SIN_BORRADOR",
  version: 0,
};

async function api(body) {
  const response = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
function message(text, error = false) {
  $("geo-message").textContent = text;
  $("geo-message").classList.toggle("error", error);
}
async function action(button, work) {
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    message(
      error instanceof Error ? error.message : "No se pudo completar la acción",
      true,
    );
  } finally {
    button.disabled = false;
  }
}
function setState() {
  $("project-state").textContent =
    `${state.status} · VERSIÓN ${state.version}${state.dirty ? " · CAMBIOS SIN GUARDAR" : ""}`;
}
function masterObjects(type = state.type) {
  return state.master?.objetos?.[type] || [];
}
function assignment(id, itinerary = state.scope) {
  return (state.master?.asignaciones?.[itinerary] || []).find(
    (x) => x.maestro_id === id,
  );
}
function visibleObjects() {
  return masterObjects();
}
function assignmentCounts(itinerary = state.scope) {
  const rows = state.master?.asignaciones?.[itinerary] || [];
  return {
    geocercas: rows.filter((x) => x.activa && x.tipo === "geocercas").length,
    rutas_madre: rows.filter((x) => x.activa && x.tipo === "rutas_madre").length,
    geocerca_tramo: rows.filter((x) => x.activa && x.tipo === "geocerca_tramo").length,
  };
}
function selectedObject() {
  return TYPES.flatMap((t) => masterObjects(t)).find(
    (x) => x.id === state.selected,
  );
}
function coordsPath(path) {
  return path.map((c) => ({ lat: +c[1], lng: +c[0] }));
}
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
    return g.coordinates.map((line) => ({
      shape: "line",
      path: coordsPath(line),
    }));
  return [];
}
const colors = {
  geocercas: "#2563eb",
  rutas_madre: "#f97316",
  geocerca_tramo: "#7c3aed",
};

async function loadMaps(key) {
  if (window.google?.maps) return;
  if (!key) throw Error("Falta GOOGLE_MAPS_API_KEY en Supabase");
  await new Promise((resolve, reject) => {
    window.__editorMapsReady = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__editorMapsReady`;
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
function renderMap() {
  for (const list of state.overlays.values())
    for (const overlay of list) overlay.setMap(null);
  state.overlays.clear();
  for (const obj of visibleObjects()) {
    const list = [];
    for (const part of overlayParts(obj)) {
      const common = {
        map: state.visible.has(obj.id) ? state.map : null,
        strokeColor: colors[state.type],
        strokeOpacity: 0.9,
        strokeWeight: state.type === "rutas_madre" ? 4 : 2,
        clickable: true,
        editable: false,
      };
      const overlay =
        part.shape === "polygon"
          ? new google.maps.Polygon({
              ...common,
              paths: part.paths,
              fillColor: colors[state.type],
              fillOpacity: 0.13,
            })
          : new google.maps.Polyline({ ...common, path: part.path });
      overlay.addListener("click", () => selectObject(obj.id));
      list.push(overlay);
    }
    state.overlays.set(obj.id, list);
  }
  if (state.selected) selectObject(state.selected, false);
}
function syncGeometry() {
  if (state.scope !== "MAESTRO" || !state.selected) return;
  const obj = selectedObject(),
    list = state.overlays.get(state.selected) || [];
  if (!obj || !list.length) return;
  if (list[0] instanceof google.maps.Polygon) {
    const polys = list.map((overlay) => {
      const rings = [];
      for (let i = 0; i < overlay.getPaths().getLength(); i++)
        rings.push(pathCoords(overlay.getPaths().getAt(i)));
      return rings;
    });
    obj.geometry = {
      type: polys.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: polys.length === 1 ? polys[0] : polys,
    };
  } else {
    const lines = list.map((overlay) => pathCoords(overlay.getPath()));
    obj.geometry = {
      type: lines.length === 1 ? "LineString" : "MultiLineString",
      coordinates: lines.length === 1 ? lines[0] : lines,
    };
  }
}
function editOverlay(overlay) {
  if (state.scope !== "MAESTRO") return;
  const paths =
    overlay instanceof google.maps.Polygon
      ? overlay.getPaths()
      : [overlay.getPath()];
  for (const path of paths)
    for (const event of ["set_at", "insert_at", "remove_at"])
      path.addListener(event, () => {
        syncGeometry();
        state.dirty = true;
        setState();
      });
}
function centerObject() {
  const list = state.overlays.get(state.selected) || [];
  if (!list.length) return;
  const bounds = new google.maps.LatLngBounds();
  for (const overlay of list) {
    if (overlay instanceof google.maps.Polygon)
      for (let i = 0; i < overlay.getPaths().getLength(); i++)
        overlay
          .getPaths()
          .getAt(i)
          .forEach((p) => bounds.extend(p));
    else overlay.getPath().forEach((p) => bounds.extend(p));
  }
  if (!bounds.isEmpty()) state.map.fitBounds(bounds);
}
function selectObject(id, center = true) {
  const obj = TYPES.flatMap((type) =>
    masterObjects(type).map((x) => ({ ...x, __type: type })),
  ).find((x) => x.id === id);
  if (!obj) return;
  state.selected = id;
  if (obj.__type !== state.type) {
    state.type = obj.__type;
    paintTabs();
  }
  state.visible.add(id);
  for (const [objectId, list] of state.overlays)
    for (const overlay of list) {
      const editing = state.scope === "MAESTRO" && objectId === id;
      overlay.setEditable?.(editing);
      overlay.setMap(state.visible.has(objectId) ? state.map : null);
      if (editing) editOverlay(overlay);
    }
  $("empty-properties").classList.add("hidden");
  $("properties").classList.remove("hidden");
  $("object-id").value = obj.id;
  $("object-name").value = obj.name;
  $("object-name").readOnly = state.scope !== "MAESTRO";
  $("object-kind").value = obj.kind;
  $("delete-object").classList.toggle("hidden", state.scope !== "MAESTRO");
  $("delete-object").textContent =
    obj.__type === "geocercas"
      ? "ELIMINAR GEOCERCA"
      : obj.__type === "rutas_madre"
        ? "ELIMINAR RUTA MADRE"
        : "ELIMINAR GEOCERCA DE RUTA";
  const box = $("assignment-box");
  box.classList.toggle("hidden", state.scope === "MAESTRO");
  if (state.scope !== "MAESTRO") {
    const a = assignment(id);
    $("assigned").checked = !!a?.activa;
    $("operational-name").value = a?.nombre_operativo || obj.name;
  }
  const list = state.overlays.get(id) || [],
    count = list.reduce(
      (n, o) =>
        n +
        (o instanceof google.maps.Polygon
          ? [...Array(o.getPaths().getLength()).keys()].reduce(
              (s, i) => s + o.getPaths().getAt(i).getLength(),
              0,
            )
          : o.getPath().getLength()),
      0,
    );
  $("vertex-count").textContent =
    `${count} vértices${state.scope === "MAESTRO" ? " editables" : " · geometría compartida"}`;
  renderTree();
  if (center) centerObject();
}
function renderTree() {
  const rows = visibleObjects();
  $("object-tree").innerHTML =
    rows
      .map((o) => {
        const a = state.scope === "MAESTRO" ? null : assignment(o.id),
          assigned = !!a?.activa;
        return `<div class="geo-tree-item ${o.id === state.selected ? "selected" : ""} ${assigned ? "assigned" : ""}" data-id="${esc(o.id)}"><button class="geo-eye">${state.visible.has(o.id) ? "◉" : "○"}</button><button class="geo-name">${state.scope === "MAESTRO" ? "" : assigned ? "✓ " : "○ "}${esc(a?.nombre_operativo || o.name)}</button><button class="geo-center">⌖</button></div>`;
      })
      .join("") ||
    `<div class="geo-empty">No hay objetos en el Maestro.</div>`;
  document.querySelectorAll(".geo-tree-item").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".geo-eye").onclick = (event) => {
      event.stopPropagation();
      state.visible.has(id) ? state.visible.delete(id) : state.visible.add(id);
      for (const overlay of state.overlays.get(id) || [])
        overlay.setMap(state.visible.has(id) ? state.map : null);
      renderTree();
    };
    row.querySelector(".geo-name").onclick = () => selectObject(id);
    row.querySelector(".geo-center").onclick = () => {
      selectObject(id, false);
      centerObject();
    };
  });
}
function paintTabs() {
  document
    .querySelectorAll("[data-type]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.type === state.type),
    );
  $("new-object").disabled = state.scope !== "MAESTRO";
  $("publish").disabled = state.scope === "MAESTRO";
  $("publish").textContent =
    state.scope === "MAESTRO"
      ? "SELECCIONE UN ITINERARIO"
      : `SUBIR A ${state.scope}`;
  renderMap();
  renderTree();
}
function paintDraft() {
  state.draftOverlay?.setMap(null);
  const polygon = state.drawing !== "rutas_madre";
  state.draftOverlay = polygon
    ? new google.maps.Polygon({
        map: state.map,
        paths: state.draftPath,
        strokeColor: colors[state.drawing],
        fillColor: colors[state.drawing],
        fillOpacity: 0.16,
        strokeWeight: 3,
      })
    : new google.maps.Polyline({
        map: state.map,
        path: state.draftPath,
        strokeColor: colors[state.drawing],
        strokeWeight: 4,
      });
  $("finish-draw").textContent =
    `FINALIZAR DIBUJO · ${state.draftPath.length} PUNTOS`;
}
async function invalidateCementoGps() {
  localStorage.removeItem("cemento_precarga_activa");
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("cemento-gps-temporal");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function boot() {
  message("Cargando Maestro…");
  const data = await api({ action: "leer_maestro" });
  state.master = structuredClone(data.maestro);
  state.role = data.rol;
  state.status = data.estado;
  state.version = data.version_publicada;
  state.dirty = !!data.actualizacion_version_2_pendiente;
  $("scope").innerHTML =
    `<option value="MAESTRO">MAESTRO GENERAL</option>${data.itinerarios.map((x) => `<option value="${esc(x)}">ASIGNACIONES · ${esc(x)}</option>`).join("")}`;
  await loadMaps(data.google_maps_api_key);
  initMap();
  setState();
  paintTabs();
  message(
    data.actualizacion_version_2_pendiente
      ? "VERSIÓN 2 preparada. GUARDA EL MAESTRO y luego VALIDA antes de publicar."
      : data.origen_inicial === "SUPABASE"
        ? "Maestro VERSIÓN 2 cargado desde Supabase."
        : "Maestro VERSIÓN 2 precargado. Guarda para registrarlo.",
  );
}

$("scope").onchange = () => {
  syncGeometry();
  state.scope = $("scope").value;
  state.selected = null;
  state.visible.clear();
  $("properties").classList.add("hidden");
  $("empty-properties").classList.remove("hidden");
  paintTabs();
};
document.querySelectorAll("[data-type]").forEach(
  (button) =>
    (button.onclick = () => {
      syncGeometry();
      state.type = button.dataset.type;
      state.selected = null;
      state.visible.clear();
      $("properties").classList.add("hidden");
      $("empty-properties").classList.remove("hidden");
      paintTabs();
    }),
);
$("show-all").onclick = () => {
  for (const object of visibleObjects()) state.visible.add(object.id);
  renderMap();
  renderTree();
};
$("hide-all").onclick = () => {
  state.visible.clear();
  renderMap();
  renderTree();
};
$("new-object").onclick = () => {
  if (state.scope !== "MAESTRO")
    return message("Los objetos nuevos se crean en el Maestro.", true);
  state.drawing = state.type;
  state.draftPath = [];
  state.draftOverlay?.setMap(null);
  $("finish-draw").classList.remove("hidden");
  $("geo-map").classList.add("geo-drawing");
  message(
    `Dibuja ${state.type === "rutas_madre" ? "una línea" : "un polígono"} haciendo clic en el mapa.`,
  );
};
$("finish-draw").onclick = () => {
  const min = state.drawing === "rutas_madre" ? 2 : 3;
  if (state.draftPath.length < min)
    return message(`Se requieren al menos ${min} puntos.`, true);
  const name = prompt(
    "Nombre maestro del nuevo objeto:",
    state.drawing === "rutas_madre" ? "NUEVA RUTA MADRE" : "NUEVA GEOCERCA",
  );
  if (!name) return;
  const coords = state.draftPath.map((p) => [
      +p.lng.toFixed(7),
      +p.lat.toFixed(7),
    ]),
    obj = {
      id: `GEO_${crypto.randomUUID()}`,
      name: name.trim(),
      kind:
        state.drawing === "rutas_madre"
          ? "ruta_madre"
          : state.drawing === "geocerca_tramo"
            ? "geocerca_tramo"
            : "geocerca",
      geometry: {
        type: state.drawing === "rutas_madre" ? "LineString" : "Polygon",
        coordinates: state.drawing === "rutas_madre" ? coords : [coords],
      },
    };
  state.master.objetos[state.drawing].push(obj);
  state.draftOverlay?.setMap(null);
  state.draftOverlay = null;
  state.drawing = null;
  state.draftPath = [];
  state.dirty = true;
  $("finish-draw").classList.add("hidden");
  $("geo-map").classList.remove("geo-drawing");
  state.visible.add(obj.id);
  paintTabs();
  selectObject(obj.id);
  setState();
};
$("save-object").onclick = () => {
  const obj = selectedObject();
  if (!obj) return;
  if (state.scope === "MAESTRO") {
    const name = $("object-name").value.trim();
    if (!name) return message("El nombre maestro no puede quedar vacío.", true);
    obj.name = name;
  } else {
    let list = state.master.asignaciones[state.scope] || [],
      a = assignment(obj.id);
    if ($("assigned").checked && !a) {
      a = {
        maestro_id: obj.id,
        nombre_operativo: $("operational-name").value.trim() || obj.name,
        tipo: state.type,
        activa: true,
      };
      list.push(a);
    } else if (a) {
      a.activa = $("assigned").checked;
      a.nombre_operativo = $("operational-name").value.trim() || obj.name;
      a.tipo = state.type;
    }
    state.master.asignaciones[state.scope] = list;
  }
  state.dirty = true;
  setState();
  renderTree();
  message("Cambio preparado en el borrador del Maestro.");
};
$("center-object").onclick = centerObject;
$("delete-object").onclick = () => {
  const obj = selectedObject();
  if (state.scope !== "MAESTRO" || !obj) return;
  const usedIn = Object.entries(state.master.asignaciones || {})
    .filter(([, rows]) => (rows || []).some((x) => x.maestro_id === obj.id && x.activa !== false))
    .map(([name]) => name);
  const affected = usedIn.length
    ? `\n\nActualmente está asignada en: ${usedIn.join(", ")}.`
    : "\n\nNo tiene asignaciones activas.";
  if (!confirm(
    `ELIMINAR DEL MAESTRO\n\n${obj.name}${affected}\n\nSe eliminará la geometría y todas sus asignaciones. Después debes GUARDAR, VALIDAR y SUBIR los itinerarios afectados.\n\n¿Continuar?`,
  )) return;
  state.master.objetos[state.type] = masterObjects().filter(
    (x) => x.id !== obj.id,
  );
  for (const itinerary of Object.keys(state.master.asignaciones))
    state.master.asignaciones[itinerary] = state.master.asignaciones[
      itinerary
    ].filter((x) => x.maestro_id !== obj.id);
  state.selected = null;
  state.dirty = true;
  $("properties").classList.add("hidden");
  $("empty-properties").classList.remove("hidden");
  paintTabs();
  setState();
};
$("save-draft").onclick = () =>
  action($("save-draft"), async () => {
    syncGeometry();
    const data = await api({
      action: "guardar_maestro",
      maestro: state.master,
    });
    state.status = data.estado;
    state.dirty = false;
    setState();
    message("Maestro guardado. Las publicaciones vigentes no cambiaron.");
  });
$("validate-draft").onclick = () =>
  action($("validate-draft"), async () => {
    if (state.dirty)
      return message("Guarda el Maestro antes de validarlo.", true);
    const data = await api({ action: "validar_maestro" });
    state.status = data.estado;
    setState();
    message("Maestro y asignaciones validados. Aún no están publicados.");
  });
$("publish").onclick = () =>
  action($("publish"), async () => {
    if (state.scope === "MAESTRO")
      return message("Seleccione Cemento o Cerro Verde para publicar.", true);
    if (state.dirty)
      return message("Guarda el Maestro y valida los cambios antes de publicar.", true);
    const counts = assignmentCounts();
    const clear =
      state.scope === "CEMENTO"
        ? "\n\nLa precarga GPS vigente de Cemento se invalidará para recalcular la ubicación con la nueva red."
        : "";
    if (
      !confirm(
        `ACTUALIZAR ${state.scope}\n\n` +
          `Geocercas: ${counts.geocercas}\n` +
          `Rutas madre: ${counts.rutas_madre}\n` +
          `Geocercas de ruta: ${counts.geocerca_tramo}\n\n` +
          `Se reemplazará la cartografía publicada de este itinerario por estas asignaciones.${clear}\n\n¿Continuar?`,
      )
    )
      return;
    const data = await api({
      action: "publicar_maestro",
      itinerario: state.scope,
    });
    if (state.scope === "CEMENTO") await invalidateCementoGps();
    state.status = data.estado;
    state.version = data.version_publicada;
    setState();
    const confirmation =
      `${data.mensaje || `RUTAS Y GEOCERCAS ACTUALIZADAS EN EL ITINERARIO ${data.itinerario}`}\n\n` +
      `${data.publicacion.geocercas} geocercas · ` +
      `${data.publicacion.rutas_madre} rutas madre · ` +
      `${data.publicacion.geocercas_ruta} geocercas de ruta` +
      `${data.itinerario === "CEMENTO" ? "\n\nPrecarga GPS invalidada: la próxima ejecución recalculará el análisis." : ""}`;
    message(confirmation.replaceAll("\n", " · "));
    alert(confirmation);
  });
$("google-login").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-blocked")
      return signInWithRedirect(auth, provider);
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
    message(error.message, true);
  }
});
