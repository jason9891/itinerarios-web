import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import bundledRouteRules from "./RUTAS_SAP.json" with { type: "json" };
import { clasificarOc } from "./reasignacion.js";

const PROJECT = "itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const SAP_FIELDS = new Set([
  "FecIniReal", "Ord Carga", "UsuCrea OCRG", "Creado el", "Destino", "Ruta",
  "Proveedor Transporte", "Teléfono", "Nombre Piloto", "LicencCond", "Equipo",
  "Matrícula", "Acoplado 1", "PlacaAcop1", "Descripción Ruta", "Nombre Destino",
  "Observaciones", "por", "UMP", "Neto", "FechaCarga", "Estado", "Material",
  "Material de Servicio", "Tipo Presentación", "Dirección Destino", "Cliente",
  "Nom Client", "CE", "GESTOR",
]);
const SAP_WINDOW_DAYS = 7;

function routeKey(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function dateKey(value: unknown) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}
function limaTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftDateKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
async function routeRules(db: any) {
  const rules = new Map<string, boolean>();
  for (const [description, decision] of Object.entries((bundledRouteRules as any).rutas || {})) {
    rules.set(routeKey(description), String(decision).trim().toUpperCase() === "SI");
  }
  const { data, error } = await db.from("sap_rutas_reglas").select("descripcion_normalizada,usar").eq("itinerario", "CEMENTO");
  if (error) throw error;
  for (const row of data || []) rules.set(String(row.descripcion_normalizada), Boolean(row.usar));
  return rules;
}

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    vary: "Origin",
    "cache-control": "no-store",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json; charset=utf-8" },
  });
}
async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw new Error("Origen no autorizado");
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(header.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });
  const uid = String(payload.sub || "");
  if (!uid) throw new Error("Identidad Firebase no válida");
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: user, error } = await db.from("app_usuarios")
    .select("id,email,rol,itinerarios,activo,firebase_uid")
    .eq("firebase_uid", uid).maybeSingle();
  if (error) throw error;
  if (!user || !user.activo || !["ADMIN", "EDITOR"].includes(user.rol) || !user.itinerarios?.includes("CEMENTO")) {
    throw new Error("Se requiere acceso operativo a CEMENTO");
  }
  return { db, email: String(user.email || "").toLowerCase() };
}
function oc(value: unknown) {
  return String(value ?? "").trim().replace(/\.0$/, "");
}
async function allReferences(db: any, table: string, origin?: string) {
  const result: string[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select("orden_carga").eq("itinerario", "CEMENTO").order("id").range(from, from + 999);
    if (origin) query = query.eq("origen", origin);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) if (oc(row.orden_carga)) result.push(oc(row.orden_carga));
    if ((data || []).length < 1000) break;
  }
  return [...new Set(result)];
}
async function allRows(db: any, table: string, columns: string, origin?: string) {
  const result: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns).eq("itinerario", "CEMENTO").order("id").range(from, from + 999);
    if (origin) query = query.eq("origen", origin);
    const { data, error } = await query;
    if (error) throw error;
    result.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return result;
}
function sanitize(raw: unknown) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SAP_FIELDS.has(key)) continue;
    clean[key] = typeof value === "string" ? value.trim() : value;
  }
  clean["Ord Carga"] = oc(clean["Ord Carga"]);
  return clean;
}
function assignmentPlate(value: unknown) {
  return routeKey(value).replace(/[^A-Z0-9]/g, "");
}
function assignmentDriverKey(row: Record<string, any>) {
  return routeKey(row?.LicencCond) || routeKey(row?.["Nombre Piloto"]);
}
function assignmentReview(orden: string, previousRaw: unknown, currentRaw: unknown) {
  const previous = previousRaw && typeof previousRaw === "object" && !Array.isArray(previousRaw) ? previousRaw as Record<string, any> : {};
  const current = currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw) ? currentRaw as Record<string, any> : {};
  const oldDate = dateKey(previous.FecIniReal || previous["Creado el"]), newDate = dateKey(current.FecIniReal || current["Creado el"]);
  const oldDriver = assignmentDriverKey(previous), newDriver = assignmentDriverKey(current);
  const oldTracto = assignmentPlate(previous["Matrícula"]), newTracto = assignmentPlate(current["Matrícula"]);
  const oldCarreta = assignmentPlate(previous.PlacaAcop1), newCarreta = assignmentPlate(current.PlacaAcop1);
  const cambios: string[] = [];
  if (oldDate !== newDate) cambios.push("FECHA");
  if (oldDriver !== newDriver) cambios.push("CHOFER");
  if (oldTracto !== newTracto) cambios.push("TRACTO");
  if (oldCarreta !== newCarreta) cambios.push("CARRETA");
  const view = (row: Record<string, any>) => ({
    fecha: dateKey(row.FecIniReal || row["Creado el"]) || "—",
    chofer: String(row["Nombre Piloto"] || "").trim() || "—",
    licencia: String(row.LicencCond || "").trim() || "—",
    tracto: String(row["Matrícula"] || "").trim() || "—",
    carreta: String(row.PlacaAcop1 || "").trim() || "—",
  });
  return { orden_carga: orden, anterior: view(previous), actual: view(current), cambios };
}
function dailyPayload(s: Record<string, unknown>) {
  return {
    "Fecha Carga Real": s["Creado el"] ?? "",
    "Fecha de Orden": s.FecIniReal ?? "",
    "Orden de Carga": oc(s["Ord Carga"]),
    "CONDUCTOR": s["Nombre Piloto"] ?? "",
    "Celular": s["Teléfono"] ?? "",
    "TRACTO": s.Equipo ?? "",
    "Placa Tracto": s["Matrícula"] ?? "",
    "Código Carreta": s["Acoplado 1"] ?? "",
    "Placa Carreta": s.PlacaAcop1 ?? "",
    "Ruta": s["Descripción Ruta"] ?? "",
    "CARGA": s["Material de Servicio"] ?? "",
    "DESTINO": s["Nombre Destino"] ?? "",
    "PRESENTACION": s["Tipo Presentación"] ?? "",
    "GESTOR": s.GESTOR ?? "",
    "USUARIO SAP": s["UsuCrea OCRG"] ?? "",
    "FECHA DE SALIDA PLANTA YURA/CARACOTO": "",
    "FECHA LLEGADA A DESTINO": "",
    "Tiempo Total de Ida": "",
    "FECHA INICIO DE RETORNO": "",
    "FECHA FIN DE RETORNO AQP/YURA/CRCT": "",
    "Tiempo Total de Retorno": "",
    "Tiempo Total de Viaje": "",
    "Tiempo de descarga": "",
    "CARGA DE RETORNO": "",
    "OBSERVACIONES": "",
    "FECHA": "",
    "HORA": "",
    "UBICACIÓN": "",
    "ESTADO": "",
    "Viaje": "",
    "ESTADO OC": "",
    "DIAS PARADO PLANTA": "",
  };
}
function filteredByOc(input: any[], rules: Map<string, boolean>) {
  const until = limaTodayKey(), from = shiftDateKey(until, -SAP_WINDOW_DAYS);
  const unknown = [...new Set(input.map((row: any) => String(row?.["Descripción Ruta"] || "").trim())
    .filter((description: string) => routeKey(description) && !rules.has(routeKey(description))))];
  if (unknown.length) throw new Error(`Existen rutas sin decisión SI/NO: ${unknown.slice(0, 8).join(" | ")}`);
  const byOc = new Map<string, Record<string, unknown>>();
  for (const raw of input) {
    const day = dateKey(raw?.FecIniReal), decision = rules.get(routeKey(raw?.["Descripción Ruta"]));
    if (!(day && day >= from && day <= until && decision === true)) continue;
    const row = sanitize(raw), key = oc(row["Ord Carga"]);
    if (key && !byOc.has(key)) byOc.set(key, row);
  }
  return byOc;
}
async function classifyRows(db: any, byOc: Map<string, Record<string, unknown>>) {
  const [sapRows, trackingRows] = await Promise.all([
    allRows(db, "sap_registros_staging", "id,orden_carga,payload"),
    allRows(db, "seguimiento_staging", "id,orden_carga,origen,payload"),
  ]);
  const sapByOc = new Map<string, any>(), trackingByOc = new Map<string, any>();
  for (const row of sapRows) sapByOc.set(oc(row.orden_carga), row);
  for (const row of trackingRows) trackingByOc.set(oc(row.orden_carga), row);
  const groups: Record<string, string[]> = {
    NUEVA: [], REASIGNAR_VACIA: [], REABRIR_CON_INFORMACION: [],
    ABIERTA_EXISTENTE: [], CERRADA_SIN_CAMBIOS: [], SIN_SEGUIMIENTO_EXISTENTE: [],
  };
  const actions = new Map<string, string>(), reopenDetails: any[] = [];
  for (const [key, sapActual] of byOc) {
    const sapAnterior = sapByOc.get(key), seguimiento = trackingByOc.get(key);
    const kind = clasificarOc({ sapAnterior, seguimiento, sapActual });
    groups[kind].push(key);
    if (kind === "REABRIR_CON_INFORMACION") reopenDetails.push(assignmentReview(key, sapAnterior?.payload, sapActual));
    if (["NUEVA", "REASIGNAR_VACIA", "REABRIR_CON_INFORMACION"].includes(kind)) actions.set(key, kind);
  }
  return { groups, actions, reopenDetails };
}
function peruIso(value: unknown) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Fecha inválida; use DD/MM/AAAA HH:mm:ss");
  const iso = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}-05:00`;
  if (Number.isNaN(Date.parse(iso))) throw new Error("Fecha de corte inválida");
  return iso;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "Método no permitido" }, 405);
  try {
    const { db, email } = await secure(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "referencias") {
      const [sap, daily, history] = await Promise.all([
        allReferences(db, "sap_registros_staging"),
        allReferences(db, "seguimiento_staging", "DIARIO"),
        allReferences(db, "seguimiento_staging", "HISTORICO"),
      ]);
      return reply(req, { sap_ocs: sap, diario_ocs: daily, historico_ocs: history });
    }
    if (action === "reglas_rutas") {
      const rules = await routeRules(db);
      return reply(req, { reglas: Object.fromEntries(rules), columna: "Descripción Ruta", ventana_dias: SAP_WINDOW_DAYS });
    }
    if (action === "guardar_regla_ruta") {
      const description = String(body.descripcion || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const normalized = routeKey(description);
      if (!normalized) throw new Error("La descripción de ruta está vacía");
      if (typeof body.usar !== "boolean") throw new Error("La decisión de ruta debe ser SI o NO");
      const { error } = await db.from("sap_rutas_reglas").upsert({
        itinerario: "CEMENTO",
        descripcion_normalizada: normalized,
        descripcion: description,
        usar: body.usar,
        actualizado_por: email,
        actualizado_en: new Date().toISOString(),
      }, { onConflict: "itinerario,descripcion_normalizada" });
      if (error) throw error;
      return reply(req, { ok: true, descripcion: description, usar: body.usar });
    }
    if (action === "actualizar_corte") {
      const timestamp = peruIso(body.fecha_local);
      const { error } = await db.rpc("cemento_actualizar_corte", { p_fecha: timestamp });
      if (error) throw error;
      return reply(req, { ok: true, fecha_inicio_recorrido: timestamp });
    }
    if (action === "clasificar") {
      const input = Array.isArray(body.filas) ? body.filas : [];
      if (input.length > 2000) throw new Error("La validación excede 2000 OCs");
      const rules = await routeRules(db), byOc = filteredByOc(input, rules);
      const { groups, reopenDetails } = await classifyRows(db, byOc);
      return reply(req, {
        ok: true,
        nuevas: groups.NUEVA,
        vacias_reasignadas: groups.REASIGNAR_VACIA,
        con_informacion_reabiertas: groups.REABRIR_CON_INFORMACION,
        reaperturas_detalle: reopenDetails,
        abiertas_existentes: groups.ABIERTA_EXISTENTE,
        cerradas_sin_cambios: groups.CERRADA_SIN_CAMBIOS,
        sin_seguimiento_existente: groups.SIN_SEGUIMIENTO_EXISTENTE,
      });
    }
    if (action === "aplicar") {
      const input = Array.isArray(body.filas) ? body.filas : [];
      if (!input.length) throw new Error("No hay OCs nuevas para aplicar");
      if (input.length > 2000) throw new Error("La actualización excede 2000 OCs nuevas");
      const rules = await routeRules(db), byOc = filteredByOc(input, rules);
      if (!byOc.size) throw new Error("Ninguna OC cumple el rango y las rutas SI de CEMENTO");
      const { groups, actions } = await classifyRows(db, byOc);
      const rows = [...actions].map(([key, kind]) => ({
        orden_carga: key,
        accion: kind,
        sap_payload: byOc.get(key),
        daily_payload: dailyPayload(byOc.get(key)!),
      }));
      if (!rows.length) return reply(req, { ok: true, agregadas_sap: 0, agregadas_diario: 0,
        vacias_reasignadas: [], con_informacion_reabiertas: [], mensaje: "No hay OCs nuevas ni reasignadas" });
      const { data: applied, error: applyError } = await db.rpc("cemento_aplicar_sap_reasignacion", {
        p_nombre_archivo: String(body.nombre_archivo || "SAP_WEB.xlsx").slice(0, 255),
        p_hash_sha256: String(body.hash_sha256 || "").slice(0, 255),
        p_filas_recibidas: Number(body.filas_recibidas || input.length),
        p_rows: rows,
        p_usuario: email,
      });
      if (applyError) throw applyError;
      return reply(req, { ok: true, ...applied, cerradas_sin_cambios: groups.CERRADA_SIN_CAMBIOS });
    }
    return reply(req, { error: "Acción no encontrada" }, 404);
  } catch (error) {
    console.error(error);
    return reply(req, { error: error instanceof Error ? error.message : "Error SAP" }, 400);
  }
});
