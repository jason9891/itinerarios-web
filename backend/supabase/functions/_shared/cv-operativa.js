export const text = (v) => String(v ?? "").trim();
export const norm = (v) => text(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export const normPlate = (v) => norm(v).replace(/[^A-Z0-9]/g, "");
export const key = (v) => text(v).replace(/\.0+$/, "").trim();

export function plateOf(p = {}) {
  const raw = text(p["PLACA TRACTO"] || p.Placa || p.PLACA);
  return normPlate(raw.includes("/") ? raw.split("/", 1)[0] : raw);
}

export function parseDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = text(v);
  if (!s || s === "-") return null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const fmtLocal = (v) => {
  const d = parseDate(v);
  if (!d) return text(v);
  const z = (n) => String(n).padStart(2, "0");
  return `${z(d.getUTCDate())}/${z(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
};

export function cycleAnchor(p = {}) {
  const fields = [
    "TIMESTAMP INGRESO SAP",
    "TIMESTAMP SALIDA SAP",
    "FECHA DE CARGA",
    "LLEGADA A CARACOTO",
    "SALIDA DE CARACOTO",
    "ENTREGA SAP",
  ];
  for (const f of fields) {
    const d = parseDate(p[f]);
    if (d) return d.getTime();
  }
  return 0;
}

export function dateReference(p = {}) {
  const fields = [
    "LLEGADA A BASE RACIEMSA VACIO",
    "SALIDA DE SMCV",
    "INGRESO A SMCV",
    "SALIDA DE BASE RACIEMSA CARGADO",
    "LLEGADA A BASE RACIEMSA",
    "SALIDA DE CARACOTO",
    "SALIDA DE CARGUIO",
    "INGRESO A CARGUIO",
    "LLEGADA A CARACOTO",
    "SALIDA DE BASE RACIEMSA",
    "TIMESTAMP SALIDA SAP",
    "FECHA DE CARGA",
  ];
  let best = 0;
  for (const f of fields) {
    const d = parseDate(p[f]);
    if (d && d.getTime() > best) best = d.getTime();
  }
  return best;
}

export function derivedState(p = {}) {
  const explicit = norm(p.ESTADO);
  if (explicit && explicit !== "FIN DE CICLO") return explicit;
  const has = (f) => !!parseDate(p[f]);
  if (has("LLEGADA A BASE RACIEMSA VACIO")) return "ESTACIONADO VACIO";
  if (has("SALIDA DE SMCV")) return "TRANSITO VACIO";
  if (has("INGRESO A SMCV")) return "PROCESO DE DESCARGUIO";
  if (has("SALIDA DE BASE RACIEMSA CARGADO")) return "TRANSITO CARGADO";
  if (has("LLEGADA A BASE RACIEMSA")) return "ESTACIONADO CARGADO";
  if (has("SALIDA DE CARACOTO") || has("SALIDA DE CARGUIO")) return "TRANSITO CARGADO";
  if (has("LLEGADA A CARACOTO") || has("INGRESO A CARGUIO")) return "ESTACIONADO VACIO";
  if (has("SALIDA DE BASE RACIEMSA")) return "TRANSITO VACIO";
  return explicit === "FIN DE CICLO" ? "ESTACIONADO VACIO" : "";
}

export function reportGroup(p = {}) {
  const explicit = norm(p.SECCION_REPORTE || p["SECCION REPORTE"]);
  if (explicit.includes("CARGADO")) return "CARGADO";
  if (explicit.includes("VACIO")) return "VACIO";
  const s = norm(derivedState(p));
  if (s.includes("CARGADO") || s.includes("DESCARGUIO")) return "CARGADO";
  if (s.includes("VACIO")) return "VACIO";
  const events = [
    ["LLEGADA A BASE RACIEMSA VACIO", "VACIO"],
    ["SALIDA DE SMCV", "VACIO"],
    ["INGRESO A SMCV", "CARGADO"],
    ["SALIDA DE BASE RACIEMSA CARGADO", "CARGADO"],
    ["LLEGADA A BASE RACIEMSA", "CARGADO"],
    ["SALIDA DE CARACOTO", "CARGADO"],
    ["SALIDA DE CARGUIO", "CARGADO"],
    ["INGRESO A CARGUIO", "VACIO"],
    ["LLEGADA A CARACOTO", "VACIO"],
    ["SALIDA DE BASE RACIEMSA", "VACIO"],
  ];
  for (const [f, g] of events) if (parseDate(p[f])) return g;
  return "VACIO";
}

export function closeReportState(p = {}) {
  const events = [
    ["SALIDA DE BASE RACIEMSA", "VACIO"],
    ["LLEGADA A CARACOTO", "VACIO"],
    ["INGRESO A CARGUIO", "VACIO"],
    ["SALIDA DE CARGUIO", "CARGADO"],
    ["SALIDA DE CARACOTO", "CARGADO"],
    ["LLEGADA A BASE RACIEMSA", "CARGADO"],
    ["SALIDA DE BASE RACIEMSA CARGADO", "CARGADO"],
    ["INGRESO A SMCV", "CARGADO"],
    ["SALIDA DE SMCV", "VACIO"],
    ["LLEGADA A BASE RACIEMSA VACIO", "VACIO"],
  ];
  let last = null;
  for (const [f, c] of events) {
    const d = parseDate(p[f]);
    if (d && (!last || d.getTime() > last.t)) last = { t: d.getTime(), cond: c, field: f };
  }
  let cond = last?.cond || "";
  const s = norm(p.ESTADO);
  if (!cond) {
    if (s.includes("VACIO")) cond = "VACIO";
    else if (s.includes("CARGADO") || s.includes("DESCARG")) cond = "CARGADO";
    else cond = "VACIO";
  }
  let state = derivedState(p);
  if (cond === "CARGADO" && !(state.includes("CARGADO") || state.includes("DESCARG"))) state = "ESTACIONADO CARGADO";
  if (cond === "VACIO" && !state.includes("VACIO")) state = "ESTACIONADO VACIO";
  return {
    condicion: cond,
    grupo_reporte: `CAL ${cond}`,
    estado_base: state || `ESTACIONADO ${cond}`,
    origen_condicion: last ? `HITO:${last.field}` : "ESTADO/FALLBACK",
  };
}

export function activeGroupRows(rows = []) {
  const byPlate = new Map();
  for (const r of rows) {
    if (r?.activo === false) continue;
    const p = r?.payload || {};
    const plate = normPlate(p.PLACA_TRACTO || p["PLACA TRACTO"] || p.Placa || p.PLACA);
    if (!plate) continue;
    const old = byPlate.get(plate);
    if (!old || new Date(r.actualizado_en || 0).getTime() >= new Date(old.actualizado_en || 0).getTime()) byPlate.set(plate, r);
  }
  return [...byPlate.values()];
}

export function reportRowFromGroup(g = {}) {
  const p = g.payload || g;
  const group = norm(p.SECCION_REPORTE || p["SECCION REPORTE"]).includes("CARGADO") ? "CARGADO" : "VACIO";
  const fallback = p.SNAPSHOT_CICLO || p.snapshot_ciclo || {};
  const h = [1, 2, 3, 4].map((i) => text(p[`HITO_${i}_REPORTE`]) || "");
  let fields;
  if (group === "CARGADO") fields = ["SALIDA DE CARACOTO", "LLEGADA A BASE RACIEMSA", "SALIDA DE BASE RACIEMSA CARGADO", "INGRESO A SMCV"];
  else fields = ["SALIDA DE BASE RACIEMSA", "LLEGADA A CARACOTO", "SALIDA DE SMCV", "LLEGADA A BASE RACIEMSA VACIO"];
  const hitos = fields.map((f, i) => h[i] && h[i] !== "-" ? h[i] : text(fallback[f]) || "-");
  return {
    grupo: group,
    conductor: text(p.CONDUCTOR_REPORTE) || text(p.CONDUCTOR) || "-",
    tracto: text(p.CODIGO_TRACTO || p["CODIGO TRACTO"]) || "-",
    carreta: text(p.CODIGO_CARRETA || p["CODIGO CARRETA"]) || "-",
    h1: hitos[0] || "-",
    h2: hitos[1] || "-",
    h3: hitos[2] || "-",
    h4: hitos[3] || "-",
    estado: text(p.ESTADO) || derivedState(fallback) || "-",
    monitoreo: text(p.MONITOREO) || "-",
    observacion: text(p.OBSERVACION) || "-",
    placa: normPlate(p.PLACA_TRACTO || p["PLACA TRACTO"] || fallback["PLACA TRACTO"] || fallback.PLACA),
  };
}

export function reportSort(a, b) {
  return norm(a.estado).localeCompare(norm(b.estado)) || norm(a.tracto).localeCompare(norm(b.tracto), undefined, { numeric: true });
}

export function reportSnapshotFromCycle(p = {}, forcedSection = "") {
  const section = forcedSection || `CAL ${reportGroup(p)}`;
  const loaded = norm(section).includes("CARGADO");
  const fields = loaded
    ? ["SALIDA DE CARACOTO", "LLEGADA A BASE RACIEMSA", "SALIDA DE BASE RACIEMSA CARGADO", "INGRESO A SMCV"]
    : ["SALIDA DE BASE RACIEMSA", "LLEGADA A CARACOTO", "SALIDA DE SMCV", "LLEGADA A BASE RACIEMSA VACIO"];
  const snap = {
    SECCION_REPORTE: loaded ? "CAL CARGADO" : "CAL VACIO",
    ESTADO: derivedState(p),
    MONITOREO: text(p.MONITOREO),
    OBSERVACION: text(p.OBSERVACION),
    SNAPSHOT_CICLO: p,
  };
  fields.forEach((f, i) => { snap[`HITO_${i + 1}_REPORTE`] = text(p[f]) || "-"; });
  return snap;
}
