// Ejecutar: node frontend/pruebas/cemento-v3-local-track.test.mjs
import assert from "node:assert/strict";
import { buildTrack, newCtx, handleLocal, pendingOps, markOpDone, putHist, histLoaded, tractoNorm } from "../public/cemento-v3/local-track-core.js";

const boot = () => ({
  units: [
    { placa: "AKW-705", tracto: "20-R-758", conductor: "A", revisada: false, ocs: [
      { id: 1, orden_carga: "OC1", payload: { TRACTO: "20-R-758", "Placa Tracto": "AKW-705", "FECHA DE SALIDA PLANTA YURA/CARACOTO": "01/11/2026 08:00" }, original_payload: {}, borrador: null, observacion_migracion: "", reabierta: false },
      { id: 2, orden_carga: "OC2", payload: { TRACTO: "20-R-758", "Placa Tracto": "AKW-705" }, original_payload: {}, borrador: null, observacion_migracion: "", reabierta: false },
    ] },
    { placa: "B75-935", tracto: "20-R-458", conductor: "B", revisada: true, ocs: [
      { id: 3, orden_carga: "OC3", payload: { TRACTO: "20-R-458", "Placa Tracto": "B75-935" }, original_payload: {}, borrador: { cambios: {}, accion: "GUARDAR", revisada: true }, observacion_migracion: "", reabierta: false },
    ] },
  ],
});
const mk = () => newCtx(buildTrack(boot()), {});
const call = (ctx, b) => handleLocal(ctx, b);

// 1) lista/bootstrap reflejan la sesión local
{
  const c = mk();
  const l = call(c, { action: "lista" });
  assert.equal(l.placas.length, 2); assert.equal(l.total_ocs, 3); assert.equal(l.revisadas, 1); assert.equal(l.borradores, 0);
  assert.equal(pendingOps(c).length, 0, "sin cambios no hay nada que enviar");
}

// 2) guardar acumula: dos guardados de campos distintos → UNA operación con ambos (antes se perdía el primero)
{
  const c = mk();
  const r1 = call(c, { action: "guardar", id: 1, datos: { llegada_destino: "02/11/2026 10:00" } });
  assert.equal(r1.local, true); assert.equal(r1.maestro, false);
  call(c, { action: "guardar", id: 1, datos: { observaciones: "ok" } });
  const ops = pendingOps(c);
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].body.datos, { llegada_destino: "02/11/2026 10:00", observaciones: "ok" });
  assert.equal(ops[0].kind, "guardar");
  // la pantalla ve el cambio sin pasar por el maestro
  const d = call(c, { action: "detalle", placa: "AKW705" });
  assert.equal(d.ocs[0].payload["FECHA LLEGADA A DESTINO"], "02/11/2026 10:00");
  assert.equal(call(c, { action: "lista" }).borradores, 1);
}

// 3) valores vacíos no borran; null sí borra (igual que el maestro)
{
  const c = mk();
  call(c, { action: "guardar", id: 1, datos: { salida_planta: "" } });
  assert.equal(pendingOps(c).length, 1); // dirty aunque no cambie nada: accion GUARDAR inofensiva
  assert.deepEqual(pendingOps(c)[0].body.datos, {});
  call(c, { action: "guardar", id: 1, datos: { salida_planta: null } });
  assert.deepEqual(pendingOps(c)[0].body.datos, { salida_planta: null });
  assert.equal("FECHA DE SALIDA PLANTA YURA/CARACOTO" in call(c, { action: "detalle", placa: "AKW-705" }).ocs[0].payload, false);
}

// 4) cerrar tras guardar → una sola operación "cerrar" con todo lo acumulado
{
  const c = mk();
  call(c, { action: "guardar", id: 2, datos: { fin_de_ciclo: "03/11/2026 09:00" } });
  call(c, { action: "cerrar", id: 2, datos: { carga_retorno: "SI" } });
  const ops = pendingOps(c);
  assert.equal(ops.length, 1); assert.equal(ops[0].kind, "cerrar");
  assert.deepEqual(ops[0].body.datos, { fin_de_ciclo: "03/11/2026 09:00", carga_retorno: "SI" });
}

// 5) revisadas: se envía el ESTADO FINAL (marcar y desmarcar la misma placa = nada que enviar)
{
  const c = mk();
  call(c, { action: "marcar_revisada", placa: "AKW-705" });
  call(c, { action: "desmarcar_revisada", placa: "AKW-705" });
  assert.equal(pendingOps(c).length, 0, "marcar+desmarcar = sin cambio (antes quedaba marcada)");
  call(c, { action: "marcar_revisada", placa: "AKW-705" });
  call(c, { action: "desmarcar_revisada", placa: "B75-935" });
  const ops = pendingOps(c).map((o) => o.kind + ":" + o.body.placa).sort();
  assert.deepEqual(ops, ["desmarcar_revisada:B75-935", "marcar_revisada:AKW-705"]);
  assert.equal(call(c, { action: "lista" }).revisadas, 1);
  assert.throws(() => call(c, { action: "marcar_revisada", placa: "NOEXISTE" }), /sin OCs abiertas/);
}

// 6) orden: guardar/cerrar siempre antes que las marcas
{
  const c = mk();
  call(c, { action: "marcar_revisada", placa: "AKW-705" });
  call(c, { action: "guardar", id: 1, datos: { observaciones: "x" } });
  const kinds = pendingOps(c).map((o) => o.kind);
  assert.deepEqual(kinds, ["guardar", "marcar_revisada"]);
}

// 7) idempotencia / reintento parcial: lo ya aceptado deja de estar pendiente
{
  const c = mk();
  call(c, { action: "guardar", id: 1, datos: { observaciones: "x" } });
  call(c, { action: "marcar_revisada", placa: "AKW-705" });
  const ops = pendingOps(c);
  markOpDone(c, ops[0]); // falló la 2.ª
  const resto = pendingOps(c);
  assert.equal(resto.length, 1); assert.equal(resto[0].kind, "marcar_revisada");
  markOpDone(c, resto[0]);
  assert.equal(pendingOps(c).length, 0);
  // y una nueva edición vuelve a quedar pendiente
  call(c, { action: "guardar", id: 1, datos: { observaciones: "y" } });
  assert.equal(pendingOps(c).length, 1);
}

// 8) históricos: se piden una vez, se editan local, solo se envían los campos cambiados
{
  const c = mk();
  assert.equal(histLoaded(c, "20-R-758"), false);
  assert.throws(() => call(c, { action: "cerradas_por_tracto", tracto: "20-R-758" }), (e) => e.needsHist === "20-R-758");
  assert.equal(tractoNorm("20-R-758"), "R758");
  putHist(c, { R758: [
    { id: 90, orden_carga: "H1", payload: { TRACTO: "20-R-758", "ESTADO OC": "CERRADA", OBSERVACIONES: "a" } },
    { id: 91, orden_carga: "H2", payload: { TRACTO: "20-R-758", "ESTADO OC": "ABIERTA" } },
  ] });
  assert.equal(histLoaded(c, "R-758"), true);
  const h = call(c, { action: "cerradas_por_tracto", tracto: "20-R-758" });
  assert.equal(h.total, 2);
  assert.equal(call(c, { action: "guardar_cerrada", id: 90, datos: { observaciones: "a" } }).accion, "SIN CAMBIOS");
  assert.equal(call(c, { action: "guardar_cerrada", id: 90, datos: { observaciones: "b", ubicacion: "" } }).accion, "HISTORICO ACTUALIZADO");
  assert.throws(() => call(c, { action: "guardar_cerrada", id: 91, datos: { observaciones: "z" } }), /no está cerrada/);
  assert.throws(() => call(c, { action: "guardar_cerrada", id: 999, datos: {} }), /no encontrada/);
  assert.equal(call(c, { action: "cerradas_por_tracto", tracto: "20-R-758" }).ocs[0].payload.OBSERVACIONES, "b");
  const ops = pendingOps(c);
  assert.equal(ops.length, 1); assert.deepEqual(ops[0].body, { action: "guardar_cerrada", id: 90, datos: { observaciones: "b" } });
  markOpDone(c, ops[0]);
  assert.equal(pendingOps(c).length, 0);
}

// 9) el histórico editado y los tocados se marcan para persistir; bootstrap local no filtra campos internos
{
  const c = mk();
  call(c, { action: "guardar", id: 1, datos: { observaciones: "x" } });
  assert.ok(c.touched.has("track"));
  const b = call(c, { action: "bootstrap" });
  assert.equal(b.units[0].ocs[0].local, undefined);
  assert.equal(b.total_placas, 2);
}
console.log("local-track OK");
