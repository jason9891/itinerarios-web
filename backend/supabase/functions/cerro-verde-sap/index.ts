import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import * as XLSX from "npm:xlsx@0.18.5";

const PROJECT = "itinerarios-2fa6f";
const IT = "CERRO VERDE";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

const FIELDS = [
  "Sociedad", "Centro", "Entrega", "Transporte", "Nro.Pedido", "Tipo pedido",
  "Doc.FI", "Doc.Sunat", "Cliente", "Destino", "Material", "Descripcion",
  "Cantidad", "UMV", "Lote", "Placa", "Guia", "Fecha", "Ingreso",
  "Fecha Salida", "Salida", "Tara", "Neto", "Prom.", "Orden Compra Cliente",
  "Peso Total", "Unidad Peso", "Precinto", "Bomba", "GRE-R", "Identif.Ext.1",
  "Denominación", "Id.Tracktransp",
];

const text = (v: any) => String(v ?? "").trim();
const key = (v: any) => text(v).replace(/\.0+$/, "");
const ascii = (v: any) => text(v)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/\s+/g, " ")
  .trim();
const compact = (v: any) => ascii(v).replace(/[^A-Z0-9]/g, "");
const plate = compact;

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(req) });

async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw Error("Origen no autorizado");

  const a = req.headers.get("authorization") || "";
  if (!a.startsWith("Bearer ")) throw Error("Falta iniciar sesión");

  const { payload } = await jwtVerify(a.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: u, error } = await db
    .from("app_usuarios")
    .select("rol,itinerarios,activo")
    .eq("firebase_uid", String(payload.sub || ""))
    .maybeSingle();

  if (error) throw error;
  if (!u?.activo || !["ADMIN", "EDITOR"].includes(u.rol) || !u.itinerarios?.includes(IT)) {
    throw Error("Se requiere acceso operativo a CERRO VERDE");
  }
  return db;
}

function bytes64(s: string) {
  const raw = atob(s.includes(",") ? s.split(",").pop()! : s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function parse(content: string) {
  const bytes = bytes64(content);
  if (bytes.byteLength > 15 * 1024 * 1024) throw Error("El SAP supera 15 MB");

  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw Error("El Excel no contiene hojas");

  // Mantenemos la lectura actual. La corrección de este parche es el FLUJO,
  // no la visualización de Excel ni el formato científico de pantalla.
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as any[];
  if (rows.length > 10000) throw Error("El SAP supera 10 000 filas");

  const cols = new Set(rows.flatMap(Object.keys));
  if (!["Entrega", "Placa", "Cliente"].every((x) => cols.has(x))) {
    throw Error("Formato SAP Cerro Verde no reconocido");
  }
  return { bytes, rows };
}

function clean(r: any) {
  return Object.fromEntries(FIELDS.map((f) => [f, text(r?.[f])]));
}

function splitPlates(v: any) {
  const p = text(v)
    .toUpperCase()
    .split(/[\/\s]+/)
    .map(plate)
    .filter(Boolean);
  return [p[0] || "", p[1] || ""];
}

function business(r: any) {
  const c = ascii(r?.Cliente);
  const d = ascii(r?.Destino);
  return (
    c === ascii("SOCIEDAD MINERA CERRO VERDE S.A.A.") ||
    (c === ascii("CAL & CEMENTO SUR S.A.") && d === ascii("ARE.ARE.YARABAMBA"))
  );
}

function date(v: any) {
  const s = text(v);
  const m = s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function timestamp(d: any, t: any) {
  const a = date(d);
  const b = text(t);
  return a && b ? `${a} ${b}` : a || "";
}

function daily(s: any, m: any) {
  const [pt, pc] = splitPlates(s.Placa);
  return {
    "LICENCIA": m.licencia,
    "CONDUCTOR": m.conductor,
    "CODIGO TRACTO": m.tracto,
    "PLACA": `${pt}/${pc}`,
    "CODIGO CARRETA": m.carreta,
    "ESTADO": "",
    "FECHA DE CARGA": date(s.Fecha),
    "SALIDA DE BASE RACIEMSA": "",
    "LLEGADA A CARACOTO": "",
    "INGRESO A CARGUIO": "",
    "SALIDA DE CARGUIO": "",
    "SALIDA DE CARACOTO": "",
    "LLEGADA A BASE RACIEMSA": "",
    "SALIDA DE BASE RACIEMSA CARGADO": "",
    "INGRESO A SMCV": "",
    "SALIDA DE SMCV": "",
    "LLEGADA A BASE RACIEMSA VACIO": "",
    "MONITOREO": "",
    "OBSERVACION": "",
    "ENTREGA SAP": key(s.Entrega),
    "TRANSPORTE SAP": key(s.Transporte),
    "NRO PEDIDO SAP": key(s["Nro.Pedido"]),
    "GUIA SAP": key(s.Guia),
    "GRE-R SAP": key(s["GRE-R"]),
    "TIMESTAMP INGRESO SAP": timestamp(s.Fecha, s.Ingreso),
    "TIMESTAMP SALIDA SAP": timestamp(s["Fecha Salida"] || s.Fecha, s.Salida),
    "PLACA TRACTO": pt,
    "PLACA CARRETA": pc,
    "MATERIAL SAP": s.Material,
    "DESCRIPCION MATERIAL SAP": s.Descripcion,
    "CANTIDAD SAP": s.Cantidad,
    "ESTADO CICLO": "ABIERTO",
    "FECHA ALTA SEGUIMIENTO": new Date().toISOString(),
    "FECHA CIERRE SEGUIMIENTO": "",
    "ORIGEN REGISTRO": "SAP_INCREMENTAL_WEB",
    "OBSERVACION SISTEMA": m.advertencia_acople
      ? `ALTA AUTOMATICA DESDE SAP · ${m.advertencia_acople}`
      : "ALTA AUTOMATICA DESDE SAP",
    "ADVERTENCIA MAESTRO": m.advertencia_acople || "",
    "CONTROL INTERNO PERNOCTE": "",
    "INGRESO A PLANTA": "",
    "SALIDA DE PLANTA": "",
  };
}

async function allRows(db: any, table: string, select: string, filters: (q: any) => any) {
  const out: any[] = [];
  for (let n = 0;; n += 1000) {
    let q = db.from(table).select(select).range(n, n + 999);
    q = filters(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out;
}

function groupStamp(p: any) {
  const s = text(p["TIMESTAMP SALIDA SAP"] || p["TIMESTAMP INGRESO SAP"] || p["FECHA DE CARGA"]);
  const d = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(d) ? d : 0;
}

function uniqueGroupRows(items: any[]) {
  const by = new Map<string, any>();
  for (const x of items) {
    const p = x.payload || {};
    const k = text(p["CODIGO TRACTO"]);
    if (!k) continue;
    const old = by.get(k);
    if (!old || groupStamp(p) >= groupStamp(old.payload)) by.set(k, x);
  }
  return [...by.values()];
}

type FilterResult = {
  rows: any[];
  discards: any[];
};

function filterLikeDesktop(rawRows: any[], equipment: Map<string, string>): FilterResult {
  // Regla operativa CERRO VERDE:
  // 1) negocio Cerro Verde;
  // 2) la PRIMERA placa es el tracto y define pertenencia/seguimiento;
  // 3) la carreta/acople NO bloquea aunque sea nueva o aún no exista en maestro;
  // 4) entrega no vacía;
  // 5) deduplicar por ENTREGA al final.
  // No se filtra por centro aquí: el XLS ZSDF017 ya viene de los centros configurados.
  const candidates: any[] = [];
  const discards: any[] = [];

  for (const raw of rawRows) {
    const s = clean(raw);
    const entrega = key(s.Entrega);

    if (!business(s)) {
      discards.push({ entrega: entrega || "—", motivo: "FUERA DEL NEGOCIO CERRO VERDE" });
      continue;
    }

    const [pt] = splitPlates(s.Placa);
    if (!pt) {
      discards.push({ entrega: entrega || "—", motivo: "PLACA TRACTO INCOMPLETA" });
      continue;
    }

    // Solo el tracto debe pertenecer al maestro de la operación.
    if (!equipment.has(pt)) {
      discards.push({ entrega: entrega || "—", motivo: `TRACTO ${pt} NO EXISTE EN MAESTROS` });
      continue;
    }

    if (!entrega) {
      discards.push({ entrega: "—", motivo: "SIN ENTREGA SAP" });
      continue;
    }

    candidates.push(s);
  }

  const seen = new Set<string>();
  const rows: any[] = [];
  for (const s of candidates) {
    const entrega = key(s.Entrega);
    if (seen.has(entrega)) {
      discards.push({ entrega, motivo: "DUPLICADA EN EL ARCHIVO / HISTORICO SAP" });
      continue;
    }
    seen.add(entrega);
    rows.push(s);
  }

  return { rows, discards };
}

function summaryByReason(items: any[]) {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = text(x.motivo) || "OTRO";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([motivo, cantidad]) => ({ motivo, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));
}

async function prepare(db: any, content: string) {
  const { bytes, rows } = parse(content);

  // IMPORTANTE: los maestros superan el límite por respuesta de PostgREST.
  // Se leen COMPLETOS por páginas, igual que SAP histórico y tracking.
  // Sin esto, placas que sí existen en Supabase aparecen falsamente como
  // "NO EXISTE EN MAESTROS" al quedar fuera de la primera página.
  const [equipmentRows, driverRows, sapDbRows, trackingRows] = await Promise.all([
    allRows(
      db,
      "cerro_verde_maestro_equipos",
      "placa,codigo_sap",
      (q: any) => q,
    ),
    allRows(
      db,
      "cerro_verde_maestro_conductores",
      "licencia,conductor",
      (q: any) => q,
    ),
    allRows(
      db,
      "sap_registros_staging",
      "orden_carga,payload",
      (q: any) => q.eq("itinerario", IT),
    ),
    allRows(
      db,
      "seguimiento_staging",
      "orden_carga,origen",
      (q: any) => q.eq("itinerario", IT),
    ),
  ]);

  const equipment = new Map<string, string>();
  for (const x of equipmentRows) equipment.set(plate(x.placa), text(x.codigo_sap));

  const drivers = new Map<string, string>();
  for (const x of driverRows) drivers.set(compact(x.licencia), text(x.conductor));

  // A) Archivo actual: mismo filtro que escritorio.
  const currentFiltered = filterLikeDesktop(rows, equipment);
  const currentValid = currentFiltered.rows;

  // B) SAP histórico ya guardado en Supabase.
  // Desktop añade lo nuevo a SAP_HISTORICO y DESPUÉS relee TODO SAP_HISTORICO.
  const sapExistingByDelivery = new Map<string, any>();
  for (const x of sapDbRows) {
    const entrega = key(x.orden_carga || x.payload?.Entrega);
    if (entrega && !sapExistingByDelivery.has(entrega)) {
      sapExistingByDelivery.set(entrega, clean(x.payload || {}));
    }
  }

  const fresh = currentValid.filter((s) => !sapExistingByDelivery.has(key(s.Entrega)));

  // Universo equivalente al SAP_HISTORICO después del append del escritorio:
  // existentes + nuevas del archivo actual.
  const mergedSapRaw = [...sapExistingByDelivery.values(), ...fresh];
  const historicalFiltered = filterLikeDesktop(mergedSapRaw, equipment);

  const tracked = new Set<string>();
  for (const x of trackingRows) {
    const entrega = key(x.orden_carga);
    if (entrega) tracked.add(entrega);
  }

  // C) Reconciliación REAL del escritorio: TODO SAP_HISTORICO válido - TODO tracking.
  const missingTracking = historicalFiltered.rows.filter((s) => !tracked.has(key(s.Entrega)));

  const unresolved: any[] = [];
  const newDaily: any[] = [];
  const acoplesSinMaestro: any[] = [];

  for (const s of missingTracking) {
    const [pt, pc] = splitPlates(s.Placa);
    const tracto = text(equipment.get(pt));
    const carreta = pc ? text(equipment.get(pc)) : "";
    const licencia = compact(s["Denominación"] || s.Denominacion || s.Licencia);
    const conductor = text(drivers.get(licencia));

    // Bloqueantes: tracto / licencia / conductor.
    // La carreta NO es bloqueante: puede ser un acople recién incorporado.
    if (!tracto || !licencia || !conductor) {
      unresolved.push({
        entrega: key(s.Entrega),
        placa: text(s.Placa),
        placa_tracto: pt,
        placa_carreta: pc,
        codigo_tracto: tracto,
        codigo_carreta: carreta,
        licencia,
        conductor,
        referencia_sap: text(s["Identif.Ext.1"]),
        motivo: !tracto
          ? `CODIGO INTERNO FALTANTE PARA TRACTO ${pt}`
          : !licencia
          ? "LICENCIA / DENOMINACION VACIA"
          : `CONDUCTOR NO RESUELTO PARA LICENCIA ${licencia}`,
      });
      continue;
    }

    const advertenciaAcople = !pc
      ? "SIN PLACA CARRETA EN SAP"
      : !equipment.has(pc)
      ? `CARRETA ${pc} NO EXISTE EN MAESTROS`
      : !carreta
      ? `CODIGO INTERNO FALTANTE PARA CARRETA ${pc}`
      : "";

    if (advertenciaAcople) {
      acoplesSinMaestro.push({
        entrega: key(s.Entrega),
        placa_tracto: pt,
        codigo_tracto: tracto,
        placa_carreta: pc,
        codigo_carreta: carreta,
        advertencia: advertenciaAcople,
      });
    }

    newDaily.push({
      sap: s,
      payload: daily(s, {
        tracto,
        carreta,
        licencia,
        conductor,
        advertencia_acople: advertenciaAcople,
      }),
    });
  }

  const currentKeys = new Set(currentValid.map((x) => key(x.Entrega)));
  const freshKeys = new Set(fresh.map((x) => key(x.Entrega)));
  const missingKeys = new Set(missingTracking.map((x) => key(x.Entrega)));

  const recoveredFromHistorical = [...missingKeys].filter((k) => !freshKeys.has(k)).length;
  const missingFromCurrentFile = [...missingKeys].filter((k) => currentKeys.has(k)).length;

  const byDate: Record<string, number> = {};
  for (const x of missingTracking) {
    const d = date(x.Fecha) || "SIN_FECHA";
    byDate[d] = (byDate[d] || 0) + 1;
  }

  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

  const allDiscards = [
    ...currentFiltered.discards,
    ...unresolved.map((x) => ({ entrega: x.entrega, motivo: x.motivo })),
  ];

  return {
    summary: {
      leidas: rows.length,
      en_alcance: currentValid.length,
      registradas: currentValid.length - fresh.length,
      nuevas_sap: fresh.length,
      // Esta cifra replica el escritorio: faltantes de TODO SAP histórico contra tracking.
      nuevas_diario: missingTracking.length,
      nuevas_diario_resueltas: newDaily.length,
      recuperadas_sap_historico: recoveredFromHistorical,
      faltantes_del_archivo_actual: missingFromCurrentFile,
      pendientes_maestro: unresolved.length,
      pendientes_maestro_detalle: unresolved.slice(0, 100),
      acoples_sin_maestro: acoplesSinMaestro.length,
      acoples_sin_maestro_detalle: acoplesSinMaestro.slice(0, 100),
      por_fecha_nuevas_diario: byDate,
      descartadas: rows.length - currentValid.length,
      descartes: currentFiltered.discards.slice(0, 150),
      descartes_resumen: summaryByReason(currentFiltered.discards),
      hash,
    },
    fresh,
    missingTracking,
    newDaily,
    unresolved,
  };
}

function iso(v: any) {
  const m = text(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw Error("Fecha inválida; use DD/MM/AAAA HH:mm:ss");
  return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}T${m[4]}:${m[5]}:${m[6]}-05:00`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "Método no permitido" }, 405);

  try {
    const db = await secure(req);
    const b = await req.json();
    const action = text(b.action);

    if (action === "actualizar_corte") {
      const stamp = iso(b.fecha_local);
      const { error } = await db.rpc("cerro_verde_actualizar_corte", { p_fecha: stamp });
      if (error) throw error;
      return reply(req, { ok: true, fecha_inicio_recorrido: stamp });
    }

    if (!["validar_archivo", "aplicar_archivo"].includes(action)) {
      return reply(req, { error: "Acción no encontrada" }, 404);
    }

    if (!/\.xlsx?$/i.test(text(b.nombre_archivo))) {
      throw Error("Seleccione un SAP .xls o .xlsx");
    }

    const p = await prepare(db, text(b.contenido_base64));

    if (action === "validar_archivo") {
      return reply(req, { ok: true, ...p.summary });
    }

    if (p.unresolved.length) {
      const sample = p.unresolved
        .slice(0, 8)
        .map((x: any) => `${x.entrega}: ${x.motivo}`)
        .join(" | ");
      throw Error(
        `Hay ${p.unresolved.length} entrega(s) pendientes de resolver en MAESTROS. ` +
        `No se aplicó ningún cambio. ${sample}`,
      );
    }

    if (!p.fresh.length && !p.newDaily.length) {
      return reply(req, {
        ok: true,
        ...p.summary,
        agregadas_sap: 0,
        agregadas_diario: 0,
        unidades_grupo_actualizadas: 0,
        mensaje: "No hay entregas SAP nuevas ni ciclos faltantes por reconciliar",
      });
    }

    const sapRows = p.fresh.map((s: any) => ({
      orden_carga: key(s.Entrega),
      payload: s,
    }));

    const dailyRows = p.newDaily.map((x: any) => ({
      orden_carga: key(x.sap.Entrega),
      payload: x.payload,
    }));

    const groupRows = uniqueGroupRows(dailyRows).map((x: any) => ({
      codigo_tracto: text(x.payload["CODIGO TRACTO"]),
      placa: text(x.payload["PLACA TRACTO"]),
      payload: x.payload,
    }));

    const { data, error } = await db.rpc("cerro_verde_aplicar_sap_v3", {
      p_nombre_archivo: text(b.nombre_archivo),
      p_hash_sha256: p.summary.hash,
      p_filas_recibidas: p.summary.leidas,
      p_filas_validas: p.summary.en_alcance,
      p_filas_fuera_alcance: p.summary.descartadas,
      p_sap_rows: sapRows,
      p_daily_rows: dailyRows,
      p_group_rows: groupRows,
    });

    if (error) {
      const parts = [error.message, error.details, error.hint, error.code].filter(Boolean);
      throw Error(parts.join(" | ") || "Error aplicando SAP");
    }

    return reply(req, { ok: true, ...p.summary, ...data });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e || "Error SAP");
    return reply(req, { error: msg || "Error SAP" }, 400);
  }
});
