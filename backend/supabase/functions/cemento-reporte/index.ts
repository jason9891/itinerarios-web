import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import ExcelJS from "npm:exceljs@4.4.0";
import { GESTOR_POR_PLACA, TELEFONOS_POR_LICENCIA } from "./MAESTROS_CEMENTO.ts";

const PROJECT = "itinerarios-2fa6f",
  ORIGINS = new Set([
    "https://itinerarios-2fa6f.web.app",
    "https://itinerarios-2fa6f.firebaseapp.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ]),
  JWKS = createRemoteJWKSet(
    new URL(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    ),
  );
const REPORT_COLUMNS = [
  "ITEM",
  "Viaje",
  "Fecha Carga Real",
  "Fecha de Orden",
  "Orden de Carga",
  "CONDUCTOR",
  "Celular",
  "TRACTO",
  "Placa Tracto",
  "Código Carreta",
  "Placa Carreta",
  "Ruta",
  "CARGA",
  "DESTINO",
  "PRESENTACION",
  "GESTOR",
  "USUARIO SAP",
  "FECHA DE SALIDA PLANTA YURA",
  "FECHA LLEGADA A DESTINO",
  "Tiempo Total de Ida",
  "FECHA INICIO DE RETORNO",
  "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  "Tiempo Total de Retorno",
  "Tiempo Total de Viaje",
  "Tiempo antes de retorno",
  "CARGA DE RETORNO",
  "OBSERVACIONES",
  "FECHA",
  "HORA",
  "UBICACIÓN",
  "ESTADO",
];
const REPORT_SOURCE: Record<string, string> = {
  "Fecha Carga Real": "Fecha Carga Real",
  "Fecha de Orden": "Fecha de Orden",
  "Orden de Carga": "Orden de Carga",
  CONDUCTOR: "CONDUCTOR",
  Celular: "Celular",
  TRACTO: "TRACTO",
  "Placa Tracto": "Placa Tracto",
  "Código Carreta": "Código Carreta",
  "Placa Carreta": "Placa Carreta",
  Ruta: "Ruta",
  CARGA: "CARGA",
  DESTINO: "DESTINO",
  PRESENTACION: "PRESENTACION",
  GESTOR: "GESTOR",
  "USUARIO SAP": "USUARIO SAP",
  "FECHA DE SALIDA PLANTA YURA": "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  "FECHA LLEGADA A DESTINO": "FECHA LLEGADA A DESTINO",
  "Tiempo Total de Ida": "Tiempo Total de Ida",
  "FECHA INICIO DE RETORNO": "FECHA INICIO DE RETORNO",
  "FECHA FIN DE RETORNO AQP/YURA/CRCT": "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  "Tiempo Total de Retorno": "Tiempo Total de Retorno",
  "Tiempo Total de Viaje": "Tiempo Total de Viaje",
  "Tiempo antes de retorno": "Tiempo de descarga",
  "CARGA DE RETORNO": "CARGA DE RETORNO",
  OBSERVACIONES: "OBSERVACIONES",
  FECHA: "FECHA",
  HORA: "HORA",
  UBICACIÓN: "UBICACIÓN",
  ESTADO: "ESTADO",
};
const ARCHIVE_COLUMNS = [
  "Fecha Carga Real",
  "Fecha de Orden",
  "Orden de Carga",
  "CONDUCTOR",
  "Celular",
  "TRACTO",
  "Placa Tracto",
  "Código Carreta",
  "Placa Carreta",
  "Ruta",
  "CARGA",
  "DESTINO",
  "PRESENTACION",
  "GESTOR",
  "USUARIO SAP",
  "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  "FECHA LLEGADA A DESTINO",
  "Tiempo Total de Ida",
  "FECHA INICIO DE RETORNO",
  "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  "Tiempo Total de Retorno",
  "Tiempo Total de Viaje",
  "Tiempo de descarga",
  "CARGA DE RETORNO",
  "OBSERVACIONES",
  "FECHA",
  "HORA",
  "UBICACIÓN",
  "ESTADO",
  "Viaje",
  "ESTADO OC",
  "DIAS PARADO PLANTA",
];
const SAP_ARCHIVE_COLUMNS = [
  "FecIniReal",
  "Ord Carga",
  "UsuCrea OCRG",
  "Creado el",
  "Destino",
  "Ruta",
  "Proveedor Transporte",
  "Teléfono",
  "Nombre Piloto",
  "LicencCond",
  "Equipo",
  "Matrícula",
  "Acoplado 1",
  "PlacaAcop1",
  "Descripción Ruta",
  "Nombre Destino",
  "Observaciones",
  "por",
  "UMP",
  "Neto",
  "FechaCarga",
  "Estado",
  "Material",
  "Material de Servicio",
  "Tipo Presentación",
  "Dirección Destino",
  "Cliente",
  "Nom Client",
  "CE",
  "GESTOR",
];
const SAP_DATE_COLUMNS = new Set(["FecIniReal", "Creado el", "FechaCarga"]);
const DATE_ONLY_COLUMNS = new Set([
    "Fecha Carga Real",
    "Fecha de Orden",
  ]),
  DATE_TIME_COLUMNS = new Set([
    "FECHA DE SALIDA PLANTA YURA",
    "FECHA DE SALIDA PLANTA YURA/CARACOTO",
    "FECHA LLEGADA A DESTINO",
    "FECHA INICIO DE RETORNO",
    "FECHA FIN DE RETORNO AQP/YURA/CRCT",
  ]),
  DURATION_COLUMNS = new Set([
    "Tiempo Total de Ida",
    "Tiempo Total de Retorno",
    "Tiempo Total de Viaje",
    "Tiempo antes de retorno",
    "Tiempo de descarga",
  ]);

function cors(req: Request) {
  const o = req.headers.get("origin") || "",
    h: Record<string, string> = {
      vary: "Origin",
      "cache-control": "no-store",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return h;
}
function json(req: Request, b: any, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: {
      ...cors(req),
      "content-type": "application/json; charset=utf-8",
    },
  });
}
async function secure(req: Request) {
  const o = req.headers.get("origin") || "";
  if (!ORIGINS.has(o)) throw Error("Origen no autorizado");
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(h.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });
  const uid = String(payload.sub || "");
  if (!uid) throw Error("Identidad Firebase no válida");
  const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
    { data: u, error } = await db
      .from("app_usuarios")
      .select("id,email,rol,itinerarios,activo,firebase_uid")
      .eq("firebase_uid", uid)
      .maybeSingle();
  if (error) throw error;
  if (
    !u ||
    !u.activo ||
    !["ADMIN", "EDITOR"].includes(u.rol) ||
    !u.itinerarios?.includes("CEMENTO")
  )
    throw Error("Se requiere acceso operativo a CEMENTO");
  return { db, email: String(u.email || "").toLowerCase() };
}
async function registrarEgress(db: any, email: string, servicio: string, bytes: number) {
  try {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    await db.from("app_egress_log").insert({
      itinerario: "CEMENTO", servicio, bytes: Math.round(bytes), usuario: email
    });
  } catch (e) {
    console.warn("No se pudo registrar egress PRUEBA 17", e);
  }
}
const masterKey = (value: unknown) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]/g, "");
async function enrichWithMaster(db: any, rows: any[]) {
  const sapByOc = new Map<string, any>();
  const orders = [...new Set(rows.map((row) => String(row.orden_carga || "").trim()).filter(Boolean))];
  for (let i = 0; i < orders.length; i += 100) {
    const { data, error } = await db.from("sap_registros_staging")
      .select("orden_carga,payload").eq("itinerario", "CEMENTO")
      .in("orden_carga", orders.slice(i, i + 100));
    if (error) throw error;
    for (const row of data || []) sapByOc.set(String(row.orden_carga), row.payload || {});
  }
  return rows.map((row) => {
    const payload = { ...(row.payload || {}) };
    const plate = masterKey(payload["Placa Tracto"] || payload.TRACTO);
    if (Object.hasOwn(GESTOR_POR_PLACA, plate)) payload.GESTOR = GESTOR_POR_PLACA[plate] || "";
    const sap = sapByOc.get(String(row.orden_carga)) || {};
    const license = masterKey(sap.LicencCond);
    const masterPhone = TELEFONOS_POR_LICENCIA[license];
    if (masterPhone) payload.Celular = masterPhone;
    else if (!has(payload.Celular) && has(sap["Teléfono"])) payload.Celular = sap["Teléfono"];
    return { ...row, payload };
  });
}
const has = (v: any) =>
  v !== null &&
  v !== undefined &&
  !new Set(["", "-", "NONE", "NULL", "NAN", "NAT"]).has(
    String(v).trim().toUpperCase(),
  );
const transit = (v: any) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .includes("TRANSITO");
const norm = (v: any) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
const routeRank = (value: any) => {
  const n = norm(value);
  if (n.includes("CARGADO")) return 2;
  if (n.includes("VACIO")) return 1;
  return 0;
};
const baseBucket = (value: any) => {
  const u = norm(value);
  if (!u) return null;
  if (u.includes("RACIEMSA")) return "RACIEMSA AREQUIPA";
  if (u.includes("YURA")) return "YURA";
  return null;
};
function trip(p: any) {
  const salida = has(p["FECHA DE SALIDA PLANTA YURA/CARACOTO"]),
    llegada = has(p["FECHA LLEGADA A DESTINO"]),
    inicio = has(p["FECHA INICIO DE RETORNO"]),
    fin = has(p["FECHA FIN DE RETORNO AQP/YURA/CRCT"]);
  if (inicio || fin) return "RETORNO";
  if (salida && llegada && !transit(p.ESTADO)) return "PARADA";
  return "IDA";
}
function signature(rows: any[]) {
  const raw = rows
      .map((x) => `${x.id}|${x.orden_carga}|${JSON.stringify(x.payload || {})}`)
      .join("\n"),
    bytes = new TextEncoder().encode(raw);
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((x) =>
      [...new Uint8Array(x)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
}
function value(p: any, col: string) {
  if (col === "ITEM") return null;
  if (col === "Viaje") return trip(p);
  if (DURATION_COLUMNS.has(col)) return calculatedDuration(p, col);
  return p[REPORT_SOURCE[col] || col] ?? null;
}
function summary(rows: any[]) {
  const by: Record<string, { cargadas: number; vacias: number }> = {},
    bases: Record<string, { cargadas: number; vacias: number }> = {},
    other: Record<string, number> = {};
  let still = 0,
    totalAsignadas = 0,
    totalCargadas = 0,
    totalVacias = 0;
  for (const r of rows) {
    const p = r.payload || {};
    if (!has(p.TRACTO)) continue;
    const estado = norm(p.ESTADO);
    const route = String(p.Ruta || "SIN RUTA").trim() || "SIN RUTA";
    const rank = routeRank(estado);
    if (rank === 2 || rank === 1) {
      by[route] ||= { cargadas: 0, vacias: 0 };
      if (rank === 2) {
        by[route].cargadas++;
        totalCargadas++;
      } else {
        by[route].vacias++;
        totalVacias++;
      }
      totalAsignadas++;
    } else if (!estado || estado === "-" || estado === "(EN BLANCO)" || estado === "SIN MOVIMIENTO") {
      still++;
    } else {
      other[String(p.ESTADO || "SIN ESTADO")] =
        (other[String(p.ESTADO || "SIN ESTADO")] || 0) + 1;
    }
    const base = baseBucket(p["UBICACIÓN"]);
    if (base && rank > 0) {
      bases[base] ||= { cargadas: 0, vacias: 0 };
      if (rank === 2) bases[base].cargadas++;
      else bases[base].vacias++;
    }
  }
  const rutas = Object.keys(by)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
    .map((ruta) => ({ ruta, ...by[ruta], total: by[ruta].cargadas + by[ruta].vacias }));
  const baseRows = Object.keys(bases)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
    .map((base) => ({ base, ...bases[base], total: bases[base].cargadas + bases[base].vacias }));
  return {
    rutas,
    bases: baseRows,
    total_en_base: baseRows.reduce((a, x) => a + x.total, 0),
    total_cargadas: totalCargadas,
    total_vacias: totalVacias,
    total_asignadas: totalAsignadas,
    sin_movimiento: still,
    otros_estados: other,
  };
}
function asDate(v: any) {
  if (!has(v)) return v;
  const text = String(v).trim(), match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const d = match
    ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0))
    : new Date(text);
  return Number.isNaN(d.getTime()) ? v : d;
}
function dateMillis(v: any) {
  const d = asDate(v);
  return d instanceof Date ? d.getTime() : NaN;
}
function calculatedDuration(p: any, col: string) {
  const salida = dateMillis(p["FECHA DE SALIDA PLANTA YURA/CARACOTO"]),
    llegada = dateMillis(p["FECHA LLEGADA A DESTINO"]),
    inicio = dateMillis(p["FECHA INICIO DE RETORNO"]),
    fin = dateMillis(p["FECHA FIN DE RETORNO AQP/YURA/CRCT"]);
  const pairs: Record<string, [number, number]> = {
    "Tiempo Total de Ida": [salida, llegada],
    "Tiempo Total de Retorno": [inicio, fin],
    "Tiempo Total de Viaje": [salida, fin],
    "Tiempo antes de retorno": [llegada, inicio],
    "Tiempo de descarga": [llegada, inicio],
  };
  const [start, end] = pairs[col] || [NaN, NaN];
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return (end - start) / 86400000;
  return p[REPORT_SOURCE[col] || col] ?? null;
}
function asDuration(v: any) {
  if (!has(v)) return v;
  const s = String(v),
    m = s.match(/^(?:(\d+)\s+days?,\s*)?(\d+):(\d+):(\d+)$/i);
  return m
    ? (Number(m[1] || 0) * 86400 +
        Number(m[2]) * 3600 +
        Number(m[3]) * 60 +
        Number(m[4])) /
        86400
    : v;
}
function stampPE() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}`;
}
async function readTracking(db: any, origin: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("seguimiento_staging")
      .select("id,orden_carga,payload").eq("itinerario", "CEMENTO")
      .eq("origen", origin).order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}
async function readSap(db: any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("sap_registros_staging")
      .select("id,orden_carga,payload").eq("itinerario", "CEMENTO")
      .order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}
function rowsWithDriverMask(rows: any[]) {
  const cloned = rows.map((row) => ({ ...row, payload: { ...(row.payload || {}) } }));
  const groups = new Map<string, any[]>();
  for (const row of cloned) {
    const p = row.payload || {};
    const conductor = String(p.CONDUCTOR || "").trim();
    const tracto = String(p.TRACTO || "").trim();
    if (!has(conductor) || conductor === "-" || !has(tracto)) continue;
    const key = norm(conductor);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const items of groups.values()) {
    const tractos = new Set(items.map((row) => String(row.payload?.TRACTO || "").trim()).filter(Boolean));
    if (tractos.size <= 1) continue;
    const active = items.filter((row) => {
      const etapa = trip(row.payload || {});
      return etapa === "IDA" || etapa === "PARADA";
    });
    const candidates = active.length ? active : items;
    const keep = candidates.slice().sort((a, b) => {
      const da = dateMillis(a.payload?.["Fecha Carga Real"]),
        db = dateMillis(b.payload?.["Fecha Carga Real"]);
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return db - da;
      const oa = Number(a.orden_carga || 0),
        ob = Number(b.orden_carga || 0);
      return ob - oa;
    })[0];
    const keepTracto = String(keep.payload?.TRACTO || "").trim();
    for (const row of items) {
      const tracto = String(row.payload?.TRACTO || "").trim();
      if (tracto && tracto !== keepTracto) row.payload.CONDUCTOR = "-";
    }
  }
  return cloned;
}

async function workbook(rows: any[], report: boolean, archiveOrigin = "SEGUIMIENTO") {
  const dataRows = report ? rowsWithDriverMask(rows) : rows;
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet(
      report
        ? new Date()
            .toLocaleDateString("es-PE", {
              day: "2-digit",
              month: "2-digit",
              timeZone: "America/Lima",
            })
            .replace("/", "-") + " REPORTE"
        : archiveOrigin,
    ),
    cols = report ? REPORT_COLUMNS : ARCHIVE_COLUMNS;
  ws.addRow(cols);
  dataRows.forEach((r: any, i: number) => {
    const p = r.payload || {},
      vals = cols.map((c) => report
        ? (c === "ITEM" ? i + 1 : value(p, c))
        : (DURATION_COLUMNS.has(c) ? calculatedDuration(p, c) : (p[c] ?? null))),
      row = ws.addRow(vals);
    for (let j = 0; j < cols.length; j++) {
      const c = row.getCell(j + 1),
        name = cols[j];
      if (DATE_ONLY_COLUMNS.has(name) || DATE_TIME_COLUMNS.has(name)) {
        const d = asDate(c.value);
        if (d instanceof Date) {
          c.value = d;
          c.numFmt = DATE_ONLY_COLUMNS.has(name) ? "dd/mm/yyyy" : "dd/mm/yyyy hh:mm";
        }
      } else if (DURATION_COLUMNS.has(name)) {
        const n = asDuration(c.value);
        if (typeof n === "number") {
          c.value = n;
          c.numFmt = "[h]:mm";
        }
      } else if (name === "FECHA") c.numFmt = "dd/mm/yyyy";
      else if (name === "HORA") c.numFmt = "hh:mm";
      c.font = { name: "Arial", size: 8 };
      c.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      c.border = {
        top: { style: "thin", color: { argb: "FF7C8796" } },
        left: { style: "thin", color: { argb: "FF7C8796" } },
        bottom: { style: "thin", color: { argb: "FF7C8796" } },
        right: { style: "thin", color: { argb: "FF7C8796" } },
      };
    }
    if (report) {
      const c = row.getCell(2),
        t = String(c.value || "");
      c.font = { name: "Arial", size: 8, bold: true };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb:
            t === "IDA"
              ? "FFD9EAF7"
              : t === "PARADA"
                ? "FFFFF2CC"
                : t === "RETORNO"
                  ? "FFD9EAD3"
                  : "FFFFFFFF",
        },
      };
    }
  });
  const widths: Record<string, number> = {
    ITEM: 7,
    Viaje: 12,
    "Fecha Carga Real": 13,
    "Fecha de Orden": 13,
    "Orden de Carga": 13,
    CONDUCTOR: 30,
    Celular: 15,
    TRACTO: 12,
    "Placa Tracto": 13,
    "Código Carreta": 15,
    "Placa Carreta": 13,
    Ruta: 30,
    CARGA: 29,
    DESTINO: 28,
    PRESENTACION: 18,
    GESTOR: 14,
    "USUARIO SAP": 14,
    "FECHA DE SALIDA PLANTA YURA": 19,
    "FECHA LLEGADA A DESTINO": 19,
    "Tiempo Total de Ida": 14,
    "FECHA INICIO DE RETORNO": 19,
    "FECHA FIN DE RETORNO AQP/YURA/CRCT": 19,
    "Tiempo Total de Retorno": 14,
    "Tiempo Total de Viaje": 14,
    "Tiempo antes de retorno": 16,
    "CARGA DE RETORNO": 18,
    OBSERVACIONES: 28,
    FECHA: 12,
    HORA: 10,
    UBICACIÓN: 28,
    ESTADO: 18,
  };
  ws.columns.forEach(
    (c, i) =>
      (c.width = report
        ? widths[cols[i]] || 14
        : Math.max(12, Math.min(32, cols[i].length + 2))),
  );
  const header = ws.getRow(1);
  header.height = report ? 42 : 30;
  header.eachCell((c, i) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: report && i === 2 ? "FF173B75" : "FFA9B7C9" },
    };
    c.font = {
      name: "Arial",
      size: 9,
      bold: true,
      color: { argb: report && i === 2 ? "FFFFFFFF" : "FF000000" },
    };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = {
      top: { style: "thin", color: { argb: "FF7C8796" } },
      left: { style: "thin", color: { argb: "FF7C8796" } },
      bottom: { style: "thin", color: { argb: "FF7C8796" } },
      right: { style: "thin", color: { argb: "FF7C8796" } },
    };
  });
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: cols.length },
  };
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  return await wb.xlsx.writeBuffer();
}

async function sapWorkbook(rows: any[]) {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet("SAP_HISTORICO");
  ws.addRow(SAP_ARCHIVE_COLUMNS);
  for (const record of rows) {
    const payload = record.payload || {},
      row = ws.addRow(
        SAP_ARCHIVE_COLUMNS.map((column) =>
          column === "Ord Carga"
            ? (payload[column] ?? record.orden_carga ?? "")
            : (payload[column] ?? ""),
        ),
      );
    SAP_ARCHIVE_COLUMNS.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      if (SAP_DATE_COLUMNS.has(column)) {
        const date = asDate(cell.value);
        if (date instanceof Date) {
          cell.value = date;
          cell.numFmt = "dd/mm/yyyy";
        }
      }
      cell.font = { name: "Arial", size: 8 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF7C8796" } },
        left: { style: "thin", color: { argb: "FF7C8796" } },
        bottom: { style: "thin", color: { argb: "FF7C8796" } },
        right: { style: "thin", color: { argb: "FF7C8796" } },
      };
    });
  }
  ws.columns.forEach((column, index) => {
    const name = SAP_ARCHIVE_COLUMNS[index];
    column.width = ["Nombre Piloto", "Descripción Ruta", "Nombre Destino", "Observaciones", "Dirección Destino", "Material de Servicio"].includes(name)
      ? 30
      : Math.max(12, Math.min(22, name.length + 2));
  });
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9B7C9" } };
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF000000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF7C8796" } },
      left: { style: "thin", color: { argb: "FF7C8796" } },
      bottom: { style: "thin", color: { argb: "FF7C8796" } },
      right: { style: "thin", color: { argb: "FF7C8796" } },
    };
  });
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: SAP_ARCHIVE_COLUMNS.length },
  };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return await wb.xlsx.writeBuffer();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST")
    return json(req, { error: "Método no permitido" }, 405);
  try {
    const { db, email } = await secure(req),
      b = await req.json(),
      action = String(b.action || ""),
      origin = String(b.origen || "DIARIO").toUpperCase();
    if (action === "archivo") {
      if (!["SAP", "DIARIO", "HISTORICO"].includes(origin))
        throw Error("Archivo no permitido");
      let bytes: any, name: string;
      if (origin === "SAP") {
        bytes = await sapWorkbook(await readSap(db));
        name = "SAP_HISTORICO.xlsx";
      } else {
        const data = await readTracking(db, origin);
        const enriched = await enrichWithMaster(db, data);
        bytes = await workbook(enriched, false, origin);
        name = `SEGUIMIENTO_${origin}.xlsx`;
      }
      await registrarEgress(db, email, `ARCHIVO_${origin}`, Number((bytes as any)?.byteLength || (bytes as any)?.length || 0));
      return new Response(bytes as BodyInit, {
        headers: {
          ...cors(req),
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename=\"${name}\"`,
        },
      });
    }
    const [rows, { data: sessionRows, error: de }] =
      await Promise.all([
        readTracking(db, "DIARIO"),
        db
          .from("seguimiento_sesion_web")
          .select("accion,cambios,revisada")
          .eq("itinerario", "CEMENTO")
          .eq("usuario", email),
      ]);
    if (de) throw de;
    const pendingDrafts = (sessionRows || []).filter(
        (x: any) =>
          String(x.accion || "").toUpperCase() === "CERRAR" ||
          Object.keys(x.cambios || {}).length > 0,
      ).length,
      firma = await signature(rows),
      { data: control, error: ce } = await db
        .from("cemento_reporte_control")
        .select("estado,total_placas,revisadas,placas_revisadas,firma_diario,completado_en")
        .eq("itinerario", "CEMENTO")
        .maybeSingle();
    if (ce) throw ce;
    const currentPlates = new Set(
        rows
          .map((r: any) =>
            String(r.payload?.["Placa Tracto"] || r.payload?.TRACTO || "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, ""),
          )
          .filter(Boolean),
      ).size,
      validCut =
        !!control &&
        ["PARCIAL", "COMPLETO"].includes(String(control.estado || "")) &&
        control.firma_diario === firma,
      enabled = validCut && pendingDrafts === 0;
    if (action === "estado") {
      let mensaje = "Guarde un corte parcial o termine el seguimiento para generar el reporte";
      if (pendingDrafts > 0)
        mensaje = "Hay cambios posteriores al último corte. Use GUARDAR PARCIAL para incluirlos en el reporte";
      else if (control && control.firma_diario !== firma)
        mensaje = "La data diaria cambió después del último corte. Guarde un nuevo corte parcial";
      else if (enabled && control?.estado === "PARCIAL")
        mensaje = `Seguimiento parcial guardado: ${control.revisadas}/${control.total_placas} placas revisadas`;
      else if (enabled)
        mensaje = "Seguimiento completo guardado";
      return json(req, {
        habilitado: enabled,
        estado: control?.estado || null,
        parcial: control?.estado === "PARCIAL",
        total_placas: control?.total_placas || currentPlates,
        revisadas: control?.revisadas || 0,
        placas_revisadas: control?.placas_revisadas || [],
        diario: rows.length,
        pendientes_sin_guardar: pendingDrafts,
        completado_en: control?.completado_en || null,
        mensaje,
      });
    }
    if (!enabled)
      return json(
        req,
        {
          error:
            "CREAR REPORTE requiere un corte válido. Use GUARDAR PARCIAL o TERMINAR SEGUIMIENTO; no es obligatorio revisar el 100% para un reporte parcial.",
        },
        409,
      );
    if (action === "datos")
      return json(req, {
        nombre_excel: `REPORTE_CEMENTO_${stampPE()}.xlsx`,
        resumen: summary(rows),
        revision: {
          estado: control?.estado || null,
          revisadas: control?.revisadas || 0,
          total_placas: control?.total_placas || currentPlates,
          corte_en: control?.completado_en || null,
        },
      });
    if (action === "excel") {
      const enriched = await enrichWithMaster(db, rows);
      const bytes = await workbook(enriched, true),
        name = `MONITOREO_CEMENTO_${stampPE()}.xlsx`;
      await registrarEgress(db, email, "REPORTE_EXCEL", Number((bytes as any)?.byteLength || (bytes as any)?.length || 0));
      return new Response(bytes as BodyInit, {
        headers: {
          ...cors(req),
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename=\"${name}\"`,
        },
      });
    }
    return json(req, { error: "Acción no encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json(req, { error: e instanceof Error ? e.message : "Error" }, 400);
  }
});
