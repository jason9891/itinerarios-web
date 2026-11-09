// Ejecutar: node --import ./registrar-stubs.mjs cemento-v3-integracion.test.mjs
// Prueba el cableado real (session-store + api-client + track-sync + consolidar) contra un MAESTRO FALSO
// que imita las reglas de la función cemento-seguimiento.
import assert from "node:assert/strict";

const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAPC = { salida_planta: "FECHA DE SALIDA PLANTA YURA/CARACOTO", llegada_destino: "FECHA LLEGADA A DESTINO", inicio_retorno: "FECHA INICIO DE RETORNO", fin_de_ciclo: "FECHA FIN DE RETORNO AQP/YURA/CRCT", carga_retorno: "CARGA DE RETORNO", observaciones: "OBSERVACIONES", ubicacion: "UBICACIÓN", estado_fisico: "ESTADO" };

// ── maestro falso ──
const M = {
  diario: [
    { id: 1, orden_carga: "OC1", payload: { TRACTO: "20-R-758", "Placa Tracto": "AKW-705", CONDUCTOR: "A" } },
    { id: 2, orden_carga: "OC2", payload: { TRACTO: "20-R-758", "Placa Tracto": "AKW-705", CONDUCTOR: "A" } },
    { id: 3, orden_carga: "OC3", payload: { TRACTO: "20-R-458", "Placa Tracto": "B75-935", CONDUCTOR: "B" } },
  ],
  drafts: new Map(),
  historico: [
    { id: 90, orden_carga: "H1", payload: { TRACTO: "20-R-758", "ESTADO OC": "CERRADA", OBSERVACIONES: "a" } },
    { id: 91, orden_carga: "H2", payload: { TRACTO: "20-R-458", "ESTADO OC": "CERRADA" } },
  ],
  log: [],
  batch: false,
  failOn: null,
};
const plate = (p) => String(p?.["Placa Tracto"] || p?.TRACTO || "");
function master(b) {
  M.log.push(b.action + (b.id ? ":" + b.id : "") + (b.placa ? ":" + b.placa : ""));
  if (M.failOn && M.failOn(b)) { const e = new Error("boom"); e.http = 500; throw e; }
  const a = b.action;
  if (a === "bootstrap") {
    const by = new Map();
    for (const x of M.diario) {
      const d = M.drafts.get(x.id), k = norm(plate(x.payload));
      if (!by.has(k)) by.set(k, { placa: plate(x.payload), tracto: x.payload.TRACTO, conductor: x.payload.CONDUCTOR || "", ocs: [], revisada: false, ultima_oc_cerrada: null });
      const g = by.get(k);
      g.ocs.push({ id: x.id, orden_carga: x.orden_carga, payload: { ...x.payload, ...(d?.cambios || {}) }, original_payload: { ...x.payload }, borrador: d || null, observacion_migracion: "", reabierta: false });
      if (d?.revisada) g.revisada = true;
    }
    return { units: [...by.values()] };
  }
  if (a === "__lote") {
    if (!M.batch) { const e = new Error("Function not found"); e.http = 404; throw e; }
    const por = {};
    for (const t of b.tractos) por[t] = M.historico.filter((x) => norm(x.payload.TRACTO).replace(/^20R(?=\d)/, "R") === t).map((x) => ({ id: x.id, orden_carga: x.orden_carga, payload: x.payload, original_payload: x.payload, historico: true }));
    return { por_tracto: por };
  }
  if (a === "cerradas_por_tracto") {
    const k = norm(b.tracto).replace(/^20R(?=\d)/, "R");
    return { tracto: b.tracto, total: 0, ocs: M.historico.filter((x) => norm(x.payload.TRACTO).replace(/^20R(?=\d)/, "R") === k).map((x) => ({ id: x.id, orden_carga: x.orden_carga, payload: x.payload, original_payload: x.payload, historico: true })) };
  }
  if (a === "guardar" || a === "cerrar") {
    const row = M.diario.find((x) => x.id === b.id); if (!row) throw new Error("OC no encontrada en Diario");
    const ch = {};
    for (const [k, col] of Object.entries(MAPC)) {
      if (!Object.hasOwn(b.datos || {}, k)) continue;
      const raw = b.datos[k];
      if (raw === null) { if (Object.hasOwn(row.payload, col)) ch[col] = null; continue; }
      const v = String(raw).trim(); if (!v) continue;
      if (String(row.payload[col] ?? "").trim() !== v) ch[col] = v;
    }
    const cur = M.drafts.get(b.id), merged = { ...(cur?.cambios || {}), ...ch };
    M.drafts.set(b.id, { cambios: merged, accion: a === "cerrar" ? "CERRAR" : "GUARDAR", revisada: cur?.revisada === true });
    Object.assign(row.payload, merged); for (const [k, v] of Object.entries(merged)) if (v === null) delete row.payload[k];
    return { ok: true, maestro: true };
  }
  if (a === "marcar_revisada" || a === "desmarcar_revisada") {
    const rows = M.diario.filter((x) => norm(plate(x.payload)) === norm(b.placa));
    if (!rows.length && a === "marcar_revisada") throw new Error("Unidad sin OCs abiertas");
    for (const r of rows) { const e = M.drafts.get(r.id); M.drafts.set(r.id, { cambios: e?.cambios || {}, accion: e?.accion || "GUARDAR", revisada: a === "marcar_revisada" }); }
    return { ok: true };
  }
  if (a === "guardar_cerrada") {
    const row = M.historico.find((x) => x.id === b.id); if (!row) throw new Error("OC histórica no encontrada");
    if (row.payload["ESTADO OC"] !== "CERRADA") throw new Error("La OC seleccionada no está cerrada");
    for (const [k, col] of Object.entries(MAPC)) {
      if (!Object.hasOwn(b.datos || {}, k)) continue;
      const v = b.datos[k] === null ? null : String(b.datos[k]).trim();
      if (String(row.payload[col] ?? "") !== String(v ?? "")) row.payload[col] = v;
    }
    return { ok: true };
  }
  throw new Error("Acción no encontrada");
}
globalThis.fetch = async (url, init = {}) => {
  const b = JSON.parse(init.body || "{}");
  const esLote = String(url).endsWith("/cemento-historicos");
  if (!esLote && !String(url).endsWith("/cemento-seguimiento")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  try { return new Response(JSON.stringify(master(esLote ? { action: "__lote", ...b } : b)), { status: 200 }); }
  catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: e.http || 400 }); }
};

const base = "../public/cemento-v3/";
const { setBootstrapPayload, loadTrackCtx } = await import(base + "session-store.js");
const { apiPost } = await import(base + "api-client.js");
const { API } = await import(base + "registry.js");
const { downloadTrackFromMaster, refreshTrackFromMaster } = await import(base + "track-sync.js");
const { consolidarSesionCemV2 } = await import(base + "consolidar.js");
const { countPendingOps } = await import(base + "local-track.js");
const track = (b) => apiPost(API.track, b);
const calls = () => M.log.length;

// ── INICIO: maestro → navegador ──
await setBootstrapPayload({ user_email: "operador@prueba.pe" });
const d = await downloadTrackFromMaster();
assert.deepEqual([d.placas, d.ocs, d.historicos_por_demanda], [2, 3, true]);
assert.ok(M.log.includes("bootstrap") && M.log.includes("__lote"));

// ── SEGUIMIENTO: cero llamadas al maestro (salvo bajar un histórico la primera vez) ──
let n0 = calls();
await track({ action: "guardar", id: 1, datos: { llegada_destino: "02/11/2026 10:00" } });
await track({ action: "guardar", id: 1, datos: { observaciones: "ok" } });
await track({ action: "cerrar", id: 2, datos: { fin_de_ciclo: "03/11/2026 09:00" } });
await track({ action: "marcar_revisada", placa: "AKW-705" });
await track({ action: "marcar_revisada", placa: "B75-935" });
await track({ action: "desmarcar_revisada", placa: "B75-935" });
const l = await track({ action: "lista" });
assert.equal(l.revisadas, 1); assert.equal(l.borradores, 2);
const bt = await track({ action: "bootstrap" });
assert.equal(bt.units[0].ocs[0].payload["FECHA LLEGADA A DESTINO"], "02/11/2026 10:00");
assert.equal(calls(), n0, "durante el seguimiento no debe tocar el maestro");
assert.equal(M.diario[0].payload["FECHA LLEGADA A DESTINO"], undefined, "el maestro sigue intacto");

// histórico: la primera vez se baja (1 llamada), luego es local
const h1 = await track({ action: "cerradas_por_tracto", tracto: "20-R-758" });
assert.equal(h1.total, 1); assert.equal(calls(), n0 + 1);
await track({ action: "cerradas_por_tracto", tracto: "20-R-758" });
assert.equal((await track({ action: "guardar_cerrada", id: 90, datos: { observaciones: "editada" } })).accion, "HISTORICO ACTUALIZADO");
assert.equal(calls(), n0 + 1);
assert.equal(await countPendingOps(), 4); // oc1, oc2(cerrar), rev AKW, hist 90

// ── persiste: al "reabrir" la pestaña (memoria vacía) se recupera desde IndexedDB ──
// (se simula recargando el módulo con otra query para obtener instancia nueva)
const store2 = await import(base + "session-store.js?recarga=1");
const c2 = await store2.loadTrackCtx();
assert.ok(c2.track && c2.track.units.length === 2, "track recuperado de IndexedDB");
assert.ok(c2.hist.R758?.length === 1 && c2.hist.R758[0].payload.OBSERVACIONES === "editada");

// ── FIN: envío al maestro con fallo parcial y reintento ──
M.failOn = (b) => b.action === "cerrar";
let r = await consolidarSesionCemV2({ includeSummary: false });
assert.equal(r.failed, 1); assert.equal(r.consolidado, false);
assert.equal(M.drafts.get(1).cambios["FECHA LLEGADA A DESTINO"], "02/11/2026 10:00");
assert.equal(M.drafts.get(1).cambios.OBSERVACIONES, "ok", "los dos guardados llegan juntos");
assert.equal(M.drafts.get(1).revisada, true, "la marca de revisada llega aunque otro envío falle");
assert.equal(M.historico[0].payload.OBSERVACIONES, "editada");
assert.equal(M.drafts.get(3)?.revisada ?? false, false, "marcar+desmarcar B75 no se envió");
assert.equal(await countPendingOps(), 1, "solo queda el cierre fallido");

M.failOn = null; M.log.length = 0;
r = await consolidarSesionCemV2({ includeSummary: false });
assert.equal(r.failed, 0); assert.equal(r.consolidado, true);
assert.deepEqual(M.log, ["cerrar:2"], "el reintento envía solo lo que faltaba");
assert.equal(M.drafts.get(2).accion, "CERRAR");
assert.equal(M.drafts.get(1).revisada, true);

M.log.length = 0;
r = await consolidarSesionCemV2({ includeSummary: false });
assert.equal(r.total, 0); assert.equal(M.log.length, 0, "sin cambios no se envía nada");

// ── refresh (p. ej. tras SAP): se niega si hay cambios sin enviar ──
await track({ action: "guardar", id: 3, datos: { observaciones: "nuevo" } });
await assert.rejects(() => refreshTrackFromMaster(), /sin enviar/);
await consolidarSesionCemV2({ includeSummary: false });
M.diario.push({ id: 4, orden_carga: "OC4", payload: { TRACTO: "20-R-999", "Placa Tracto": "ZZZ-111", CONDUCTOR: "Z" } });
M.batch = true;
const d2 = await refreshTrackFromMaster();
assert.equal(d2.placas, 3); assert.equal(d2.historicos_por_demanda, false);
const lh = await track({ action: "cerradas_por_tracto", tracto: "20-R-458" });
assert.equal(lh.total, 1);
assert.equal((await track({ action: "lista" })).placas.length, 3);
console.log("integracion OK · llamadas al maestro registradas:", M.log.length);
