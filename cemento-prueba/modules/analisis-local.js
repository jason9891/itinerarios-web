/**
 * Análisis local optimizado (50 placas).
 *
 * Red:
 *  - 1× geocercas al montar módulo (cuenta operador)
 *  - GPS solo si no hay caché IndexedDB para placa|desde|hasta
 *  - Concurrencia 3 (no en serie)
 * Principal:
 *  - Solo [{ placa, ok }]
 */
import { auth } from "../../shared/auth.js";
import { queryClocator } from "../../shared/clocator-client.js";
import { API, OPERADOR, CENTRAL } from "../registry.js";
import { normalizeFence, analyzeLocal } from "../local-analyze.js";

const GPS_DB = "cemento-prueba-gps-v2";
const GPS_STORE = "routes";
const CONCURRENCY = 3;
const MAX_LINE_POINTS = 80; // simplifica dibujo

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(GPS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GPS_STORE)) db.createObjectStore(GPS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(placa, desde, hasta) {
  return `${placa}|${desde}|${hasta}`;
}

async function getCached(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction(GPS_STORE, "readonly").objectStore(GPS_STORE).get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

async function putCached(key, data) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(GPS_STORE, "readwrite");
    tx.objectStore(GPS_STORE).put({ ...data, cached_at: Date.now() }, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
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

/** Pool de promesas con límite de concurrencia */
async function mapPool(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { error: e };
      }
      done++;
      if (onProgress) onProgress(done, items.length, items[idx]);
    }
  }
  const n = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function simplifyPath(points) {
  const pts = (points || [])
    .map((p) => ({ lat: +p.lat, lng: +p.lng }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length <= MAX_LINE_POINTS) return pts;
  const step = Math.ceil(pts.length / MAX_LINE_POINTS);
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

let map = null;
let layers = [];
let mapsKey = "";
let fencesCache = null; // cargado al montar
let bootPromise = null;

function clearMapLayers() {
  for (const L of layers) {
    try {
      L.setMap(null);
    } catch (_) {}
  }
  layers = [];
}

async function loadMaps(key) {
  if (window.google?.maps) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
}

async function ensureMap(host, key) {
  await loadMaps(key);
  if (!map) {
    map = new google.maps.Map(host, {
      center: { lat: -12.05, lng: -77.05 },
      zoom: 6,
      mapTypeControl: false,
      streetViewControl: false,
      gestureHandling: "greedy",
    });
  }
}

function drawUnit(points, ok) {
  if (!map || !points?.length) return;
  const path = simplifyPath(points);
  if (!path.length) return;
  layers.push(
    new google.maps.Polyline({
      map,
      path,
      strokeColor: ok ? "#16a34a" : "#dc2626",
      strokeOpacity: 0.8,
      strokeWeight: 3,
    }),
  );
  layers.push(
    new google.maps.Marker({
      map,
      position: path[path.length - 1],
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: ok ? "#16a34a" : "#dc2626",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 1,
      },
    }),
  );
  return path;
}

/** Precarga geocercas + maps key (1 sola red al abrir módulo) */
async function bootGeo(token) {
  if (fencesCache && mapsKey) return { fences: fencesCache, mapsKey };
  const cfgR = await fetch(API.clocator, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "map_config" }),
    signal: AbortSignal.timeout(45000),
  });
  const cfg = await cfgR.json().catch(() => ({}));
  if (!cfgR.ok) throw new Error(cfg.error || `map_config ${cfgR.status}`);
  mapsKey = cfg.google_maps_api_key || mapsKey;
  fencesCache = (cfg.geocercas || [])
    .map(normalizeFence)
    .filter((f) => f.ring?.length);
  if (!mapsKey) {
    try {
      const r = await fetch(CENTRAL.clocatorFallback || API.clocator, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "map_config" }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      mapsKey = j.google_maps_api_key || "";
    } catch (_) {}
  }
  return { fences: fencesCache, mapsKey };
}

export async function mount(container) {
  map = null;
  layers = [];
  // no reset fencesCache: reutilizar entre visitas al módulo en la misma sesión

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:340px 1fr;gap:12px;height:calc(100vh - 90px)">
      <section style="background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:12px;overflow:auto">
        <h2 style="margin:0 0 8px;font-size:15px;color:#0b2f68">Análisis local · SI / NO</h2>
        <p style="font-size:12px;color:#64748b;margin:0 0 8px">
          Geocercas 1× al abrir. GPS en paralelo (×${CONCURRENCY}) con caché por placa+rango.
          Al principal solo <code>[{placa, ok}]</code>.
        </p>
        <textarea id="al-plates" rows="12" style="width:100%;font:12px ui-monospace,monospace;padding:8px;border:1px solid #cbd5e1;border-radius:6px"
          placeholder="Una placa por línea (máx 50)"></textarea>
        <label style="font-size:11px;font-weight:700;display:block;margin-top:8px">Desde</label>
        <input id="al-from" style="width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:6px"/>
        <label style="font-size:11px;font-weight:700;display:block">Hasta</label>
        <input id="al-to" style="width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px"/>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <button type="button" id="al-run" style="flex:1;padding:10px;font-weight:800;background:#0b2f68;color:#fff;border:none;border-radius:8px;cursor:pointer">ANALIZAR + DIBUJAR</button>
          <button type="button" id="al-send" disabled style="flex:1;padding:10px;font-weight:800;background:#15803d;color:#fff;border:none;border-radius:8px;cursor:pointer">SUBIR SI/NO AL PRINCIPAL</button>
        </div>
        <p id="al-status" style="font-size:12px;color:#475569;margin-top:8px"></p>
        <div id="al-stats" style="font-size:11px;color:#64748b;margin-top:4px"></div>
        <ul id="al-list" style="list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px"></ul>
      </section>
      <section style="background:#fff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;min-height:420px">
        <div id="al-map" style="width:100%;height:100%;min-height:420px;display:grid;place-items:center;color:#64748b">Mapa de rutas</div>
      </section>
    </div>
  `;

  const pe = nowPE();
  container.querySelector("#al-from").value = pe.replace(/\d{2}:\d{2}:\d{2}$/, "00:00:00");
  container.querySelector("#al-to").value = pe;

  let resultados = [];

  const setStatus = (msg, ok) => {
    const el = container.querySelector("#al-status");
    el.textContent = msg;
    el.style.color = ok === false ? "#b91c1c" : ok === true ? "#15803d" : "#475569";
  };

  // Boot geocercas en background al abrir
  bootPromise = (async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken(true);
      setStatus("Precargando geocercas (operador)…");
      const { fences } = await bootGeo(token);
      setStatus(`Geocercas listas (${fences.length}). Puede analizar.`, true);
    } catch (e) {
      setStatus("Geocercas: " + (e.message || e), false);
    }
  })();

  container.querySelector("#al-run").onclick = async () => {
    const units = parsePlates(container.querySelector("#al-plates").value).slice(0, 50);
    if (!units.length) {
      setStatus("Ingrese placas.", false);
      return;
    }
    const desde = container.querySelector("#al-from").value.trim();
    const hasta = container.querySelector("#al-to").value.trim() || nowPE();
    const btn = container.querySelector("#al-run");
    const send = container.querySelector("#al-send");
    btn.disabled = true;
    send.disabled = true;
    resultados = [];
    clearMapLayers();
    container.querySelector("#al-list").innerHTML = "";
    container.querySelector("#al-stats").textContent = "";

    const t0 = performance.now();
    let cacheHits = 0;
    let netFetches = 0;

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sin sesión Firebase");
      const token = await user.getIdToken(true);

      await bootPromise;
      const { fences, mapsKey: key } = await bootGeo(token);
      if (!key) throw new Error("Sin Google Maps API key");

      const host = container.querySelector("#al-map");
      host.textContent = "";
      await ensureMap(host, key);
      const bounds = new google.maps.LatLngBounds();

      const rows = await mapPool(
        units,
        CONCURRENCY,
        async (u) => {
          const keyC = cacheKey(u.placa, desde, hasta);
          let points = [];
          let fromCache = false;
          const cached = await getCached(keyC);
          if (cached?.puntos_gps?.length) {
            points = cached.puntos_gps;
            fromCache = true;
            cacheHits++;
          } else {
            const data = await queryClocator({
              endpoint: API.clocator,
              token,
              placa: u.placa,
              tracto: u.tracto,
              desde,
              hasta,
              includeMap: false,
              timeoutMs: 50000,
            });
            points = data.puntos_gps || [];
            await putCached(keyC, { puntos_gps: points });
            netFetches++;
          }
          const an = analyzeLocal(points, fences || []);
          const ok =
            an.puntos > 0 && (!!an.ultima_geocerca || an.puntos >= 5);
          const motivo = an.ultima_geocerca
            ? `geo:${an.ultima_geocerca}`
            : an.puntos
              ? `pts:${an.puntos}`
              : "sin_puntos";
          return { placa: u.placa, ok, motivo, points, fromCache };
        },
        (done, total, item) => {
          setStatus(`${done}/${total} · ${item?.placa || ""}`);
        },
      );

      const list = container.querySelector("#al-list");
      for (const row of rows) {
        if (row?.error) {
          const e = row.error;
          resultados.push({
            placa: "?",
            ok: false,
            motivo: e.message || String(e),
          });
          continue;
        }
        resultados.push({ placa: row.placa, ok: row.ok, motivo: row.motivo });
        if (row.points?.length) {
          const path = drawUnit(row.points, row.ok);
          path?.forEach((p) => bounds.extend(p));
        }
        const li = document.createElement("li");
        li.style.cssText =
          "display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px";
        const cacheTag = row.fromCache ? " · caché" : "";
        li.innerHTML = `<b>${row.placa}</b><span style="color:${row.ok ? "#15803d" : "#b91c1c"};font-weight:800">${row.ok ? "SI" : "NO"}${cacheTag}</span>`;
        li.title = row.motivo || "";
        list.appendChild(li);
      }

      try {
        if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
      } catch (_) {}

      const si = resultados.filter((r) => r.ok).length;
      const ms = Math.round(performance.now() - t0);
      setStatus(`Listo: ${si} SI · ${resultados.length - si} NO · ${ms} ms`, true);
      container.querySelector("#al-stats").textContent =
        `caché ${cacheHits} · red ${netFetches} · geocercas ${fences?.length || 0} · paralelo ×${CONCURRENCY}`;
      send.disabled = !resultados.length;
    } catch (e) {
      setStatus(e.message || String(e), false);
    } finally {
      btn.disabled = false;
    }
  };

  container.querySelector("#al-send").onclick = async () => {
    if (!resultados.length) return;
    const btn = container.querySelector("#al-send");
    btn.disabled = true;
    btn.textContent = "SUBIENDO…";
    try {
      const token = await auth.currentUser.getIdToken(true);
      const payload = resultados.map(({ placa, ok }) => ({ placa, ok: !!ok }));
      const r = await fetch(API.mensaje, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "enviar_resultados",
          resultados: payload,
          origen: "cemento-prueba-analisis-local",
          operador_ref: OPERADOR.ref,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(
        `Principal OK · ${payload.length}× {placa, ok} · id=${j.id || "—"}`,
        true,
      );
    } catch (e) {
      setStatus(e.message || String(e), false);
    } finally {
      btn.disabled = false;
      btn.textContent = "SUBIR SI/NO AL PRINCIPAL";
    }
  };
}

export function unmount() {
  clearMapLayers();
  map = null;
}
