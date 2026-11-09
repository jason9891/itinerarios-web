/**
 * Parser SAP de CEMENTO (extraído de producción).
 * Solo Cemento — no usar en Cerro Verde.
 */
export const SAP_WINDOW_DAYS = 7;

export const SAP_COLUMNS = [
  "FecIniReal","Ord Carga","UsuCrea OCRG","Creado el","Destino","Ruta",
  "Proveedor Transporte","Teléfono","Nombre Piloto","LicencCond","Equipo",
  "Matrícula","Acoplado 1","PlacaAcop1","Descripción Ruta","Nombre Destino",
  "Observaciones","por","UMP","Neto","FechaCarga","Estado","Material",
  "Material de Servicio","Tipo Presentación","Dirección Destino","Cliente",
  "Nom Client","CE","GESTOR",
];
const DATE_SAP = new Set(["FecIniReal", "Creado el", "FechaCarga"]);
const headerKey = (v) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
const SAP_ALIASES = new Map([
  ["FECINIREAL","FecIniReal"],["ORDCARGA","Ord Carga"],["USUCREAOCRG","UsuCrea OCRG"],
  ["USCREAOCRG","UsuCrea OCRG"],["CREADOEL","Creado el"],["DESTINO","Destino"],
  ["RUTA","Ruta"],["PROVEEDORTRANSPORTE","Proveedor Transporte"],["PROVTRANSP","Proveedor Transporte"],
  ["TELEFONO","Teléfono"],["NOMBREPILOTO","Nombre Piloto"],["LICENCCOND","LicencCond"],
  ["EQUIPO","Equipo"],["MATRICULA","Matrícula"],["ACOPLADO1","Acoplado 1"],
  ["PLACAACOP1","PlacaAcop1"],["DESCRIPCIONRUTA","Descripción Ruta"],["NOMBREDESTINO","Nombre Destino"],
  ["OBSERVACIONES","Observaciones"],["POR","por"],["NOGRR","por"],["UMP","UMP"],["NETO","Neto"],
  ["FECHACARGA","FechaCarga"],["ESTADO","Estado"],["MATERIAL","Material"],
  ["MATERIALDESERVICIO","Material de Servicio"],["TIPOPRESENTACION","Tipo Presentación"],
  ["DIRECCIONDESTINO","Dirección Destino"],["CLIENTE","Cliente"],["DEUDOR","Cliente"],
  ["NOMCLIENT","Nom Client"],["CE","CE"],["GESTOR","GESTOR"],
]);
export function excelColumnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "A";
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

export function xmlElements(node, name) {
  return [...node.getElementsByTagName("*")].filter(
    (x) => x.localName === name,
  );
}

export function excelSerialDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return d.toISOString().slice(0, 10) + "T00:00:00";
}

export function normalizeSapDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || /^\d{5}(?:\.\d+)?$/.test(String(value)))
    return excelSerialDate(value);
  const s = String(value).trim(),
    m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return m
    ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00`
    : s;
}

export async function parseXlsx(buffer) {
  if (!window.JSZip) throw Error("No se cargó el lector Excel local");
  const zip = await JSZip.loadAsync(buffer),
    shared = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const doc = new DOMParser().parseFromString(
      await sharedFile.async("string"),
      "application/xml",
    );
    for (const si of xmlElements(doc, "si"))
      shared.push(
        xmlElements(si, "t")
          .map((x) => x.textContent || "")
          .join(""),
      );
  }
  const workbook = zip.file("xl/workbook.xml"),
    rels = zip.file("xl/_rels/workbook.xml.rels");
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (workbook && rels) {
    const wdoc = new DOMParser().parseFromString(
        await workbook.async("string"),
        "application/xml",
      ),
      rdoc = new DOMParser().parseFromString(
        await rels.async("string"),
        "application/xml",
      ),
      sheet = xmlElements(wdoc, "sheet")[0],
      rid =
        sheet?.getAttribute("r:id") ||
        sheet?.getAttributeNS(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "id",
        ),
      rel = xmlElements(rdoc, "Relationship").find(
        (x) => x.getAttribute("Id") === rid,
      ),
      target = rel?.getAttribute("Target");
    if (target)
      sheetPath = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw Error("El Excel no contiene una hoja legible");
  const doc = new DOMParser().parseFromString(
      await sheetFile.async("string"),
      "application/xml",
    ),
    rows = [];
  for (const row of xmlElements(doc, "row")) {
    const values = [];
    for (const c of [...row.children].filter((x) => x.localName === "c")) {
      const index = excelColumnIndex(c.getAttribute("r")),
        type = c.getAttribute("t") || "",
        v = xmlElements(c, "v")[0]?.textContent ?? "",
        inline = xmlElements(c, "t")
          .map((x) => x.textContent || "")
          .join("");
      values[index] =
        type === "s"
          ? (shared[Number(v)] ?? "")
          : type === "inlineStr"
            ? inline
            : type === "b"
              ? v === "1"
              : v !== "" && Number.isFinite(Number(v))
                ? Number(v)
                : v;
    }
    rows.push(values);
  }
  return rows;
}

export function parseSapText(buffer) {
  const text = new TextDecoder("windows-1252").decode(buffer);
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((row) => row.some((v) => String(v).trim()));
}

export async function parseSapFile(file) {
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    hash = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join(""),
    rows = file.name.toLowerCase().endsWith(".xlsx")
      ? await parseXlsx(buffer)
      : parseSapText(buffer);
  const hi = rows.findIndex((r) => r.some((v) => headerKey(v) === "ORDCARGA"));
  if (hi < 0)
    throw Error("No se encontró la columna Ord Carga en el archivo SAP");
  const headers = rows[hi].map((v) => SAP_ALIASES.get(headerKey(v)) || ""),
    seen = new Set(),
    records = [],
    duplicates = [];
  for (const row of rows.slice(hi + 1)) {
    const p = {};
    headers.forEach((h, i) => {
      if (!h || !SAP_COLUMNS.includes(h)) return;
      let v = row[i] ?? "";
      if (DATE_SAP.has(h)) v = normalizeSapDate(v);
      p[h] = typeof v === "string" ? v.trim() : v;
    });
    const oc = String(p["Ord Carga"] ?? "")
      .replace(/\.0$/, "")
      .trim();
    if (!oc) continue;
    p["Ord Carga"] = oc;
    if (seen.has(oc)) {
      duplicates.push(oc);
      continue;
    }
    seen.add(oc);
    records.push(p);
  }
  if (!records.length)
    throw Error("El archivo no contiene órdenes de carga válidas");
  return {
    nombre: file.name,
    tamano: file.size,
    hash,
    filas_archivo: rows.length,
    encabezados: headers.filter(Boolean),
    registros: records,
    duplicadas: [...new Set(duplicates)],
  };
}

export function sapTextKey(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function sapDateKey(value) {
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

export function limaTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date()),
    p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function shiftDateKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

