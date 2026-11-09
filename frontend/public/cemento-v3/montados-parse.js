/**
 * Parser de guías de Montados (Cemento).
 * Pegado desde Excel (Ctrl+V, columnas separadas por tab).
 *
 * Convención operativa:
 *   1ª unidad  = ACOPLE CORTO  = MONTADO
 *   2ª unidad  = ACOPLE LARGO  = TRANSPORTA (montando a)
 *   Fecha      = celda justo antes de RUTA REALIZADA
 */

function clean(v) {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strip(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function parseUnit(v) {
  const x = strip(clean(v))
    .toUpperCase()
    .replace(/\./g, "");
  const m = x.match(
    /(?:20\s*[- ]?\s*)?R\s*[- ]?\s*(\d+)\s*\/\s*(?:20\s*[- ]?\s*)?P\s*[- ]?\s*(\d+)/,
  );
  if (!m) return null;
  return {
    tracto: "20-R-" + Number(m[1]),
    acople: "20-P-" + Number(m[2]),
  };
}

function normRuta(v) {
  return strip(clean(v))
    .toUpperCase()
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function isRuta(v) {
  const x = normRuta(v);
  return x && /^[A-Z0-9 ]+\s-\s[A-Z0-9 /]+$/.test(x);
}

export function fechaTexto(v) {
  const x = clean(v);
  let m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return (
      String(Number(m[1])).padStart(2, "0") +
      "/" +
      String(Number(m[2])).padStart(2, "0") +
      "/" +
      m[3]
    );
  }
  m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return null;
}

/** YYYY-MM-DD for API */
export function fechaIso(v) {
  const x = clean(v);
  let m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  }
  return null;
}

function parseOc(v) {
  const x = clean(v).replace(/\s/g, "");
  if (!/^(?:0|\d{5,7})$/.test(x) || x === "0") return null;
  return x;
}

/**
 * @returns {{ number, fecha, ruta, corto, largo, ocCorto, ocLargo, guia, errores, valida, duplicada? }}
 */
export function parseRow(line, number) {
  const cells = String(line).split("\t").map(clean);
  const routeIndex = cells.findIndex(isRuta);
  const ruta = routeIndex >= 0 ? normRuta(cells[routeIndex]) : "";
  const fecha = routeIndex > 0 ? fechaTexto(cells[routeIndex - 1]) : null;

  const units = [];
  cells.forEach((cell, index) => {
    const u = parseUnit(cell);
    if (u) units.push({ index, ...u });
  });

  const corto = units[0] || null; // MONTADO
  const largo = units[1] || null; // TRANSPORTA / montando a

  const ocs = [];
  if (routeIndex >= 0) {
    const stop = corto ? corto.index : cells.length;
    for (let i = routeIndex + 1; i < stop; i++) {
      const x = cells[i].replace(/\s/g, "");
      if (/^(?:0|\d{5,7})$/.test(x)) ocs.push(x);
    }
  }

  const ocCorto = ocs.length >= 1 ? parseOc(ocs[0]) : null;
  const ocLargo = ocs.length >= 2 ? parseOc(ocs[1]) : null;

  let guia = null;
  if (largo && largo.index + 1 < cells.length) {
    const x = clean(cells[largo.index + 1]);
    if (x && x !== "0" && x !== ".") guia = x;
  }

  const errores = [];
  if (!fecha) errores.push("FECHA");
  if (!ruta) errores.push("RUTA");
  if (!corto) errores.push("ACOPLE CORTO");
  if (!largo) errores.push("ACOPLE LARGO");

  return {
    number,
    fecha,
    ruta,
    corto,
    largo,
    ocCorto,
    ocLargo,
    guia,
    errores,
    valida: errores.length === 0,
    duplicada: false,
  };
}

export function parsePaste(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map((line, index) => parseRow(line, index + 1));

  const seen = new Set();
  rows.forEach((r) => {
    r.duplicada = false;
    if (!r.valida) return;
    const key = [r.fecha, r.ruta, r.largo.tracto, r.corto.tracto].join("|");
    if (seen.has(key)) r.duplicada = true;
    else seen.add(key);
  });
  return rows;
}

/** Filas listas para action:guardar */
export function toSavePayload(validRows) {
  return validRows.map((r) => ({
    fecha: fechaIso(r.fecha),
    ruta: r.ruta,
    tracto_largo: r.largo.tracto,
    acople_largo: r.largo.acople || null,
    tracto_corto: r.corto.tracto,
    acople_corto: r.corto.acople || null,
    oc_largo: r.ocLargo,
    oc_corto: r.ocCorto,
    guia: r.guia,
  }));
}
