// @ts-nocheck
// Extractor de rutas CLocator para el proyecto de Supabase de cada usuario.
// GENERADO por build-supabase.mjs a partir de src/ (no editar a mano).
// Secretos requeridos (Edge Functions → Secrets): CLOCATOR_USER, CLOCATOR_PASSWORD, ALLOWED_EMAILS
// Desplegar con "Verify JWT" DESACTIVADO (la identidad se valida con el token de Firebase).
// ───── auth.js ─────
// Verificación de ID tokens de Firebase con Web Crypto (sin dependencias → poca CPU).
const PROJECT = "itinerarios-2fa6f";
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwks = null;
let jwksAt = 0;
const keyCache = new Map();

const b64uToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

async function getKey(kid, fetchFn) {
  if (keyCache.has(kid) && Date.now() - jwksAt < 3600_000) return keyCache.get(kid);
  if (!jwks || Date.now() - jwksAt >= 3600_000 || !jwks.keys.some((k) => k.kid === kid)) {
    const r = await fetchFn(JWKS_URL);
    if (!r.ok) throw new Error("No se pudo leer las llaves de Firebase");
    jwks = await r.json();
    jwksAt = Date.now();
    keyCache.clear();
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("Llave de token desconocida");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  keyCache.set(kid, key);
  return key;
}

/** Devuelve { uid, email } o lanza error. */
async function verificarFirebase(token, env, fetchFn = fetch) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Token inválido");
  const header = b64uToJson(parts[0]);
  const payload = b64uToJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Token inválido");
  const key = await getKey(header.kid, fetchFn);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64uToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error("Firma de token inválida");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT || payload.iss !== `https://securetoken.google.com/${PROJECT}`) {
    throw new Error("Token de otro proyecto");
  }
  if (!payload.exp || payload.exp < now - 30) throw new Error("Sesión vencida");
  if (!payload.sub) throw new Error("Token sin identidad");
  const email = String(payload.email || "").toLowerCase();
  const permitidos = String(env.ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!permitidos.length) throw new Error("Usuario sin acceso: el secreto ALLOWED_EMAILS no está configurado en el Worker");
  if (!email) throw new Error("Usuario sin acceso: el token no trae correo");
  if (!payload.email_verified) throw new Error(`Usuario sin acceso: el correo ${email} no está verificado`);
  if (!permitidos.includes(email)) throw new Error(`Usuario sin acceso: ${email} no está en ALLOWED_EMAILS`);
  return { uid: payload.sub, email };
}

// ───── clocator.js ─────
// Cliente CLocator (Comsatel) para Workers: SIN cheerio, solo cadenas y regex (mínima CPU).
const BASE = "https://clocatorplus.comsatel.com.pe/CL";
const LOGIN = `${BASE}/faces/seguridad/login.xhtml`;
const MAIN = `${BASE}/faces/page/main.xhtml`;
const RPC = `${BASE}/JSON-RPC`;
const ORIGIN = "https://clocatorplus.comsatel.com.pe";

// ───────── utilidades de texto ─────────
const ENT = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", "#39": "'", "#039": "'" };
function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCharCode(n) : m;
    }
    return m;
  });
}
const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const norm = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, "");
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

function viewHtml(html) {
  const re = /<input\b[^>]*name=["']javax\.faces\.ViewState["'][^>]*>/i;
  const t = html.match(re)?.[0];
  if (t) return attrs(t).value || "";
  const t2 = html.match(/<input\b[^>]*id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>/i)?.[0];
  return t2 ? attrs(t2).value || "" : "";
}
function viewPartial(xml) {
  const m = xml.match(
    /<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/i,
  );
  return m?.[1]?.trim() || "";
}

// ───────── geo ─────────
const inPeru = (la, lo) => la >= -19.5 && la <= 0.5 && lo >= -82 && lo <= -68;
function geoValido(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const ok = (la, lo) => Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Math.abs(la) > 0.1 && Math.abs(lo) > 0.1;
  return ok(x, y) || ok(y, x);
}
function normLatLng(a, b) {
  const x = Number(a), y = Number(b);
  if (!geoValido(x, y)) return null;
  if (inPeru(x, y)) return { lat: x, lng: y };
  if (inPeru(y, x)) return { lat: y, lng: x };
  if (Math.abs(x) <= 90 && Math.abs(y) <= 180) return { lat: x, lng: y };
  if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return { lat: y, lng: x };
  return null;
}

/** "dd/MM/yyyy HH:mm:ss" (hora Lima, UTC-5) → segundos unix. */
function limaStrToSec(s) {
  if (!s || s.length < 19) return null;
  const d = +s.slice(0, 2), mo = +s.slice(3, 5), y = +s.slice(6, 10);
  const h = +s.slice(11, 13), mi = +s.slice(14, 16), se = +s.slice(17, 19);
  const t = Date.UTC(y, mo - 1, d, h + 5, mi, se);
  return Number.isFinite(t) ? t / 1000 : null;
}

// ───────── sesión / cookies ─────────
class Jar {
  constructor(init) {
    this.c = new Map(Object.entries(init || {}));
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const first = sc.split(";")[0];
      const i = first.indexOf("=");
      if (i < 1) continue;
      const k = first.slice(0, i).trim(), v = first.slice(i + 1).trim();
      if (/;\s*max-age=0/i.test(sc) || v === "") this.c.delete(k);
      else this.c.set(k, v);
    }
  }
  toObject() {
    return Object.fromEntries(this.c);
  }
}

async function req(S, url, init = {}, hops = 6) {
  let u = url, method = init.method || "GET", body = init.body;
  for (let i = 0; i <= hops; i++) {
    const headers = { ...(init.headers || {}) };
    const ck = S.jar.header();
    if (ck) headers.cookie = ck;
    headers["user-agent"] ||= "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
    const r = await S.fetch(u, { method, headers, body, redirect: "manual" });
    S.jar.absorb(r);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      u = new URL(r.headers.get("location"), u).href;
      method = "GET";
      body = undefined;
      S.n++;
      continue;
    }
    S.n++;
    return r;
  }
  throw new Error("Demasiadas redirecciones en CLocator");
}

const postForm = (S, url, data, referer, ajax = false) =>
  req(S, url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer,
      ...(ajax
        ? {
            accept: "application/xml, text/xml, */*; q=0.01",
            "faces-request": "partial/ajax",
            "x-requested-with": "XMLHttpRequest",
            origin: ORIGIN,
          }
        : {}),
    },
    body: new URLSearchParams(data).toString(),
  });

// ───────── login (sin DOM) ─────────
function parseLoginForm(html, baseUrl) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find((f) => /<input\b[^>]*type=["']?password/i.test(f));
  if (!form) return null;
  const formTag = form.match(/<form\b[^>]*>/i)[0];
  const fa = attrs(formTag);
  const data = {};
  let userName = "", passName = "", submit = null;
  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const type = (a.type || "text").toLowerCase();
    if (!a.name) continue;
    if (type === "password") {
      passName ||= a.name;
      continue;
    }
    if ((type === "text" || type === "email") && !userName) {
      userName = a.name;
      continue;
    }
    if (type === "submit") {
      submit ||= a;
      continue;
    }
    if ((type === "checkbox" || type === "radio") && !("checked" in a)) continue;
    data[a.name] = a.value ?? "";
  }
  const sb = form.match(/<button\b[^>]*type=["']?submit[^>]*>[\s\S]*?<\/button>/i)?.[0];
  if (!submit && sb) submit = { ...attrs(sb), value: attrs(sb).value || stripTags(sb) };
  const fid = fa.id || fa.name;
  if (fid) data[fid] = fid;
  if (submit?.name) data[submit.name] = submit.value || "";
  return { action: new URL(fa.action || LOGIN, baseUrl).href, data, userName, passName };
}

async function loginFresh(S, env) {
  if (!env.CLOCATOR_USER || !env.CLOCATOR_PASSWORD) throw new Error("Faltan los secretos CLOCATOR_USER y CLOCATOR_PASSWORD");
  let form = null;
  for (const url of [LOGIN, `${BASE}/`, MAIN]) {
    const r = await req(S, url);
    if (!r.ok) continue;
    form = parseLoginForm(await r.text(), r.url || url);
    if (form) break;
  }
  if (!form) throw new Error("No se encontró el formulario de acceso de CLocator");
  form.data[form.userName] = env.CLOCATOR_USER;
  form.data[form.passName] = env.CLOCATOR_PASSWORD;
  await postForm(S, form.action, form.data, LOGIN);
}

async function getMain(S) {
  const r = await req(S, MAIN);
  const html = await r.text();
  const view = viewHtml(html);
  if (!r.ok || !view) return null;
  return { html, view };
}

async function openSession(S, env) {
  // Siempre sesión propia: el resultado de recorridoMBean vive en la sesión de CLocator,
  // compartirla entre peticiones paralelas mezclaría rutas de unidades distintas.
  S.jar = new Jar();
  await loginFresh(S, env);
  S.mark?.('login');
  const m = await getMain(S);
  S.mark?.('main');
  if (!m) throw new Error("CLocator rechazó el acceso o no devolvió ViewState");
  return { ...m, reused: false };
}

// ───────── fila de la unidad (sin DOM) ─────────
function buscarFila(html, plate, tracto) {
  const targets = new Set();
  for (const raw of [plate, tracto].filter(Boolean)) {
    const n = norm(raw);
    if (!n) continue;
    targets.add(n);
    const m = n.match(/^(?:20)?R(\d{2,4})$/);
    if (m) {
      targets.add(`R${m[1]}`);
      targets.add(`20R${m[1]}`);
    }
  }
  const match = (v) => {
    if (!v) return false;
    if (targets.has(v)) return true;
    for (const t of targets) if (t.length >= 3 && v.includes(t)) return true;
    return false;
  };
  // Verifica UNA fila (primeras 3 celdas) y devuelve { rk, rowHtml } o null
  const evalRow = (rowStart, rowEnd) => {
    const row = html.slice(rowStart, rowEnd);
    const open = row.slice(0, row.indexOf(">") + 1);
    const rk = attrs(open)["data-rk"];
    if (!rk) return null;
    const cells = [];
    const reTd = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let t;
    while (cells.length < 3 && (t = reTd.exec(row))) cells.push(norm(stripTags(t[1])));
    return cells.some(match) ? { rk, rowHtml: row } : null;
  };

  // 1) Atajo barato: localizar el texto crudo con indexOf y validar solo esa fila
  const crudos = new Set();
  for (const raw of [plate, tracto].filter(Boolean)) {
    const r = String(raw).trim();
    if (r.length >= 3) {
      crudos.add(r);
      crudos.add(r.toUpperCase());
    }
  }
  for (const c of crudos) {
    let from = 0, idx;
    let guard = 0;
    while ((idx = html.indexOf(c, from)) >= 0 && guard++ < 20) {
      const rs = html.lastIndexOf("<tr", idx);
      const re = html.indexOf("</tr>", idx);
      if (rs >= 0 && re > rs) {
        const hit = evalRow(rs, re + 5);
        if (hit) return hit;
      }
      from = idx + c.length;
    }
  }

  // 2) Respaldo: recorrer toda la tabla (más CPU, solo si el atajo no encontró)
  const start = html.search(/id=["'][^"']*dtTablaMonitoreo_data["']/i);
  const scope = start >= 0 ? html.slice(start) : html;
  const reRow = /<tr\b[^>]*data-rk=[^>]*>[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = reRow.exec(scope))) {
    const row = m[0];
    const open = row.slice(0, row.indexOf(">") + 1);
    const rk = attrs(open)["data-rk"];
    const cells = [];
    const reTd = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let t;
    while (cells.length < 3 && (t = reTd.exec(row))) cells.push(norm(stripTags(t[1])));
    if (rk && cells.some(match)) return { rk, rowHtml: row };
  }
  return null;
}

function coordsDeFila(rowHtml) {
  const src = decodeEntities(rowHtml);
  const re = /irAMonitoreo\s*\(\s*['"]?\d+['"]?\s*,\s*['"]?(-?\d+[.,]\d+)['"]?\s*,\s*['"]?(-?\d+[.,]\d+)/gi;
  const num = (s) => Number(String(s).replace(",", "."));
  let m, first = null;
  while ((m = re.exec(src))) {
    const f = normLatLng(num(m[1]), num(m[2]));
    if (!f) continue;
    if (inPeru(f.lat, f.lng)) return f;
    first ||= f;
  }
  return first;
}

function showSource(html) {
  const i = html.search(/ui-menuitem-text["'][^>]*>\s*Mostrar Recorrido/i);
  if (i >= 0) {
    const a = html.lastIndexOf("<a", i);
    if (a >= 0) {
      const tag = decodeEntities(html.slice(a, html.indexOf(">", a) + 1));
      const s = tag.match(/source:'([^']+)'/)?.[1];
      if (s) return s;
    }
  }
  return "frmMonitoreo:j_idt735";
}

function dateFields(xml) {
  const found = [
    ...xml.matchAll(
      /name=["'](frmRecorrido:[^"']+_input)["'][^>]*value=["']\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}["']/gi,
    ),
  ].map((x) => x[1]);
  const u = [...new Set(found)];
  return [u[0] || "frmRecorrido:j_idt132_input", u[1] || "frmRecorrido:j_idt134_input"];
}

// ───────── recorrido ─────────
/**
 * @returns {{ ok, n, ultimo_monitoreo, p:[[tSeg,lat,lng],...], dbg }}
 */
/** Ruta de UNA unidad dentro de una sesión ya abierta (ses = página principal). */
async function rutaEnSesion(S, ses, { placa, tracto, desde, hasta }, mark) {
  const fila = buscarFila(ses.html, placa, tracto);
  if (!fila) throw new Error(`No se encontró ${placa || tracto} en el monitoreo CLocator`);
  const ultimo = coordsDeFila(fila.rowHtml);
  mark("fila");
  const common = {
    frmMonitoreo: "frmMonitoreo",
    "frmMonitoreo:cmbBuscarMonitoreo_input": "Placa",
    "frmMonitoreo:cmbBuscarMonitoreo_focus": "",
    "frmMonitoreo:txtBuscarMonitoreo": "",
    "frmMonitoreo:ckbEtiquetasMonitoreo": "on",
    "frmMonitoreo:dtTablaMonitoreo_selection": fila.rk,
    "frmMonitoreo:dtTablaMonitoreo_scrollState": "0,0",
  };
  let r = await postForm(S, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.partial.execute": "frmMonitoreo:dtTablaMonitoreo",
    "javax.faces.behavior.event": "contextMenu",
    "javax.faces.partial.event": "contextMenu",
    ...common,
    "javax.faces.ViewState": ses.view,
  }, MAIN, true);
  let xml = await r.text();
  mark('menu');
  let view = viewPartial(xml) || ses.view;
  const source = showSource(ses.html);
  r = await postForm(S, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": source,
    "javax.faces.partial.execute": "@all",
    [source]: source,
    ...common,
    "javax.faces.ViewState": view,
  }, MAIN, true);
  xml = await r.text();
  mark('mostrar');
  view = viewPartial(xml);
  if (!view) throw new Error("CLocator no abrió Mostrar Recorrido");
  const [startField, endField] = dateFields(xml);
  r = await postForm(S, MAIN, {
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
    [startField]: desde,
    [endField]: hasta,
    "javax.faces.ViewState": view,
  }, MAIN, true);
  if (!r.ok) throw new Error(`Buscar recorrido devolvió HTTP ${r.status}`);
  mark('buscar');
  r = await req(S, RPC, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: ORIGIN,
      referer: MAIN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "recorridoMBean.getRecorridoAgregado", params: [], id: 6 }),
  });
  if (!r.ok) throw new Error(`JSON-RPC devolvió HTTP ${r.status}`);
  mark('rpc_headers');
  const data = await r.json();
  mark('rpc_json');
  if (data.error) throw new Error(`JSON-RPC: ${JSON.stringify(data.error)}`);
  const list = data?.result?.map?.listHistorica?.list;
  if (!Array.isArray(list)) throw new Error("CLocator no devolvió listHistorica.list");

  const p = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const q = it?.map ?? it;
    const f = normLatLng(q?.latitud ?? q?.lat, q?.longitud ?? q?.lng ?? q?.lon);
    if (!f) continue;
    const t = limaStrToSec(q.fechaFinToString || q.fechaInicioToString || q.fecha || "");
    if (t == null) continue;
    p.push([t, Math.round(f.lat * 1e5) / 1e5, Math.round(f.lng * 1e5) / 1e5]);
  }
  return {
    ok: true,
    n: p.length,
    sin_movimiento: p.length < 2,
    ultimo_monitoreo: ultimo,
    p,
    total_original: list.length,
  };
}

/**
 * Varias unidades en UNA sesión (una tras otra): el login + página principal (~10-12 s)
 * se paga una sola vez por petición. Máximo recomendado: 3-4 unidades (CPU del plan gratis).
 * @returns {{ resultados: Array, dbg }}
 */
async function recorridos(env, lista, fetchFn = fetch) {
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const t0 = Date.now();
  const dbg = { ms: {}, unidades: lista.length };
  const mark = (k) => { dbg.ms[k] = Date.now() - t0; };
  S.mark = mark;
  const ses = await openSession(S, env);
  mark("sesion");
  const resultados = [];
  for (let i = 0; i < lista.length; i++) {
    const pre = (k) => mark(`u${i}_${k}`);
    try {
      const r = await rutaEnSesion(S, ses, lista[i], pre);
      resultados.push({ ...r, placa: lista[i].placa, tracto: lista[i].tracto });
    } catch (e) {
      resultados.push({ ok: false, error: e instanceof Error ? e.message : String(e), placa: lista[i].placa, tracto: lista[i].tracto });
    }
  }
  mark("total");
  dbg.subrequests = S.n;
  return { resultados, dbg };
}

/** Compatibilidad: una sola unidad. */
async function recorrido(env, params, fetchFn = fetch) {
  const { resultados, dbg } = await recorridos(env, [params], fetchFn);
  const r = resultados[0];
  if (!r.ok) throw new Error(r.error);
  return { ...r, dbg };
}

// ───────── snapshot (tabla de monitoreo completa, formato compacto) ─────────
const COLOR_CLASE = [
  ["fila-amarillo-opaco", "AMARILLO"], ["fila-gris", "GRIS"], ["fila-verde-opaco", "VERDE"], ["fila-rojo-opaco", "ROJO"],
];
function colorDeClase(raw) {
  const c = String(raw || "").toLowerCase();
  for (const [k, v] of COLOR_CLASE) if (c.includes(k)) return v;
  if (c.includes("amarillo")) return "AMARILLO";
  if (c.includes("gris") || c.includes("gray")) return "GRIS";
  if (c.includes("verde") || c.includes("green")) return "VERDE";
  if (c.includes("rojo") || c.includes("red")) return "ROJO";
  return "SIN_COLOR";
}

/**
 * Filas con código 20-R-: [placa, codigo, t_parada, lat, lng, color].
 * Sin DOM (regex); el filtro de geocercas se hace en el navegador.
 */
function extraerSnapshotCompacto(html) {
  const start = html.search(/id=["'][^"']*dtTablaMonitoreo_data["']/i);
  if (start < 0) throw new Error("No se encontró la tabla de monitoreo CLocator");
  const end = html.indexOf("</tbody>", start);
  const scope = html.slice(start, end > 0 ? end : undefined);
  const reRow = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  const filas = [];
  let total = 0, conCoord = 0, m;
  while ((m = reRow.exec(scope))) {
    if (!/data-rk=/.test(m[1])) continue;
    total++;
    const body = m[2];
    if (body.indexOf("20-R-") < 0 && body.indexOf("20-r-") < 0) continue; // atajo barato
    const textos = [];
    const reTd = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let t, i = 0;
    while (textos.length < 11 && (t = reTd.exec(body))) { if (i++ > 0) textos.push(stripTags(t[1])); }
    const placa = textos[0] || "";
    if (!placa) continue;
    let codigo = "";
    for (const tx of textos) {
      const c = String(tx).toUpperCase().match(/20-R-\d+/);
      if (c) { codigo = c[0]; break; }
    }
    if (!codigo) continue;
    const co = coordsDeFila(body);
    if (co) conCoord++;
    const cl = attrs(`<tr ${m[1]}>`)["class"] || "";
    filas.push([placa, codigo, textos[5] || textos[6] || "", co ? +co.lat.toFixed(6) : null, co ? +co.lng.toFixed(6) : null, colorDeClase(cl)]);
  }
  return { filas, total, conCoord };
}

async function snapshot(env, fetchFn = fetch) {
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const ses = await openSession(S, env);
  const r = extraerSnapshotCompacto(ses.html);
  return { ok: true, generado_en: new Date().toISOString(), filas_tabla: r.total, con_coord: r.conCoord, filas: r.filas };
}

// ───── geocercas-tn.js ─────
// Geocercas _TN de Turno Amanecida: anillos [[lng,lat],...]. Fuente: supabase/functions/turno-amanecida-snapshot/geocercas_tn.json
const GEOCERCAS_TN = {"Filtro_Macro_Sur_TN":[[-75.262608,-14.6595094],[-73.4637702,-12.6555505],[-71.5467158,-13.2358952],[-69.3647563,-14.8092475],[-66.5796457,-21.4828531],[-70.6047799,-22.6220015],[-70.6495157,-18.4781864],[-71.7745123,-17.3914765],[-75.4496748,-15.2733014],[-75.262608,-14.6595094]],"Planta_Yura_TN":[[-71.6816691,-16.2542979],[-71.6826554,-16.2494372],[-71.6861403,-16.2460915],[-71.6962007,-16.247354],[-71.7459126,-16.1689619],[-71.8022551,-16.1453245],[-71.8746007,-16.1614515],[-71.8939586,-16.214449],[-71.8529981,-16.303743],[-71.7676879,-16.3323451],[-71.6857065,-16.2762082],[-71.6727578,-16.2666248],[-71.6757231,-16.2605518],[-71.6816691,-16.2542979]],"Raciemsa_Aqp_TN":[[-71.61516754396283,-16.396468046963633],[-71.56969988651454,-16.396468046963633],[-71.56969988651454,-16.414925542749543],[-71.61516754396283,-16.414925542749543],[-71.61516754396283,-16.396468046963633]],"Base_Mpquegua_TN":[[-70.9445746,-17.2139847],[-70.9441254,-17.2142004],[-70.9431211,-17.2151593],[-70.9430496,-17.2155216],[-70.9423227,-17.2161972],[-70.9428325,-17.2175937],[-70.9456278,-17.2177559],[-70.9451718,-17.2139984],[-70.9445746,-17.2139847]],"Or_Tacna_TN":[[-70.3071866,-18.0813277],[-70.3044889,-18.0781725],[-70.3007786,-18.081754],[-70.3032932,-18.0853165],[-70.3071866,-18.0813277]],"Cesur_Caracoto_TN":[[-70.1048662,-15.5709948],[-70.1019241,-15.5744157],[-70.1169635,-15.6235112],[-70.140137,-15.6529381],[-70.1685135,-15.6260313],[-70.192352,-15.6053547],[-70.1754464,-15.5853178],[-70.1711405,-15.5766432],[-70.1053468,-15.5675399],[-70.1048662,-15.5709948]],"Aconstruir_Huasao_TN":[[-71.8116845,-13.5770496],[-71.8052,-13.5800091],[-71.8082452,-13.583704],[-71.8133361,-13.5800361],[-71.8133361,-13.5800361],[-71.8116845,-13.5770496]],"SMCV_SanJose_TN":[[-71.661306,-16.4586537],[-71.5646188,-16.4776895],[-71.5667959,-16.5730026],[-71.6741902,-16.5918802],[-71.7460086,-16.5475271],[-71.661306,-16.4586537]],"Planta_Gloria_TN":[[-71.5502589,-16.4174883],[-71.5610697,-16.430555],[-71.5646878,-16.4278751],[-71.5519325,-16.4158519],[-71.5502589,-16.4174883]],"Guardia_Civil_TN":[[-71.5113998,-16.4241103],[-71.5075881,-16.4222934],[-71.505259,-16.4256231],[-71.5091656,-16.4279599],[-71.5091656,-16.4279599],[-71.5113998,-16.4241103]],"Gloria_Majes_TN":[[-72.1625737,-16.3627136],[-72.1582452,-16.3651669],[-72.1664653,-16.3696094],[-72.1664653,-16.3696094],[-72.1625737,-16.3627136]],"Volvo_Aqp_TN":[[-71.5776315,-16.371409],[-71.5688328,-16.3695758],[-71.5707443,-16.375196],[-71.5738313,-16.3779363],[-71.5759932,-16.3783209],[-71.5776315,-16.371409]],"Juliaca_TN":[[-70.1632136,-15.4918477],[-70.1252455,-15.5466851],[-70.0842386,-15.5345886],[-70.111728,-15.4625047],[-70.155937,-15.4595026],[-70.155937,-15.4595026],[-70.1632136,-15.4918477]]};

// ───── router.js ─────



const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);
const FECHA = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

function limaNow() {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function reply(request, body, status = 200) {
  const o = request.headers.get("origin") || "";
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function manejar(request, env) {
  {
    if (request.method === "OPTIONS") return reply(request, { ok: true });
    if (request.method !== "POST") return reply(request, { error: "Método no permitido" }, 405);
    const origin = request.headers.get("origin") || "";
    if (!ORIGINS.has(origin)) return reply(request, { error: "Origen no autorizado" }, 403);
    try {
      const auth = request.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) throw Object.assign(new Error("Falta iniciar sesión"), { status: 401 });
      try {
        await verificarFirebase(auth.slice(7), env);
      } catch (e) {
        throw Object.assign(e, { status: 401 });
      }
      const body = await request.json().catch(() => ({}));
      const action = String(body.action || "ruta");
      if (action === "ping") return reply(request, { ok: true, hora: limaNow() });
      if (action === "snapshot") return reply(request, await snapshot(env));
      if (action === "geocercas") return reply(request, { ok: true, geocercas: GEOCERCAS_TN });
      if (action === "config") return reply(request, { ok: true, google_maps_api_key: env.GOOGLE_MAPS_API_KEY || "" });
      if (action === "acoples_listar" || action === "acoples_guardar") {
        if (!env.ACOPLES) throw new Error("Falta el KV ACOPLES (binding) en el Worker");
        if (action === "acoples_listar") {
          const v = await env.ACOPLES.get("catalogo", "json");
          return reply(request, { ok: true, filas: v?.filas || [], actualizado_en: v?.actualizado_en || null });
        }
        const filas = (Array.isArray(body.filas) ? body.filas : [])
          .map((r) => [String(r[0] ?? r.codigo ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, ""), String(r[1] ?? r.carroceria ?? "").trim(), String(r[2] ?? r.gestor ?? "").trim()])
          .filter((r) => r[0]);
        if (filas.length > 20000) throw new Error("Demasiadas filas");
        const actualizado_en = new Date().toISOString();
        await env.ACOPLES.put("catalogo", JSON.stringify({ filas, actualizado_en }));
        return reply(request, { ok: true, filas: filas.length, actualizado_en });
      }
      if (action === "rutas") {
        const lista = Array.isArray(body.unidades) ? body.unidades : [];
        if (!lista.length) throw new Error("Falta unidades[]");
        if (lista.length > 4) throw new Error("Máximo 4 unidades por petición");
        const ahora = limaNow();
        const norm = lista.map((u) => ({
          placa: String(u.placa || "").trim(),
          tracto: String(u.tracto || "").trim(),
          desde: String(u.desde || "").trim(),
          hasta: FECHA.test(String(u.hasta || "").trim()) ? String(u.hasta).trim() : ahora,
        }));
        for (const u of norm) {
          if (!u.placa && !u.tracto) throw new Error("Falta placa o tracto");
          if (!FECHA.test(u.desde)) throw new Error("Falta una fecha de inicio válida (dd/MM/yyyy HH:mm:ss)");
        }
        const out = await recorridos(env, norm);
        return reply(request, { ok: true, resultados: out.resultados.map((r, i) => ({ ...r, desde: norm[i].desde, hasta: norm[i].hasta })), ...(body.debug ? { dbg: out.dbg } : {}) });
      }
      if (action !== "ruta") return reply(request, { error: `Acción desconocida: ${action}` }, 400);

      const placa = String(body.placa || "").trim();
      const tracto = String(body.tracto || "").trim();
      const desde = String(body.desde || "").trim();
      const hasta = FECHA.test(String(body.hasta || "").trim()) ? String(body.hasta).trim() : limaNow();
      if (!placa && !tracto) throw new Error("Falta placa o tracto");
      if (!FECHA.test(desde)) throw new Error("Falta una fecha de inicio válida (dd/MM/yyyy HH:mm:ss)");
      const out = await recorrido(env, { placa, tracto, desde, hasta });
      if (!body.debug) delete out.dbg;
      return reply(request, { ...out, placa, tracto, desde, hasta });
    } catch (e) {
      return reply(request, { error: e instanceof Error ? e.message : "Error CLocator" }, e?.status || 400);
    }
  }
}

Deno.serve((request) => {
  const env = { CLOCATOR_USER: Deno.env.get("CLOCATOR_USER"), CLOCATOR_PASSWORD: Deno.env.get("CLOCATOR_PASSWORD"), ALLOWED_EMAILS: Deno.env.get("ALLOWED_EMAILS") };
  return manejar(request, env);
});
