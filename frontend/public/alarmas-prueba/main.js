/**
 * ALARMAS DE PRUEBA — página independiente (no importa código de ningún itinerario).
 * Objetivo: captar las alarmas pendientes de CLocator/Comsatel (acción `alarmas` del Worker),
 * registrar cada una (primera vez, veces vistas, cuándo desaparece) y MEDIR qué tan confiable es
 * la captura, para compararla con el historial de Comsatel y con lo que muestra el navegador.
 * Solo funciona mientras esta pestaña esté abierta.
 */
import { applyPlatformShell } from "./propio/platform-shell.js";
import { auth, onAuthStateChanged, wireLoginForm } from "./propio/auth.js";
import { vacio, aplicarConsulta, registrarFallo, guardarMuestra, resumen, horaLima, aTSV, norm } from "./logica.js?v=alp7";

applyPlatformShell({ itinerary: "alarmas-prueba", subtitle: "ALARMAS DE PRUEBA" });
wireLoginForm();

const WORKER = "https://clocator-proxy.jasontupayachihurtado.workers.dev/";
const LS_REG = "alp_registro_v1:";
const LS_CFG = "alp_cfg_v1";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let user = null, reg = vacio(), timer = null, corriendo = false, enCurso = false;
let codigos = new Map(); // placa normalizada → código 20-R-
let ultimoSnap = 0, nuevasIds = new Set(), ultimoError = "", audioCtx = null;
let cfg = { minutos: 1, sonido: true, soloTurno: false, filtro: "", auto: false, debug: true };
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(LS_CFG) || "{}") }; } catch { /* ignore */ }

const guardarCfg = () => { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch { /* ignore */ } };
const cargarReg = () => { try { return { ...vacio(), ...JSON.parse(localStorage.getItem(LS_REG + user.uid) || "{}") }; } catch { return vacio(); } };
const guardarReg = () => { try { localStorage.setItem(LS_REG + user.uid, JSON.stringify(reg)); } catch { /* ignore */ } };

async function worker(body, ms = 70000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(WORKER, { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken(false)}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `Worker HTTP ${r.status}`);
    return d;
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "El Worker tardó demasiado" : e.message);
  } finally { clearTimeout(t); }
}

function beep() {
  if (!cfg.sonido) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.type = "square"; o.frequency.value = 900; g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.4);
  } catch { /* ignore */ }
}

async function actualizarCodigos() {
  if (Date.now() - ultimoSnap < 10 * 60000) return;
  ultimoSnap = Date.now();
  try {
    const d = await worker({ action: "snapshot" });
    codigos = new Map((d.filas || []).map((f) => [norm(f[0]), f[1]]));
  } catch { /* el código del turno es solo informativo */ }
}

let sesionTok = ""; // sesión de CLocator reutilizada (cifrada por el Worker): un login, consultas cada minuto

async function consultar() {
  if (enCurso || !user) return;
  enCurso = true; pintarEstado("Consultando…");
  try {
    await actualizarCodigos();
    const res = await worker({ action: "alarmas", persistente: true, sesion: sesionTok, ...(cfg.debug ? { debug: true } : {}) });
    sesionTok = res.sesion || sesionTok;
    const { nuevas } = aplicarConsulta(reg, res, Date.now());
    if (cfg.debug) guardarMuestra(reg, res, Date.now());
    nuevasIds = new Set(nuevas.map((n) => n.k));
    ultimoError = "";
    if (nuevas.length) { beep(); document.title = `🔴 ${nuevas.length} alarma(s) nueva(s) · Alarmas de prueba`; setTimeout(() => (document.title = "Alarmas de prueba · Itinerarios · RACIEMSA"), 8000); }
  } catch (e) {
    ultimoError = e.message; registrarFallo(reg, e.message, Date.now());
  } finally {
    enCurso = false; guardarReg(); pintar();
  }
}

function programar() {
  clearTimeout(timer);
  if (!corriendo) return;
  timer = setTimeout(async () => { await consultar(); programar(); }, cfg.minutos * 60000);
}
const iniciar = async () => { corriendo = true; cfg.auto = true; guardarCfg(); pintar(); await consultar(); programar(); };
const detener = () => { corriendo = false; cfg.auto = false; guardarCfg(); clearTimeout(timer); pintar(); };
// Cierre de sesión: se frena el temporizador pero se conserva cfg.auto para reanudar al volver a entrar/recargar.
const pausar = () => { corriendo = false; clearTimeout(timer); };

function pintarEstado(txt) {
  const el = document.getElementById("alp-estado"); if (!el) return;
  el.textContent = txt; el.className = "alp-estado" + (ultimoError ? " err" : corriendo ? " on" : "");
}

function pintar() {
  const root = document.getElementById("content"); if (!root || !user) return;
  const hoy0 = new Date(Date.now() - 5 * 3600000); hoy0.setUTCHours(0, 0, 0, 0);
  const desde = hoy0.getTime() + 5 * 3600000;
  const s = resumen(reg, desde);
  const f = norm(cfg.filtro);
  let recs = Object.values(reg.alarmas).sort((a, b) => b.primera - a.primera);
  if (cfg.soloTurno) recs = recs.filter((r) => codigos.has(norm(r.placa)));
  if (f) recs = recs.filter((r) => norm(r.placa + r.descripcion + (codigos.get(norm(r.placa)) || "")).includes(f));
  const kpi = (n, t, c = "") => `<div class="alp-kpi ${c}"><b>${n}</b><small>${t}</small></div>`;
  root.innerHTML = `
    <section class="panel">
      <h1 style="margin:0 0 4px">Alarmas de prueba</h1>
      <p class="alp-nota">Capta las <b>alarmas pendientes</b> que CLocator (Comsatel) muestra en su panel «Alarmas» abriendo una sesión nueva en cada consulta, y registra cuándo aparece y cuándo desaparece cada una.
      Compara esta tabla con el <b>historial de Comsatel</b>: lo que falte aquí pero esté allá se perdió en la captura. Solo capta mientras esta pestaña esté abierta. La hora es la de <b>captura</b> (el panel no entrega la hora de la alarma).</p>
      <div class="alp-bar">
        <button type="button" class="primary" id="alp-ini">${corriendo ? "DETENER" : "INICIAR CAPTURA"}</button>
        <button type="button" class="ghost" id="alp-ya" ${enCurso ? "disabled" : ""}>CONSULTAR AHORA</button>
        <label>Cada <select id="alp-min">${[1, 2, 3, 5, 10].map((m) => `<option value="${m}" ${m === cfg.minutos ? "selected" : ""}>${m} min</option>`).join("")}</select></label>
        <label><input type="checkbox" id="alp-snd" ${cfg.sonido ? "checked" : ""}> Sonido al llegar nueva</label>
        <label title="Guarda fragmentos crudos de CLocator cada vez que cambia lo que devuelve"><input type="checkbox" id="alp-dbg" ${cfg.debug ? "checked" : ""}> Diagnóstico</label>
        <span id="alp-estado" class="alp-estado ${ultimoError ? "err" : corriendo ? "on" : ""}">${ultimoError ? "Error: " + esc(ultimoError) : corriendo ? "Capturando" : "Detenido"}</span>
      </div>
      <div class="alp-kpis">
        ${kpi(s.capturadas, "Capturadas hoy")}
        ${kpi(s.activas, "Activas ahora", s.activas ? "bad" : "")}
        ${kpi(s.efimeras, "Vistas 1 sola vez (hoy)", s.efimeras ? "warn" : "")}
        ${kpi(s.consultas, "Consultas hoy")}
        ${kpi(s.pctOk + "%", "Consultas exitosas", s.pctOk < 95 && s.consultas ? "warn" : "")}
        ${kpi(s.fallos, "Fallidas", s.fallos ? "bad" : "")}
        ${kpi(s.dudosas, "Lecturas dudosas", s.dudosas ? "warn" : "")}
        ${kpi(s.huecoMaxMin + " min", "Mayor hueco sin consulta")}
      </div>
      <div class="alp-bar">
        <input type="search" id="alp-fil" placeholder="Filtrar placa, código o texto" value="${esc(cfg.filtro)}">
        <label><input type="checkbox" id="alp-turno" ${cfg.soloTurno ? "checked" : ""}> Solo unidades 20-R- (turno)</label>
        <button type="button" class="ghost" id="alp-copiar">COPIAR TABLA</button>
        <button type="button" class="ghost" id="alp-dcopiar" title="Copia las últimas muestras crudas de CLocator">COPIAR DIAGNÓSTICO (${(reg.muestras || []).length})</button>
        <button type="button" class="ghost" id="alp-hist" title="Pide al Worker mirar la página de alarmas (CLAlarma) y copia lo que ve">EXPLORAR HISTORIAL</button>
        <button type="button" class="ghost" id="alp-borrar">BORRAR REGISTRO</button>
        <span class="alp-msg" id="alp-msg" aria-live="polite"></span>
      </div>
      <div class="alp-scroll"><table class="alp-tabla"><thead><tr>
        <th>Hora del evento</th><th>Primera captura</th><th>Demora</th><th>Placa</th><th>Código</th><th>Descripción</th><th>Veces</th><th>Última vez</th><th>Estado</th><th>ID evento</th></tr></thead><tbody>
        ${recs.map((r) => `<tr class="${r.activa ? "activa" : "gone"}${nuevasIds.has(r.k) ? " nueva" : ""}">
          <td>${r.fechaEvento ? horaLima(r.fechaEvento) : "—"}</td><td>${horaLima(r.primera)}</td><td>${r.fechaEvento ? Math.max(0, Math.round((r.primera - r.fechaEvento) / 600) / 100) + " min" : "—"}</td><td><b>${esc(r.placa)}</b></td><td class="turno">${esc(codigos.get(norm(r.placa)) || r.codigoExt || "")}</td>
          <td>${esc(r.descripcion)}</td><td>${r.veces}</td><td>${horaLima(r.ultima)}</td>
          <td>${r.activa ? "<b>ACTIVA</b>" : "desapareció " + horaLima(r.desaparecio)}</td><td>${esc(r.eventoId)}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">Sin alarmas capturadas todavía.</td></tr>`}
      </tbody></table></div>
      <details class="alp-log"><summary>Registro de consultas (últimas 60)</summary>
        <div class="alp-scroll" style="max-height:30vh"><table class="alp-tabla"><thead><tr><th>Hora</th><th>Resultado</th><th>Fuente</th><th>Alarmas</th><th>Lectura</th><th>ms</th></tr></thead><tbody>
        ${reg.consultas.slice(-60).reverse().map((c) => `<tr><td>${horaLima(c.t)}</td><td>${c.ok ? "OK" : "<b style='color:#b91c1c'>FALLÓ</b> " + esc(c.error)}</td><td>${esc(c.fuente || "")}</td><td>${c.total ?? ""}</td><td>${c.ok ? (c.segura ? "segura" : "dudosa") : ""}</td><td>${c.ms ?? ""}</td></tr>`).join("")}
        </tbody></table></div></details>
    </section>`;
  const $ = (id) => root.querySelector(id), msg = (t) => { const m = $("#alp-msg"); if (m) m.textContent = t; };
  $("#alp-ini").addEventListener("click", () => (corriendo ? detener() : iniciar()));
  $("#alp-ya").addEventListener("click", async () => { await consultar(); });
  $("#alp-min").addEventListener("change", (e) => { cfg.minutos = +e.target.value; guardarCfg(); programar(); });
  $("#alp-snd").addEventListener("change", (e) => { cfg.sonido = e.target.checked; guardarCfg(); if (cfg.sonido) beep(); });
  $("#alp-dbg").addEventListener("change", (e) => { cfg.debug = e.target.checked; guardarCfg(); });
  $("#alp-dcopiar").addEventListener("click", async () => {
    const ms = (reg.muestras || []).slice(-8);
    if (!ms.length) { msg("Aún no hay muestras: deja activo «Diagnóstico» y consulta."); return; }
    try { await navigator.clipboard.writeText(JSON.stringify({ copiado: horaLima(Date.now()), consultas_hoy: reg.consultas.length, resumen_fuentes: reg.consultas.reduce((o, c) => (o[c.fuente || (c.ok ? "?" : "FALLO")] = (o[c.fuente || (c.ok ? "?" : "FALLO")] || 0) + 1, o), {}), sesiones_nuevas: reg.consultas.filter((c) => c.nueva).length, contador_max: Math.max(0, ...reg.consultas.map((c) => c.cnt || 0)), ultimas_consultas: reg.consultas.slice(-40).map((c) => [horaLima(c.t), c.ok ? (c.fuente || "") : "FALLO " + (c.error || ""), c.total, c.cnt, c.nueva ? "NUEVA" : "", c.ms]), muestras: ms }, null, 1)); msg(`Diagnóstico copiado (${ms.length} muestras).`); } catch { msg("No se pudo copiar."); }
  });
  $("#alp-hist").addEventListener("click", async () => {
    msg("Explorando historial de CLocator…");
    try {
      const d = await worker({ action: "alarmas_historial_diag", sesion: sesionTok });
      sesionTok = d.sesion || sesionTok; delete d.sesion;
      await navigator.clipboard.writeText(JSON.stringify({ copiado: horaLima(Date.now()), ...d }, null, 1));
      msg("Historial explorado: ya está copiado, pégalo en el chat.");
    } catch (e) { msg("No se pudo explorar: " + e.message); }
  });
  $("#alp-turno").addEventListener("change", (e) => { cfg.soloTurno = e.target.checked; guardarCfg(); pintar(); });
  $("#alp-fil").addEventListener("change", (e) => { cfg.filtro = e.target.value; guardarCfg(); pintar(); });
  $("#alp-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(aTSV(recs, codigos)); msg("Tabla copiada (pégala en Excel)."); } catch { msg("No se pudo copiar."); }
  });
  $("#alp-borrar").addEventListener("click", () => {
    if (!confirm("¿Borrar todo el registro de alarmas y consultas de este navegador?")) return;
    reg = vacio(); nuevasIds = new Set(); guardarReg(); pintar();
  });
}

onAuthStateChanged(auth, (u) => {
  user = u;
  document.body.classList.remove("auth-pending");
  document.getElementById("login")?.classList.toggle("hidden", !!u);
  document.getElementById("workspace")?.classList.toggle("hidden", !u);
  const who = document.getElementById("alp-user"); if (who) who.textContent = u?.email || "";
  if (u) { reg = cargarReg(); pintar(); if (cfg.auto && !corriendo) iniciar(); } else { pausar(); }
});
