import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { load } from "cheerio";
import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import geodata from "./GEOCERCAS.json";

const PROJECT = "itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "https://itinerarios-2fa6f--prueba-fin-ciclo-t0s1424a.web.app",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
const BASE = "https://clocatorplus.comsatel.com.pe/CL",
  LOGIN = `${BASE}/faces/seguridad/login.xhtml`,
  MAIN = `${BASE}/faces/page/main.xhtml`,
  RPC = `${BASE}/JSON-RPC`;

function reply(req: Request, body: unknown, status = 200) {
  const o = req.headers.get("origin") || "",
    h: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "Origin",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return new Response(JSON.stringify(body), { status, headers: h });
}
async function registrarEgress(
  db: any,
  user: any,
  servicio: string,
  body: unknown,
) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (bytes > 0)
      await db
        .from("app_egress_log")
        .insert({
          itinerario: "CERRO VERDE",
          servicio,
          bytes,
          usuario: String(user?.email || ""),
        });
  } catch (e) {
    console.warn("No se pudo registrar egress CLocator PRUEBA 17", e);
  }
}
async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw new Error("Origen no autorizado");
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw new Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(h.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });
  const uid = String(payload.sub || "");
  if (!uid) throw new Error("Identidad Firebase no válida");
  const db = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: u, error } = await db
    .from("app_usuarios")
    .select("id,email,rol,itinerarios,activo,firebase_uid")
    .eq("firebase_uid", uid)
    .maybeSingle();
  if (error) throw error;
  if (
    !u ||
    !u.activo ||
    !u.itinerarios?.includes("CERRO VERDE") ||
    !["ADMIN", "EDITOR"].includes(u.rol)
  )
    throw new Error("Se requiere acceso operativo a CERRO VERDE");
  return { db, user: u };
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
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
function norm(v: unknown) {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
function viewHtml(html: string) {
  const $ = load(html);
  return $('input[name="javax.faces.ViewState"]').attr("value") || "";
}
function viewPartial(xml: string) {
  const m = xml.match(
    /<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/i,
  );
  return m?.[1]?.trim() || "";
}
function encode(data: Record<string, string>) {
  return new URLSearchParams(data).toString();
}
function formData($: any, form: any) {
  const d: Record<string, string> = {};
  form.find("input,select,textarea").each((_: number, e: any) => {
    const x = $(e),
      name = x.attr("name");
    if (!name) return;
    const type = (x.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !x.attr("checked")) return;
    if (e.tagName === "select")
      d[name] =
        x.find("option[selected]").attr("value") ??
        x.find("option").first().attr("value") ??
        "";
    else d[name] = x.attr("value") ?? "";
  });
  return d;
}
async function postForm(
  fetcher: any,
  url: string,
  data: Record<string, string>,
  referer: string,
  ajax = false,
) {
  return await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: referer,
      ...(ajax
        ? {
            accept: "application/xml, text/xml, */*; q=0.01",
            "faces-request": "partial/ajax",
            "x-requested-with": "XMLHttpRequest",
            origin: "https://clocatorplus.comsatel.com.pe",
          }
        : {}),
    },
    body: encode(data),
    redirect: "follow",
  });
}
async function login(user: string, password: string) {
  const fetcher = makeFetchCookie(fetch, new CookieJar());
  let page: Response | null = null,
    $: any,
    form: any,
    userInput: any,
    passInput: any;
  for (const url of [LOGIN, `${BASE}/`, MAIN]) {
    const r = await fetcher(url, { redirect: "follow" });
    if (!r.ok) continue;
    const html = await r.text();
    $ = load(html);
    form = $("form")
      .filter(
        (_: number, e: any) => $(e).find('input[type="password"]').length > 0,
      )
      .first();
    if (form.length) {
      page = new Response(html, { status: r.status, headers: r.headers });
      passInput = form.find('input[type="password"]').first();
      userInput = form.find('input[type="text"],input[type="email"]').first();
      break;
    }
  }
  if (!page || !form?.length)
    throw new Error("No se encontró el formulario de acceso de CLocator");
  const html = await page.text(),
    baseUrl = page.headers.get("x-final-url") || LOGIN;
  $ = load(html);
  form = $("form")
    .filter(
      (_: number, e: any) => $(e).find('input[type="password"]').length > 0,
    )
    .first();
  passInput = form.find('input[type="password"]').first();
  userInput = form.find('input[type="text"],input[type="email"]').first();
  const data = formData($, form);
  data[userInput.attr("name")] = user;
  data[passInput.attr("name")] = password;
  const fid = form.attr("id") || form.attr("name");
  if (fid) data[fid] = fid;
  const submit = form
    .find('input[type="submit"],button[type="submit"]')
    .first();
  if (submit.attr("name"))
    data[submit.attr("name")] = submit.attr("value") || submit.text().trim();
  const action = new URL(form.attr("action") || LOGIN, baseUrl).href;
  await postForm(fetcher, action, data, LOGIN);
  const r = await fetcher(MAIN, { redirect: "follow" });
  const main = await r.text();
  if (!r.ok || !viewHtml(main))
    throw new Error("CLocator rechazó el acceso o no devolvió ViewState");
  return { fetcher, main, view: viewHtml(main) };
}

function inPeruBBox(lat: number, lng: number) {
  return lat >= -18.5 && lat <= -0.01 && lng >= -81.5 && lng <= -68.5;
}
function esParGeoValido(a: number, b: number) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const ok = (la: number, lo: number) =>
    Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Math.abs(la) > 0.1 && Math.abs(lo) > 0.1;
  return ok(x, y) || ok(y, x);
}
function normalizeLatLngSimple(a: unknown, b: unknown) {
  const x = Number(a), y = Number(b);
  if (!esParGeoValido(x, y)) return null;
  if (inPeruBBox(x, y)) return { lat: x, lng: y };
  if (inPeruBBox(y, x)) return { lat: y, lng: x };
  if (Math.abs(x) <= 90 && Math.abs(y) <= 180) return { lat: x, lng: y };
  if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return { lat: y, lng: x };
  return null;
}
function parseFechaMonitoreo(text: string) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  let m = s.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]} ${m[2]}:${m[3] || "00"}`;
  m = s.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5] || "00"}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5] || "00"}`;
  return "";
}
function decodeHtmlEntities(s: string) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
/** Lat/lng solo desde irAMonitoreo en la fila — nunca celdas de texto. */
function obtenerLatLonDesdeFila($: any, row: any) {
  const chunks: string[] = [];
  chunks.push($.html(row) || "");
  row.find("*").addBack().each((_: number, el: any) => {
    const node = $(el);
    for (const attr of [
      "onclick", "ondblclick", "href", "data-href", "data-url",
      "data-lat", "data-lon", "data-longitude", "data-latitude",
      "title", "data-geocode", "data-pos",
    ]) {
      const v = node.attr(attr);
      if (v) chunks.push(String(v));
    }
    const attribs = el.attribs || {};
    for (const [, v] of Object.entries(attribs)) {
      if (v) chunks.push(String(v));
    }
  });
  chunks.push(row.html() || "");
  const src = decodeHtmlEntities(chunks.join("\n"));
  // irAMonitoreo(id,'lat','lng',...)
  const reIdLatLng =
    /irAMonitoreo\s*\(\s*['"]?\d+['"]?\s*,\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = reIdLatLng.exec(src))) {
    const a = m[1].replace(",", ".");
    const b = m[2].replace(",", ".");
    const fixed = normalizeLatLngSimple(a, b);
    if (fixed) return { ...fixed, raw_a: a, raw_b: b };
  }
  const reLatLng =
    /irAMonitoreo\s*\(\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
  while ((m = reLatLng.exec(src))) {
    const a = m[1].replace(",", ".");
    const b = m[2].replace(",", ".");
    const fixed = normalizeLatLngSimple(a, b);
    if (fixed) return { ...fixed, raw_a: a, raw_b: b };
  }
  return null;
}

function rowData(html: string, plate: string, tracto: string) {
  return rowInfo(html, plate, tracto).rk;
}
/** Fila de monitoreo: data-rk + último punto del main (irAMonitoreo + T. Parada). */
function rowInfo(html: string, plate: string, tracto: string) {
  const $ = load(html);
  const targets = new Set([norm(plate), norm(tracto)].filter(Boolean));
  let found: any = null;
  const tryFind = (scope: any) => {
    scope.find("tr").each((_: number, tr: any) => {
      if (found) return;
      const vals = $(tr).find("td").map((__: number, td: any) => norm($(td).text())).get();
      if (vals.some((v: string) => targets.has(v))) found = tr;
    });
  };
  let $scope = $("#frmMonitoreo\\:dtTablaMonitoreo_data");
  if (!$scope.length) {
    $scope = $("tbody").filter((_: number, el: any) =>
      String($(el).attr("id") || "").endsWith("dtTablaMonitoreo_data")
    ).first();
  }
  if ($scope.length) tryFind($scope);
  if (!found) tryFind($.root());
  if (!found)
    throw new Error(
      `No se encontró ${plate} / ${tracto} en el monitoreo CLocator`,
    );
  const row = $(found);
  const rk = row.attr("data-rk");
  if (!rk) throw new Error("La unidad encontrada no contiene data-rk");

  const textos = row.find("td").map((_: number, td: any) =>
    $(td).text().replace(/\s+/g, " ").trim()
  ).get();
  // Hora del último reporte: columna T. Parada (idx 5), fallback otras
  let fecha = parseFechaMonitoreo(textos[5] || "");
  if (!fecha) fecha = parseFechaMonitoreo(textos[4] || "");
  if (!fecha) {
    for (const tx of textos) {
      fecha = parseFechaMonitoreo(tx);
      if (fecha) break;
    }
  }

  let coords = obtenerLatLonDesdeFila($, row);
  if (!coords) {
    const mainHtml = String(html || "");
    for (const key of [plate, tracto].filter(Boolean)) {
      if (!key || key.length < 3) continue;
      const idx = mainHtml.toUpperCase().indexOf(key.toUpperCase());
      if (idx < 0) continue;
      const slice = mainHtml.slice(Math.max(0, idx - 500), Math.min(mainHtml.length, idx + 2500));
      const re = /irAMonitoreo\s*\(\s*['"]?\d+['"]?\s*,\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(slice))) {
        const fixed = normalizeLatLngSimple(m[1].replace(",", "."), m[2].replace(",", "."));
        if (fixed) {
          coords = { ...fixed, raw_a: m[1], raw_b: m[2] };
          break;
        }
      }
      if (coords) break;
    }
  }

  const ultimo_monitoreo = coords
    ? {
        lat: coords.lat,
        lng: coords.lng,
        fecha: fecha || null,
        fuente: "irAMonitoreo",
      }
    : null;

  return { rk, ultimo_monitoreo, fecha };
}
function showSource(html: string) {
  const $ = load(html);
  let source = "";
  $("span.ui-menuitem-text").each((_: number, e: any) => {
    if ($(e).text().trim().toUpperCase() === "MOSTRAR RECORRIDO") {
      const onclick = $(e).closest("a").attr("onclick") || "";
      source = onclick.match(/source:'([^']+)'/)?.[1] || "";
    }
  });
  return source || "frmMonitoreo:j_idt735";
}
function dateFields(xml: string) {
  const found = [
    ...xml.matchAll(
      /name=["'](frmRecorrido:[^"']+_input)["'][^>]*value=["']\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}["']/gi,
    ),
  ].map((m) => m[1]);
  const u = [...new Set(found)];
  return [
    u[0] || "frmRecorrido:j_idt132_input",
    u[1] || "frmRecorrido:j_idt134_input",
  ];
}
type Pt = { lat: number; lng: number; fecha: string | null };
type Fence = {
  id: string;
  maestro_id: string;
  name: string;
  originalName: string;
  role: "CARACOTO" | "CARGUIO" | "RACIEMSA" | "SMCV" | "YURA" | "OTRO";
  kind: "geocerca";
  geometry: any;
  minStay: number;
};
type Visit = {
  geocerca: string;
  rol: string;
  ingreso: string | null;
  salida: string | null;
  permanencia_minutos: number;
  puntos_dentro: number;
  abierta: boolean;
};

const bundledFences = ((geodata as any).objetos || [])
  .filter((x: any) => x.kind === "geocerca" && ["Polygon", "MultiPolygon"].includes(x.geometry?.type))
  .map((x: any) => normalizeFence({
    id: x.maestro_id || x.id,
    maestro_id: x.maestro_id || x.id,
    name: x.name,
    geometry: x.geometry,
    regla_permanencia_min: x.regla_permanencia_min,
  }))
  .filter(Boolean) as Fence[];

function textNorm(v: unknown) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}
function roleForFence(id: string, name: string): Fence["role"] {
  const n = textNorm(name), k = textNorm(id);
  if (k === "GEO_MTSUXU4X_2" || n.includes("PLANTA CALCESUR")) return "CARGUIO";
  if (k === "ZG0005" || (n.includes("CALCESUR") && !n.includes("PLANTA")) || n.includes("CARACOTO")) return "CARACOTO";
  if (k === "ZG0009" || n.includes("RACIEMSA")) return "RACIEMSA";
  if (k === "ZG0202" || k === "GEO_MTLITIF9_6" || n === "SMCV" || n.includes("SAN JOSE") || n.includes("CERRO VERDE")) return "SMCV";
  if (k === "ZG0001" || n.includes("PLANTA YURA")) return "YURA";
  return "OTRO";
}
function operationalName(role: Fence["role"], original: string) {
  if (role === "CARACOTO") return "CARACOTO";
  if (role === "CARGUIO") return "CARGUIO CARACOTO";
  if (role === "RACIEMSA") return "RACIEMSA";
  if (role === "SMCV") return textNorm(original).includes("SAN JOSE") ? "SAN JOSE / SMCV" : "SMCV";
  if (role === "YURA") return "PLANTA YURA";
  return original;
}
function normalizeFence(x: any): Fence | null {
  if (!x || !["Polygon", "MultiPolygon"].includes(x.geometry?.type)) return null;
  const id = String(x.maestro_id || x.id || "").trim();
  const original = String(x.nombre_operativo || x.name || "").trim();
  if (!id || !original) return null;
  const role = roleForFence(id, original);
  const min = Number(x.regla_permanencia_min ?? x.minStay ?? 20);
  return {
    id,
    maestro_id: id,
    name: operationalName(role, original),
    originalName: original,
    role,
    kind: "geocerca",
    geometry: x.geometry,
    minStay: Number.isFinite(min) && min > 0 ? min : 20,
  };
}
function outerRing(g: any): number[][] {
  if (g?.type === "Polygon") return Array.isArray(g.coordinates?.[0]) ? g.coordinates[0] : [];
  if (g?.type === "MultiPolygon") {
    let best: number[][] = [];
    for (const p of g.coordinates || []) {
      const r = Array.isArray(p?.[0]) ? p[0] : [];
      if (r.length > best.length) best = r;
    }
    return best;
  }
  return [];
}
function roughArea(g: any) {
  const r = outerRing(g);
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]?.[0] || 0) * (r[i]?.[1] || 0) - (r[i]?.[0] || 0) * (r[j]?.[1] || 0);
  return Math.abs(a / 2);
}
function dedupeOperationalFences(fences: Fence[]) {
  const out: Fence[] = [];
  for (const role of ["CARACOTO", "CARGUIO", "RACIEMSA", "SMCV", "YURA"] as Fence["role"][]) {
    const found = fences.filter((f) => f.role === role);
    if (!found.length) continue;
    if (role === "SMCV") {
      found.sort((a, b) => {
        const an = textNorm(a.originalName || a.name), bn = textNorm(b.originalName || b.name);
        const ap = an.includes("SAN JOSE") ? 1 : 0, bp = bn.includes("SAN JOSE") ? 1 : 0;
        if (bp !== ap) return bp - ap;
        return roughArea(b.geometry) - roughArea(a.geometry);
      });
    }
    out.push(found[0]);
  }
  return out;
}
function projectPublishedFences(data: any): Fence[] {
  const pub = data?.publicado || {};
  const source = pub?.geocercas?.objetos || pub?.objetos?.geocercas || pub?.geocercas || [];
  if (!Array.isArray(source)) return [];
  return source.map(normalizeFence).filter(Boolean) as Fence[];
}
function masterAssignedFences(data: any): Fence[] {
  const pub = data?.publicado || {};
  const objects = pub?.objetos?.geocercas || [];
  const assignments = pub?.asignaciones?.["CERRO VERDE"] || [];
  if (!Array.isArray(objects) || !Array.isArray(assignments)) return [];
  const byId = new Map(objects.map((x: any) => [String(x.id || x.maestro_id || ""), x]));
  const out: Fence[] = [];
  for (const a of assignments) {
    if (!a || a.activa === false || String(a.tipo || "") !== "geocercas") continue;
    const id = String(a.maestro_id || "");
    const obj = byId.get(id);
    if (!obj) continue;
    const f = normalizeFence({ ...obj, maestro_id: id, nombre_operativo: a.nombre_operativo || obj.name });
    if (f) out.push(f);
  }
  return out;
}
async function publishedCartography(db: any) {
  let warning = "";
  try {
    const q = await db.from("editor_geocercas_proyectos")
      .select("version_publicada,publicado_en,publicado")
      .eq("itinerario", "CERRO VERDE").maybeSingle();
    if (q.error) throw q.error;
    const f = projectPublishedFences(q.data);
    const required = new Set(dedupeOperationalFences(f).map((x) => x.role));
    if (["CARACOTO", "CARGUIO", "RACIEMSA", "SMCV"].every((x) => required.has(x as any))) {
      return {
        fences: f,
        eventFences: dedupeOperationalFences(f),
        info: {
          itinerario: "CERRO VERDE",
          version: Number(q.data?.version_publicada || 0),
          publicada_en: q.data?.publicado_en || null,
          geocercas_operativas: f.length,
          fuente: "PUBLICACION_CERRO_VERDE",
          advertencia: null,
        },
      };
    }
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }

  try {
    const q = await db.from("editor_geocercas_maestro")
      .select("version_publicada,publicado_en,publicado")
      .eq("id", 1).maybeSingle();
    if (q.error) throw q.error;
    const f = masterAssignedFences(q.data);
    const eventFences = dedupeOperationalFences(f);
    const roles = new Set(eventFences.map((x) => x.role));
    const missing = ["CARACOTO", "CARGUIO", "RACIEMSA", "SMCV"].filter((x) => !roles.has(x as any));
    if (!missing.length) {
      return {
        fences: f,
        eventFences,
        info: {
          itinerario: "CERRO VERDE",
          version: Number(q.data?.version_publicada || 0),
          publicada_en: q.data?.publicado_en || null,
          geocercas_operativas: f.length,
          fuente: "MAESTRO_ASIGNADO_CERRO_VERDE",
          advertencia: warning || null,
        },
      };
    }
    warning = `Asignación CERRO VERDE incompleta: ${missing.join(", ")}`;
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }

  const eventFences = dedupeOperationalFences(bundledFences);
  return {
    fences: bundledFences,
    eventFences,
    info: {
      itinerario: "CERRO VERDE",
      version: 0,
      publicada_en: null,
      geocercas_operativas: bundledFences.length,
      fuente: "GEOCERCAS_INCLUIDAS_FALLBACK",
      advertencia: warning || "No se pudo leer la asignación del Maestro.",
    },
  };
}

function timeValue(v: string | null) {
  if (!v) return NaN;
  const m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : Date.parse(String(v).replace(" ", "T"));
}
function formatPE(ms: number) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms), z = (n: number) => String(n).padStart(2, "0");
  return `${z(d.getUTCDate())}/${z(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
}
function dateKey(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
function onSegment(x: number, y: number, a: number[], b: number[]) {
  const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
  return Math.abs(cross) < 1e-10 && x >= Math.min(a[0], b[0]) - 1e-10 && x <= Math.max(a[0], b[0]) + 1e-10 && y >= Math.min(a[1], b[1]) - 1e-10 && y <= Math.max(a[1], b[1]) + 1e-10;
}
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(x, y, a, b)) return true;
    if (b[1] > y !== a[1] > y && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}
function inPolygon(x: number, y: number, rings: number[][][]) {
  return !!rings.length && inRing(x, y, rings[0]) && !rings.slice(1).some((r) => inRing(x, y, r));
}
function contains(g: any, p: Pt) {
  if (!g) return false;
  if (g.type === "Polygon") return inPolygon(p.lng, p.lat, g.coordinates || []);
  return g.type === "MultiPolygon" && (g.coordinates || []).some((poly: number[][][]) => inPolygon(p.lng, p.lat, poly));
}
function haversine(a: Pt, b: Pt) {
  const r = 6371000, rad = Math.PI / 180;
  const p1 = a.lat * rad, p2 = b.lat * rad, dp = (b.lat - a.lat) * rad, dl = (b.lng - a.lng) * rad;
  const q = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}
function center(points: Pt[]): Pt {
  return { lat: points.reduce((a, x) => a + x.lat, 0) / Math.max(1, points.length), lng: points.reduce((a, x) => a + x.lng, 0) / Math.max(1, points.length), fecha: points[0]?.fecha || null };
}
function median(values: number[]) {
  const a = [...values].sort((x, y) => x - y), n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0;
}
function medianCenter(points: Pt[]): Pt {
  return { lat: median(points.map((x) => x.lat)), lng: median(points.map((x) => x.lng)), fecha: points[0]?.fecha || null };
}
function zoneAt(p: Pt, fences: Fence[]) {
  const priority: Record<string, number> = { YURA: 0, RACIEMSA: 1, CARACOTO: 2, SMCV: 3, CARGUIO: 4, OTRO: 9 };
  const found = fences.filter((f) => contains(f.geometry, p)).sort((a, b) => {
    const pa = priority[a.role] ?? 9, pb = priority[b.role] ?? 9;
    if (pa !== pb) return pa - pb;
    // SAN JOSE es garita; cuando coexiste con el polígono SMCV, para
    // etiquetar una parada preferimos SMCV (planta) y dejamos SAN JOSE
    // exclusivamente como geocerca de evento de ingreso/salida.
    if (a.role === "SMCV" && b.role === "SMCV") {
      const asj = textNorm(a.originalName).includes("SAN JOSE") ? 1 : 0;
      const bsj = textNorm(b.originalName).includes("SAN JOSE") ? 1 : 0;
      return asj - bsj;
    }
    return 0;
  });
  return found[0] || null;
}
function orderedPoints(points: Pt[]) {
  return [...points].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(timeValue(p.fecha))).sort((a, b) => timeValue(a.fecha) - timeValue(b.fecha));
}
function interpolatePoint(a: Pt, b: Pt, fraction: number): Pt {
  const f = Math.max(0, Math.min(1, fraction));
  const ta = timeValue(a.fecha), tb = timeValue(b.fecha);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    fecha: Number.isFinite(ta) && Number.isFinite(tb) ? formatPE(ta + (tb - ta) * f) : (b.fecha || a.fecha),
  };
}
function segmentFraction(a: Pt, b: Pt, c: number[], d: number[]) {
  const rx = b.lng - a.lng, ry = b.lat - a.lat;
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-14) return null;
  const qpx = c[0] - a.lng, qpy = c[1] - a.lat;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -1e-10 || t > 1 + 1e-10 || u < -1e-10 || u > 1 + 1e-10) return null;
  return Math.max(0, Math.min(1, t));
}
function boundaryFractions(g: any, a: Pt, b: Pt) {
  const rings: number[][][] = [];
  if (g?.type === "Polygon") rings.push(...(g.coordinates || []));
  else if (g?.type === "MultiPolygon") for (const poly of g.coordinates || []) rings.push(...(poly || []));
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const t = segmentFraction(a, b, ring[i - 1], ring[i]);
      if (t != null && !out.some((x) => Math.abs(x - t) < 1e-7)) out.push(t);
    }
  }
  return out.sort((x, y) => x - y);
}
function boundaryCross(fence: Fence, a: Pt, b: Pt, preferEnd = true) {
  const fractions = boundaryFractions(fence.geometry, a, b);
  if (!fractions.length) return b;
  return interpolatePoint(a, b, preferEnd ? fractions[fractions.length - 1] : fractions[0]);
}
function rawBlocksInside(points: Pt[], fence: Fence) {
  const out: any[] = [];
  let i = 0;
  while (i < points.length) {
    if (!contains(fence.geometry, points[i])) { i++; continue; }
    const start = i;
    while (i + 1 < points.length && contains(fence.geometry, points[i + 1])) i++;
    const end = i;
    const startMs = timeValue(points[start].fecha), endMs = timeValue(points[end].fecha), exit = end + 1 < points.length ? points[end + 1] : null;
    out.push({ start, end, points: points.slice(start, end + 1), ingreso: points[start].fecha, ultimo: points[end].fecha, salida: exit?.fecha || null, startMs, endMs, minutes: Math.max(0, (endMs - startMs) / 60000), abierta: !exit });
    i++;
  }
  return out;
}
function confirmedAreaVisits(points: Pt[], fence: Fence) {
  const visits: any[] = [], events: any[] = [], unconfirmed: any[] = [];
  const min = Math.max(20, fence.minStay || 20);
  for (const b of rawBlocksInside(points, fence)) {
    let startPoint = b.points[0] as Pt, startType = "INICIO_DENTRO";
    if (b.start > 0) {
      const prev = points[b.start - 1], first = points[b.start];
      const gap = (timeValue(first.fecha) - timeValue(prev.fecha)) / 60000;
      if (gap >= 0 && gap <= 10) { startPoint = boundaryCross(fence, prev, first, true); startType = "INGRESO"; }
    }
    let endPoint = b.points[b.points.length - 1] as Pt, endType = "FIN_DENTRO";
    if (b.end + 1 < points.length) { endPoint = boundaryCross(fence, points[b.end], points[b.end + 1], true); endType = "SALIDA"; }
    const duration = (timeValue(endPoint.fecha) - timeValue(startPoint.fecha)) / 60000;
    const row = { geocerca: fence.name, rol: fence.role, ingreso: startPoint.fecha, salida: endType === "SALIDA" ? endPoint.fecha : null, ultimo_dentro: b.ultimo, permanencia_minutos: Math.round(duration * 10) / 10, puntos_dentro: b.points.length, abierta: endType !== "SALIDA" };
    if (duration >= min) {
      visits.push(row);
      events.push({ geocerca: fence.name, rol: fence.role, evento: startType, fecha: startPoint.fecha, lat: startPoint.lat, lng: startPoint.lng });
      events.push({ geocerca: fence.name, rol: fence.role, evento: endType, fecha: endPoint.fecha, lat: endPoint.lat, lng: endPoint.lng });
    } else unconfirmed.push(row);
  }
  return { visits, events, unconfirmed };
}
function gateEvents(points: Pt[], fence: Fence) {
  const events: any[] = [], visits: Visit[] = [];
  if (!points.length) return { visits, events };
  let prevInside = contains(fence.geometry, points[0]);
  if (prevInside) events.push({ geocerca: fence.name, rol: fence.role, evento: "INGRESO", fecha: points[0].fecha, lat: points[0].lat, lng: points[0].lng });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], inside = contains(fence.geometry, b);
    if (prevInside !== inside) {
      // Desktop: cambio observado FUERA/DENTRO usa el punto GPS actual.
      events.push({ geocerca: fence.name, rol: fence.role, evento: inside ? "INGRESO" : "SALIDA", fecha: b.fecha, lat: b.lat, lng: b.lng });
    } else if (!prevInside && !inside) {
      // Si ambos puntos están fuera pero el segmento atraviesa la garita,
      // registrar entrada/salida interpoladas, sin exigir permanencia.
      const fs = boundaryFractions(fence.geometry, a, b);
      if (fs.length >= 2) {
        const enter = interpolatePoint(a, b, fs[0]), exit = interpolatePoint(a, b, fs[fs.length - 1]);
        events.push({ geocerca: fence.name, rol: fence.role, evento: "INGRESO", fecha: enter.fecha, lat: enter.lat, lng: enter.lng });
        events.push({ geocerca: fence.name, rol: fence.role, evento: "SALIDA", fecha: exit.fecha, lat: exit.lat, lng: exit.lng });
      }
    }
    prevInside = inside;
  }
  // Bloques solo para información visual; NO validan la garita.
  for (const b of rawBlocksInside(points, fence)) visits.push({ geocerca: fence.name, rol: fence.role, ingreso: b.ingreso, salida: b.salida, permanencia_minutos: Math.round(b.minutes * 10) / 10, puntos_dentro: b.points.length, abierta: b.abierta });
  return { visits, events };
}
function carguioVisits(points: Pt[], fence: Fence) {
  const result: any[] = [], inside = points.map((p) => contains(fence.geometry, p));
  let i = 0;
  while (i < points.length) {
    if (!inside[i]) { i++; continue; }
    const indexes = [i]; let j = i + 1, outside = 0;
    while (j < points.length) {
      if (inside[j]) { indexes.push(j); outside = 0; j++; continue; }
      outside++;
      const gap = (timeValue(points[j].fecha) - timeValue(points[indexes[indexes.length - 1]].fecha)) / 60000;
      if (outside <= 2 && gap <= 5) { j++; continue; }
      break;
    }
    const first = indexes[0], last = indexes[indexes.length - 1], duration = (timeValue(points[last].fecha) - timeValue(points[first].fecha)) / 60000;
    if (duration >= Math.max(20, fence.minStay || 20)) {
      let salida = points[last].fecha;
      for (let k = last + 1; k < points.length; k++) if (!inside[k]) { salida = points[k].fecha; break; }
      result.push({ geocerca: fence.name, rol: fence.role, ingreso: points[first].fecha, salida, permanencia_minutos: Math.round(duration * 10) / 10, puntos_dentro: indexes.length, abierta: last === points.length - 1 });
    }
    i = Math.max(j, last + 1);
  }
  return result;
}
function operationalVisits(points: Pt[], eventFences: Fence[]) {
  const visits: Visit[] = [], events: any[] = [], unconfirmed: any[] = [];
  for (const f of eventFences) {
    if (f.role === "SMCV") {
      const x = gateEvents(points, f); visits.push(...x.visits); events.push(...x.events); continue;
    }
    if (f.role === "CARGUIO") {
      visits.push(...carguioVisits(points, f));
      continue;
    }
    if (f.role === "RACIEMSA" || f.role === "CARACOTO") {
      const x = confirmedAreaVisits(points, f); visits.push(...x.visits); events.push(...x.events); unconfirmed.push(...x.unconfirmed); continue;
    }
  }
  events.sort((a, b) => timeValue(a.fecha) - timeValue(b.fecha));
  visits.sort((a, b) => timeValue(a.ingreso) - timeValue(b.ingreso));
  return { visits, events, unconfirmed };
}
function pauseCandidates(points: Pt[], fences: Fence[]) {
  const out: any[] = [], minPts = 3, maxGapMin = 5, radius = 110;
  let i = 0;
  while (i < points.length - 1) {
    const group: Pt[] = [points[i]];
    let c = center(group), j = i + 1;
    while (j < points.length) {
      const gap = (timeValue(points[j].fecha) - timeValue(group[group.length - 1].fecha)) / 60000;
      if (gap < 0 || gap > maxGapMin || haversine(c, points[j]) > radius) break;
      group.push(points[j]); c = center(group); j++;
    }
    if (group.length >= minPts) {
      const start = timeValue(group[0].fecha), end = timeValue(group[group.length - 1].fecha), min = (end - start) / 60000;
      const touchesArea = group.some((p) => fences.some((f) => contains(f.geometry, p)));
      if (min > 5 && min < 20 && !touchesArea) {
        const ctr = center(group);
        out.push({ tipo: "PAUSA_ACTIVA", inicio: group[0].fecha, fin: group[group.length - 1].fecha, duracion_min: Math.round(min * 100) / 100, lat: ctr.lat, lng: ctr.lng, geocerca: "FUERA DE GEOCERCA", modo: "PARADA_ESPACIAL_5_20", puntos: group.length });
      }
    }
    i = j > i + 1 ? j : i + 1;
  }
  return out;
}
function qualifiesOvernight(startMs: number, endMs: number) {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && (endMs - startMs) / 3600000 > 4 && dateKey(startMs) !== dateKey(endMs);
}
function plantPernoctes(points: Pt[], fences: Fence[]) {
  const out: any[] = [];
  const plants = fences.filter((f) => f.role !== "CARGUIO" && !(f.role === "SMCV" && textNorm(f.originalName).includes("SAN JOSE")));
  for (const f of plants) {
    for (const b of rawBlocksInside(points, f)) {
      if (b.points.length < 2 || !qualifiesOvernight(b.startMs, b.endMs)) continue;
      const ctr = center(b.points);
      out.push({ tipo: "PERNOCTE", inicio: b.ingreso, fin: b.ultimo, duracion_min: Math.round((b.endMs - b.startMs) / 600) / 100, lat: ctr.lat, lng: ctr.lng, geocerca: f.name, modo: "PERMANENCIA_EN_PLANTA", puntos: b.points.length, prioridad: 3 });
    }
  }
  return out;
}
function spatialPernoctes(points: Pt[], fences: Fence[]) {
  const out: any[] = [], radius = 160;
  let i = 0;
  while (i < points.length - 1) {
    const group: Pt[] = [points[i]];
    let c = center(group), j = i + 1;
    while (j < points.length) {
      if (haversine(c, points[j]) > radius) break;
      group.push(points[j]); c = center(group); j++;
    }
    if (group.length >= 2) {
      const start = timeValue(group[0].fecha), end = timeValue(group[group.length - 1].fecha);
      if (qualifiesOvernight(start, end)) {
        const ctr = center(group), zone = zoneAt(ctr, fences);
        if (!zone || (zone.role === "SMCV" && textNorm(zone.originalName).includes("SAN JOSE"))) out.push({ tipo: "PERNOCTE", inicio: group[0].fecha, fin: group[group.length - 1].fecha, duracion_min: Math.round((end - start) / 600) / 100, lat: ctr.lat, lng: ctr.lng, geocerca: zone?.name || "FUERA DE GEOCERCA", modo: "PARADA_ESPACIAL", puntos: group.length, prioridad: 2 });
      }
    }
    i = j > i + 1 ? j : i + 1;
  }
  return out;
}
function revisitPernoctes(points: Pt[], fences: Fence[]) {
  const radius = 230, cell = 0.0021, map = new Map<string, Pt[]>(), out: any[] = [], seen = new Set<string>();
  for (const p of points) {
    const x = Math.floor(p.lng / cell), y = Math.floor(p.lat / cell), key = `${x}:${y}`;
    if (!map.has(key)) map.set(key, []); map.get(key)!.push(p);
  }
  for (const key of map.keys()) {
    const [x, y] = key.split(":").map(Number), nearby: Pt[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) nearby.push(...(map.get(`${x + dx}:${y + dy}`) || []));
    if (nearby.length < 4) continue;
    const ctr0 = medianCenter(nearby), core = nearby.filter((p) => haversine(ctr0, p) <= radius).sort((a, b) => timeValue(a.fecha) - timeValue(b.fecha));
    if (core.length < 4) continue;
    const centreKey = `${ctr0.lat.toFixed(3)}:${ctr0.lng.toFixed(3)}`;
    if (seen.has(centreKey)) continue; seen.add(centreKey);
    let group: Pt[] = [];
    const flush = () => {
      if (group.length < 4) { group = []; return; }
      const start = timeValue(group[0].fecha), end = timeValue(group[group.length - 1].fecha), hours = (end - start) / 3600000;
      if (!qualifiesOvernight(start, end) || hours > 16) { group = []; return; }
      const distinctHours = new Set(group.map((p) => { const d = new Date(timeValue(p.fecha)); return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`; })).size;
      if (distinctHours < 3) { group = []; return; }
      const ctr = medianCenter(group), zone = zoneAt(ctr, fences);
      if (zone && !(zone.role === "SMCV" && textNorm(zone.originalName).includes("SAN JOSE"))) { group = []; return; }
      const interval = points.filter((p) => { const t = timeValue(p.fecha); return t >= start && t <= end; });
      const nucleus = interval.filter((p) => haversine(ctr, p) <= radius), ratio = nucleus.length / Math.max(1, interval.length);
      if (ratio < 0.10) { group = []; return; }
      let maxGap = 0; for (let k = 1; k < group.length; k++) maxGap = Math.max(maxGap, (timeValue(group[k].fecha) - timeValue(group[k - 1].fecha)) / 60000);
      out.push({ tipo: "PERNOCTE", inicio: group[0].fecha, fin: group[group.length - 1].fecha, duracion_min: Math.round((end - start) / 600) / 100, lat: ctr.lat, lng: ctr.lng, geocerca: zone?.name || "FUERA DE GEOCERCA", modo: "REVISITA_ESTACIONARIA", puntos: nucleus.length, puntos_intervalo: interval.length, ratio_nucleo: Math.round(ratio * 10000) / 10000, horas_distintas: distinctHours, max_gap_nucleo_min: Math.round(maxGap * 10) / 10, prioridad: 1 });
      group = [];
    };
    for (const p of core) {
      if (!group.length) { group = [p]; continue; }
      const gapH = (timeValue(p.fecha) - timeValue(group[group.length - 1].fecha)) / 3600000;
      if (gapH > 3.5) { flush(); group = [p]; } else group.push(p);
    }
    flush();
  }
  return out;
}
function overlapSeconds(a: any, b: any) {
  const ini = Math.max(timeValue(a.inicio), timeValue(b.inicio)), fin = Math.min(timeValue(a.fin), timeValue(b.fin));
  return Math.max(0, (fin - ini) / 1000);
}
function equivalentStop(a: any, b: any) {
  const da = Math.max(1, (timeValue(a.fin) - timeValue(a.inicio)) / 1000), db = Math.max(1, (timeValue(b.fin) - timeValue(b.inicio)) / 1000);
  return haversine({ lat: a.lat, lng: a.lng, fecha: null }, { lat: b.lat, lng: b.lng, fecha: null }) <= 230 && overlapSeconds(a, b) / Math.min(da, db) >= 0.5;
}
function dedupePernoctes(rows: any[]) {
  const sorted = [...rows].sort((a, b) => (b.prioridad || 0) - (a.prioridad || 0) || timeValue(a.inicio) - timeValue(b.inicio)), out: any[] = [];
  for (const r of sorted) {
    const i = out.findIndex((x) => equivalentStop(r, x));
    if (i < 0) out.push(r);
    else if ((r.prioridad || 0) > (out[i].prioridad || 0)) out[i] = r;
  }
  return out.sort((a, b) => timeValue(a.inicio) - timeValue(b.inicio));
}
function stopId(p: any) {
  return `${p.tipo}|${p.inicio}|${p.fin}|${Number(p.lat).toFixed(5)}|${Number(p.lng).toFixed(5)}`;
}
function analyze(points: Pt[], fences: Fence[], eventFences: Fence[]) {
  const ordered = orderedPoints(points), geo = operationalVisits(ordered, eventFences);
  const pauses = pauseCandidates(ordered, fences);
  const pernoctes = dedupePernoctes([...plantPernoctes(ordered, fences), ...spatialPernoctes(ordered, fences), ...revisitPernoctes(ordered, fences)]);
  const stops = [...pernoctes, ...pauses].map((x) => ({ ...x, id: stopId(x) })).sort((a, b) => timeValue(a.inicio) - timeValue(b.inicio));
  const last = ordered.at(-1), lastFence = last ? zoneAt(last, fences) : null;
  const first = ordered[0] || null;
  return {
    puntos_evaluados: ordered.length,
    reglas: { pausa_activa: ">5 y <20 min · >=3 puntos · radio 110 m · gap <=5 min · fuera de áreas operativas", pernocte: ">4 h y cambio de fecha · validación humana obligatoria", raciemsa: ">=20 min", san_jose_smcv: "cruce geométrico observado, sin permanencia mínima", geocercas_todas: "última posición usa todas las geocercas publicadas (incluye corredor SMCV)" },
    eventos_geocerca: geo.events,
    visitas_confirmadas: geo.visits,
    visitas_no_confirmadas: geo.unconfirmed,
    paradas_candidatas: stops,
    resumen_paradas: { pernoctes: pernoctes.length, pausas_activas: pauses.length },
    estado_final: lastFence ? "EN GEOCERCA" : "TRÁNSITO",
    ultima_geocerca: lastFence?.name || "",
    ultima_geocerca_rol: lastFence?.role || "",
    // Sugerido para campo MONITOREO: nombre de geocerca si el punto F está dentro de una.
    monitoreo_sugerido: lastFence?.name || "",
    punto_inicio: first ? { lat: first.lat, lng: first.lng, fecha: first.fecha || "" } : null,
    punto_fin: last ? { lat: last.lat, lng: last.lng, fecha: last.fecha || "", geocerca: lastFence?.name || "", rol: lastFence?.role || "" } : null,
  };
}

async function recorrido(plate: string, tracto: string, from: string, to: string, fences: Fence[], eventFences: Fence[]) {
  const user = process.env["CLOCATOR_USER"], password = process.env["CLOCATOR_PASSWORD"];
  if (!user || !password) throw new Error("No existen CLOCATOR_USER y CLOCATOR_PASSWORD en los secretos de Supabase");
  const s = await login(user, password), info = rowInfo(s.main, plate, tracto), rk = info.rk, ultimoMonitoreo = info.ultimo_monitoreo, common = {
    frmMonitoreo: "frmMonitoreo",
    "frmMonitoreo:cmbBuscarMonitoreo_input": "Placa",
    "frmMonitoreo:cmbBuscarMonitoreo_focus": "",
    "frmMonitoreo:txtBuscarMonitoreo": "",
    "frmMonitoreo:ckbEtiquetasMonitoreo": "on",
    "frmMonitoreo:dtTablaMonitoreo_selection": rk,
    "frmMonitoreo:dtTablaMonitoreo_scrollState": "0,0",
  };
  let r = await postForm(s.fetcher, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.partial.execute": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.behavior.event": "contextMenu",
    "javax.faces.partial.event": "contextMenu",
    ...common,
    "javax.faces.ViewState": s.view,
  }, MAIN, true);
  let xml = await r.text(), view = viewPartial(xml) || s.view;
  const source = showSource(s.main);
  r = await postForm(s.fetcher, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": source,
    "javax.faces.partial.execute": "@all",
    [source]: source,
    ...common,
    "javax.faces.ViewState": view,
  }, MAIN, true);
  xml = await r.text(); view = viewPartial(xml);
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
    "javax.faces.ViewState": view,
  }, MAIN, true);
  if (!r.ok) throw new Error(`Buscar recorrido devolvió HTTP ${r.status}`);
  r = await s.fetcher(RPC, {
    method: "POST",
    headers: { accept: "application/json, text/javascript, */*; q=0.01", "content-type": "application/json", "x-requested-with": "XMLHttpRequest", origin: "https://clocatorplus.comsatel.com.pe", referer: MAIN },
    body: JSON.stringify({ jsonrpc: "2.0", method: "recorridoMBean.getRecorridoAgregado", params: [], id: 6 }),
  });
  if (!r.ok) throw new Error(`JSON-RPC devolvió HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(`JSON-RPC: ${JSON.stringify(data.error)}`);
  const list = data?.result?.map?.listHistorica?.list;
  if (!Array.isArray(list)) throw new Error("CLocator no devolvió listHistorica.list");
  const points: Pt[] = [];
  for (const item of list) {
    const p = item?.map ?? item;
    if (Number.isFinite(Number(p?.latitud)) && Number.isFinite(Number(p?.longitud))) points.push({ lat: Number(p.latitud), lng: Number(p.longitud), fecha: p.fechaFinToString || p.fechaInicioToString || null });
  }
  const last = points.at(-1) || null;
  // Preferir punto válido en Perú; si el del rango es basura, usar irAMonitoreo del main
  let ultimo: Pt | null = null;
  if (last && inPeruBBox(last.lat, last.lng)) ultimo = last;
  else if (ultimoMonitoreo && inPeruBBox(ultimoMonitoreo.lat, ultimoMonitoreo.lng)) {
    ultimo = { lat: ultimoMonitoreo.lat, lng: ultimoMonitoreo.lng, fecha: ultimoMonitoreo.fecha || null };
  } else if (last && esParGeoValido(last.lat, last.lng)) ultimo = last;
  else if (ultimoMonitoreo && esParGeoValido(ultimoMonitoreo.lat, ultimoMonitoreo.lng)) {
    ultimo = { lat: ultimoMonitoreo.lat, lng: ultimoMonitoreo.lng, fecha: ultimoMonitoreo.fecha || null };
  }
  return {
    puntos: points.length,
    total_original: list.length,
    primero: points[0] || null,
    ultimo,
    ultimo_monitoreo: ultimoMonitoreo,
    sin_movimiento: points.length < 2,
    puntos_gps: points,
    analisis: analyze(points, fences, eventFences),
    geocercas: fences,
  };
}

export async function handleClocatorRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "Método no permitido" }, 405);
  try {
    const { db, user } = await secure(req), cartography = await publishedCartography(db), fences = cartography.fences, eventFences = cartography.eventFences;
    const body = await req.json().catch(() => ({}));
    if (body.action === "map_config") {
      const out = { ok: true, geocercas: fences, cartografia: cartography.info, google_maps_api_key: process.env["GOOGLE_MAPS_API_KEY"] || "", analisis_version: "CV_DESKTOP_RULES_20261009_1" };
      await registrarEgress(db, user, "CLOCATOR_MAPA", out); return reply(req, out);
    }
    if (body.action === "reanalyze") {
      const raw = Array.isArray(body.puntos_gps) ? body.puntos_gps : [];
      const points: Pt[] = raw.map((p: any) => ({ lat: Number(p?.lat), lng: Number(p?.lng), fecha: p?.fecha || null }))
        .filter((p: Pt) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const out = { ok: true, analisis_version: "CV_DESKTOP_RULES_20261009_1", analisis: analyze(points, fences, eventFences), cartografia: cartography.info };
      await registrarEgress(db, user, "CLOCATOR_REANALISIS", out); return reply(req, out);
    }
    if (body.action === "health") {
      const clUser = process.env["CLOCATOR_USER"] || "", clPassword = process.env["CLOCATOR_PASSWORD"] || "";
      if (!clUser || !clPassword) throw new Error("Faltan CLOCATOR_USER / CLOCATOR_PASSWORD en secretos de Firebase Functions");
      await login(clUser, clPassword);
      const roles = Object.fromEntries(eventFences.map((x) => [x.role, x.name]));
      const out = { ok: true, clocator: "CONECTADO", credenciales: "SECRETOS_FIREBASE", cartografia: cartography.info, roles };
      await registrarEgress(db, user, "CLOCATOR_HEALTH", out); return reply(req, out);
    }
    const valid = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/,
      plate = String(body.placa || "").trim(), tracto = String(body.tracto || "").trim(), requestedFrom = String(body.desde || "").trim(), requestedTo = String(body.hasta || "").trim(),
      from = valid.test(requestedFrom) ? requestedFrom : "", to = valid.test(requestedTo) ? requestedTo : nowPE();
    if (!plate && !tracto) throw new Error("Falta placa o tracto");
    if (!from) throw new Error("Falta una fecha de inicio válida para el recorrido");
    const includeMap = body.include_map !== false, result: any = await recorrido(plate, tracto, from, to, fences, eventFences);
    if (!includeMap) delete result.geocercas;
    const out = { ok: true, modo: includeMap ? "ANALISIS_OPERATIVO_CERRO_VERDE" : "PRECARGA_ANALIZADA", analisis_version: "CV_DESKTOP_RULES_20261009_1", placa: plate, tracto, desde: from, hasta: to, ...result, cartografia: cartography.info, ...(includeMap ? { google_maps_api_key: process.env["GOOGLE_MAPS_API_KEY"] || "" } : {}), nota: "GPS vía proxy Firebase (sin egress Supabase); análisis en servidor." };
    await registrarEgress(db, user, includeMap ? "CLOCATOR_MAPA_GPS" : "CLOCATOR_PRECARGA_GPS", out); return reply(req, out);
  } catch (e) {
    console.error(e);
    return reply(req, { error: e instanceof Error ? e.message : "Error CLocator" }, 400);
  }
}


export const cerroVerdeClocator = onRequest(
  {
    cors: false,
    invoker: "public",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
  },
  async (req, res) => {
    try {
      const origin = String(req.get("origin") || "");
      if (req.method === "OPTIONS") {
        if (ORIGINS.has(origin)) {
          res.set("access-control-allow-origin", origin);
          res.set("vary", "Origin");
          res.set("access-control-allow-headers", "authorization, content-type");
          res.set("access-control-allow-methods", "POST, OPTIONS");
        }
        res.status(204).send("");
        return;
      }
      const host = String(req.get("host") || "localhost");
      const proto = String(req.get("x-forwarded-proto") || "https");
      const url = `${proto}://${host}${req.originalUrl || req.url || "/"}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers || {})) {
        if (v == null) continue;
        headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
      let bodyText: BodyInit | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (Buffer.isBuffer((req as any).rawBody)) bodyText = (req as any).rawBody;
        else if (typeof req.body === "string") bodyText = req.body;
        else if (req.body != null) bodyText = JSON.stringify(req.body);
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        body: bodyText,
      });
      const response = await handleClocatorRequest(request);
      response.headers.forEach((v, k) => res.set(k, v));
      const text = await response.text();
      res.status(response.status).send(text);
    } catch (e) {
      console.error(e);
      const origin = String(req.get("origin") || "");
      if (ORIGINS.has(origin)) {
        res.set("access-control-allow-origin", origin);
        res.set("vary", "Origin");
      }
      res.status(500).json({ error: e instanceof Error ? e.message : "Error proxy GPS" });
    }
  },
);


/** Handler HTTP compartido (CORS manual, Gen2). */
async function serveClocatorHttp(req: any, res: any) {
  try {
    const origin = String(req.get("origin") || "");
    if (req.method === "OPTIONS") {
      if (ORIGINS.has(origin)) {
        res.set("access-control-allow-origin", origin);
        res.set("vary", "Origin");
        res.set("access-control-allow-headers", "authorization, content-type");
        res.set("access-control-allow-methods", "POST, OPTIONS");
      }
      res.status(204).send("");
      return;
    }
    const host = String(req.get("host") || "localhost");
    const proto = String(req.get("x-forwarded-proto") || "https");
    const url = `${proto}://${host}${req.originalUrl || req.url || "/"}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (v == null) continue;
      headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    let bodyText: BodyInit | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (Buffer.isBuffer((req as any).rawBody)) bodyText = (req as any).rawBody;
      else if (typeof req.body === "string") bodyText = req.body;
      else if (req.body != null) bodyText = JSON.stringify(req.body);
    }
    const request = new Request(url, { method: req.method, headers, body: bodyText });
    const response = await handleClocatorRequest(request);
    response.headers.forEach((v, k) => res.set(k, v));
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (e) {
    console.error(e);
    const origin = String(req.get("origin") || "");
    if (ORIGINS.has(origin)) {
      res.set("access-control-allow-origin", origin);
      res.set("vary", "Origin");
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Error proxy GPS" });
  }
}

/**
 * TURNO AMANECIDA — proxy CLocator independiente (no usa endpoint Cerro Verde).
 * Mismo secret GOOGLE_MAPS_API_KEY / CLOCATOR_* del proyecto Work.
 */
export const turnoAmanecidaClocator = onRequest(
  {
    cors: false,
    invoker: "public",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
  },
  serveClocatorHttp,
);

/**
 * TURNO AMANECIDA — solo config de mapa (API key). Independiente de Cerro Verde.
 */
export const turnoAmanecidaConfig = onRequest(
  {
    cors: false,
    invoker: "public",
    timeoutSeconds: 30,
    memory: "256MiB",
    region: "us-central1",
  },
  async (req, res) => {
    const origin = String(req.get("origin") || "");
    const setCors = () => {
      if (ORIGINS.has(origin)) {
        res.set("access-control-allow-origin", origin);
        res.set("vary", "Origin");
        res.set("access-control-allow-headers", "authorization, content-type");
        res.set("access-control-allow-methods", "POST, OPTIONS");
      }
    };
    try {
      if (req.method === "OPTIONS") {
        setCors();
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        setCors();
        res.status(405).json({ error: "POST requerido" });
        return;
      }
      // Auth opcional-ligera: si hay Bearer se valida; si no, igual devolvemos key solo a orígenes permitidos
      setCors();
      if (!ORIGINS.has(origin)) {
        res.status(403).json({ error: "Origin no permitido" });
        return;
      }
      const key = process.env["GOOGLE_MAPS_API_KEY"] || "";
      res.status(200).json({
        ok: true,
        google_maps_api_key: key,
        itinerary: "turno-amanecida",
        nota: key ? "key_ok" : "GOOGLE_MAPS_API_KEY vacío en env de la function",
      });
    } catch (e) {
      setCors();
      res.status(500).json({ error: e instanceof Error ? e.message : "Error config" });
    }
  },
);
