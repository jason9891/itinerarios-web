import { recorrido, parseLoginForm, buscarFila, showSource, viewPartial } from "../src/clocator.js";
import assert from "node:assert/strict";

const ROWS = 450;
function mainHtml(logged) {
  if (!logged) return `<html><form id="frmLogin" action="/CL/faces/seguridad/login.xhtml;jsessionid=abc" method="post">
    <input type="hidden" name="frmLogin" value="frmLogin"><input type="text" name="frmLogin:user" value="">
    <input type="password" name="frmLogin:pass"><input type="hidden" name="javax.faces.ViewState" value="vs0">
    <button type="submit" name="frmLogin:btn" value="Ingresar">Ingresar</button></form></html>`;
  let rows = "";
  for (let i = 0; i < ROWS; i++) {
    const cod = `20-R-${100 + i}`;
    rows += `<tr data-ri="${i}" data-rk="${9000 + i}" class="ui-widget-content"><td>PL${i}X</td><td>${cod}</td><td>Conductor ${i}</td><td><a onclick="irAMonitoreo(${9000 + i},'-16.4${i}','-71.5${i}','0')">ver</a></td><td></td><td>09/10/2026 03:10:10</td>` + "<td>x</td>".repeat(20) + `</tr>`;
  }
  return `<html><form id="frmMonitoreo"><input type="hidden" name="javax.faces.ViewState" value="vs1">
  <ul><li><a href="#" onclick="PrimeFaces.ab({s:&quot;x&quot;,source:&#039;frmMonitoreo:j_idt777&#039;});"><span class="ui-menuitem-text">Mostrar Recorrido</span></a></li></ul>
  <table><tbody id="frmMonitoreo:dtTablaMonitoreo_data">${rows}</tbody></table></form></html>`;
}
const N = 3000;
function rpc() {
  const list = [];
  for (let i = 0; i < N; i++) {
    const s = 16 * 3600 + i * 8;
    const hh = String(Math.floor(s / 3600) % 24).padStart(2, "0"), mm = String(Math.floor(s / 60) % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    list.push({ map: { latitud: -16.4 - i * 1e-4, longitud: -71.5, fechaFinToString: `08/10/2026 ${hh}:${mm}:${ss}`, velocidad: 33, direccion: "Av. Larga de prueba 123, Arequipa, Peru", estado: "MOV", extra: "x".repeat(150) } });
  }
  return JSON.stringify({ result: { map: { listHistorica: { list } } } });
}
let logged = false, calls = [];
const RPC_JSON = rpc();
async function fakeFetch(url, init = {}) {
  const u = String(url), method = init.method || "GET";
  calls.push(`${method} ${u.replace(/^.*\/CL/, "")}`);
  const h = (extra = {}) => new Headers({ "content-type": "text/html", ...extra });
  const mk = (body, opts = {}) => { const r = new Response(body, { status: opts.status || 200, headers: opts.headers }); Object.defineProperty(r, "url", { value: u }); return r; };
  if (u.includes("login.xhtml") && method === "GET") return mk(mainHtml(false));
  if (u.includes("login.xhtml") && method === "POST") {
    assert.match(String(init.body), /frmLogin%3Auser=USR/);
    assert.match(String(init.body), /frmLogin%3Apass=PWD/);
    logged = true;
    const hd = new Headers(); hd.append("set-cookie", "JSESSIONID=zzz; Path=/CL; HttpOnly"); hd.set("location", "/CL/faces/page/main.xhtml");
    return mk("", { status: 302, headers: hd });
  }
  if (u.endsWith("main.xhtml") && method === "GET") {
    if (!/JSESSIONID=zzz/.test(init.headers?.cookie || "")) return mk(mainHtml(false));
    return mk(mainHtml(true));
  }
  if (u.endsWith("main.xhtml") && method === "POST") {
    const b = String(init.body);
    if (b.includes("contextMenu")) { assert.match(b, /dtTablaMonitoreo_selection=90\d\d/); return mk(`<partial-response><changes><update id="j_id1:javax.faces.ViewState:0"><![CDATA[vs2]]></update></changes></partial-response>`); }
    if (b.includes("j_idt777")) return mk(`<partial-response><changes><update id="j_id1:javax.faces.ViewState:0"><![CDATA[vs3]]></update><update id="x"><![CDATA[<input name="frmRecorrido:aaa_input" value="09/10/2026 00:00:00"><input name="frmRecorrido:bbb_input" value="09/10/2026 23:59:59">]]></update></changes></partial-response>`);
    if (b.includes("fnBuscarRecorridoDeVehiculo")) { assert.match(b, /frmRecorrido%3Aaaa_input=08%2F10%2F2026\+16%3A00%3A00/); assert.match(b, /ViewState=vs3/); return mk("<ok/>"); }
  }
  if (u.endsWith("JSON-RPC")) return mk(RPC_JSON, { headers: h({ "content-type": "application/json" }) });
  throw new Error("URL inesperada " + u);
}

const env = { CLOCATOR_USER: "USR", CLOCATOR_PASSWORD: "PWD" };
const t0 = process.cpuUsage();
const out = await recorrido(env, { placa: "PL5X", tracto: "20-R-105", desde: "08/10/2026 16:00:00", hasta: "09/10/2026 04:00:00" }, fakeFetch);
const cpu = process.cpuUsage(t0);
assert.equal(out.ok, true);
assert.equal(out.n, N);
assert.deepEqual(out.p[0].length, 3);
assert.ok(out.ultimo_monitoreo && out.ultimo_monitoreo.lat < -16);
// 08/10/2026 16:00:00 Lima = 21:00 UTC
assert.equal(out.p[0][0], Date.UTC(2026, 9, 8, 21, 0, 0) / 1000);
console.log("OK flujo completo · puntos:", out.n, "· subrequests:", out.dbg.subrequests);
console.log("Tamaño JSON de salida:", JSON.stringify(out.p).length, "bytes (puntos compactos)");
console.log("CPU Node (aprox. orientativo, incluye mocks y generar datos):", ((cpu.user + cpu.system) / 1000).toFixed(1), "ms");
console.log(calls.join("\n"));

// Parsers aislados: medir CPU del parseo de la tabla grande
const big = mainHtml(true);
let t = process.cpuUsage();
const f = buscarFila(big, "PL440X", "20-R-540");
let c = process.cpuUsage(t);
assert.equal(f.rk, "9440");
console.log(`Tabla ${ROWS} filas (${(big.length / 1024).toFixed(0)} KB): buscarFila CPU ≈`, ((c.user + c.system) / 1000).toFixed(2), "ms");
t = process.cpuUsage();
const parsed = JSON.parse(RPC_JSON);
c = process.cpuUsage(t);
console.log(`JSON.parse de ${N} puntos (${(RPC_JSON.length / 1024).toFixed(0)} KB) CPU ≈`, ((c.user + c.system) / 1000).toFixed(2), "ms");
assert.equal(showSource(big), "frmMonitoreo:j_idt777");
assert.equal(viewPartial(`<update id="javax.faces.ViewState"><![CDATA[abc]]></update>`), "abc");

import { recorridos } from "../src/clocator.js";
calls.length = 0; logged = false;
const multi = await recorridos(env, [
  { placa: "PL5X", tracto: "20-R-105", desde: "08/10/2026 16:00:00", hasta: "09/10/2026 04:00:00" },
  { placa: "PL7X", tracto: "20-R-107", desde: "08/10/2026 16:00:00", hasta: "09/10/2026 04:00:00" },
  { placa: "NOEXISTE", tracto: "20-R-99999", desde: "08/10/2026 16:00:00", hasta: "09/10/2026 04:00:00" },
], fakeFetch);
assert.equal(multi.resultados[0].ok, true);
assert.equal(multi.resultados[1].ok, true);
assert.equal(multi.resultados[2].ok, false);
const logins = calls.filter((c) => c.startsWith("POST /faces/seguridad")).length;
assert.equal(logins, 1, "un solo login para varias unidades");
console.log("Varias unidades en una sesión OK · logins:", logins);

import { extraerSnapshotCompacto } from "../src/clocator.js";
let srows = "";
for (let i = 0; i < 450; i++) srows += `<tr data-ri="${i}" data-rk="${i}" class="ui-widget-content fila-${i % 2 ? "verde" : "rojo"}-opaco"><td><div class="ui-chkbox"></div></td><td>PL${i}X</td><td>${i % 5 ? "Otra" : "20-R-" + (100 + i)}</td><td>Cond</td><td><a onclick="irAMonitoreo(${i},&#039;-16.4${i}&#039;,&#039;-71.5${i}&#039;,&#039;0&#039;)">v</a></td><td></td><td>2 h 10 min</td>` + "<td>x</td>".repeat(15) + "</tr>";
const shtml = `<tbody id="frmMonitoreo:dtTablaMonitoreo_data">${srows}</tbody><div>otro</div>`;
t = process.cpuUsage();
const sn = extraerSnapshotCompacto(shtml);
c = process.cpuUsage(t);
assert.equal(sn.total, 450);
assert.equal(sn.filas.length, 90);
assert.deepEqual(sn.filas[0].slice(0, 2), ["PL0X", "20-R-100"]);
assert.equal(sn.filas[0][5], "ROJO");
assert.equal(sn.filas[0][3] < -16 && sn.filas[0][4] < -71, true);
console.log("Snapshot compacto OK · filas 20-R-:", sn.filas.length, "· CPU ≈", ((c.user + c.system) / 1000).toFixed(1), "ms · JSON", JSON.stringify(sn.filas).length, "bytes");
console.log("TODO OK");

// ── alarmas: parser con el HTML REAL del panel (fixture) ──
import { extraerAlarmas } from "../src/clocator.js";
import { readFileSync } from "node:fs";
const al = extraerAlarmas(readFileSync(new URL("./alarmas-fixture.html", import.meta.url), "utf8"));
assert.equal(al.length, 1);
assert.equal(al[0].placa, "F6B919");
assert.equal(al[0].descripcion, "SEN-DESCONEXION DE ENERGIA EXTERNA");
assert.equal(al[0].eventoId, "7713046018");
assert.equal(al[0].vehiculoId, "61541");
assert.equal(al[0].historicaId, "45476282350");
assert.deepEqual(extraerAlarmas('<tbody id="x:dtAlarma_data"><tr data-ri="0"><td>No records found.</td></tr></tbody>'), []);
assert.deepEqual(extraerAlarmas("<html>sin tabla</html>"), []);
console.log("Alarmas OK:", JSON.stringify(al[0]));

// ── alarmas: modo debug (fragmentos crudos del panel) ──
import { diagAlarmas, alarmas as alarmasFn } from "../src/clocator.js";
const fx = readFileSync(new URL("./alarmas-fixture.html", import.meta.url), "utf8");
const dg = diagAlarmas(fx);
assert.equal(dg.tabla_encontrada, true);
assert.equal(dg.burbuja, "1");
assert.ok(dg.ids.some((x) => x.includes("dtAlarma")));
assert.ok(dg.ctx_tabla.includes("dtAlarma_data"));
const dg0 = diagAlarmas("<html>nada</html>");
assert.equal(dg0.tabla_encontrada, false);
assert.equal(dg0.burbuja, null);
assert.deepEqual(dg0.ids, []);
// sin debug no hay dbg; con debug sí, y la lista sigue viniendo del HTML aunque se consulte el ajax
const mainConAlarma = `<form id="frmMonitoreo"><input type="hidden" name="javax.faces.ViewState" value="vsA"></form>${fx}`;
let nPost = 0;
const fakeAl = async (url, init = {}) => {
  const u = String(url), method = init.method || "GET";
  const mk = (body, opts = {}) => { const r = new Response(body, { status: opts.status || 200, headers: opts.headers }); Object.defineProperty(r, "url", { value: u }); return r; };
  if (u.includes("login.xhtml") && method === "GET") return mk(`<form id="frmLogin" action="/CL/faces/seguridad/login.xhtml;jsessionid=abc" method="post"><input type="hidden" name="frmLogin" value="frmLogin"><input type="text" name="frmLogin:user"><input type="password" name="frmLogin:pass"><input type="hidden" name="javax.faces.ViewState" value="vs0"><button type="submit" name="frmLogin:btn" value="Ingresar">Ingresar</button></form>`);
  if (u.includes("login.xhtml") && method === "POST") { const hd = new Headers(); hd.append("set-cookie", "JSESSIONID=zzz; Path=/CL; HttpOnly"); hd.set("location", "/CL/faces/page/main.xhtml"); return mk("", { status: 302, headers: hd }); }
  if (u.endsWith("main.xhtml") && method === "GET") return mk(mainConAlarma);
  if (u.endsWith("main.xhtml") && method === "POST") { nPost++; return mk(`<partial-response><changes><update id="x"><![CDATA[sin filas]]></update></changes><extension ln="primefaces" type="args">{"cant":1}</extension></partial-response>`); }
  throw new Error("URL inesperada " + u);
};
const envA = { CLOCATOR_USER: "USR", CLOCATOR_PASSWORD: "PWD" };
const rNo = await alarmasFn(envA, fakeAl);
assert.equal(rNo.total, 1); assert.equal(rNo.fuente, "html"); assert.equal(rNo.diag.dbg, undefined); assert.equal(nPost, 0);
const rDbg = await alarmasFn(envA, fakeAl, { debug: true });
assert.equal(rDbg.total, 1); assert.equal(rDbg.fuente, "html");
assert.equal(rDbg.diag.dbg.burbuja, "1"); assert.ok(rDbg.diag.ajax_xml.includes("cant")); assert.equal(nPost, 1);
console.log("Alarmas debug OK · ids:", dg.ids.length, "· bytes ctx_tabla:", dg.ctx_tabla.length);
