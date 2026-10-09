import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import {
  activeGroupRows, closeReportState, cycleAnchor, derivedState, norm, normPlate,
  parseDate, plateOf, reportSnapshotFromCycle, text,
} from "../_shared/cv-operativa.js";

const PROJECT = "itinerarios-2fa6f";
const IT = "CERRO VERDE";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app", "https://itinerarios-2fa6f.firebaseapp.com",
  "https://itinerarios-2fa6f--prueba-fin-ciclo-t0s1424a.web.app",
  "http://localhost:5000", "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

const MAP: Record<string, string> = {
  salida_base: "SALIDA DE BASE RACIEMSA",
  llegada_caracoto: "LLEGADA A CARACOTO",
  ingreso_carguio: "INGRESO A CARGUIO",
  salida_carguio: "SALIDA DE CARGUIO",
  salida_caracoto: "SALIDA DE CARACOTO",
  llegada_base: "LLEGADA A BASE RACIEMSA",
  salida_base_cargado: "SALIDA DE BASE RACIEMSA CARGADO",
  ingreso_smcv: "INGRESO A SMCV",
  salida_smcv: "SALIDA DE SMCV",
  llegada_base_vacio: "LLEGADA A BASE RACIEMSA VACIO",
  monitoreo: "MONITOREO",
  observacion: "OBSERVACION",
  estado: "ESTADO",
};

function reply(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin",
    "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw Error("Origen no autorizado");
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(h.slice(7), JWKS, { algorithms: ["RS256"], issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error } = await db.from("app_usuarios").select("email,rol,itinerarios,activo").eq("firebase_uid", String(payload.sub || "")).maybeSingle();
  if (error) throw error;
  if (!u?.activo || !["ADMIN", "EDITOR"].includes(u.rol) || !u.itinerarios?.includes(IT)) throw Error("Se requiere acceso operativo a CERRO VERDE");
  return { db, email: String(u.email || "").toLowerCase() };
}

async function activeGroups(db: any) {
  const { data, error } = await db.from("cerro_verde_grupo_smcv").select("codigo_tracto,payload,activo,actualizado_en").eq("activo", true);
  if (error) throw error;
  return activeGroupRows(data || []);
}

async function dailyRows(db: any) {
  const { data, error } = await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario", IT).eq("origen", "DIARIO").order("id");
  if (error) throw error;
  return data || [];
}

async function draftMap(db: any, email: string) {
  const { data, error } = await db.from("seguimiento_sesion_web").select("seguimiento_id,orden_carga,cambios,accion,revisada,actualizado_en").eq("itinerario", IT).eq("usuario", email);
  if (error) throw error;
  return new Map((data || []).map((x: any) => [Number(x.seguimiento_id), x]));
}

async function revisionState(db: any, email: string) {
  const { data, error } = await db.from("cerro_verde_revision_estado")
    .select("usuario,legacy_sync_bloqueado,ultima_limpieza_en,actualizado_en")
    .eq("usuario", email).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const now = new Date().toISOString();
  const row = { usuario: email, legacy_sync_bloqueado: false, ultima_limpieza_en: null, actualizado_en: now };
  const { error: ie } = await db.from("cerro_verde_revision_estado").insert(row);
  if (ie) throw ie;
  return row;
}

async function blockLegacySync(db: any, email: string, cleanup = false) {
  const now = new Date().toISOString();
  const payload: any = { usuario: email, legacy_sync_bloqueado: true, actualizado_en: now };
  if (cleanup) payload.ultima_limpieza_en = now;
  const { error } = await db.from("cerro_verde_revision_estado")
    .upsert(payload, { onConflict: "usuario" });
  if (error) throw error;
  return now;
}

async function resetReviews(db: any, email: string) {
  const now = await blockLegacySync(db, email, true);
  const { data, error } = await db.from("cerro_verde_revision_unidades")
    .update({
      revisada: false,
      orden_revision: null,
      origen_revision: "LIMPIADA",
      actualizado_en: now,
    })
    .eq("usuario", email)
    .or("revisada.eq.true,orden_revision.not.is.null")
    .select("placa");
  if (error) throw error;
  return { limpiadas: (data || []).length, limpieza_en: now };
}

async function reviews(db: any, email: string) {
  const { data, error } = await db.from("cerro_verde_revision_unidades").select("placa,revisada,orden_revision,origen_revision,actualizado_en").eq("usuario", email).eq("revisada", true);
  if (error) {
    if (error.code === "42P01") {
      const empty = new Map();
      (empty as any).schema_ready = false;
      return empty;
    }
    throw error;
  }
  const out = new Map((data || []).map((x: any) => [normPlate(x.placa), x]));
  (out as any).schema_ready = true;
  return out;
}

async function markReviewed(db: any, email: string, plate: string, origin = "MANUAL") {
  const p = normPlate(plate);
  if (!p) throw Error("Placa inválida");
  const { data: maxRow, error: me } = await db.from("cerro_verde_revision_unidades").select("orden_revision").eq("usuario", email).eq("revisada", true).order("orden_revision", { ascending: false }).limit(1);
  if (me?.code === "42P01") throw Error("BASE CERRO VERDE PENDIENTE DE MIGRACIÓN: falta cerro_verde_revision_unidades");
  if (me) throw me;
  const n = (Number(maxRow?.[0]?.orden_revision) || 0) + 1;
  const { error } = await db.from("cerro_verde_revision_unidades").upsert({
    usuario: email,
    placa: p,
    revisada: true,
    orden_revision: n,
    origen_revision: text(origin) || "MANUAL",
    actualizado_en: new Date().toISOString(),
  }, { onConflict: "usuario,placa" });
  if (error) throw error;
  return n;
}

function cycleSort(rows: any[], drafts: Map<number, any>) {
  return rows.map((r: any) => {
    const d = drafts.get(Number(r.id));
    const effective = { ...(r.payload || {}), ...(d?.cambios || {}) };
    return { ...r, draft: d || null, effective, anchor: cycleAnchor(effective), prepared: d?.accion === "CERRAR" };
  }).sort((a: any, b: any) => a.anchor - b.anchor || String(a.orden_carga).localeCompare(String(b.orden_carga), undefined, { numeric: true }));
}

function reviewStatus(cycles: any[]) {
  const unresolvedPrevious = cycles.slice(0, -1).filter((x: any) => !x.prepared);
  return {
    eligible: unresolvedPrevious.length === 0,
    unresolved_previous: unresolvedPrevious.map((x: any) => ({ id: x.id, orden_carga: x.orden_carga })),
    all_closed: cycles.length > 0 && cycles.every((x: any) => x.prepared),
  };
}

function parseTs(v: unknown) {
  const d = parseDate(v);
  return d ? d.getTime() : NaN;
}

function isoLocal(v: unknown) {
  const s = text(v);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : s;
}

function stopPayload(candidate: any, row: any, id: number) {
  const p = row.payload || {}, tipo = text(candidate.tipo).toUpperCase();
  return {
    id, tipo_parada: tipo,
    motivo: text(candidate.descripcion) || (tipo === "PERNOCTE" ? `DESCANSO / PERNOCTE - ${text(candidate.geocerca) || "FUERA DE GEOCERCA"}` : "PAUSA ACTIVA / DESCANSO PREVENTIVO"),
    entrega: text(row.orden_carga), placa: text(p["PLACA TRACTO"] || p.PLACA || p.Placa), licencia: text(p.LICENCIA), conductor: text(p.CONDUCTOR),
    codigo_tracto: text(p["CODIGO TRACTO"]), placa_completa: text(p.PLACA || p["PLACA TRACTO"]), codigo_carreta: text(p["CODIGO CARRETA"]), fecha_carga: text(p["FECHA DE CARGA"]),
    inicio: isoLocal(candidate.inicio), fin: isoLocal(candidate.fin), duracion_min: Math.round(Number(candidate.duracion_min || 0) * 100) / 100,
    latitud: Number(candidate.lat), longitud: Number(candidate.lng), geocerca: text(candidate.geocerca) || "FUERA DE GEOCERCA", modo_deteccion: text(candidate.modo), validado_en: new Date().toISOString(),
  };
}

async function upsertArrastre(db: any, row: any, effective: any, reason = "CIERRE_CICLO_WEB") {
  const placa = plateOf(effective), r = closeReportState(effective), now = new Date().toISOString();
  if (!placa) throw Error("No se puede preparar el cierre: placa no identificada");
  const data = {
    placa, ultima_entrega: text(row.orden_carga), codigo_tracto: text(effective["CODIGO TRACTO"]), codigo_carreta: text(effective["CODIGO CARRETA"]),
    placa_carreta: text(effective["PLACA CARRETA"] || text(effective.PLACA).split("/")[1]), licencia: text(effective.LICENCIA), conductor: text(effective.CONDUCTOR),
    fecha_carga: text(effective["FECHA DE CARGA"]), fecha_cierre_ciclo: now, estado_base: r.estado_base, grupo_reporte: r.grupo_reporte,
    situacion: "ESPERA_NUEVO_CICLO", monitoreo_previo: text(effective.MONITOREO), observacion_previa: text(effective.OBSERVACION),
    origen: `${reason}|${r.origen_condicion}`, activo: true, actualizado_en: now, payload: effective,
  };
  const { error } = await db.from("cerro_verde_arrastre_operativo").upsert(data, { onConflict: "placa" });
  if (error?.code === "42P01") throw Error("BASE CERRO VERDE PENDIENTE DE MIGRACIÓN: falta cerro_verde_arrastre_operativo");
  if (error) throw error;
  return r;
}

async function clearReportControl(db: any) {
  const { error } = await db.from("cemento_reporte_control").delete().eq("itinerario", IT);
  if (error) throw error;
}


async function allRows(db: any, table: string, columns: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function operationalDatePE() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function convoyData(db: any) {
  const [equipment, drivers, convoyQ] = await Promise.all([
    allRows(db, "cerro_verde_maestro_equipos", "placa,codigo_sap"),
    allRows(db, "cerro_verde_maestro_conductores", "licencia,conductor"),
    db.from("cerro_verde_convoy_diario").select("posicion,conductor,licencia,codigo_tracto,placa_tracto,codigo_carreta,placa_carreta,hito_1,hito_2,hito_3,hito_4,estado,monitoreo,observacion,fecha_operativa,actualizado_en").order("posicion"),
  ]);
  if (convoyQ.error) throw convoyQ.error;
  const tractos = equipment.filter((x: any) => /^20-R-/i.test(text(x.codigo_sap))).map((x: any) => ({ codigo_sap: text(x.codigo_sap), placa: normPlate(x.placa) })).filter((x: any) => x.codigo_sap && x.placa).sort((a: any, b: any) => norm(a.codigo_sap).localeCompare(norm(b.codigo_sap), undefined, { numeric: true }));
  const carretas = equipment.filter((x: any) => /^20-(T|P)-/i.test(text(x.codigo_sap))).map((x: any) => ({ codigo_sap: text(x.codigo_sap), placa: normPlate(x.placa) })).filter((x: any) => x.codigo_sap && x.placa).sort((a: any, b: any) => norm(a.codigo_sap).localeCompare(norm(b.codigo_sap), undefined, { numeric: true }));
  const conductores = drivers.map((x: any) => ({ licencia: text(x.licencia), conductor: text(x.conductor) })).filter((x: any) => x.licencia && x.conductor).sort((a: any, b: any) => norm(a.conductor).localeCompare(norm(b.conductor)));
  return { convoy: convoyQ.data || [], tractos, carretas, conductores };
}

function equipmentLookup(rows: any[]) {
  const byCode = new Map<string, any>(), byPlate = new Map<string, any>();
  for (const x of rows) {
    const code = text(x.codigo_sap), plate = normPlate(x.placa);
    if (code) byCode.set(norm(code), { codigo_sap: code, placa: plate });
    if (plate) byPlate.set(plate, { codigo_sap: code, placa: plate });
  }
  return (value: any) => byCode.get(norm(value)) || byPlate.get(normPlate(value)) || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "Método no permitido" }, 405);
  try {
    const { db, email } = await secure(req);
    const b = await req.json();
    const action = text(b.action);

    if (action === "lista") {
      const [group, daily, drafts, rev] = await Promise.all([activeGroups(db), dailyRows(db), draftMap(db, email), reviews(db, email)]);
      const byPlate = new Map<string, any[]>();
      for (const r of daily) {
        const p = plateOf(r.payload);
        if (!p) continue;
        if (!byPlate.has(p)) byPlate.set(p, []);
        byPlate.get(p)!.push(r);
      }
      const placas = group.map((g: any) => {
        const p = g.payload || {}, plate = normPlate(p.PLACA_TRACTO || p["PLACA TRACTO"] || p.PLACA), cycles = cycleSort(byPlate.get(plate) || [], drafts), rs = reviewStatus(cycles), rv = rev.get(plate);
        return {
          placa: plate, tracto: text(p.CODIGO_TRACTO || g.codigo_tracto), conductor: text(p.CONDUCTOR), carreta: text(p.CODIGO_CARRETA),
          estado: text(p.ESTADO), seccion: text(p.SECCION_REPORTE), ultima_entrega: text(p.ULTIMA_ENTREGA),
          ocs: cycles.length, despachos_abiertos: cycles.filter((x: any) => !x.prepared).length, cierres_preparados: cycles.filter((x: any) => x.prepared).length,
          pendientes_anteriores: rs.unresolved_previous.length, revisada: !!rv, orden_revision: rv?.orden_revision || null,
        };
      }).filter((x: any) => x.placa).sort((a: any, b: any) => {
        if (a.revisada !== b.revisada) return a.revisada ? 1 : -1;
        return a.tracto.localeCompare(b.tracto, undefined, { numeric: true });
      });
      return reply(req, { placas, total_ocs: daily.length, revisadas: [...rev.keys()], schema_ready: (rev as any).schema_ready !== false, fuente: "GRUPO_SMCV ACTIVO · PLACA COMO UNIDAD DE REVISIÓN" });
    }

    if (action === "sincronizar_revisadas") {
      // Migración LEGACY de localStorage: se acepta una sola vez por usuario.
      // Después de una limpieza/reinicio queda bloqueada para que el navegador
      // no pueda reinyectar revisadas antiguas.
      const state = await revisionState(db, email);
      if (state.legacy_sync_bloqueado) {
        return reply(req, {
          ok: true,
          importadas: 0,
          placas_importadas: [],
          omitidas: [],
          legacy_sync_bloqueado: true,
          motivo: "SINCRONIZACION_LEGACY_DESHABILITADA",
          ultima_limpieza_en: state.ultima_limpieza_en || null,
        });
      }
      const [group, daily, drafts] = await Promise.all([activeGroups(db), dailyRows(db), draftMap(db, email)]);
      const allowed = new Set(group.map((x: any) => normPlate(x.payload?.PLACA_TRACTO || x.payload?.["PLACA TRACTO"] || x.payload?.PLACA)));
      const requested = [...new Set((Array.isArray(b.placas) ? b.placas : []).map(normPlate).filter((x: string) => allowed.has(x)))];
      const imported: string[] = [], omitted: any[] = [];
      for (const p of requested) {
        const cycles = cycleSort(daily.filter((x: any) => plateOf(x.payload) === p), drafts), rs = reviewStatus(cycles);
        if (!rs.eligible) { omitted.push({ placa: p, pendientes_anteriores: rs.unresolved_previous }); continue; }
        await markReviewed(db, email, p, "LEGACY_LOCALSTORAGE"); imported.push(p);
      }
      await blockLegacySync(db, email, false);
      return reply(req, {
        ok: true,
        importadas: imported.length,
        placas_importadas: imported,
        omitidas: omitted,
        legacy_sync_bloqueado: true,
      });
    }

    if (action === "reiniciar_revisadas") {
      const result = await resetReviews(db, email);
      return reply(req, {
        ok: true,
        ...result,
        revisadas: 0,
        legacy_sync_bloqueado: true,
        mensaje: "Contador de revisadas reiniciado. No se reimportará el localStorage antiguo.",
      });
    }

    if (action === "marcar_revisada") {
      const plate = normPlate(b.placa), [group, daily, drafts] = await Promise.all([activeGroups(db), dailyRows(db), draftMap(db, email)]);
      if (!group.some((x: any) => normPlate(x.payload?.PLACA_TRACTO) === plate)) throw Error("Unidad fuera del GRUPO_SMCV activo");
      const cycles = cycleSort(daily.filter((x: any) => plateOf(x.payload) === plate), drafts), rs = reviewStatus(cycles);
      if (!rs.eligible) throw Error(`No puede marcarse REVISADA: quedan ${rs.unresolved_previous.length} despacho(s) anterior(es) abiertos antes de un despacho posterior.`);
      const order = await markReviewed(db, email, plate, "MANUAL");
      return reply(req, { ok: true, placa: plate, orden_revision: order, ciclos: cycles.length });
    }

    if (action === "detalle") {
      const key = normPlate(b.placa);
      const [group, daily, drafts, histQ, stopsQ, rev] = await Promise.all([
        activeGroups(db), dailyRows(db), draftMap(db, email),
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario", IT).eq("origen", "HISTORICO").order("id", { ascending: false }).limit(1800),
        db.from("cerro_verde_eventos_paradas").select("evento_origen_id,tipo,entrega_sap,payload,actualizado_en").order("actualizado_en", { ascending: false }).limit(3500),
        reviews(db, email),
      ]);
      if (histQ.error) throw histQ.error; if (stopsQ.error) throw stopsQ.error;
      const unit = group.find((x: any) => normPlate(x.payload?.PLACA_TRACTO || x.payload?.["PLACA TRACTO"] || x.payload?.PLACA) === key);
      if (!unit) return reply(req, { error: "Unidad fuera del GRUPO_SMCV activo" }, 404);
      const sorted = cycleSort(daily.filter((x: any) => plateOf(x.payload) === key), drafts), rs = reviewStatus(sorted);
      const ocs = sorted.map((x: any, i: number) => {
        const next = sorted[i + 1], prev = sorted[i - 1];
        return {
          id: x.id, orden_carga: x.orden_carga, payload: x.effective, original_payload: x.payload || {}, borrador: x.draft,
          preparado_cierre: x.prepared, es_actual: i === sorted.length - 1, tiene_despacho_posterior: !!next,
          requiere_cierre_por_despacho_posterior: !!next && !x.prepared,
          anterior_entrega: prev?.orden_carga || null, siguiente_entrega: next?.orden_carga || null,
          ventana_desde: text(x.effective["FECHA DE CARGA"] || x.effective["TIMESTAMP INGRESO SAP"]),
          ventana_hasta: next ? text(next.effective["FECHA DE CARGA"] || next.effective["TIMESTAMP INGRESO SAP"]) : null,
          anchor: x.anchor,
        };
      });
      const lastHist = (histQ.data || []).find((x: any) => plateOf(x.payload) === key);
      const valid = (stopsQ.data || []).filter((x: any) => normPlate(x.payload?.placa || x.payload?.placa_completa) === key)
        .map((x: any) => ({ id: x.evento_origen_id, tipo: x.tipo, entrega: x.entrega_sap, ...(x.payload || {}) }));
      const latestValid = valid[0] || null;
      const p = unit.payload || {};
      return reply(req, {
        placa: key, tracto: text(p.CODIGO_TRACTO || unit.codigo_tracto), conductor: text(p.CONDUCTOR), carreta: text(p.CODIGO_CARRETA),
        estado: text(p.ESTADO), monitoreo: text(p.MONITOREO), seccion: text(p.SECCION_REPORTE), revisada: rev.has(key),
        ocs, revision: rs, ultima_validada: latestValid, paradas_validadas: valid,
        ultima_oc_cerrada: lastHist ? { orden_carga: lastHist.orden_carga } : null, schema_ready: (rev as any).schema_ready !== false,
      });
    }

    if (action === "parada_validar") {
      const id = Number(b.id);
      if (!Number.isInteger(id)) throw Error("Seleccione el despacho al que pertenece la parada");
      const { data: row, error } = await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("id", id).eq("itinerario", IT).eq("origen", "DIARIO").maybeSingle();
      if (error) throw error; if (!row) throw Error("El despacho ya no está abierto");
      const c = b.parada || {}, tipo = text(c.tipo).toUpperCase(), min = Number(c.duracion_min || 0), ini = parseTs(c.inicio), fin = parseTs(c.fin);
      if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) throw Error("Rango de parada inválido");
      if (tipo === "PAUSA_ACTIVA" && !(min > 5 && min < 20)) throw Error("La pausa activa debe ser mayor a 5 y menor a 20 minutos");
      if (tipo === "PERNOCTE" && !(min > 240 && new Date(ini).toISOString().slice(0, 10) !== new Date(fin).toISOString().slice(0, 10))) throw Error("El pernocte debe ser mayor a 4 horas y cambiar de fecha");
      if (!["PAUSA_ACTIVA", "PERNOCTE"].includes(tipo)) throw Error("Tipo de parada no válido");
      const { data: existing, error: ee } = await db.from("cerro_verde_eventos_paradas").select("evento_origen_id,payload").eq("tipo", tipo).eq("entrega_sap", String(row.orden_carga)).limit(500);
      if (ee) throw ee;
      const dup = (existing || []).find((x: any) => text(x.payload?.inicio) === isoLocal(c.inicio) && text(x.payload?.fin) === isoLocal(c.fin));
      if (dup) return reply(req, { ok: true, ya_validada: true, id: dup.evento_origen_id, payload: dup.payload });
      const eid = Date.now() * 1000 + crypto.getRandomValues(new Uint32Array(1))[0] % 1000, payload = stopPayload(c, row, eid);
      const { error: ie } = await db.from("cerro_verde_eventos_paradas").insert({ evento_origen_id: eid, tipo, entrega_sap: String(row.orden_carga), payload, actualizado_en: new Date().toISOString() });
      if (ie) throw ie;
      return reply(req, { ok: true, id: eid, payload });
    }

    if (action === "guardar" || action === "cerrar") {
      const id = Number(b.id);
      if (!Number.isInteger(id)) throw Error("ID de despacho inválido");
      const { data: row, error } = await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("id", id).eq("itinerario", IT).eq("origen", "DIARIO").maybeSingle();
      if (error) throw error; if (!row) throw Error("Despacho no encontrado en DIARIO");
      const changes: Record<string, any> = {};
      for (const [k, col] of Object.entries(MAP)) {
        if (!Object.hasOwn(b.datos || {}, k)) continue;
        const raw = b.datos[k];
        if (raw === null) { changes[col] = null; continue; }
        const value = text(raw);
        if (text(row.payload?.[col]) !== value) changes[col] = value;
      }
      const { data: prev, error: pe } = await db.from("seguimiento_sesion_web").select("cambios,accion").eq("itinerario", IT).eq("usuario", email).eq("seguimiento_id", id).maybeSingle();
      if (pe) throw pe;
      const merged = { ...(prev?.cambios || {}), ...changes }, actionFinal = action === "cerrar" || prev?.accion === "CERRAR" ? "CERRAR" : "GUARDAR";
      if (action === "cerrar" && text(b.motivo_cierre)) merged["MOTIVO CIERRE SEGUIMIENTO"] = text(b.motivo_cierre);
      const { error: ue } = await db.from("seguimiento_sesion_web").upsert({ itinerario: IT, usuario: email, seguimiento_id: id, orden_carga: row.orden_carga, cambios: merged, accion: actionFinal, revisada: false, actualizado_en: new Date().toISOString() }, { onConflict: "itinerario,usuario,seguimiento_id" });
      if (ue) throw ue;

      // Primero reconstruimos TODA la cadena de despachos de la placa. Un cierre de
      // un despacho anterior NO puede volver a activar arrastre si ya existe un
      // despacho posterior: ese nuevo despacho es justamente la evidencia de que
      // el anterior fue superado.
      const [allDaily, drafts] = await Promise.all([dailyRows(db), draftMap(db, email)]);
      const plate = plateOf(row.payload), cycles = cycleSort(allDaily.filter((x: any) => plateOf(x.payload) === plate), drafts);
      const pos = cycles.findIndex((x: any) => Number(x.id) === id), hasLater = pos >= 0 && pos < cycles.length - 1;
      let reportState: any = null;
      if (actionFinal === "CERRAR") {
        if (hasLater) {
          const next = cycles[pos + 1];
          const { error: ae } = await db.from("cerro_verde_arrastre_operativo").update({
            activo: false, situacion: "SUPERADO_POR_NUEVO_CICLO", fecha_salida_arrastre: new Date().toISOString(),
            motivo_salida: "NUEVO_DESPACHO_POSTERIOR", nueva_entrega: text(next?.orden_carga), actualizado_en: new Date().toISOString(),
          }).eq("placa", plate);
          if (ae) throw ae;
        } else {
          reportState = await upsertArrastre(db, row, { ...(row.payload || {}), ...merged }, text(b.motivo_cierre) || "CIERRE_CICLO_WEB");
        }
      }
      await clearReportControl(db);
      const rs = reviewStatus(cycles);
      let autoReviewed = false;
      if (actionFinal === "CERRAR" && rs.all_closed) { await markReviewed(db, email, plate, "AUTO_CIERRE_CICLOS"); autoReviewed = true; }
      return reply(req, {
        ok: true, accion: actionFinal === "CERRAR" ? "CIERRE PREPARADO" : "CAMBIOS PREPARADOS", cambios: Object.keys(merged).length,
        placa: plate, placa_revisada: autoReviewed, revision_habilitada: rs.eligible, despacho_posterior: hasLater,
        siguiente_entrega: hasLater ? cycles[pos + 1]?.orden_carga : null, estado_arrastre: reportState,
        pendientes_anteriores: rs.unresolved_previous, ocs_restantes_sin_cierre: cycles.filter((x: any) => !x.prepared).length,
      });
    }

    if (action === "convoy_datos") {
      const data = await convoyData(db);
      return reply(req, data);
    }

    if (action === "convoy_guardar") {
      const filas = Array.isArray(b.filas) ? b.filas.slice(0, 10) : [];
      const [equipment, drivers, currentQ] = await Promise.all([
        allRows(db, "cerro_verde_maestro_equipos", "placa,codigo_sap"),
        allRows(db, "cerro_verde_maestro_conductores", "licencia,conductor"),
        db.from("cerro_verde_convoy_diario").select("posicion,hito_1,hito_2,hito_3,hito_4,observacion"),
      ]);
      const cq: any = currentQ;
      if (cq.error) throw cq.error;
      const findEquipment = equipmentLookup(equipment);
      const driversByName = new Map(drivers.map((x: any) => [norm(x.conductor), x]));
      const driversByLicense = new Map(drivers.map((x: any) => [norm(x.licencia), x]));
      const current = new Map<number, any>((cq.data || []).map((x: any) => [Number(x.posicion), x]));
      const now = new Date().toISOString(), fecha = operationalDatePE(), payload: any[] = [];
      let occupied = 0;
      for (let pos = 1; pos <= 10; pos++) {
        const src = filas.find((x: any) => Number(x?.posicion) === pos) || filas[pos - 1] || {};
        const tractRaw = text(src.codigo_tracto || src.placa_tracto), trailerRaw = text(src.codigo_carreta || src.placa_carreta), driverRaw = text(src.conductor || src.licencia);
        const hasContent = !!(tractRaw || trailerRaw || driverRaw || text(src.estado) || text(src.monitoreo));
        if (hasContent && !tractRaw) throw Error(`Posición ${pos}: seleccione un tracto del Maestro`);
        const tract = tractRaw ? findEquipment(tractRaw) : null;
        if (tractRaw && (!tract || !/^20-R-/i.test(tract.codigo_sap))) throw Error(`Posición ${pos}: tracto no válido en Maestro`);
        const trailer = trailerRaw ? findEquipment(trailerRaw) : null;
        if (trailerRaw && (!trailer || !/^20-(T|P)-/i.test(trailer.codigo_sap))) throw Error(`Posición ${pos}: carreta no válida en Maestro`);
        const driver: any = driverRaw ? (driversByName.get(norm(driverRaw)) || driversByLicense.get(norm(driverRaw))) : null;
        if (driverRaw && !driver) throw Error(`Posición ${pos}: conductor no válido en Maestro`);
        const old: any = current.get(pos) || {};
        if (tract) occupied++;
        payload.push({
          posicion: pos,
          conductor: driver ? text(driver.conductor) : null,
          licencia: driver ? text(driver.licencia) : null,
          codigo_tracto: tract ? text(tract.codigo_sap) : null,
          placa_tracto: tract ? normPlate(tract.placa) : null,
          codigo_carreta: trailer ? text(trailer.codigo_sap) : null,
          placa_carreta: trailer ? normPlate(trailer.placa) : null,
          hito_1: old.hito_1 ?? null, hito_2: old.hito_2 ?? null, hito_3: old.hito_3 ?? null, hito_4: old.hito_4 ?? null,
          estado: text(src.estado) || null,
          monitoreo: text(src.monitoreo) || null,
          observacion: old.observacion ?? null,
          fecha_operativa: fecha,
          actualizado_en: now,
        });
      }
      const { error } = await db.from("cerro_verde_convoy_diario").upsert(payload, { onConflict: "posicion" });
      if (error) throw error;
      return reply(req, { ok: true, ocupadas: occupied, mensaje: `Convoy guardado: ${occupied}/10 posiciones.` });
    }

    if (action === "grupo_buscar") {
      const q = norm(text(b.q));
      if (q.length < 2) return reply(req, { resultados: [] });
      const [group, daily, histQ] = await Promise.all([
        activeGroups(db), dailyRows(db),
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario", IT).eq("origen", "HISTORICO").order("id", { ascending: false }).limit(2500),
      ]);
      if (histQ.error) throw histQ.error;
      const activePlates = new Set(group.map((x: any) => normPlate(x.payload?.PLACA_TRACTO || x.payload?.["PLACA TRACTO"] || x.payload?.PLACA)));
      const dailyPlates = new Set(daily.map((x: any) => plateOf(x.payload)).filter(Boolean));
      const seen = new Set<string>(), resultados: any[] = [];
      for (const r of histQ.data || []) {
        const p = r.payload || {}, plate = plateOf(p);
        if (!plate || seen.has(plate) || activePlates.has(plate) || dailyPlates.has(plate)) continue;
        seen.add(plate);
        const haystack = norm([plate, p["CODIGO TRACTO"], p.CONDUCTOR, p["CODIGO CARRETA"], r.orden_carga].join(" "));
        if (!haystack.includes(q)) continue;
        resultados.push({
          id: r.id, orden_carga: text(r.orden_carga), placa: plate, tracto: text(p["CODIGO TRACTO"]), conductor: text(p.CONDUCTOR),
          carreta: text(p["CODIGO CARRETA"]), fecha_carga: text(p["FECHA DE CARGA"]), estado: text(p.ESTADO), monitoreo: text(p.MONITOREO),
        });
        if (resultados.length >= 30) break;
      }
      return reply(req, { resultados });
    }

    if (action === "grupo_agregar") {
      const id = Number(b.id), section = norm(text(b.seccion)).includes("CARGADO") ? "CAL CARGADO" : "CAL VACIO";
      if (!Number.isInteger(id)) throw Error("Seleccione una unidad histórica válida");
      const { data: hist, error: he } = await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("id", id).eq("itinerario", IT).eq("origen", "HISTORICO").maybeSingle();
      if (he) throw he; if (!hist) throw Error("La fila histórica ya no está disponible");
      const p = hist.payload || {}, plate = plateOf(p), tracto = text(p["CODIGO TRACTO"]);
      if (!plate || !tracto) throw Error("La unidad histórica no tiene placa/código tracto válidos");
      const [group, daily] = await Promise.all([activeGroups(db), dailyRows(db)]);
      if (group.some((x: any) => normPlate(x.payload?.PLACA_TRACTO || x.payload?.PLACA) === plate)) throw Error("La unidad ya pertenece al GRUPO_SMCV activo");
      if (daily.some((x: any) => plateOf(x.payload) === plate)) throw Error("La unidad tiene un despacho DIARIO abierto; debe ingresar por SAP, no como retorno manual");
      const now = new Date().toISOString(), forced = section, snapshot = reportSnapshotFromCycle(p, forced);
      const gp = {
        CODIGO_TRACTO: tracto, PLACA_TRACTO: plate, LICENCIA: text(p.LICENCIA), CONDUCTOR: text(p.CONDUCTOR),
        CONDUCTOR_REPORTE: text(p.CONDUCTOR), CODIGO_CARRETA: text(p["CODIGO CARRETA"]), PLACA_CARRETA: text(p["PLACA CARRETA"] || text(p.PLACA).split("/")[1]),
        ACTIVO_GRUPO: 1, ...snapshot, ULTIMA_ENTREGA: text(hist.orden_carga), FECHA_ULTIMA_CARGA: text(p["FECHA DE CARGA"]), CICLO_ABIERTO: 0,
        ORIGEN_FOTO: "RETORNO MANUAL WEB", MOTIVO_ALTA: "RETORNO SIN NUEVA CARGA", FECHA_ALTA_GRUPO: now, FECHA_BAJA_GRUPO: "", MOTIVO_BAJA: "", REQUIERE_REVISION_SIN_NUEVA_CARGA: 0,
      };
      const { error: ge } = await db.from("cerro_verde_grupo_smcv").upsert({ codigo_tracto: tracto, payload: gp, activo: true, actualizado_en: now }, { onConflict: "codigo_tracto" });
      if (ge) throw ge;
      const cr = closeReportState({ ...p, SECCION_REPORTE: section, ESTADO: gp.ESTADO });
      const { error: ae } = await db.from("cerro_verde_arrastre_operativo").upsert({
        placa: plate, ultima_entrega: text(hist.orden_carga), codigo_tracto: tracto, codigo_carreta: text(p["CODIGO CARRETA"]), placa_carreta: text(p["PLACA CARRETA"] || text(p.PLACA).split("/")[1]),
        licencia: text(p.LICENCIA), conductor: text(p.CONDUCTOR), fecha_carga: text(p["FECHA DE CARGA"]), fecha_cierre_ciclo: now, estado_base: gp.ESTADO || cr.estado_base,
        grupo_reporte: section, situacion: "RETORNO_SIN_NUEVA_CARGA", monitoreo_previo: text(p.MONITOREO), observacion_previa: text(p.OBSERVACION), origen: "ALTA_MANUAL_GRUPO_WEB", activo: true,
        actualizado_en: now, fecha_salida_arrastre: null, motivo_salida: null, nueva_entrega: null, payload: p,
      }, { onConflict: "placa" });
      if (ae) throw ae;
      const { error: re } = await db.from("cerro_verde_revision_unidades").delete().eq("placa", plate);
      if (re) throw re;
      await clearReportControl(db);
      return reply(req, { ok: true, placa: plate, tracto, seccion: section, agregado_al_grupo: true });
    }

    if (action === "otra_operacion") {
      const plate = normPlate(b.placa), reason = text(b.motivo) || "CAMBIO_DE_OPERACION";
      const [group, daily, drafts] = await Promise.all([activeGroups(db), dailyRows(db), draftMap(db, email)]);
      const row = group.find((x: any) => normPlate(x.payload?.PLACA_TRACTO || x.payload?.["PLACA TRACTO"] || x.payload?.PLACA) === plate);
      if (!row) throw Error("Unidad no está activa en GRUPO_SMCV");
      const cycles = cycleSort(daily.filter((x: any) => plateOf(x.payload) === plate), drafts);
      const now = new Date().toISOString();
      let prepared = 0;

      // CAMBIO DE OPERACIÓN es una decisión operativa definitiva. Si la placa aún
      // conserva despachos DIARIO abiertos, no se obliga al operador a recorrerlos
      // uno por uno: se preparan para cierre administrativo con la información
      // realmente existente. No se inventa ningún hito GPS.
      for (const cycle of cycles) {
        if (cycle.prepared) continue;
        const prior = cycle.draft || null;
        const merged = {
          ...(prior?.cambios || {}),
          "MOTIVO CIERRE SEGUIMIENTO": reason,
          "ORIGEN CIERRE SEGUIMIENTO": "RETIRO_REPORTE_WEB",
        };
        const { error: se } = await db.from("seguimiento_sesion_web").upsert({
          itinerario: IT, usuario: email, seguimiento_id: cycle.id, orden_carga: cycle.orden_carga,
          cambios: merged, accion: "CERRAR", revisada: false, actualizado_en: now,
        }, { onConflict: "itinerario,usuario,seguimiento_id" });
        if (se) throw se;
        prepared++;
      }

      const payload = {
        ...(row.payload || {}), ACTIVO_GRUPO: 0, FECHA_BAJA_GRUPO: now, MOTIVO_BAJA: reason,
        REQUIERE_REVISION_SIN_NUEVA_CARGA: 0, CICLO_ABIERTO: 0,
      };
      const { error } = await db.from("cerro_verde_grupo_smcv").update({ activo: false, payload, actualizado_en: now }).eq("codigo_tracto", row.codigo_tracto);
      if (error) throw error;
      const { error: ae } = await db.from("cerro_verde_arrastre_operativo").update({
        activo: false, situacion: "OTRA_OPERACION", fecha_salida_arrastre: now, motivo_salida: reason, actualizado_en: now,
      }).eq("placa", plate);
      if (ae) throw ae;
      await markReviewed(db, email, plate, "AUTO_OTRA_OPERACION");
      await clearReportControl(db);
      return reply(req, { ok: true, placa: plate, retirado_del_reporte: true, motivo: reason, cierres_preparados: prepared });
    }

    if (action === "cerradas_por_placa" || action === "cerradas_por_tracto") {
      // Histórico consolidado de la placa (más reciente primero). Progresivo en UI.
      const raw = text(b.placa || b.tracto || b.placa_tracto);
      const key = normPlate(raw);
      if (!key) throw Error("Indique placa o tracto");
      const all: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await db.from("seguimiento_staging")
          .select("id,orden_carga,payload")
          .eq("itinerario", IT)
          .eq("origen", "HISTORICO")
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < pageSize) break;
      }
      const stamp = (p: any) => {
        const candidates = [
          p?.["FECHA DE CARGA"], p?.["SALIDA DE CARACOTO"], p?.["INGRESO A SMCV"],
          p?.["TIMESTAMP INGRESO SAP"], p?.["FECHA CIERRE SEGUIMIENTO"],
        ];
        for (const c of candidates) {
          const t = parseTs(c);
          if (Number.isFinite(t)) return t;
        }
        return 0;
      };
      const rows = all
        .filter((x: any) => plateOf(x.payload) === key || normPlate(x.payload?.["PLACA TRACTO"] || x.payload?.PLACA_TRACTO || "") === key)
        .sort((a: any, b: any) => {
          const d = stamp(b.payload) - stamp(a.payload);
          return d || Number(b.id) - Number(a.id);
        });
      return reply(req, {
        placa: key,
        total: rows.length,
        ocs: rows.map((x: any) => ({
          id: x.id,
          orden_carga: x.orden_carga,
          payload: x.payload || {},
          historico: true,
          fecha_referencia: text(
            x.payload?.["FECHA DE CARGA"] ||
            x.payload?.["SALIDA DE CARACOTO"] ||
            x.payload?.["INGRESO A SMCV"] ||
            "",
          ),
        })),
      });
    }

    if (action === "reabrir_historico") {
      // Vuelve un despacho HISTORICO a DIARIO para editarlo en seguimiento.
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) throw Error("ID histórico inválido");
      const { data: row, error } = await db.from("seguimiento_staging")
        .select("id,orden_carga,payload,origen")
        .eq("id", id).eq("itinerario", IT).eq("origen", "HISTORICO").maybeSingle();
      if (error) throw error;
      if (!row) throw Error("Despacho histórico no encontrado");
      const plate = plateOf(row.payload);
      // Evitar duplicar la misma entrega ya abierta en DIARIO
      const { data: dup, error: de } = await db.from("seguimiento_staging")
        .select("id")
        .eq("itinerario", IT)
        .eq("origen", "DIARIO")
        .eq("orden_carga", row.orden_carga)
        .maybeSingle();
      if (de) throw de;
      if (dup) throw Error(`La entrega ${row.orden_carga} ya está abierta en DIARIO`);
      const payload = { ...(row.payload || {}) };
      // Limpia marcas de cierre de ciclo si existían
      if (payload["ESTADO CICLO"]) payload["ESTADO CICLO"] = "ABIERTO";
      const { error: ue } = await db.from("seguimiento_staging")
        .update({ origen: "DIARIO", payload })
        .eq("id", id)
        .eq("itinerario", IT)
        .eq("origen", "HISTORICO");
      if (ue) throw ue;
      if (plate) {
        await db.from("cerro_verde_revision_unidades").delete().eq("usuario", email).eq("placa", plate);
      }
      return reply(req, {
        ok: true,
        id,
        orden_carga: row.orden_carga,
        placa: plate,
        accion: "REABIERTO_HISTORICO",
        mensaje: "Despacho histórico reabierto en DIARIO. Ya aparece en seguimiento.",
      });
    }

    if (action === "reabrir_despacho") {
      // Deshace CIERRE PREPARADO de la sesión web para poder editar el ciclo en seguimiento.
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) throw Error("ID de despacho inválido");
      const { data: row, error } = await db.from("seguimiento_staging")
        .select("id,orden_carga,payload")
        .eq("id", id).eq("itinerario", IT).eq("origen", "DIARIO").maybeSingle();
      if (error) throw error;
      if (!row) throw Error("El despacho no está en DIARIO (solo se reabren cierres preparados de la sesión actual)");
      const { data: prev, error: pe } = await db.from("seguimiento_sesion_web")
        .select("cambios,accion,revisada")
        .eq("itinerario", IT).eq("usuario", email).eq("seguimiento_id", id).maybeSingle();
      if (pe) throw pe;
      if (!prev || prev.accion !== "CERRAR") {
        throw Error("Este despacho no tiene un cierre preparado en su sesión");
      }
      const { error: ue } = await db.from("seguimiento_sesion_web").upsert({
        itinerario: IT,
        usuario: email,
        seguimiento_id: id,
        orden_carga: row.orden_carga,
        cambios: prev.cambios || {},
        accion: "GUARDAR",
        revisada: false,
        actualizado_en: new Date().toISOString(),
      }, { onConflict: "itinerario,usuario,seguimiento_id" });
      if (ue) throw ue;
      // Si la placa quedó revisada por auto-cierre, quitar marca de revisión
      const plate = plateOf(row.payload);
      if (plate) {
        const { error: de } = await db.from("cerro_verde_revision_unidades")
          .delete()
          .eq("usuario", email)
          .eq("placa", plate);
        if (de && de.code !== "42P01") throw de;
      }
      return reply(req, {
        ok: true,
        id,
        orden_carga: row.orden_carga,
        accion: "REABIERTO",
        mensaje: "Cierre preparado anulado. El despacho vuelve a ser editable.",
      });
    }

    if (action === "consolidar") {
      const { data, error } = await db.rpc("cerro_verde_consolidar_seguimiento_v3", { p_usuario: email });
      if (error) throw error;
      const reset = await resetReviews(db, email);
      return reply(req, {
        ok: true,
        ...data,
        seguimiento_completo: true,
        revisadas_reiniciadas: true,
        revisadas_limpiadas: reset.limpiadas,
        limpieza_en: reset.limpieza_en,
      });
    }

    return reply(req, { error: "Acción no encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return reply(req, { error: e instanceof Error ? e.message : "Error" }, 400);
  }
});
