import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import seed from "./seed/MAESTRO_GEOCERCAS.json" with { type: "json" };

const PROJECT = "itinerarios-2fa6f";
const DETAIL_VERSION = "VERSION_2";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
const TYPES = ["geocercas", "rutas_madre", "geocerca_tramo"] as const;
type MasterType = (typeof TYPES)[number];
const ITINERARIES = ["CEMENTO", "CERRO VERDE", "TURNO AMANECIDA"];

function reply(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw Error("Origen no autorizado");
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(auth.slice(7), JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${PROJECT}`,
    audience: PROJECT,
  });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: user, error } = await db
    .from("app_usuarios")
    .select("email,rol,itinerarios,activo")
    .eq("firebase_uid", String(payload.sub || ""))
    .maybeSingle();
  if (error) throw error;
  if (!user?.activo)
    throw Error("Cuenta inactiva o sin acceso a la plataforma");
  return { db, user };
}

function pointOk(point: unknown) {
  if (!Array.isArray(point) || point.length < 2) return false;
  const lng = Number(point[0]);
  const lat = Number(point[1]);
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}
function lineOk(value: unknown, min = 2): boolean {
  return Array.isArray(value) && value.length >= min && value.every(pointOk);
}
function geometryOk(g: any, type: MasterType): boolean {
  if (!g || typeof g !== "object") return false;
  const c = g.coordinates;
  if (type === "rutas_madre")
    return g.type === "LineString"
      ? lineOk(c)
      : g.type === "MultiLineString" &&
          Array.isArray(c) &&
          c.length > 0 &&
          c.every((x: unknown) => lineOk(x));
  return g.type === "Polygon"
    ? Array.isArray(c) && c.length > 0 && c.every((x: unknown) => lineOk(x, 3))
    : g.type === "MultiPolygon" &&
        Array.isArray(c) &&
        c.length > 0 &&
        c.every(
          (p: unknown) =>
            Array.isArray(p) &&
            p.length > 0 &&
            p.every((x: unknown) => lineOk(x, 3)),
        );
}
function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}
function cleanCopyName(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s*[-–—]?\s*COPIA\s*$/i, "")
    .trim();
}

function normalizeMaster(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Maestro inválido");

  const objects: Record<MasterType, any[]> = {
    geocercas: [],
    rutas_madre: [],
    geocerca_tramo: [],
  };
  const ids = new Set<string>();
  const typeById = new Map<string, MasterType>();

  for (const type of TYPES) {
    const source = Array.isArray(raw.objetos?.[type]) ? raw.objetos[type] : [];
    objects[type] = source.map((item: any, index: number) => {
      if (!geometryOk(item?.geometry, type))
        throw Error(`${type}: geometría inválida en ${item?.name || index + 1}`);
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!id) throw Error(`${type}: falta identificador interno`);
      if (ids.has(id)) throw Error(`Identificador maestro duplicado: ${id}`);
      if (!name) throw Error(`${id}: falta nombre maestro`);
      ids.add(id);
      typeById.set(id, type);
      return {
        ...item,
        id,
        name,
        kind:
          type === "rutas_madre"
            ? "ruta_madre"
            : type === "geocerca_tramo"
              ? "geocerca_tramo"
              : "geocerca",
      };
    });
  }

  const assignments: Record<string, any[]> = {};
  for (const itinerary of ITINERARIES) {
    const seen = new Set<string>();
    const operationalNames = new Set<string>();
    assignments[itinerary] = (
      Array.isArray(raw.asignaciones?.[itinerary])
        ? raw.asignaciones[itinerary]
        : []
    ).map((a: any) => {
      const masterId = String(a.maestro_id || "").trim();
      const type = String(a.tipo || "geocercas") as MasterType;
      const key = `${itinerary}|${masterId}`;
      if (!TYPES.includes(type)) throw Error(`Tipo de asignación inválido: ${type}`);
      if (!ids.has(masterId)) throw Error(`Asignación sin maestro: ${key}`);
      if (seen.has(key)) throw Error(`Asignación duplicada: ${key}`);
      if (typeById.get(masterId) !== type)
        throw Error(`${masterId}: la asignación no coincide con su tipo maestro`);
      seen.add(key);
      const master = objects[type].find((x) => x.id === masterId)!;
      const operationalName =
        cleanCopyName(a.nombre_operativo || master.name) || master.name;

      // Las rutas madre pueden compartir nombre físico/operativo. En geocercas sí
      // evitamos duplicados para que la identificación de zona sea inequívoca.
      if (type !== "rutas_madre" && a.activa !== false) {
        const nameKey = `${type}|${normalizeText(operationalName)}`;
        if (operationalNames.has(nameKey))
          throw Error(
            `Nombre operativo duplicado en ${itinerary}: ${operationalName}`,
          );
        operationalNames.add(nameKey);
      }
      return {
        maestro_id: masterId,
        nombre_operativo: operationalName,
        tipo: type,
        activa: a.activa !== false,
      };
    });
  }

  const normalized = {
    version: Math.max(Number(raw.version || 1), 3),
    detalle_version: DETAIL_VERSION,
    actualizado: new Date().toISOString(),
    origen: "EDITOR_MAESTRO_GEOCERCAS_WEB",
    reglas_motor_rutas: raw.reglas_motor_rutas || (seed as any).reglas_motor_rutas || {},
    objetos: objects,
    asignaciones: assignments,
  };
  if (
    new TextEncoder().encode(JSON.stringify(normalized)).byteLength >
    8 * 1024 * 1024
  )
    throw Error("El Maestro supera 8 MB");
  return normalized;
}

function upgradeMaster(raw: any) {
  const base = normalizeMaster(seed);
  const current = normalizeMaster(raw);
  const objetos: Record<MasterType, any[]> = {
    geocercas: [],
    rutas_madre: [],
    geocerca_tramo: [],
  };

  for (const type of TYPES) {
    const baseById = new Map(base.objetos[type].map((x: any) => [x.id, x]));
    objetos[type] = current.objetos[type].map((x: any) => ({
      ...(baseById.get(x.id) || {}),
      ...x,
      // La geometría editada por el usuario siempre gana. La base sólo aporta
      // metadatos/coverage productivos que 19.3 había perdido.
      geometry: x.geometry || baseById.get(x.id)?.geometry,
    }));
    const currentIds = new Set(objetos[type].map((x: any) => x.id));
    for (const x of base.objetos[type])
      if (!currentIds.has(x.id)) objetos[type].push(x);
  }

  const asignaciones: Record<string, any[]> = {};
  for (const itinerary of ITINERARIES) {
    const currentAssignments = (current.asignaciones[itinerary] || []).map(
      (a: any) => ({ ...a, nombre_operativo: cleanCopyName(a.nombre_operativo) }),
    );
    const keys = new Set(currentAssignments.map((a: any) => `${a.tipo}|${a.maestro_id}`));

    // DETALLES_1 agrega a CEMENTO la red que 19.3 impedía publicar. No se
    // reactivan geocercas que el usuario hubiese desasignado manualmente.
    if (itinerary === "CEMENTO") {
      for (const a of base.asignaciones[itinerary] || []) {
        if (!["rutas_madre", "geocerca_tramo"].includes(a.tipo)) continue;
        const key = `${a.tipo}|${a.maestro_id}`;
        if (!keys.has(key)) {
          currentAssignments.push({ ...a });
          keys.add(key);
        }
      }
    }
    asignaciones[itinerary] = currentAssignments;
  }

  return normalizeMaster({
    ...current,
    version: 3,
    detalle_version: DETAIL_VERSION,
    reglas_motor_rutas: base.reglas_motor_rutas,
    objetos,
    asignaciones,
  });
}

function publication(master: any, itinerary: string) {
  const docs: Record<string, any> = {};
  for (const type of TYPES) {
    const objetos = (master.asignaciones[itinerary] || [])
      .filter((a: any) => a.activa && a.tipo === type)
      .map((a: any) => {
        const source = master.objetos[type].find((x: any) => x.id === a.maestro_id);
        if (!source) throw Error(`${a.maestro_id}: objeto maestro no encontrado`);
        return {
          ...source,
          id: source.id,
          maestro_id: source.id,
          name: a.nombre_operativo,
        };
      });
    docs[type] = {
      itinerario: `_${itinerary.replaceAll(" ", "_")}`,
      tipo: type.toUpperCase(),
      actualizado: new Date().toISOString(),
      detalle_version: DETAIL_VERSION,
      origen: "EDITOR_MAESTRO_GEOCERCAS_WEB",
      objetos,
    };
  }
  return docs;
}
function summary(row: any, doc: any) {
  return {
    estado: row?.estado || "SIN_BORRADOR",
    version_publicada: row?.version_publicada || 0,
    publicado_en: row?.publicado_en || null,
    detalle_version: DETAIL_VERSION,
    conteos: {
      geocercas: doc?.objetos?.geocercas?.length || 0,
      rutas_madre: doc?.objetos?.rutas_madre?.length || 0,
      geocerca_tramo: doc?.objetos?.geocerca_tramo?.length || 0,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "POST") return reply(req, { error: "Método no permitido" }, 405);
  try {
    const { db, user } = await secure(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const { data: row, error: readError } = await db
      .from("editor_geocercas_maestro")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (readError) throw readError;

    const source = row?.borrador || row?.publicado || seed;
    const requiresDetailsSave = String(source?.detalle_version || "") !== DETAIL_VERSION;
    const current = upgradeMaster(source);

    if (action === "leer_maestro")
      return reply(req, {
        maestro: current,
        ...summary(row, current),
        itinerarios: ITINERARIES,
        rol: user.rol,
        google_maps_api_key: Deno.env.get("GOOGLE_MAPS_API_KEY") || "",
        origen_inicial: row ? "SUPABASE" : "MAESTRO_ADJUNTO_12_09_2026",
        actualizacion_version_2_pendiente: requiresDetailsSave,
      });

    if (action === "guardar_maestro") {
      const doc = upgradeMaster(body.maestro);
      const { error } = await db.from("editor_geocercas_maestro").upsert({
        id: 1,
        estado: "BORRADOR",
        borrador: doc,
        validado: null,
        actualizado_por: user.email,
        actualizado_en: new Date().toISOString(),
      });
      if (error) throw error;
      return reply(req, {
        ok: true,
        ...summary({ estado: "BORRADOR" }, doc),
        mensaje: "Maestro VERSIÓN 2 guardado. Las publicaciones vigentes no cambiaron.",
      });
    }

    if (action === "validar_maestro") {
      if (!row?.borrador) throw Error("Primero debe guardar el Maestro");
      const doc = upgradeMaster(row.borrador);
      const { error } = await db
        .from("editor_geocercas_maestro")
        .update({
          estado: "VALIDADO",
          validado: doc,
          actualizado_por: user.email,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) throw error;
      return reply(req, {
        ok: true,
        ...summary({ estado: "VALIDADO" }, doc),
        mensaje: "Maestro y asignaciones VERSIÓN 2 validados.",
      });
    }

    if (action === "publicar_maestro") {
      const itinerary = String(body.itinerario || "").trim().toUpperCase();
      if (!ITINERARIES.includes(itinerary))
        throw Error("Seleccione el itinerario que desea publicar");
      if (!row?.validado || !["VALIDADO", "PUBLICADO"].includes(row.estado))
        throw Error("Primero debe validar el Maestro");

      const doc = upgradeMaster(row.validado);
      if (row.publicado) {
        const { error } = await db.from("editor_geocercas_maestro_versiones").upsert({
          version: row.version_publicada,
          documento: row.publicado,
          publicado_por: user.email,
        });
        if (error) throw error;
      }

      const docs = publication(doc, itinerary);
      const { data: previous, error: pe } = await db
        .from("editor_geocercas_proyectos")
        .select("publicado,version_publicada")
        .eq("itinerario", itinerary)
        .maybeSingle();
      if (pe) throw pe;
      if (previous?.publicado) {
        const { error } = await db.from("editor_geocercas_versiones").upsert({
          itinerario: itinerary,
          version: previous.version_publicada,
          documentos: previous.publicado,
          publicado_por: user.email,
        });
        if (error) throw error;
      }

      const projectVersion = Number(previous?.version_publicada || 0) + 1;
      const { error: projectError } = await db
        .from("editor_geocercas_proyectos")
        .upsert({
          itinerario: itinerary,
          estado: "PUBLICADO",
          version_publicada: projectVersion,
          publicado: docs,
          validado: docs,
          actualizado_por: user.email,
          actualizado_en: new Date().toISOString(),
          publicado_en: new Date().toISOString(),
        });
      if (projectError) throw projectError;

      const version = Number(row.version_publicada || 0) + 1;
      const { error } = await db
        .from("editor_geocercas_maestro")
        .update({
          estado: "PUBLICADO",
          version_publicada: version,
          publicado: doc,
          actualizado_por: user.email,
          actualizado_en: new Date().toISOString(),
          publicado_en: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) throw error;

      const counts = {
        geocercas: docs.geocercas.objetos.length,
        rutas_madre: docs.rutas_madre.objetos.length,
        geocercas_ruta: docs.geocerca_tramo.objetos.length,
      };
      return reply(req, {
        ok: true,
        estado: "PUBLICADO",
        version_publicada: version,
        version_itinerario: projectVersion,
        itinerario: itinerary,
        publicacion: counts,
        mensaje: `RUTAS Y GEOCERCAS ACTUALIZADAS EN EL ITINERARIO ${itinerary}`,
      });
    }

    return reply(req, { error: "Acción no encontrada" }, 404);
  } catch (error) {
    console.error(error);
    return reply(
      req,
      { error: error instanceof Error ? error.message : "Error del editor" },
      400,
    );
  }
});
