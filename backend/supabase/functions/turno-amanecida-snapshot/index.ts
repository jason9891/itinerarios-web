/**
 * Snapshot TURNO AMANECIDA
 * - Login CLocator → parsea tabla de monitoreo completa
 * Filtro en 3 capas (como desktop REPORTE_NOCHE):
 *   1) Dentro de Filtro_Macro_Sur_TN  → zona sur de interés
 *   2) EXCLUIR si está en alguna planta/base (_TN específica) → tienen resguardo
 *   3) Código contiene 20-R-
 * Resultado esperado: ~70-80 unidades en macro sur pero fuera de planta.
 * NO cruza OC ni acoples (match local en el navegador).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import { load } from "npm:cheerio@1.1.2";
import makeFetchCookie from "npm:fetch-cookie@3.1.0";
import { CookieJar } from "npm:tough-cookie@5.1.2";
import geocercasTn from "./geocercas_tn.json" with { type: "json" };

const PROJECT = "itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
const BASE = "https://clocatorplus.comsatel.com.pe/CL";
const LOGIN = `${BASE}/faces/seguridad/login.xhtml`;
const MAIN = `${BASE}/faces/page/main.xhtml`;

function reply(req: Request, body: unknown, status = 200) {
  const o = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw new Error("Origen no autorizado");
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(auth.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: user, error } = await db
    .from("app_usuarios")
    .select("email,rol,itinerarios,activo")
    .eq("firebase_uid", String(payload.sub || ""))
    .maybeSingle();
  if (error) throw error;
  if (!user?.activo) throw new Error("Cuenta inactiva o sin acceso");
  return { db, user };
}

function encode(data: Record<string, string>) {
  return new URLSearchParams(data).toString();
}

function formData($: any, form: any) {
  const data: Record<string, string> = {};
  form.find("input,select,textarea").each((_: number, el: any) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    const type = ($el.attr("type") || "").toLowerCase();
    if (type === "submit" || type === "button" || type === "image") return;
    if ((type === "checkbox" || type === "radio") && !$el.is(":checked")) return;
    data[name] = $el.val() != null ? String($el.val()) : "";
  });
  return data;
}

function viewHtml(html: string) {
  const $ = load(html);
  const vs = $('input[name="javax.faces.ViewState"]').first().attr("value");
  return vs || "";
}

async function postForm(
  fetcher: typeof fetch,
  url: string,
  data: Record<string, string>,
  referer: string,
) {
  return fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer,
    },
    body: encode(data),
    redirect: "follow",
  });
}

async function login(user: string, password: string) {
  const fetcher = makeFetchCookie(fetch, new CookieJar());
  let page: Response | null = null;
  let $: any;
  let form: any;
  let userInput: any;
  let passInput: any;
  for (const url of [LOGIN, `${BASE}/`, MAIN]) {
    const r = await fetcher(url, { redirect: "follow" });
    if (!r.ok) continue;
    const html = await r.text();
    $ = load(html);
    form = $("form")
      .filter((_: number, e: any) => $(e).find('input[type="password"]').length > 0)
      .first();
    if (form.length) {
      page = new Response(html, { status: r.status, headers: r.headers });
      passInput = form.find('input[type="password"]').first();
      userInput = form.find('input[type="text"],input[type="email"]').first();
      break;
    }
  }
  if (!page || !form?.length) throw new Error("No se encontró el formulario de acceso de CLocator");
  const html = await page.text();
  const baseUrl = page.headers.get("x-final-url") || LOGIN;
  $ = load(html);
  form = $("form")
    .filter((_: number, e: any) => $(e).find('input[type="password"]').length > 0)
    .first();
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
  const r = await fetcher(MAIN, { redirect: "follow" });
  const main = await r.text();
  if (!r.ok || !viewHtml(main)) throw new Error("CLocator rechazó el acceso o no devolvió ViewState");
  return { fetcher, main };
}

/** Ray casting point-in-polygon. ring = [[lng,lat], ...] */
function pointInRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Capa 1: ¿está en Filtro_Macro_Sur_TN?
 * Capa 2: si sí, ¿cae en alguna planta/base específica?
 *   - en planta → zona = nombre planta (se DESCARTA del seguimiento nocturno)
 *   - solo macro → zona = "Transito" (unidad de interés: sur sin resguardo)
 * Sin coordenadas válidas → no se puede clasificar (se excluye).
 */
function evaluarZona(lat: number | null, lng: number | null) {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { zona: null as string | null, en_macro: false, en_planta: false, sin_coord: true };
  }
  const macro = (geocercasTn as Record<string, number[][]>)["Filtro_Macro_Sur_TN"];
  if (!macro || !pointInRing(lng, lat, macro)) {
    return { zona: null, en_macro: false, en_planta: false, sin_coord: false };
  }
  for (const [name, ring] of Object.entries(geocercasTn as Record<string, number[][]>)) {
    if (name === "Filtro_Macro_Sur_TN") continue;
    if (pointInRing(lng, lat, ring)) {
      return { zona: name, en_macro: true, en_planta: true, sin_coord: false };
    }
  }
  // Dentro del macro, fuera de toda planta/base = tránsito de interés
  return { zona: "Transito", en_macro: true, en_planta: false, sin_coord: false };
}

function inPeruBBox(lat: number, lng: number) {
  return lat >= -19.5 && lat <= 0.5 && lng >= -82 && lng <= -68;
}

/** Rechaza UTM/odómetro (p.ej. 8689952) — solo pares geo reales. */
function esParGeoValido(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const ok = (la: number, lo: number) =>
    Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Math.abs(la) > 0.1 && Math.abs(lo) > 0.1;
  return ok(a, b) || ok(b, a);
}

function normalizeLatLng(a: number, b: number): { lat: number; lng: number } | null {
  if (!esParGeoValido(a, b)) return null;
  if (inPeruBBox(a, b)) return { lat: a, lng: b };
  if (inPeruBBox(b, a)) return { lat: b, lng: a };
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a };
  return null;
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

/**
 * CLocator real (validado en cemento-clocator):
 *   irAMonitoreo(8689952,'-16.403656666666667','-71.600115','0')
 *   → (idVehiculo, lat, lng, flag)  NO es (lat, lng)
 */
function latLngFromFila($: any, tr: any): { lat: number | null; lng: number | null } {
  const chunks: string[] = [];
  chunks.push($.html(tr) || "");
  $(tr).find("*").addBack().each((_: number, el: any) => {
    const node = $(el);
    for (const attr of [
      "onclick", "ondblclick", "href", "data-href", "data-url",
      "data-lat", "data-lon", "data-longitude", "data-latitude", "title",
    ]) {
      const v = node.attr(attr);
      if (v) chunks.push(String(v));
    }
    const attribs = el.attribs || {};
    for (const v of Object.values(attribs)) {
      if (v) chunks.push(String(v));
    }
  });
  chunks.push($(tr).html() || "");
  const src = decodeHtmlEntities(chunks.join("\n"));
  const toNum = (s: string) => Number(String(s).replace(",", "."));

  // 1) Firma real: id, lat, lng
  const reIdLatLng =
    /irAMonitoreo\s*\(\s*['"]?\d+['"]?\s*,\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = reIdLatLng.exec(src))) {
    const fixed = normalizeLatLng(toNum(m[1]), toNum(m[2]));
    if (fixed) return fixed;
  }

  // 2) Firma antigua: lat, lng (sin id)
  const reLatLng =
    /irAMonitoreo\s*\(\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
  while ((m = reLatLng.exec(src))) {
    const a = toNum(m[1]), b = toNum(m[2]);
    // Evitar (idEntero, lat) si el id no tiene decimal
    if (Number.isInteger(a) && Math.abs(a) > 90) continue;
    const fixed = normalizeLatLng(a, b);
    if (fixed) return fixed;
  }

  return { lat: null, lng: null };
}

function colorFromTr($: any, tr: any) {
  const cls = String($(tr).attr("class") || "").toUpperCase();
  if (cls.includes("AMARIL") || cls.includes("YELLOW")) return "AMARILLO";
  if (cls.includes("GRIS") || cls.includes("GRAY") || cls.includes("GREY")) return "GRIS";
  if (cls.includes("ROJO") || cls.includes("RED")) return "ROJO";
  if (cls.includes("VERDE") || cls.includes("GREEN")) return "VERDE";
  const style = String($(tr).attr("style") || "").toLowerCase();
  if (style.includes("yellow") || style.includes("#ff")) return "AMARILLO";
  if (style.includes("red")) return "ROJO";
  if (style.includes("green")) return "VERDE";
  if (style.includes("gray") || style.includes("grey")) return "GRIS";
  return "SIN_COLOR";
}

/**
 * COLOR_HTML viene del HTML de CLocator (plomo/gris, rojo, amarillo, verde).
 * NO es lo mismo que "detenida".
 * Reglas desktop (monitor_nocturno):
 *   ROJO  → PERDIDA_GPS (alerta de color CLocator, no "movimiento")
 *   GRIS  → PERDIDA_GPS / sin señal
 *   VERDE → indicios de actividad (sin snapshot previo no hay regla de 100 m)
 *   resto → DETENIDA (el movimiento real ≥100 m se calcula en el poll de monitoreo)
 */
function estadoDesdeColor(color: string) {
  const c = String(color || "").toUpperCase();
  if (c === "ROJO" || c === "GRIS") return "PERDIDA_GPS";
  if (c === "VERDE") return "MOVIMIENTO";
  if (c === "AMARILLO") return "DETENIDA";
  return "SIN_DATOS";
}

function extraerSnapshot(mainHtml: string) {
  const $ = load(mainHtml);
  let $tbody = $("#frmMonitoreo\\:dtTablaMonitoreo_data");
  if (!$tbody.length) {
    $tbody = $("tbody")
      .filter((_: number, el: any) =>
        String($(el).attr("id") || "").endsWith("dtTablaMonitoreo_data"),
      )
      .first();
  }
  if (!$tbody.length) throw new Error("No se encontró la tabla de monitoreo CLocator");

  const filas = $tbody.find("tr").toArray();
  const registros: any[] = [];
  let conPlaca = 0;
  let conCoord = 0;

  for (const tr of filas) {
    const tds = $(tr).find("td").toArray();
    if (tds.length < 3) continue;
    // Primer TD suele ser checkbox
    const textos = tds.slice(1).map((td: any) => $(td).text().replace(/\s+/g, " ").trim());
    const placa = textos[0] || "";
    if (!placa) continue;
    conPlaca++;
    // Código externo: buscar celda con 20-R- (más robusto que índice fijo)
    let codigo = "";
    for (const tx of textos) {
      const m = String(tx).toUpperCase().match(/20-R-\d+/);
      if (m) {
        codigo = m[0];
        // Si la celda es solo el código o lo contiene, preferir match completo tipo 20-R-799
        const m2 = String(tx).toUpperCase().match(/20-R-\d+/);
        if (m2) codigo = m2[0];
        break;
      }
    }
    if (!codigo) {
      // fallback columna 2 como en desktop
      const c2 = String(textos[1] || "").trim();
      if (/20-R-/i.test(c2)) codigo = c2.toUpperCase();
    }
    const tParada = textos[5] || textos[6] || "";
    const { lat, lng } = latLngFromFila($, tr);
    if (lat != null && lng != null) conCoord++;
    const color = colorFromTr($, tr);
    const geo = evaluarZona(lat, lng);
    registros.push({
      placa,
      codigo: codigo || String(textos[1] || "").trim(),
      t_parada: tParada,
      lat,
      lng,
      color_html: color,
      estado_monitoreo: estadoDesdeColor(color),
      zona: geo.zona,
      en_macro: geo.en_macro,
      en_planta: geo.en_planta,
      sin_coord: geo.sin_coord,
    });
  }

  // Diagnóstico: ¿hay irAMonitoreo en el HTML de la tabla?
  const sampleSrc = decodeHtmlEntities($tbody.html() || "").slice(0, 50000);
  const reProbe = /irAMonitoreo\s*\([^)]{0,120}\)/gi;
  const muestrasIr: string[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = reProbe.exec(sampleSrc)) && muestrasIr.length < 5) {
    muestrasIr.push(mm[0].slice(0, 120));
  }

  return {
    registros,
    conPlaca,
    conCoord,
    totalFilas: filas.length,
    muestras_irAMonitoreo: muestrasIr,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "POST requerido" }, 405);
  try {
    await secure(req);
    const body = await req.json().catch(() => ({}));
    const action = String((body as any).action || "snapshot");

    if (action !== "snapshot") {
      return reply(req, { error: `Acción desconocida: ${action}` }, 400);
    }

    const user = Deno.env.get("CLOCATOR_USER");
    const password = Deno.env.get("CLOCATOR_PASSWORD");
    if (!user || !password) {
      throw new Error("Faltan CLOCATOR_USER / CLOCATOR_PASSWORD en secretos");
    }

    const { main } = await login(user, password);
    const raw = extraerSnapshot(main);

    /**
     * Filtro operativo:
     *  A) en_macro = true  (dentro de Filtro_Macro_Sur_TN)
     *  B) en_planta = false (NO está en Yura, Caracoto, Gloria, etc.)
     *  C) codigo contiene 20-R-
     *  D) tiene coordenadas (sin coord no se puede validar zona)
     *  E) dedupe por placa
     */
    const seen = new Set<string>();
    const unidades = [];
    let n20r = 0, nMacro = 0, nPlanta = 0, nFueraMacro = 0, nSinCoord = 0, nTransito20r = 0;
    const porPlanta: Record<string, number> = {};

    for (const r of raw.registros) {
      const codigo = String(r.codigo || "").toUpperCase();
      const es20r = codigo.includes("20-R-");
      if (es20r) n20r++;
      if (r.sin_coord) nSinCoord++;
      else if (!r.en_macro) nFueraMacro++;
      else if (r.en_planta) {
        nPlanta++;
        const z = String(r.zona || "planta");
        porPlanta[z] = (porPlanta[z] || 0) + 1;
      } else {
        nMacro++; // macro y no planta = Transito
      }

      if (!es20r) continue;
      if (r.sin_coord) continue;
      if (!r.en_macro) continue;
      if (r.en_planta) continue;
      // en_macro && !en_planta && 20-R-  → zona Transito
      nTransito20r++;
      const key = String(r.placa || "").toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unidades.push({
        placa: r.placa,
        codigo: r.codigo,
        t_parada: r.t_parada,
        lat: r.lat,
        lng: r.lng,
        color_html: r.color_html,
        estado_monitoreo: r.estado_monitoreo,
        zona: "Transito",
      });
    }

    return reply(req, {
      ok: true,
      generado_en: new Date().toISOString(),
      stats: {
        filas_tabla: raw.totalFilas,
        con_placa: raw.conPlaca,
        con_coord: raw.conCoord,
        con_20r: n20r,
        sin_coord: nSinCoord,
        fuera_macro: nFueraMacro,
        en_planta: nPlanta,
        por_planta: porPlanta,
        macro_sin_planta: nMacro,
        transito_20r: nTransito20r,
        unidades_finales: unidades.length,
        geocercas_tn: Object.keys(geocercasTn).length,
        muestras_irAMonitoreo: raw.muestras_irAMonitoreo || [],
      },
      unidades,
      nota:
        "Filtro: (1) Filtro_Macro_Sur_TN (2) excluir plantas/bases _TN (3) 20-R-. Match OC local en navegador.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return reply(req, { error: msg }, 400);
  }
});
