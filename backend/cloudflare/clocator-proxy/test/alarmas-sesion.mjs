import { alarmasSesion, abrirSesion, explorarHistorial } from "../src/clocator.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const FIXTURE = readFileSync(new URL("./alarma-emergente-fixture.xml", import.meta.url), "utf8");
let N = 1; const visto = new Set();

const env = { CLOCATOR_USER: "USR", CLOCATOR_PASSWORD: "PWD" };
const ROW = `<tr data-ri="0"><td><a onclick="PrimeFaces.ab({source:'x',params:[{name:'pEventoId',value:'777'},{name:'pVehiculoId',value:'61541'}]})">F6B919</a></td><td>SEN-DESCONEXION DE ENERGIA EXTERNA</td></tr>`;
const VACIO = (vs) => `<?xml version='1.0'?><partial-response><changes><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${vs}]]></update></changes></partial-response>`;
const CON = (vs) => `<partial-response><changes><update id="frmAlarmaNotificacion:panel"><![CDATA[<tbody id="frmAlarmaNotificacion:dtAlarma_data">${ROW}</tbody>]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${vs}]]></update></changes></partial-response>`;

let popupTiempo = "", panelPedido = "", logins = 0, vsN = 0, sesionValida = true, modo = "vacio", ultimoVS = "", ultimaCookie = "";
const LOGIN_HTML = `<html><form id="frmLogin" action="/CL/faces/seguridad/login.xhtml" method="post"><input type="hidden" name="frmLogin" value="frmLogin"><input type="text" name="frmLogin:user"><input type="password" name="frmLogin:pass"><input type="hidden" name="javax.faces.ViewState" value="vs0"><button type="submit" name="frmLogin:btn" value="Ingresar">Ingresar</button></form></html>`;
const MAIN_HTML = `<html><form id="frmMonitoreo"><input type="hidden" name="javax.faces.ViewState" value="vsM"><input id="frmAlarmaFunciones:alarmaEmergentePopupTiempo" type="hidden" name="frmAlarmaFunciones:alarmaEmergentePopupTiempo" value="10" /><a id="noti-alarma"><div class="noti-bubble">0</div></a><table><tbody id="frmMonitoreo:dtTablaMonitoreo_data"></tbody></table></form></html>`;
async function fake(url, init = {}) {
  const u = String(url), m = init.method || "GET";
  const mk = (b, o = {}) => { const r = new Response(b, { status: o.status || 200, headers: o.headers }); Object.defineProperty(r, "url", { value: u }); return r; };
  if (u.includes("login.xhtml") && m === "GET") return mk(LOGIN_HTML);
  if (u.includes("login.xhtml") && m === "POST") { logins++; sesionValida = true; const h = new Headers(); h.append("set-cookie", `JSESSIONID=s${logins}; Path=/CL`); h.set("location", "/CL/faces/page/main.xhtml"); return mk("", { status: 302, headers: h }); }
  if (u.endsWith("main.xhtml") && m === "GET") return /JSESSIONID=s\d/.test(init.headers?.cookie || "") ? mk(MAIN_HTML) : mk(LOGIN_HTML);
  if (u.endsWith("main.xhtml") && m === "POST") {
    ultimaCookie = init.headers?.cookie || ""; ultimoVS = new URLSearchParams(String(init.body)).get("javax.faces.ViewState");
    if (modo === "redirect-error" && ultimaCookie.includes("s1")) return mk(`<?xml version='1.0'?><partial-response id="j_id1"><redirect url="/CL/faces/page/error.xhtml"></redirect></partial-response>`);
    if (!sesionValida || !/JSESSIONID=s\d/.test(ultimaCookie)) return mk(LOGIN_HTML); // caducada: devuelve login, no partial-response
    const bp = new URLSearchParams(String(init.body)); const src = bp.get("javax.faces.source");
    if (modo === "estado" && src === "frmAlarmaFunciones:fnContarAlarmas") { const ck = ultimaCookie; const primera = !visto.has(ck); visto.add(ck); return mk(primera ? FIXTURE.replace(/"countAlarmas":1/, `"countAlarmas":${N}`) : `<partial-response><changes><update id="j_id1:javax.faces.ViewState:0"><![CDATA[vs${++vsN}]]></update><extension ln="primefaces" type="args">{"sonidoId":1,"countAlarmas":${N}}</extension></changes></partial-response>`); }
    if (src === "frmAlarmaFunciones:fnContarAlarmas") { assert.equal(bp.get("javax.faces.partial.execute"), "@all"); assert.equal(bp.get("frmAlarmaFunciones:fnContarAlarmas"), "frmAlarmaFunciones:fnContarAlarmas"); assert.ok(bp.get("frmAlarmaFunciones:alarmaEmergentePopupTiempo")); popupTiempo = bp.get("frmAlarmaFunciones:alarmaEmergentePopupTiempo"); }
    if (src === "frmAlarmaNotificacion:fnTogglePanelALarma") { panelPedido = new URLSearchParams(String(init.body)).get("javax.faces.partial.render"); return mk(modo === "contador-sin-filas" ? VACIO(`vs${++vsN}`) : CON(`vs${++vsN}`)); }
    if (modo === "contador" || modo === "contador-sin-filas") return mk(`<partial-response><changes><update id="j_id1:javax.faces.ViewState:0"><![CDATA[vs${++vsN}]]></update><extension ln="primefaces" type="args">{"sonidoId":1,"countAlarmas":1}</extension></changes></partial-response>`);
    return mk(modo === "alarma" ? CON(`vs${++vsN}`) : VACIO(`vs${++vsN}`));
  }
  if (u.includes("/CLAlarma/")) return mk(`<html><head><title>Alarmas</title></head><body><form id="frmAlarmas"><input id="frmAlarmas:fechaDesde"><button id="frmAlarmas:btnBuscar">Buscar</button><table><tbody id="frmAlarmas:dtAlarmas_data"><tr><td>F6B919</td></tr></tbody></table></form><script src="/CLAlarma/x.js"></script></body></html>`);
  if (u.endsWith("/JSON-RPC") && m === "POST") {
    assert.match(String(init.body), /notificacionMBean\.listarAlarmasUltimos/);
    if (modo === "rpc") return mk(JSON.stringify({ result: { list: [{ estado: "A", estadoToString: "ABIERTO", evento: { eventoId: 7718038687, fecha: 1793997939000, fechaToString: "06/11/2026 15:45:39", configuracionEvento: { descripcion: "SEN-DESCONEXION DE ENERGIA EXTERNA" }, vehiculo: { vehiculoId: 50518, placa: "V4L838", codigoExterno: "20-R-502" } } }] } }), { headers: { "content-type": "application/json" } });
    return mk(JSON.stringify({ result: { list: [] } }), { headers: { "content-type": "application/json" } });
  }
  throw new Error("URL inesperada " + u);
}

// 1) sin token → login nuevo (1 login) + consulta
let r = await alarmasSesion(env, "", fake);
assert.equal(r.fuente, "sesion-nueva"); assert.equal(r.sesion_nueva, true); assert.equal(logins, 1); assert.equal(r.total, 0);
assert.ok(r.sesion && !r.sesion.includes("JSESSIONID"), "el token no debe mostrar la cookie");
const tok1 = r.sesion;
const o = await abrirSesion(env, tok1); assert.equal(o.v, "vs1"); assert.match(o.c.JSESSIONID, /s1/);
assert.equal(await abrirSesion({ CLOCATOR_PASSWORD: "otra" }, tok1), null, "otra clave no abre el token");

// 2) con token → REUTILIZA la sesión: sin login, con el ViewState anterior
modo = "alarma";
r = await alarmasSesion(env, tok1, fake);
assert.equal(logins, 1, "no debe volver a loguear"); assert.equal(ultimoVS, "vs1");
assert.equal(r.fuente, "sesion"); assert.equal(r.sesion_nueva, false);
assert.equal(r.total, 1); assert.equal(r.alarmas[0].placa, "F6B919"); assert.equal(r.alarmas[0].eventoId, "777");
assert.ok(r.diag.ajax_xml, "guarda el XML cuando llega algo");
const tok2 = r.sesion; assert.equal((await abrirSesion(env, tok2)).v, "vs2");

// 3) sesión caducada → login nuevo automático y avisa
sesionValida = false; modo = "vacio";
r = await alarmasSesion(env, tok2, fake);
assert.equal(logins, 2); assert.equal(r.fuente, "sesion-nueva"); assert.equal(r.sesion_nueva, true); assert.equal(r.diag.sesion_caducada, 200);

// 4) token basura → login nuevo
r = await alarmasSesion(env, "basura", fake);
assert.equal(r.sesion_nueva, true); assert.equal(r.diag.token_invalido, true);
console.log("Alarmas con sesión persistente OK · logins:", logins);
// 5) con debug: siempre trae dbg (para el panel de diagnóstico)
modo = "vacio";
r = await alarmasSesion(env, "", fake, { debug: true });
assert.ok(r.diag.dbg && r.diag.ajax_xml, "debug debe traer dbg y xml");
r = await alarmasSesion(env, r.sesion, fake, { debug: true });
assert.equal(r.diag.dbg.sesion_reutilizada, true);
console.log("debug OK");

// 6) explorar historial (CLAlarma) reutilizando la sesión
const h = await explorarHistorial(env, r.sesion, fake);
assert.equal(h.sesion_nueva, false); assert.equal(h.paginas[0].status, 200);
assert.equal(h.paginas[0].titulo, "Alarmas"); assert.ok(h.paginas[0].ids_utiles.includes("frmAlarmas:dtAlarmas_data"));
assert.ok(h.paginas[0].ctx_filas.includes("F6B919")); assert.equal(h.paginas[0].pide_login, false);
console.log("historial diag OK");
// 7) CLAlarma con login propio: entra con las mismas credenciales
let cla = false;
const loginCLA = `<html><head><title>CLAlarma</title></head><body><form id="frmLogin" action="/CLAlarma/faces/seguridad/login.xhtml" method="post"><input type="hidden" name="frmLogin" value="frmLogin"><input type="text" name="frmLogin:u"><input type="password" name="frmLogin:p"><button type="submit" name="frmLogin:b" value="x">Ingresar</button></form></body></html>`;
async function fake2(url, init = {}) {
  const u = String(url), m = init.method || "GET";
  const mk = (b, o = {}) => { const r = new Response(b, { status: o.status || 200, headers: o.headers }); Object.defineProperty(r, "url", { value: u }); return r; };
  if (u.includes("/CLAlarma/") && m === "POST") { assert.match(String(init.body), /frmLogin%3Au=USR/); cla = true; const h = new Headers(); h.append("set-cookie", "CLA=ok; Path=/CLAlarma"); h.set("location", "/CLAlarma/faces/page/inicio.xhtml"); return mk("", { status: 302, headers: h }); }
  if (u.includes("/CLAlarma/")) return /CLA=ok/.test(init.headers?.cookie || "") ? mk(`<html><head><title>Inicio</title></head><body><table><tbody id="f:dtA_data"><tr><td>X</td></tr></tbody></table></body></html>`) : mk(loginCLA);
  return fake(url, init);
}
const h2 = await explorarHistorial(env, "", fake2);
assert.equal(cla, true); assert.equal(h2.login.resultado, "entró"); assert.equal(h2.paginas.at(-1).pide_login, false);
console.log("historial con login OK");

// 8/9) contador > 0 sin filas legibles → queda registrado el aviso (nunca se pierde)
modo = "contador";
let rc = await alarmasSesion(env, "", fake);
assert.equal(rc.diag.count_alarmas, 1);
assert.equal(rc.total, 1); assert.equal(rc.alarmas[0].via, "contador");
assert.match(rc.diag.cuenta_worker, /^USR\*\*\*\(3\)$/);
console.log("contador sin filas OK");

// 10) CLocator responde con <redirect> a error.xhtml (sesión muerta) → NO es lectura válida: vuelve a entrar
logins = 0; modo = "vacio";
let rr = await alarmasSesion(env, "", fake);           // login #1 → cookie s1
modo = "redirect-error";
rr = await alarmasSesion(env, rr.sesion, fake);
assert.equal(rr.sesion_nueva, true); assert.equal(rr.diag.sesion_caducada, 200); assert.equal(logins, 2);
console.log("redirect a error → relogin OK");

// 11) cuenta propia para alarmas: usa CLOCATOR_ALARMAS_* y no toca la cuenta general
const envAl = { ...env, CLOCATOR_ALARMAS_USER: "ALM", CLOCATOR_ALARMAS_PASSWORD: "PWD2" };
let usuarioLogin = "";
const fake3 = async (url, init = {}) => { if (String(url).includes("login.xhtml") && (init.method || "GET") === "POST") usuarioLogin = String(init.body); return fake(url, init); };
modo = "vacio";
const rA = await alarmasSesion(envAl, "", fake3).catch((e) => e);
assert.match(usuarioLogin, /frmLogin%3Auser=ALM/);
assert.equal(rA.diag.cuenta_propia_alarmas, true); assert.match(rA.diag.cuenta_worker, /^ALM/);
console.log("cuenta propia para alarmas OK");

// 12) lectura por JSON-RPC (listarAlarmasUltimos): trae placa, código, hora real del evento
modo = "rpc";
const rr2 = await alarmasSesion(env, "", fake);
assert.equal(rr2.total, 1); assert.equal(rr2.alarmas[0].placa, "V4L838"); assert.equal(rr2.alarmas[0].codigo, "20-R-502");
assert.equal(rr2.alarmas[0].eventoId, "7718038687"); assert.equal(rr2.alarmas[0].fecha, 1793997939000); assert.equal(rr2.alarmas[0].via, "rpc");
assert.equal(rr2.diag.rpc_items, 1);
console.log("JSON-RPC alarmas OK");

// 13) la consulta es idéntica a la del navegador y usa el tiempo de popup que trae la página (10), también al reutilizar sesión
modo = "vacio"; popupTiempo = "";
let rp = await alarmasSesion(env, "", fake);
assert.equal(popupTiempo, "10"); assert.equal(rp.diag.popup_tiempo, "10");
popupTiempo = "";
rp = await alarmasSesion(env, rp.sesion, fake);
assert.equal(popupTiempo, "10");
console.log("consulta idéntica a la del navegador OK");

// 14) lista completa solo cuando cambia el contador (captura real): fila real parseada, caché y lectura con sesión nueva
modo = "estado"; N = 1; logins = 0; visto.clear();
let e1 = await alarmasSesion(env, "", fake);              // sesión nueva: su primera consulta trae la lista
assert.equal(e1.total, 1); assert.equal(e1.alarmas[0].placa, "V4L838"); assert.equal(e1.alarmas[0].eventoId, "7718038687");
assert.equal(e1.alarmas[0].vehiculoId, "50518"); assert.equal(e1.alarmas[0].historicaId, "45522925829");
assert.equal(e1.alarmas[0].descripcion, "SEN-DESCONEXION DE ENERGIA EXTERNA");
let e2 = await alarmasSesion(env, e1.sesion, fake);        // misma cantidad, consulta sin lista → viene de la caché del token
assert.equal(logins, 1); assert.equal(e2.total, 1); assert.equal(e2.diag.lista_de, "cache"); assert.equal(e2.alarmas[0].placa, "V4L838");
N = 2;
let e3 = await alarmasSesion(env, e2.sesion, fake);        // cambió el contador y esta consulta no trae lista → sesión de lectura nueva
assert.equal(logins, 2); assert.equal(e3.diag.lista_de, "sesion-lectura"); assert.equal(e3.total, 1); assert.equal(e3.alarmas[0].placa, "V4L838");
assert.equal(e3.diag.lectura_fresca.count, 2);
console.log("lista por cambio de contador / caché / sesión de lectura OK");

// 15) debug con contador>0 y sin filas: prueba variantes de la consulta y las reporta
modo = "contador-sin-filas";
const dv = await alarmasSesion(env, "", fake, { debug: true });
assert.ok(dv.diag.variantes, "debe reportar variantes");
assert.equal(dv.diag.variantes["rpc []"], 0); assert.ok("panel@all filas" in dv.diag.variantes);
assert.equal(dv.alarmas[0].via, "contador");
console.log("variantes de diagnóstico OK");
