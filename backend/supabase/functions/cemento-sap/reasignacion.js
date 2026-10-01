export const CAMPOS_HORAS_SEGUIMIENTO = Object.freeze([
  "FECHA DE SALIDA PLANTA YURA/CARACOTO",
  "FECHA LLEGADA A DESTINO",
  "FECHA INICIO DE RETORNO",
  "FECHA FIN DE RETORNO AQP/YURA/CRCT",
]);

const clean = (value) => String(value ?? "")
  .replace(/\u00a0/g, " ")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toUpperCase();

const plate = (value) => clean(value).replace(/[^A-Z0-9]/g, "");

const dateOnly = (value) => {
  const text = clean(value);
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
};

export function tieneHorasSeguimiento(payload) {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return CAMPOS_HORAS_SEGUIMIENTO.some((field) => clean(row[field]) !== "");
}

export function firmaAsignacionSap(payload) {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return [
    clean(row["Ord Carga"]),
    dateOnly(row.FecIniReal || row["Creado el"]),
    clean(row.LicencCond) || clean(row["Nombre Piloto"]),
    plate(row["Matrícula"]),
    plate(row.PlacaAcop1),
  ].join("\u001f");
}

export function clasificarOc({ sapAnterior, seguimiento, sapActual }) {
  if (!sapAnterior && !seguimiento) return "NUEVA";
  if (seguimiento?.origen === "DIARIO") return "ABIERTA_EXISTENTE";
  if (seguimiento?.origen !== "HISTORICO") return "SIN_SEGUIMIENTO_EXISTENTE";
  if (firmaAsignacionSap(sapAnterior?.payload) === firmaAsignacionSap(sapActual)) {
    return "CERRADA_SIN_CAMBIOS";
  }
  return tieneHorasSeguimiento(seguimiento.payload)
    ? "REABRIR_CON_INFORMACION"
    : "REASIGNAR_VACIA";
}
