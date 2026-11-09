// Cliente CLocator (Comsatel) para Workers: SIN cheerio, solo cadenas y regex (mínima CPU).
const BASE = "https://clocatorplus.comsatel.com.pe/CL";
const LOGIN = `${BASE}/faces/seguridad/login.xhtml`;
const MAIN = `${BASE}/faces/page/main.xhtml`;
const RPC = `${BASE}/JSON-RPC`;
const ORIGIN = "https://clocatorplus.comsatel.com.pe";

// ───────── utilidades de texto ─────────
const ENT = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", "#39": "'", "#039": "'" };
export function decodeEntities(s) {
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

export function viewHtml(html) {
  const re = /<input\b[^>]*name=["']javax\.faces\.ViewState["'][^>]*>/i;
  const t = html.match(re)?.[0];
  if (t) return attrs(t).value || "";
  const t2 = html.match(/<input\b[^>]*id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>/i)?.[0];
  return t2 ? attrs(t2).value || "" : "";
}
export function viewPartial(xml) {
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
export function normLatLng(a, b) {
  const x = Number(a), y = Number(b);
  if (!geoValido(x, y)) return null;
  if (inPeru(x, y)) return { lat: x, lng: y };
  if (inPeru(y, x)) return { lat: y, lng: x };
  if (Math.abs(x) <= 90 && Math.abs(y) <= 180) return { lat: x, lng: y };
  if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return { lat: y, lng: x };
  return null;
}

/** "dd/MM/yyyy HH:mm:ss" (hora Lima, UTC-5) → segundos unix. */
export function limaStrToSec(s) {
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
export function parseLoginForm(html, baseUrl) {
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
export function buscarFila(html, plate, tracto) {
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

export function coordsDeFila(rowHtml) {
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

export function showSource(html) {
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

export function dateFields(xml) {
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
export async function recorridos(env, lista, fetchFn = fetch) {
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
export async function recorrido(env, params, fetchFn = fetch) {
  const { resultados, dbg } = await recorridos(env, [params], fetchFn);
  const r = resultados[0];
  if (!r.ok) throw new Error(r.error);
  return { ...r, dbg };
}

// ───────── snapshot (tabla de monitoreo completa, formato compacto) ─────────
const COLOR_CLASE = [
  ["fila-amarillo-opaco", "AMARILLO"], ["fila-gris", "GRIS"], ["fila-verde-opaco", "VERDE"], ["fila-rojo-opaco", "ROJO"],
];
export function colorDeClase(raw) {
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
export function extraerSnapshotCompacto(html) {
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

export async function snapshot(env, fetchFn = fetch) {
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const ses = await openSession(S, env);
  const r = extraerSnapshotCompacto(ses.html);
  return { ok: true, generado_en: new Date().toISOString(), filas_tabla: r.total, con_coord: r.conCoord, filas: r.filas };
}

// ───────── alarmas (panel "Alarmas" de CLocator: tabla frmAlarmaNotificacion:dtAlarma) ─────────
/**
 * Filas del panel de alarmas pendientes. Sin DOM (regex).
 * @returns {Array<{placa:string,descripcion:string,eventoId:string,vehiculoId:string,historicaId:string}>}
 */
export function extraerAlarmas(html, tabla = "dtAlarma_data") {
  const start = html.search(new RegExp(`id=["'][^"']*${tabla}["']`, "i"));
  if (start < 0) return [];
  const end = html.indexOf("</tbody>", start);
  const scope = html.slice(start, end > 0 ? end : undefined);
  const out = [];
  const reRow = /<tr\b[^>]*data-ri=[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = reRow.exec(scope))) {
    const body = m[1];
    const tds = [];
    const reTd = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let t;
    while (tds.length < 2 && (t = reTd.exec(body))) tds.push(stripTags(t[1]));
    const placa = tds[0] || "";
    if (!placa || /no records found/i.test(placa)) continue;
    const val = (name) => decodeEntities(body.match(new RegExp(`name:['"]${name}['"],value:['"]([^'"]*)['"]`))?.[1] || "");
    out.push({
      placa,
      descripcion: tds[1] || "",
      eventoId: val("pEventoId") || decodeEntities(body.match(/eventoid=(\d+)/)?.[1] || ""),
      vehiculoId: val("pVehiculoId"),
      historicaId: val("pHistoricaId"),
    });
  }
  return out;
}

/**
 * Alarmas pendientes de la cuenta. 1) página principal (gratis); 2) si no trae filas,
 * la misma consulta que usa la web (fnContarAlarmas) con la sesión ya abierta.
 * `diag` dice qué camino funcionó, para medir si esta captura es confiable.
 */
/**
 * Diagnóstico del panel de alarmas (solo con debug:true): fragmentos crudos para ver DÓNDE y CÓMO
 * entrega CLocator las alarmas. Sin regex globales pesadas (el plan gratis da ~10 ms de CPU).
 */
export function diagAlarmas(html) {
  const low = html.toLowerCase();
  const cortar = (i, antes, desp) => (i < 0 ? "" : html.slice(Math.max(0, i - antes), Math.min(html.length, i + desp)));
  const ids = [];
  let i = 0, vueltas = 0;
  while (ids.length < 40 && vueltas++ < 400 && (i = low.indexOf("alarma", i)) >= 0) {
    const m = html.slice(Math.max(0, i - 90), i + 60).match(/id=["']([^"']*alarma[^"']*)["']/i);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
    i += 6;
  }
  const iTabla = low.indexOf("dtalarma_data");
  const iBurb = low.indexOf("noti-bubble");
  return {
    html_bytes: html.length,
    ids,
    tabla_encontrada: iTabla >= 0,
    burbuja: iBurb >= 0 ? (html.slice(iBurb, iBurb + 160).match(/>([^<]*)</)?.[1] || "").trim() : null,
    ctx_burbuja: cortar(iBurb, 200, 300),
    ctx_tabla: iTabla >= 0 ? cortar(iTabla, 150, 1800) : cortar(low.indexOf("dtalarma"), 150, 800),
    ctx_funciones: cortar(low.indexOf("fncontaralarmas"), 150, 450),
  };
}

export async function alarmas(env, fetchFn = fetch, { debug = false } = {}) {
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const t0 = Date.now();
  const ses = await openSession(S, env);
  const diag = { ms_sesion: Date.now() - t0, tabla_en_html: /dtAlarma_data/i.test(ses.html) };
  let lista = extraerAlarmas(ses.html);
  let fuente = "html";
  if (!lista.length || debug) {
    try {
      const r = await postForm(S, MAIN, {
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": "frmAlarmaFunciones:fnContarAlarmas",
        "javax.faces.partial.execute": "frmAlarmaFunciones:fnContarAlarmas",
        "frmAlarmaFunciones": "frmAlarmaFunciones",
        "javax.faces.ViewState": ses.view,
      }, MAIN, true);
      const xml = await r.text();
      diag.ajax_status = r.status;
      diag.ajax_bytes = xml.length;
      diag.ajax_args = (xml.match(/<extension[^>]*>([\s\S]*?)<\/extension>/i)?.[1] || "").slice(0, 300);
      if (debug) diag.ajax_xml = xml.slice(0, 1800);
      const l2 = extraerAlarmas(xml);
      if (!lista.length) {
        if (l2.length) { lista = l2; fuente = "ajax"; }
        else fuente = "ajax-vacio";
      }
    } catch (e) {
      diag.ajax_error = e instanceof Error ? e.message : String(e);
      if (!lista.length) fuente = "ajax-error";
    }
  }
  if (debug) diag.dbg = diagAlarmas(ses.html);
  diag.ms_total = Date.now() - t0;
  diag.subrequests = S.n;
  return { ok: true, generado_en: new Date().toISOString(), fuente, total: lista.length, alarmas: lista, diag };
}

// ───────── alarmas con SESIÓN PERSISTENTE (como el navegador: un login y consultas cada minuto) ─────────
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function llaveSesion(env) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`alarmas-sesion|${env.CLOCATOR_PASSWORD || ""}`));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** La cookie de CLocator viaja cifrada: el navegador solo guarda un token opaco. */
export async function sellarSesion(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await llaveSesion(env), new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64u(out);
}
export async function abrirSesion(env, tok) {
  try {
    const raw = unb64u(String(tok || ""));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await llaveSesion(env), raw.slice(12));
    const o = JSON.parse(new TextDecoder().decode(pt));
    return o && o.c && o.v ? o : null;
  } catch {
    return null;
  }
}

/** Las alarmas pueden usar una cuenta propia (CLOCATOR_ALARMAS_USER/_PASSWORD); si no existe, la de siempre. */
const envAlarmas = (env) => (env.CLOCATOR_ALARMAS_USER && env.CLOCATOR_ALARMAS_PASSWORD
  ? { ...env, CLOCATOR_USER: env.CLOCATOR_ALARMAS_USER, CLOCATOR_PASSWORD: env.CLOCATOR_ALARMAS_PASSWORD, _cuenta_propia: true }
  : env);

const viewDeXml = (xml) => xml.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]*)\]\]>/i)?.[1] || "";

/**
 * Alarmas ABIERTAS de la cuenta, por la misma llamada que hace la web cuando llega una alarma nueva:
 * JSON-RPC notificacionMBean.listarAlarmasUltimos([11]). Cada ítem trae evento.eventoId, evento.fecha (ms),
 * evento.vehiculo.placa/codigoExterno y evento.configuracionEvento.descripcion (capturas reales del 06/11).
 */
export async function listarAlarmasRpc(S, params = [11]) {
  const r = await req(S, RPC, {
    method: "POST",
    headers: { accept: "application/json, text/javascript, */*; q=0.01", "content-type": "application/json", "x-requested-with": "XMLHttpRequest", origin: ORIGIN, referer: MAIN },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notificacionMBean.listarAlarmasUltimos", params, id: 18 }),
  });
  if (!r.ok) throw new Error(`JSON-RPC alarmas HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(`JSON-RPC alarmas: ${JSON.stringify(data.error).slice(0, 200)}`);
  const list = data?.result?.list;
  if (!Array.isArray(list)) throw new Error("CLocator no devolvió la lista de alarmas");
  return list.map((it) => {
    const ev = it.evento || {};
    const v = ev.vehiculo || {};
    return {
      placa: v.placa || "",
      codigo: v.codigoExterno || "",
      descripcion: ev.configuracionEvento?.descripcion || "",
      eventoId: String(ev.eventoId ?? ""),
      vehiculoId: String(v.vehiculoId ?? ""),
      historicaId: String(ev.historica?.historicaId ?? ""),
      fecha: Number(ev.fecha) || null,
      fechaTxt: ev.fechaToString || "",
      estado: it.estadoToString || it.estado || "",
    };
  }).filter((a) => a.placa || a.eventoId);
}

const compacta = (a) => ({ placa: a.placa || "", codigo: a.codigo || "", descripcion: a.descripcion || "", eventoId: a.eventoId || "", vehiculoId: a.vehiculoId || "", historicaId: a.historicaId || "", fecha: a.fecha || null, fechaTxt: a.fechaTxt || "" });

/** Misma consulta que hace la web cada pocos segundos. Devuelve null en `xml` si la sesión caducó. */
async function consultaAlarmasAjax(S, view, pt = "5") {
  // Idéntica a la que hace el navegador (captura real 06/11): execute=@all + el botón + el tiempo del popup.
  const r = await postForm(S, MAIN, {
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmAlarmaFunciones:fnContarAlarmas",
    "javax.faces.partial.execute": "@all",
    "frmAlarmaFunciones:fnContarAlarmas": "frmAlarmaFunciones:fnContarAlarmas",
    "frmAlarmaFunciones": "frmAlarmaFunciones",
    "frmAlarmaFunciones:alarmaEmergentePopupTiempo": String(pt || "5"),
    "javax.faces.ViewState": view,
  }, MAIN, true);
  const xml = await r.text();
  const valido = r.status === 200 && /<partial-response/i.test(xml) && !/<redirect|ViewExpired|<error>/i.test(xml);
  return { status: r.status, xml, valido, view: viewDeXml(xml) };
}

/**
 * Alarmas con sesión reutilizada. `token` = el que devolvió la consulta anterior (o vacío → login nuevo).
 * Si la sesión caducó, hace login de nuevo y lo indica en `sesion_nueva`.
 */
export async function alarmasSesion(env0, token, fetchFn = fetch, { debug = false } = {}) {
  const env = envAlarmas(env0);
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const t0 = Date.now();
  const diag = {};
  let ses = token ? await abrirSesion(env, token) : null;
  let pt = "5", view = "", desde = Date.now(), nueva = false, lista = [], fuente = "sesion", ajax = null, htmlLogin = "";
  if (ses) {
    S.jar = new Jar(ses.c);
    view = ses.v;
    desde = ses.d || desde;
    pt = ses.pt || pt;
    ajax = await consultaAlarmasAjax(S, view, pt);
    if (!ajax.valido) { ses = null; diag.sesion_caducada = ajax.status; }
  } else if (token) diag.token_invalido = true;
  if (!ses) {
    const open = await openSession(S, env);
    view = open.view;
    desde = Date.now();
    nueva = true;
    fuente = "sesion-nueva";
    htmlLogin = open.html;
    pt = open.html.match(/alarmaEmergentePopupTiempo"[^>]*?value="(\d+)"/)?.[1] || pt;
    lista = extraerAlarmas(open.html);
    diag.burbuja_login = open.html.match(/noti-bubble">\s*(\d+)/)?.[1] ?? null;
    ajax = await consultaAlarmasAjax(S, view, pt);
  }
  diag.popup_tiempo = pt;
  diag.ajax_status = ajax.status;
  diag.ajax_valido = ajax.valido;
  diag.ajax_bytes = ajax.xml.length;
  diag.ajax_args = (ajax.xml.match(/<extension[^>]*>([\s\S]*?)<\/extension>/i)?.[1] || "").slice(0, 1500);
  // La consulta periódica NO trae filas: solo {"sonidoId":n,"countAlarmas":n} (alarmas nuevas). Con count>0 la web
  // abre el panel (fnTogglePanelALarma) y recién ahí llegan las filas: hacemos lo mismo.
  let args = null;
  try { args = JSON.parse(ajax.xml.match(/<extension[^>]*type="args"[^>]*>([^<]*)<\/extension>/i)?.[1] || "null"); } catch { args = null; }
  const cuenta = Number(args?.countAlarmas || 0);
  diag.count_alarmas = cuenta;
  diag.cuenta_propia_alarmas = !!env._cuenta_propia;
  diag.cuenta_worker = `${String(env.CLOCATOR_USER || "").slice(0, 3)}***(${String(env.CLOCATOR_USER || "").length})`;
  // Lectura principal: la lista de alarmas abiertas por JSON-RPC (lo que usa la web). Se pide siempre, no solo con contador > 0.
  try {
    const rpc = await listarAlarmasRpc(S);
    diag.rpc_items = rpc.length;
    for (const a of rpc) if (!lista.some((x) => x.eventoId && x.eventoId === a.eventoId)) lista.push({ ...a, via: "rpc" });
  } catch (e) { diag.rpc_error = e instanceof Error ? e.message : String(e); }
  for (const t of ["dtAlarma_data", "dtAlarmaEmergente_data"]) {
    for (const a of extraerAlarmas(ajax.xml, t)) if (!lista.some((x) => x.eventoId && x.eventoId === a.eventoId && x.placa === a.placa)) lista.push({ ...a, via: t });
  }
  // El servidor entrega la lista completa SOLO en la consulta donde cambia el contador (captura real). Si esta consulta
  // no la trajo: 1) misma cantidad que la última vez → la lista guardada en el token; 2) cantidad distinta → una
  // sesión nueva (su primera consulta siempre trae la lista completa).
  diag.filas_en_consulta = lista.length;
  if (cuenta > 0 && !lista.length) {
    if (ses && ses.cnt === cuenta && Array.isArray(ses.rows) && ses.rows.length) {
      for (const a of ses.rows) lista.push({ ...a, via: "cache" });
      diag.lista_de = "cache";
    } else if (!nueva) {
      try {
        const S2 = { fetch: S.fetch, jar: new Jar(), n: 0 };
        const o2 = await openSession(S2, env);
        const pt2 = o2.html.match(/alarmaEmergentePopupTiempo"[^>]*?value="(\d+)"/)?.[1] || pt;
        const a2 = await consultaAlarmasAjax(S2, o2.view, pt2);
        const f2 = [...extraerAlarmas(a2.xml, "dtAlarmaEmergente_data"), ...extraerAlarmas(a2.xml, "dtAlarma_data")];
        let rpc2 = [];
        try { rpc2 = await listarAlarmasRpc(S2); } catch (e) { diag.rpc2_error = e instanceof Error ? e.message : String(e); }
        const porId = new Map(f2.map((a) => [a.eventoId || `${a.placa}|${a.descripcion}`, a]));
        for (const a of rpc2) porId.set(a.eventoId, { ...(porId.get(a.eventoId) || {}), ...a });
        for (const a of porId.values()) lista.push({ ...a, via: "sesion-lectura" });
        diag.lista_de = "sesion-lectura";
        diag.lectura_fresca = { filas: f2.length, rpc: rpc2.length, count: Number(JSON.parse(a2.xml.match(/<extension[^>]*type="args"[^>]*>([^<]*)<\/extension>/i)?.[1] || "{}").countAlarmas || 0), subrequests: S2.n };
        S.n += S2.n;
      } catch (e) { diag.lectura_fresca_error = e instanceof Error ? e.message : String(e); }
    }
  }
  // Diagnóstico (solo debug): con contador > 0 y sin filas, probamos otras formas de pedir la lista y lo reportamos.
  if (debug && cuenta > 0 && !lista.some((a) => a.via !== "contador")) {
    const v = {};
    for (const prm of [[], [0], [1], [50], [100]]) {
      try { v[`rpc ${JSON.stringify(prm)}`] = (await listarAlarmasRpc(S, prm)).length; } catch (e) { v[`rpc ${JSON.stringify(prm)}`] = "ERR " + String(e.message || e).slice(0, 60); }
    }
    try {
      const pr = await postForm(S, MAIN, {
        "javax.faces.partial.ajax": "true", "javax.faces.source": "frmAlarmaNotificacion:fnTogglePanelALarma", "javax.faces.partial.execute": "@all",
        "frmAlarmaNotificacion:fnTogglePanelALarma": "frmAlarmaNotificacion:fnTogglePanelALarma", "frmAlarmaNotificacion": "frmAlarmaNotificacion",
        "javax.faces.ViewState": ajax.view || view,
      }, MAIN, true);
      const px = await pr.text();
      ajax.view = viewDeXml(px) || ajax.view;
      v["panel@all filas"] = extraerAlarmas(px).length;
      v["panel@all bytes"] = px.length;
      for (const a of extraerAlarmas(px)) lista.push({ ...a, via: "panel@all" });
    } catch (e) { v["panel@all"] = "ERR " + String(e.message || e).slice(0, 60); }
    diag.variantes = v;
  }
  // Aviso sin filas (no se pudo leer la lista): igual queda registrado que CLocator avisó.
  if (cuenta > 0 && !lista.length) lista.push({ placa: "(sin detalle)", descripcion: `CLocator avisó ${cuenta} alarma(s)`, eventoId: `cnt-${Date.now()}`, vehiculoId: "", historicaId: "", via: "contador" });
  // Si la respuesta trae más que el "vacío" típico, la guardamos para entender su estructura.
  if (ajax.xml.length > 1200 || lista.length) diag.ajax_xml = ajax.xml.slice(0, 6000);
  if (debug) {
    diag.ajax_xml ||= ajax.xml.slice(0, 1800);
    diag.dbg = htmlLogin ? diagAlarmas(htmlLogin) : { sesion_reutilizada: true, ajax_bytes: ajax.xml.length };
  }
  diag.ms_total = Date.now() - t0;
  diag.subrequests = S.n;
  const sesion = await sellarSesion(env, { c: S.jar.toObject(), v: ajax.view || view, d: desde, pt, cnt: cuenta, rows: lista.filter((a) => a.via !== "contador").slice(0, 25).map(compacta) });
  return { ok: true, generado_en: new Date().toISOString(), fuente, sesion_nueva: nueva, sesion_desde: desde, total: lista.length, alarmas: lista, sesion, diag };
}

// ───────── exploración del HISTORIAL de alarmas (CLAlarma): solo para descubrir su estructura ─────────
const CLALARMA = `${ORIGIN}/CLAlarma/`;
/** Lista (sin regex pesadas) valores de atributo `attr="..."` que contengan alguna palabra clave. */
function listarAttr(html, attr, claves, max) {
  const out = [];
  const key = `${attr}="`;
  let i = 0, vueltas = 0;
  while (out.length < max && vueltas++ < 4000 && (i = html.indexOf(key, i)) >= 0) {
    const j = html.indexOf('"', i + key.length);
    if (j < 0) break;
    const v = html.slice(i + key.length, j);
    i = j + 1;
    if (v.length < 200 && (!claves || claves.some((c) => v.toLowerCase().includes(c))) && !out.includes(v)) out.push(v);
  }
  return out;
}
export async function explorarHistorial(env0, token, fetchFn = fetch) {
  const env = envAlarmas(env0);
  const S = { fetch: (...a) => fetchFn(...a), jar: new Jar(), n: 0 };
  const t0 = Date.now();
  const ses = token ? await abrirSesion(env, token) : null;
  let sesionNueva = false;
  if (ses) S.jar = new Jar(ses.c);
  else { await openSession(S, env); sesionNueva = true; }
  const salida = { ok: true, sesion_nueva: sesionNueva, paginas: [] };
  const visitar = async (url) => {
    const r = await req(S, url);
    const html = await r.text();
    const low = html.toLowerCase();
    const ti = low.indexOf("<title>");
    const body = low.indexOf("<body");
    salida.paginas.push({
      pedida: url,
      status: r.status,
      final: r.url || url,
      bytes: html.length,
      titulo: ti >= 0 ? stripTags(html.slice(ti + 7, Math.min(html.indexOf("</title>", ti) > 0 ? html.indexOf("</title>", ti) : ti + 200, ti + 200))).slice(0, 120) : "",
      pide_login: low.includes('type="password"'),
      formularios: listarAttr(html, "id", ["frm", "form"], 12),
      ids_utiles: listarAttr(html, "id", ["dt", "tabla", "fecha", "desde", "hasta", "btn", "buscar", "alarma", "tipo", "placa", "vehiculo", "calendar"], 50),
      scripts: listarAttr(html, "src", [".js"], 20),
      enlaces: listarAttr(html, "href", ["alarma", "reporte", "historial", "xhtml"], 20),
      inicio_texto: stripTags(html.slice(body >= 0 ? body : 0, (body >= 0 ? body : 0) + 6000)).slice(0, 900),
      ctx_filas: (() => { const k = low.indexOf("_data\""); return k < 0 ? "" : html.slice(Math.max(0, k - 120), k + 1500); })(),
    });
    return html;
  };
  let html = await visitar(CLALARMA);
  // CLAlarma es otra aplicación con su propio login: probamos con las mismas credenciales.
  let pasos = 0;
  while (salida.paginas[salida.paginas.length - 1].pide_login && pasos++ < 1) {
    const ult = salida.paginas[salida.paginas.length - 1];
    const form = parseLoginForm(html, ult.final);
    if (!form) { salida.login = "sin formulario"; break; }
    form.data[form.userName] = env.CLOCATOR_USER;
    form.data[form.passName] = env.CLOCATOR_PASSWORD;
    const r = await postForm(S, form.action, form.data, ult.final);
    salida.login = { status: r.status, destino: r.url || "" };
    html = await visitar(CLALARMA);
    if (salida.paginas[salida.paginas.length - 1].pide_login) { salida.login.resultado = "sigue pidiendo login (credenciales distintas o paso extra)"; break; }
    salida.login.resultado = "entró";
    // Si entró, también pedimos la página de inicio de la app para ver su menú.
    const base = salida.paginas[salida.paginas.length - 1].final;
    salida.nota = "dentro de CLAlarma: " + base;
  }
  // Ya dentro de CLAlarma: recorremos los enlaces de la app y probamos páginas de lista típicas.
  try {
    const ult = salida.paginas[salida.paginas.length - 1];
    if (ult && !ult.pide_login) {
      const base = new URL(ult.final);
      const candidatos = [];
      for (const h of ult.enlaces) {
        if (/\.xhtml/i.test(h) && /alarma|evento|reporte|historic/i.test(h) && !/javax\.faces\.resource/.test(h)) candidatos.push(new URL(h.replace(/&amp;/g, "&"), base).href);
      }
      for (const g of ["faces/page/alarma/alarma.xhtml", "faces/page/alarma/alarmaListar.xhtml", "faces/page/alarma/alarmas.xhtml", "faces/page/inicio.xhtml"]) candidatos.push(new URL(g, CLALARMA).href);
      const vistos = new Set([ult.final, CLALARMA]);
      let n = 0;
      for (const u of candidatos) {
        if (vistos.has(u) || n >= 6) continue;
        vistos.add(u); n++;
        try { await visitar(u); } catch (e) { salida.paginas.push({ pedida: u, error: String(e.message || e).slice(0, 120) }); }
      }
    }
  } catch (e) { salida.crawl_error = String(e.message || e).slice(0, 160); }
  salida.ms_total = Date.now() - t0;
  salida.subrequests = S.n;
  salida.sesion = await sellarSesion(env, { c: S.jar.toObject(), v: ses?.v || "x", d: ses?.d || Date.now() });
  return salida;
}
