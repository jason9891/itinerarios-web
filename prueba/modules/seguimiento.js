/**
 * PRUEBA · Seguimiento mínimo: lista de placas + mapa.
 * GPS → Supabase del operador (tenant). Fallback opcional al principal.
 */
import { auth } from "../../shared/auth.js";
import { queryClocator } from "../../shared/clocator-client.js";
import { CENTRAL } from "../registry.js";
import { loadTenant, resolveClocatorUrl } from "../tenant.js";

let map = null;
let layers = [];
let selected = "";

export async function mount(container) {
  selected = "";
  layers = [];
  map = null;

  const user = auth.currentUser;
  const cfg = loadTenant(user);
  const clocator = resolveClocatorUrl(cfg);

  container.innerHTML = `
    <div class="prueba-layout">
      <section class="prueba-panel">
        <h2>Placas</h2>
        <p class="prueba-hint">Una placa por línea. Opcional: <code>PLACA|TRACTO</code></p>
        <textarea id="p-plates" placeholder="ABC123&#10;XYZ789|20-R-100"></textarea>
        <label class="prueba-hint">Desde (PE)</label>
        <input id="p-from" type="text" placeholder="dd/mm/yyyy hh:mm:ss">
        <label class="prueba-hint">Hasta (PE)</label>
        <input id="p-to" type="text" placeholder="dd/mm/yyyy hh:mm:ss">
        <div class="prueba-actions">
          <button type="button" id="p-load">CARGAR RUTAS</button>
          <button type="button" id="p-clear" class="secondary">LIMPIAR MAPA</button>
        </div>
        <p id="p-status" class="prueba-status">${
          clocator
            ? "Endpoint GPS: " + esc(clocator)
            : "Configure MI SUPABASE o se usará fallback del principal (solo para esta prueba)."
        }</p>
        <ul id="p-list" class="prueba-plate-list"></ul>
      </section>
      <section class="prueba-map-wrap">
        <div id="prueba-map">Cargue placas para ver el mapa.</div>
      </section>
    </div>
  `;

  // Defaults de rango: hoy 00:00 → ahora (Lima)
  const now = nowPE();
  const todayStart = now.replace(/\d{2}:\d{2}:\d{2}$/, "00:00:00");
  container.querySelector("#p-from").value = todayStart;
  container.querySelector("#p-to").value = now;

  const results = new Map(); // placa -> data

  container.querySelector("#p-clear").onclick = () => {
    clearLayers();
    results.clear();
    container.querySelector("#p-list").innerHTML = "";
    setStatus(container, "Mapa limpio.", "");
  };

  container.querySelector("#p-load").onclick = async () => {
    const btn = container.querySelector("#p-load");
    const raw = container.querySelector("#p-plates").value;
    const units = parsePlates(raw);
    if (!units.length) {
      setStatus(container, "Ingrese al menos una placa.", "err");
      return;
    }
    const desde = container.querySelector("#p-from").value.trim();
    const hasta = container.querySelector("#p-to").value.trim();
    if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(desde)) {
      setStatus(container, "Fecha DESDE inválida (dd/mm/yyyy hh:mm:ss).", "err");
      return;
    }

    let endpoint = resolveClocatorUrl(loadTenant(user));
    let usedFallback = false;
    if (!endpoint) {
      endpoint = CENTRAL.clocatorFallback;
      usedFallback = true;
    }

    btn.disabled = true;
    btn.textContent = "CARGANDO…";
    results.clear();
    const listEl = container.querySelector("#p-list");
    listEl.innerHTML = "";

    try {
      const token = await user.getIdToken(true);
      let ok = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        setStatus(
          container,
          `${usedFallback ? "[fallback principal] " : ""}Consultando ${u.placa} (${i + 1}/${units.length})…`,
          "",
        );
        try {
          const data = await queryClocator({
            endpoint,
            fallbackEndpoint: usedFallback ? "" : CENTRAL.clocatorFallback,
            token,
            placa: u.placa,
            tracto: u.tracto,
            desde,
            hasta: hasta || nowPE(),
            includeMap: i === 0,
          });
          results.set(u.placa, data);
          ok++;
          appendPlateRow(listEl, u.placa, data, () => {
            selected = u.placa;
            paintList(listEl, results, selected);
            drawRoute(data).catch((e) =>
              setStatus(container, e.message || String(e), "err"),
            );
          });
        } catch (e) {
          results.set(u.placa, { error: e.message || String(e) });
          appendPlateRow(listEl, u.placa, { error: e.message }, null);
        }
      }
      setStatus(
        container,
        `Listo: ${ok}/${units.length} con datos${usedFallback ? " · usó fallback principal" : ""}. Click en una placa para dibujar.`,
        ok ? "ok" : "err",
      );
      // Auto-dibujar la primera con puntos
      for (const [placa, data] of results) {
        if (data?.puntos_gps?.length) {
          selected = placa;
          paintList(listEl, results, selected);
          await drawRoute(data);
          break;
        }
      }
    } catch (e) {
      setStatus(container, e.message || String(e), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "CARGAR RUTAS";
    }
  };
}

export function unmount() {
  clearLayers();
  map = null;
}

function parsePlates(raw) {
  const out = [];
  const seen = new Set();
  for (const line of String(raw || "").split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const [placa, tracto = ""] = t.split("|").map((x) => x.trim());
    const key = placa.toUpperCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ placa: key, tracto: tracto.toUpperCase() });
  }
  return out;
}

function appendPlateRow(listEl, placa, data, onClick) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.placa = placa;
  const n = data?.puntos_gps?.length || 0;
  const err = data?.error;
  btn.innerHTML = `<b>${esc(placa)}</b><small>${
    err ? esc(err) : n + " puntos"
  }</small>`;
  if (onClick && !err && n) btn.onclick = onClick;
  else if (err) btn.disabled = true;
  li.appendChild(btn);
  listEl.appendChild(li);
}

function paintList(listEl, results, selectedPlaca) {
  listEl.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.placa === selectedPlaca);
  });
}

function setStatus(container, text, cls) {
  const el = container.querySelector("#p-status");
  if (!el) return;
  el.textContent = text;
  el.className = "prueba-status" + (cls ? " " + cls : "");
}

function clearLayers() {
  for (const L of layers) {
    try {
      L.setMap(null);
    } catch (_) {}
  }
  layers = [];
}

async function drawRoute(data) {
  const pts = (data?.puntos_gps || [])
    .map((p) => ({
      lat: +p.lat,
      lng: +p.lng,
      fecha: p.fecha || "",
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) throw new Error("Sin puntos para dibujar");

  const key =
    data?.google_maps_api_key ||
    (await ensureMapsKey(data));
  await loadMaps(key);

  const host = document.getElementById("prueba-map");
  if (!host) return;
  host.textContent = "";

  if (!map) {
    map = new google.maps.Map(host, {
      center: pts[0],
      zoom: 9,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
  }

  clearLayers();
  const bounds = new google.maps.LatLngBounds();
  pts.forEach((p) => bounds.extend(p));

  const line = new google.maps.Polyline({
    map,
    path: pts,
    strokeColor: "#2563eb",
    strokeOpacity: 0.95,
    strokeWeight: 5,
  });
  layers.push(line);

  const mk = (pos, text, color) => {
    const m = new google.maps.Marker({
      map,
      position: pos,
      label: { text, color: "#fff", fontWeight: "800", fontSize: "11px" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
      title: text + " · " + (pos.fecha || ""),
    });
    layers.push(m);
  };
  mk(pts[0], "I", "#16a34a");
  mk(pts.at(-1), "F", "#1d4ed8");
  map.fitBounds(bounds, 40);
}

let mapsKeyCache = "";
async function ensureMapsKey(data) {
  if (data?.google_maps_api_key) {
    mapsKeyCache = data.google_maps_api_key;
    return mapsKeyCache;
  }
  if (mapsKeyCache) return mapsKeyCache;
  // Intentar map_config en fallback principal
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión");
  const token = await user.getIdToken();
  const r = await fetch(CENTRAL.clocatorFallback, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "map_config" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.google_maps_api_key) {
    throw new Error("No hay Google Maps API key (map_config)");
  }
  mapsKeyCache = j.google_maps_api_key;
  return mapsKeyCache;
}

function loadMaps(key) {
  if (window.google?.maps) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
}

function nowPE() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(",", "");
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
