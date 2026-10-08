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

function esParGeoValido(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  if (Math.abs(a) < 0.1 || Math.abs(b) < 0.1) return false;
  return true;
}

function latLngFromHtml(html: string): { lat: number | null; lng: number | null } {
  const patterns = [
    /irAMonitoreo\s*\(\s*['"]?(-?\d+(?:\.\d+)?)['"]?\s*,\s*['"]?(-?\d+(?:\.\d+)?)['"]?/i,
    /(-?\d{1,3}\.\d{4,})\s*[,;]\s*(-?\d{1,3}\.\d{4,})/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    // Prefer lat,lng order if valid
    if (esParGeoValido(a, b) && Math.abs(a) <= 90) return { lat: a, lng: b };
    if (esParGeoValido(b, a) && Math.abs(b) <= 90) return { lat: b, lng: a };
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

function estadoDesdeColor(color: string) {
  if (color === "VERDE") return "MOVIMIENTO";
  if (color === "ROJO" || color === "AMARILLO") return "DETENIDA";
  if (color === "GRIS") return "PERDIDA_GPS";
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
    const rowHtml = $.html(tr);
    const { lat, lng } = latLngFromHtml(rowHtml);
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

  return { registros, conPlaca, conCoord, totalFilas: filas.length };
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
