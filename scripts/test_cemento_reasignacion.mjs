import assert from "node:assert/strict";
import fs from "node:fs";
import { clasificarOc, tieneHorasSeguimiento } from "../supabase/functions/cemento-sap/reasignacion.js";

const sap = (overrides = {}) => ({
  "Ord Carga": "123456",
  FecIniReal: "15/09/2026",
  "Nombre Piloto": "CONDUCTOR A",
  LicencCond: "L001",
  Equipo: "20-R-001",
  "Matrícula": "AAA111",
  PlacaAcop1: "BBB222",
  "Descripción Ruta": "RUTA A",
  ...overrides,
});
const historical = (payload = {}) => ({ origen: "HISTORICO", payload });

assert.equal(clasificarOc({ sapAnterior: null, seguimiento: null, sapActual: sap() }), "NUEVA");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: { origen: "DIARIO", payload: {} }, sapActual: sap({ "Matrícula": "CCC333" }) }), "ABIERTA_EXISTENTE");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({}), sapActual: sap() }), "CERRADA_SIN_CAMBIOS");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({ OBSERVACIONES: "SIN MOVIMIENTO" }), sapActual: sap({ "Matrícula": "CCC333" }) }), "REASIGNAR_VACIA");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({ "FECHA LLEGADA A DESTINO": "15/09/2026 10:30:00" }), sapActual: sap({ LicencCond: "L002", "Nombre Piloto": "CONDUCTOR B" }) }), "REABRIR_CON_INFORMACION");
assert.equal(clasificarOc({ sapAnterior: { payload: sap({ FecIniReal: "15/09/2026" }) }, seguimiento: historical({}), sapActual: sap({ FecIniReal: "2026-09-15 00:00:00" }) }), "CERRADA_SIN_CAMBIOS");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({}), sapActual: sap({ "Descripción Ruta": "RUTA CORREGIDA" }) }), "CERRADA_SIN_CAMBIOS");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({}), sapActual: sap({ FecIniReal: "16/09/2026" }) }), "REASIGNAR_VACIA");
assert.equal(clasificarOc({ sapAnterior: { payload: sap() }, seguimiento: historical({}), sapActual: sap({ PlacaAcop1: "DDD444" }) }), "REASIGNAR_VACIA");
assert.equal(clasificarOc({ sapAnterior: { payload: sap({ LicencCond: "", "Nombre Piloto": "José Pérez" }) }, seguimiento: historical({}), sapActual: sap({ LicencCond: "", "Nombre Piloto": "OTRO CONDUCTOR" }) }), "REASIGNAR_VACIA");

assert.equal(tieneHorasSeguimiento({ OBSERVACIONES: "texto", FECHA: "15/09/2026", HORA: "10:00" }), false);
for (const field of [
  "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  "FECHA LLEGADA A DESTINO",
  "FECHA INICIO DE RETORNO",
  "FECHA FIN DE RETORNO AQP/YURA/CRCT",
]) assert.equal(tieneHorasSeguimiento({ [field]: "15/09/2026 10:00:00" }), true, field);

const migration = fs.readFileSync(new URL("../supabase/migrations/20260915192223_cemento_reasignacion_oc.sql", import.meta.url), "utf8");
assert.match(migration, /cemento_aplicar_sap_reasignacion/);
assert.match(migration, /OC VACÍA REASIGNADA DESDE SAP/);
assert.match(migration, /OC REASIGNADA CON INFORMACIÓN PREVIA/);
assert.doesNotMatch(migration, /CERRO VERDE|cerro_verde/i);

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
assert.match(app, /OC VACÍA REASIGNADA/);
assert.match(app, /OC YA EXISTE CON INFORMACIÓN · SE REABRE PARA VALIDACIÓN/);
assert.match(app, /YA EXISTE CON INFORMACIÓN; SE REABRE PARA VALIDACIÓN/);

console.log("OK CEMENTO: OC nueva, cerrada sin cambios, vacía reasignada y con información para validar");
