import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import { load } from "npm:cheerio@1.1.2";
import makeFetchCookie from "npm:fetch-cookie@3.1.0";
import { CookieJar } from "npm:tough-cookie@5.1.2";
import geodata from "./GEOCERCAS.json" with {
  type: "json"
};
import routeFallback from "./RUTAS_RED_VALIDADA.json" with {
  type: "json"
};
const PROJECT = "itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://5000-cs-a2a47bf9-3b6a-4a54-b115-36fc3cb753b5.cs-us-east1-vpcf.cloudshell.dev",
  "https://jason9891.github.io"
]);
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const BASE = "https://clocatorplus.comsatel.com.pe/CL", LOGIN = `${BASE}/faces/seguridad/login.xhtml`, MAIN = `${BASE}/faces/page/main.xhtml`, RPC = `${BASE}/JSON-RPC`;
function reply(req, body, status = 200) {
  const o = req.headers.get("origin") || "", h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS"
  };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return new Response(JSON.stringify(body), {
    status,
    headers: h
  });
}
async function registrarEgress(db, user, servicio, body) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (bytes > 0) await db.from("app_egress_log").insert({
      itinerario: "CEMENTO",
      servicio,
      bytes,
      usuario: String(user?.email || "")
    });
  } catch (e) {
    console.warn("No se pudo registrar egress CLocator PRUEBA 17", e);
  }
}
async function secure(req) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw new Error("Origen no autorizado");
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw new Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(h.slice(7), JWKS, {
    algorithms: [
      "RS256"
    ],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT
  });
  const uid = String(payload.sub || "");
  if (!uid) throw new Error("Identidad Firebase no válida");
  const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const { data: u, error } = await db.from("app_usuarios").select("id,email,rol,itinerarios,activo,firebase_uid").eq("firebase_uid", uid).maybeSingle();
  if (error) throw error;
  if (!u || !u.activo || !u.itinerarios?.includes("CEMENTO") || ![
    "ADMIN",
    "EDITOR"
  ].includes(u.rol)) throw new Error("Se requiere acceso operativo a CEMENTO");
  return {
    db,
    user: u
  };
}
function nowPE() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x)=>[
      x.type,
      x.value
    ]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
function norm(v) {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function viewHtml(html) {
  const $ = load(html);
  return $('input[name="javax.faces.ViewState"]').attr("value") || "";
}
function viewPartial(xml) {
  const m = xml.match(/<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/i);
  return m?.[1]?.trim() || "";
}
function encode(data) {
  return new URLSearchParams(data).toString();
}
function formData($, form) {
  const d = {};
  form.find("input,select,textarea").each((_, e)=>{
    const x = $(e), name = x.attr("name");
    if (!name) return;
    const type = (x.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !x.attr("checked")) return;
    if (e.tagName === "select") d[name] = x.find("option[selected]").attr("value") ?? x.find("option").first().attr("value") ?? "";
    else d[name] = x.attr("value") ?? "";
  });
  return d;
}
async function postForm(fetcher, url, data, referer, ajax = false) {
  return await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: referer,
      ...ajax ? {
        accept: "application/xml, text/xml, */*; q=0.01",
        "faces-request": "partial/ajax",
        "x-requested-with": "XMLHttpRequest",
        origin: "https://clocatorplus.comsatel.com.pe"
      } : {}
    },
    body: encode(data),
    redirect: "follow"
  });
}
async function login(user, password) {
  const fetcher = makeFetchCookie(fetch, new CookieJar());
  let page = null, $, form, userInput, passInput;
  for (const url of [
    LOGIN,
    `${BASE}/`,
    MAIN
  ]){
    const r = await fetcher(url, {
      redirect: "follow"
    });
    if (!r.ok) continue;
    const html = await r.text();
    $ = load(html);
    form = $("form").filter((_, e)=>$(e).find('input[type="password"]').length > 0).first();
    if (form.length) {
      page = new Response(html, {
        status: r.status,
        headers: r.headers
      });
      passInput = form.find('input[type="password"]').first();
      userInput = form.find('input[type="text"],input[type="email"]').first();
      break;
    }
  }
  if (!page || !form?.length) throw new Error("No se encontró el formulario de acceso de CLocator");
  const html = await page.text(), baseUrl = page.headers.get("x-final-url") || LOGIN;
  $ = load(html);
  form = $("form").filter((_, e)=>$(e).find('input[type="password"]').length > 0).first();
  passInput = form.find('input[type="password"]').first();
  userInput = form.find('input[type="text"],input[type="email"]').first();
  const data = formData($, form);
  data[userInput.attr("name")] = user;
  data[passInput.attr("name")] = password;
  const fid = form.attr("id") || form.attr("name");
  if (fid) data[fid] = fid;
  const submit = form.find('input[type="submit"],button[type="submit"]').first();
  if (submit.attr("name")) data[submit.attr("name")] = submit.attr("value") || submit.text().trim();
  const action = new URL(form.attr("action") || LOGIN, baseUrl).href;
  await postForm(fetcher, action, data, LOGIN);
  const r = await fetcher(MAIN, {
    redirect: "follow"
  });
  const main = await r.text();
  if (!r.ok || !viewHtml(main)) throw new Error("CLocator rechazó el acceso o no devolvió ViewState");
  return {
    fetcher,
    main,
    view: viewHtml(main)
  };
}
function parseCoordPair(text) {
  const s = String(text || "").replace(/,/g, " ").trim();
  // -16.409047 -71.537451  |  -16.409047,-71.537451
  let m = s.match(/(-?\d{1,3}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})/);
  if (m) {
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function parseFechaHora(text) {
  const s = String(text || "").trim();
  let m = s.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]} ${m[2].length === 5 ? m[2] + ":00" : m[2]}`;
  m = s.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) {
    const [y, mo, d] = m[1].split("-");
    const tm = m[2].length === 5 ? m[2] + ":00" : m[2];
    return `${d}/${mo}/${y} ${tm}`;
  }
  return "";
}

/** Extrae data-rk + último punto visible en la fila del monitoreo (página principal). */
function rowInfo(html, plate, tracto) {
  const $ = load(html), targets = new Set([
    norm(plate),
    norm(tracto)
  ].filter(Boolean));
  let found = null;
  $("tr").each((_, tr)=>{
    if (found) return;
    const vals = $(tr).find("td").map((_, td)=>norm($(td).text())).get();
    if (vals.some((v)=>targets.has(v))) found = tr;
  });
  if (!found) throw new Error(`No se encontró ${plate} / ${tracto} en el monitoreo CLocator`);
  const row = $(found), rk = row.attr("data-rk");
  if (!rk) throw new Error("La unidad encontrada no contiene data-rk");

  // 1) atributos data-* del tr o celdas
  const attrLat = Number(row.attr("data-lat") || row.attr("data-latitude") || "");
  const attrLng = Number(row.attr("data-lng") || row.attr("data-lon") || row.attr("data-longitude") || "");
  let lat = Number.isFinite(attrLat) ? attrLat : NaN;
  let lng = Number.isFinite(attrLng) ? attrLng : NaN;
  let fecha = String(row.attr("data-fecha") || row.attr("data-hora") || row.attr("data-ultimo") || "").trim();

  // 2) celdas: coordenadas y fecha/hora del último reporte
  const tds = row.find("td").toArray();
  for (const td of tds) {
    const cell = $(td);
    const text = cell.text().trim();
    const title = String(cell.attr("title") || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const pair = parseCoordPair(text) || parseCoordPair(title);
      if (pair) {
        lat = pair.lat;
        lng = pair.lng;
      } else {
        const aloneLat = text.match(/^(-?\d{1,2}\.\d{4,})$/);
        // lat/lng en celdas separadas: se resuelve en segundo pase
      }
    }
    if (!fecha) {
      const fh = parseFechaHora(text) || parseFechaHora(title);
      if (fh) fecha = fh;
    }
  }

  // 3) lat y lng en celdas consecutivas
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const nums = [];
    for (const td of tds) {
      const text = $(td).text().trim().replace(",", ".");
      if (/^-?\d{1,3}\.\d{3,}$/.test(text)) nums.push(Number(text));
    }
    for (let i = 0; i < nums.length - 1; i++) {
      const a = nums[i], b = nums[i + 1];
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        lat = a;
        lng = b;
        break;
      }
    }
  }

  const ultimo_monitoreo =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, fecha: fecha || null, fuente: "MONITOREO_PRINCIPAL" }
      : null;

  return { rk, ultimo_monitoreo };
}

function rowData(html, plate, tracto) {
  return rowInfo(html, plate, tracto).rk;
}
function showSource(html) {
  const $ = load(html);
  let source = "";
  $("span.ui-menuitem-text").each((_, e)=>{
    if ($(e).text().trim().toUpperCase() === "MOSTRAR RECORRIDO") {
      const onclick = $(e).closest("a").attr("onclick") || "";
      source = onclick.match(/source:'([^']+)'/)?.[1] || "";
    }
  });
  return source || "frmMonitoreo:j_idt735";
}
function dateFields(xml) {
  const found = [
    ...xml.matchAll(/name=["'](frmRecorrido:[^"']+_input)["'][^>]*value=["']\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}["']/gi)
  ].map((m)=>m[1]);
  const u = [
    ...new Set(found)
  ];
  return [
    u[0] || "frmRecorrido:j_idt132_input",
    u[1] || "frmRecorrido:j_idt134_input"
  ];
}
const bundledFences = geodata.objetos.filter((x)=>x.kind === "geocerca" && [
    "Polygon",
    "MultiPolygon"
  ].includes(x.geometry?.type)).map((x)=>({
    id: x.maestro_id || x.id,
    name: x.name,
    kind: "geocerca",
    geometry: x.geometry
  }));
const bundledRoutes = (routeFallback.rutas_madre || []).filter((x)=>[
    "LineString",
    "MultiLineString"
  ].includes(x.geometry?.type)).map((x)=>({
    ...x,
    id: x.maestro_id || x.id,
    kind: "ruta_madre"
  }));
const bundledTramos = (routeFallback.geocerca_tramo || []).filter((x)=>[
    "Polygon",
    "MultiPolygon"
  ].includes(x.geometry?.type)).map((x)=>({
    ...x,
    id: x.maestro_id || x.id,
    kind: "geocerca_tramo"
  }));
async function publishedCartography(db) {
  try {
    const { data, error } = await db.from("editor_geocercas_proyectos").select("publicado").eq("itinerario", "CEMENTO").maybeSingle();
    if (error) throw error;
    const published = data?.publicado || {};
    const geocercas = (published?.geocercas?.objetos || []).filter((x)=>x.kind === "geocerca" && [
        "Polygon",
        "MultiPolygon"
      ].includes(x.geometry?.type)).map((x)=>({
        ...x,
        id: x.maestro_id || x.id,
        kind: "geocerca"
      }));
    const fallbackById = new Map(bundledRoutes.map((x)=>[
        String(x.id),
        x
      ]));
    const rutas = (published?.rutas_madre?.objetos || []).filter((x)=>x.kind === "ruta_madre" && [
        "LineString",
        "MultiLineString"
      ].includes(x.geometry?.type)).map((x)=>{
      const id = x.maestro_id || x.id;
      const validated = fallbackById.get(String(id)) || {};
      return {
        ...validated,
        ...x,
        id,
        kind: "ruta_madre",
        // La cobertura es evidencia validada de CEMENTO y se conserva en el
        // backend. La línea/nombre publicados por el editor sí prevalecen.
        cobertura_ruta_operativa: validated.cobertura_ruta_operativa || null
      };
    });
    const tramos = (published?.geocerca_tramo?.objetos || []).filter((x)=>x.kind === "geocerca_tramo" && [
        "Polygon",
        "MultiPolygon"
      ].includes(x.geometry?.type)).map((x)=>({
        ...x,
        id: x.maestro_id || x.id,
        kind: "geocerca_tramo"
      }));
    // Compatibilidad segura con la publicación 19.3: si todavía no se volvió a
    // publicar DETALLES_1, usamos únicamente la red validada que ya venía de
    // CEMENTO. No se fabrica ninguna geometría.
    return {
      geocercas: geocercas.length ? geocercas : bundledFences,
      rutas_madre: rutas.length ? rutas : bundledRoutes,
      geocerca_tramo: tramos.length ? tramos : bundledTramos,
      origen: rutas.length || tramos.length ? "PUBLICACION_EDITOR_DETALLES_1" : "PUBLICACION_ANTERIOR_MAS_RED_VALIDADA_INCLUIDA"
    };
  } catch (e) {
    console.warn("Se usará la cartografía CEMENTO incluida", e);
    return {
      geocercas: bundledFences,
      rutas_madre: bundledRoutes,
      geocerca_tramo: bundledTramos,
      origen: "RED_VALIDADA_INCLUIDA"
    };
  }
}
function timeValue(v) {
  if (!v) return NaN;
  const m = v.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : Date.parse(v);
}
function onSegment(x, y, a, b) {
  const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
  return Math.abs(cross) < 1e-10 && x >= Math.min(a[0], b[0]) - 1e-10 && x <= Math.max(a[0], b[0]) + 1e-10 && y >= Math.min(a[1], b[1]) - 1e-10 && y <= Math.max(a[1], b[1]) + 1e-10;
}
function inRing(x, y, ring) {
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const a = ring[j], b = ring[i];
    if (onSegment(x, y, a, b)) return true;
    if (b[1] > y !== a[1] > y && x < (a[0] - b[0]) * (y - b[1]) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}
function inPolygon(x, y, rings) {
  return !!rings.length && inRing(x, y, rings[0]) && !rings.slice(1).some((r)=>inRing(x, y, r));
}
function contains(g, p) {
  if (!g || ![
    "Polygon",
    "MultiPolygon"
  ].includes(g.type)) return false;
  if (g.type === "Polygon") return inPolygon(p.lng, p.lat, g.coordinates);
  return g.coordinates.some((poly)=>inPolygon(p.lng, p.lat, poly));
}
function routeCoverage(route) {
  const g = route?.cobertura_ruta_operativa || route?.coverage || null;
  return g && [
    "Polygon",
    "MultiPolygon"
  ].includes(g.type) ? g : null;
}
function publicRoute(route) {
  return {
    id: route.id,
    maestro_id: route.maestro_id || route.id,
    name: route.name,
    kind: "ruta_madre",
    geometry: route.geometry,
    tipo_trayectoria: route.tipo_trayectoria || "",
    ruta_sap: route.ruta_sap || ""
  };
}
function routeLines(g) {
  if (!g) return [];
  if (g.type === "LineString") return [
    g.coordinates || []
  ];
  if (g.type === "MultiLineString") return g.coordinates || [];
  return [];
}
function pointLineDistanceMeters(p, geometry) {
  const cosLat = Math.cos(p.lat * Math.PI / 180);
  const mx = 111320 * Math.max(0.15, Math.abs(cosLat));
  const my = 110540;
  let best = Number.POSITIVE_INFINITY;
  for (const line of routeLines(geometry)){
    for(let i = 1; i < line.length; i++){
      const a = line[i - 1], b = line[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const ax = (Number(a[0]) - p.lng) * mx;
      const ay = (Number(a[1]) - p.lat) * my;
      const bx = (Number(b[0]) - p.lng) * mx;
      const by = (Number(b[1]) - p.lat) * my;
      const vx = bx - ax, vy = by - ay;
      const denom = vx * vx + vy * vy;
      const t = denom ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / denom)) : 0;
      const dx = ax + t * vx, dy = ay + t * vy;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return Number.isFinite(best) ? best : 9e15;
}
function classifyNetwork(last, analysis, cartography) {
  if (!last) return {
    ubicacion_red: "SIN PUNTOS GPS",
    fuente_ubicacion_red: "SIN_DATOS",
    ruta_madre: "",
    ruta_madre_id: "",
    rutas_candidatas: [],
    ubicacion_tramo_id: ""
  };
  // La permanencia mínima de 20 min sigue gobernando cuándo una geocerca
  // operativa se considera válida. Si la visita está confirmada, siempre gana.
  if (analysis?.estado_final === "EN GEOCERCA" && analysis?.ultima_geocerca) {
    return {
      ubicacion_red: analysis.ultima_geocerca,
      fuente_ubicacion_red: "AREA_OPERATIVA",
      ruta_madre: "",
      ruta_madre_id: "",
      rutas_candidatas: [],
      ubicacion_tramo_id: analysis.ultima_geocerca_id || ""
    };
  }
  const tramo = cartography.geocerca_tramo.find((x)=>contains(x.geometry, last));
  if (tramo) {
    const routeId = Array.isArray(tramo.rutas_madre_asociadas) ? tramo.rutas_madre_asociadas[0] || "" : tramo.id_ruta_madre || "";
    const mother = cartography.rutas_madre.find((x)=>x.id === routeId);
    return {
      ubicacion_red: tramo.name,
      fuente_ubicacion_red: "TRAMO_TRANSITO_VALIDADO",
      ruta_madre: mother?.name || "",
      ruta_madre_id: mother?.id || routeId,
      rutas_candidatas: mother ? [
        {
          id: mother.id,
          name: mother.name,
          distancia_m: Math.round(pointLineDistanceMeters(last, mother.geometry))
        }
      ] : [],
      ubicacion_tramo_id: tramo.id || ""
    };
  }
  const candidates = cartography.rutas_madre.filter((route)=>{
    const coverage = routeCoverage(route);
    return coverage && contains(coverage, last);
  }).map((route)=>({
      id: route.id,
      name: route.name,
      distancia_m: Math.round(pointLineDistanceMeters(last, route.geometry))
    })).sort((a, b)=>a.distancia_m - b.distancia_m || a.name.localeCompare(b.name));
  const best = candidates[0];
  if (best) return {
    ubicacion_red: `EN RUTA ${best.name}`,
    fuente_ubicacion_red: "COBERTURA_RUTA_MADRE",
    ruta_madre: best.name,
    ruta_madre_id: best.id,
    rutas_candidatas: candidates,
    ubicacion_tramo_id: ""
  };
  return {
    ubicacion_red: "FUERA DE RED VALIDADA · REVISAR",
    fuente_ubicacion_red: "FUERA_DE_RED_VALIDADA_REVISAR",
    ruta_madre: "",
    ruta_madre_id: "",
    rutas_candidatas: [],
    ubicacion_tramo_id: ""
  };
}
function analyze(points, fences) {
  const ordered = [
    ...points
  ].filter((p)=>Number.isFinite(timeValue(p.fecha))).sort((a, b)=>timeValue(a.fecha) - timeValue(b.fecha));
  const labels = [];
  let previous = "";
  for (const p of ordered){
    let name = "";
    if (previous) {
      const f = fences.find((x)=>x.name === previous);
      if (f && contains(f.geometry, p)) name = previous;
    }
    if (!name) {
      const f = fences.find((x)=>contains(x.geometry, p));
      name = f?.name || "";
    }
    labels.push(name);
    previous = name;
  }
  const blocks = [];
  for(let start = 0; start < labels.length;){
    let end = start;
    while(end + 1 < labels.length && labels[end + 1] === labels[start])end++;
    if (labels[start]) {
      const fence = fences.find((x)=>x.name === labels[start]), minutes = Math.max(0, (timeValue(ordered[end].fecha) - timeValue(ordered[start].fecha)) / 60000);
      blocks.push({
        geocerca_id: fence?.id || "",
        geocerca: labels[start],
        ingreso: ordered[start].fecha,
        ultimo_punto_dentro: ordered[end].fecha,
        salida: end < ordered.length - 1 ? ordered[end].fecha : null,
        permanencia_minutos: Math.round(minutes * 10) / 10,
        puntos_dentro: end - start + 1,
        confirmada: minutes >= 20
      });
    }
    start = end + 1;
  }
  const visits = blocks.filter((x)=>x.confirmada);
  return {
    puntos_evaluados: ordered.length,
    permanencia_minima_minutos: 20,
    visitas_confirmadas: visits,
    visitas_no_confirmadas: blocks.filter((x)=>!x.confirmada),
    estado_final: visits.length && labels.at(-1) === visits.at(-1).geocerca ? "EN GEOCERCA" : "TRÁNSITO",
    ultima_geocerca: visits.at(-1)?.geocerca || "",
    ultima_geocerca_id: visits.at(-1)?.geocerca_id || ""
  };
}
async function recorrido(plate, tracto, from, to, cartography) {
  const user = Deno.env.get("CLOCATOR_USER"), password = Deno.env.get("CLOCATOR_PASSWORD");
  if (!user || !password) throw new Error("No existen CLOCATOR_USER y CLOCATOR_PASSWORD en los secretos de Supabase");
  const s = await login(user, password);
  const info = rowInfo(s.main, plate, tracto);
  const rk = info.rk;
  const ultimoMonitoreo = info.ultimo_monitoreo;
  const common = {
    frmMonitoreo: "frmMonitoreo",
    "frmMonitoreo:cmbBuscarMonitoreo_input": "Placa",
    "frmMonitoreo:cmbBuscarMonitoreo_focus": "",
    "frmMonitoreo:txtBuscarMonitoreo": "",
    "frmMonitoreo:ckbEtiquetasMonitoreo": "on",
    "frmMonitoreo:dtTablaMonitoreo_selection": rk,
    "frmMonitoreo:dtTablaMonitoreo_scrollState": "0,0"
  };
  let r = await postForm(s.fetcher, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.partial.execute": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.behavior.event": "contextMenu",
    "javax.faces.partial.event": "contextMenu",
    ...common,
    "javax.faces.ViewState": s.view
  }, MAIN, true);
  let xml = await r.text(), view = viewPartial(xml) || s.view;
  const source = showSource(s.main);
  r = await postForm(s.fetcher, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": source,
    "javax.faces.partial.execute": "@all",
    [source]: source,
    ...common,
    "javax.faces.ViewState": view
  }, MAIN, true);
  xml = await r.text();
  view = viewPartial(xml);
  if (!view) throw new Error("CLocator no abrió Mostrar Recorrido");
  const [startField, endField] = dateFields(xml);
  r = await postForm(s.fetcher, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmRecorrido:fnBuscarRecorridoDeVehiculo",
    "javax.faces.partial.execute": "@all",
    "frmRecorrido:fnBuscarRecorridoDeVehiculo": "frmRecorrido:fnBuscarRecorridoDeVehiculo",
    pDialogIsOpen: "false",
    frmRecorrido: "frmRecorrido",
    "frmRecorrido:cmbOpcionRecorrido_input": "PERSONALIZADO",
    "frmRecorrido:cmbOpcionRecorrido_focus": "",
    "frmRecorrido:cmbMensual_input": "0",
    "frmRecorrido:cmbMensual_focus": "",
    [startField]: from,
    [endField]: to,
    "javax.faces.ViewState": view
  }, MAIN, true);
  if (!r.ok) throw new Error(`Buscar recorrido devolvió HTTP ${r.status}`);
  r = await s.fetcher(RPC, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "https://clocatorplus.comsatel.com.pe",
      referer: MAIN
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "recorridoMBean.getRecorridoAgregado",
      params: [],
      id: 6
    })
  });
  if (!r.ok) throw new Error(`JSON-RPC devolvió HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(`JSON-RPC: ${JSON.stringify(data.error)}`);
  const list = data?.result?.map?.listHistorica?.list;
  if (!Array.isArray(list)) throw new Error("CLocator no devolvió listHistorica.list");
  const points = [];
  for (const item of list){
    const p = item?.map ?? item;
    if (Number.isFinite(Number(p?.latitud)) && Number.isFinite(Number(p?.longitud))) points.push({
      lat: Number(p.latitud),
      lng: Number(p.longitud),
      fecha: p.fechaFinToString || p.fechaInicioToString || null
    });
  }
  const last = points.at(-1) || null;
  // Si no hay puntos en el rango, usar último reporte de la tabla principal de monitoreo
  const ultimo = last || ultimoMonitoreo || null;
  const analysis = analyze(points, cartography.geocercas), network = classifyNetwork(ultimo, analysis, cartography);
  Object.assign(analysis, network);
  // Alias conservado para no romper consumidores de 19.3.
  analysis.ubicacion_tramo = network.ubicacion_red;
  analysis.regla_prioridad_red = [
    "AREA_OPERATIVA",
    "TRAMO_TRANSITO_VALIDADO",
    "COBERTURA_RUTA_MADRE",
    "FUERA_DE_RED_VALIDADA_REVISAR"
  ];
  return {
    puntos: points.length,
    total_original: list.length,
    primero: points[0] || null,
    ultimo,
    ultimo_monitoreo: ultimoMonitoreo,
    sin_movimiento: points.length < 2,
    puntos_gps: points,
    analisis: analysis,
    geocercas: [
      ...cartography.geocercas,
      ...cartography.geocerca_tramo
    ],
    rutas_madre: cartography.rutas_madre.map(publicRoute),
    origen_cartografia: cartography.origen
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return reply(req, {
    ok: true
  });
  if (req.method !== "POST") return reply(req, {
    error: "Método no permitido"
  }, 405);
  try {
    const { db, user } = await secure(req), cartography = await publishedCartography(db);
    const body = await req.json().catch(()=>({}));
    if (body.action === "map_config") {
      const out = {
        ok: true,
        origen_cartografia: cartography.origen,
        conteos_cartografia: {
          geocercas: cartography.geocercas.length,
          geocerca_tramo: cartography.geocerca_tramo.length,
          rutas_madre: cartography.rutas_madre.length
        },
        // VERSIÓN 2: Seguimiento usa la cartografía en el servidor para analizar,
        // pero no la descarga ni la dibuja sobre el mapa operativo.
        google_maps_api_key: Deno.env.get("GOOGLE_MAPS_API_KEY") || ""
      };
      await registrarEgress(db, user, "CLOCATOR_MAPA", out);
      return reply(req, out);
    }
    const valid = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, plate = String(body.placa || "").trim(), tracto = String(body.tracto || "").trim(), requestedFrom = String(body.desde || "").trim(), requestedTo = String(body.hasta || "").trim(), from = valid.test(requestedFrom) ? requestedFrom : "", to = valid.test(requestedTo) ? requestedTo : nowPE();
    if (!plate && !tracto) throw new Error("Falta placa o tracto");
    if (!from) throw new Error("Falta una fecha de inicio válida para el recorrido");
    const includeMap = body.include_map !== false, result = await recorrido(plate, tracto, from, to, cartography);
    if (!includeMap) {
      delete result.geocercas;
      delete result.rutas_madre;
    }
    const out = {
      ok: true,
      modo: includeMap ? "PRUEBA_ANALISIS_MAPA" : "PRECARGA_INCREMENTAL",
      placa: plate,
      tracto,
      desde: from,
      hasta: to,
      ...result,
      ...includeMap ? {
        google_maps_api_key: Deno.env.get("GOOGLE_MAPS_API_KEY") || ""
      } : {},
      nota: "Los puntos GPS no fueron guardados en Supabase; el navegador conserva únicamente la ejecución vigente."
    };
    await registrarEgress(db, user, includeMap ? "CLOCATOR_MAPA_GPS" : "CLOCATOR_PRECARGA_GPS", out);
    return reply(req, out);
  } catch (e) {
    console.error(e);
    return reply(req, {
      error: e instanceof Error ? e.message : "Error CLocator"
    }, 400);
  }
});
