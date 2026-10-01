import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import { activeGroupRows, norm, normPlate, text } from "../_shared/cv-operativa.js";

const PROJECT = "itinerarios-2fa6f";
const IT = "CERRO VERDE";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io",
]);
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

function reply(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, OPTIONS",
  };
  if (ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function secure(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!ORIGINS.has(origin)) throw Error("Origen no autorizado");
  const a = req.headers.get("authorization") || "";
  if (!a.startsWith("Bearer ")) throw Error("Falta iniciar sesión");
  const { payload } = await jwtVerify(a.slice(7), JWKS, {
    algorithms: ["RS256"], issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT,
  });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error } = await db.from("app_usuarios").select("email,nombre,rol,itinerarios,activo").eq("firebase_uid", String(payload.sub || "")).maybeSingle();
  if (error) throw error;
  if (!user?.activo || !user.itinerarios?.includes(IT)) throw Error("Cuenta no autorizada para CERRO VERDE");
  return { db, user };
}

async function groups(db: any) {
  const { data, error } = await db.from("cerro_verde_grupo_smcv").select("codigo_tracto,payload,activo,actualizado_en").eq("activo", true);
  if (error) throw error;
  return activeGroupRows(data || []);
}

function groupUnit(r: any) {
  const p = r.payload || {};
  const section = norm(p.SECCION_REPORTE).includes("CARGADO") ? "CAL CARGADO" : "CAL VACIO";
  return {
    tracto: text(p.CODIGO_TRACTO || r.codigo_tracto),
    placa: normPlate(p.PLACA_TRACTO || p["PLACA TRACTO"] || p.PLACA),
    conductor: text(p.CONDUCTOR),
    carreta: text(p.CODIGO_CARRETA),
    seccion: section,
    estado: text(p.ESTADO),
    monitoreo: text(p.MONITOREO),
    observacion: text(p.OBSERVACION),
    ultima_entrega: text(p.ULTIMA_ENTREGA),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  if (req.method !== "GET") return reply(req, { error: "Método no permitido" }, 405);
  try {
    const { db, user } = await secure(req);
    const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();

    if (action === "perfil") return reply(req, { usuario: { nombre: user.nombre, email: user.email, rol: user.rol, itinerarios: user.itinerarios } });

    if (action === "resumen") {
      const [group, diarioQ, cfg] = await Promise.all([
        groups(db),
        db.from("seguimiento_staging").select("id", { count: "exact", head: true }).eq("itinerario", IT).eq("origen", "DIARIO"),
        db.from("cemento_configuracion").select("fecha_inicio_recorrido,actualizado_en").eq("itinerario", IT).maybeSingle(),
      ]);
      if (diarioQ.error) throw diarioQ.error;
      if (cfg.error) throw cfg.error;
      let vacio = 0, cargado = 0;
      for (const r of group) norm(r.payload?.SECCION_REPORTE).includes("CARGADO") ? cargado++ : vacio++;
      return reply(req, {
        usuario: { nombre: user.nombre, rol: user.rol },
        unidades: group.length,
        ocs_abiertas: diarioQ.count || 0,
        cal_vacio: vacio,
        cal_cargado: cargado,
        rango_gps_desde: cfg.data?.fecha_inicio_recorrido || "—",
        ultima_actividad: cfg.data?.actualizado_en,
        fuente: "GRUPO_SMCV ACTIVO · DESPACHOS ANIDADOS POR PLACA",
      });
    }

    if (action === "seguimiento") {
      const group = await groups(db);
      const registros = group.map(groupUnit).filter((x: any) => x.placa).sort((a: any, b: any) => a.tracto.localeCompare(b.tracto, undefined, { numeric: true }));
      return reply(req, { total: registros.length, registros, fuente: "GRUPO_SMCV ACTIVO" });
    }

    if (action === "precarga") return reply(req, { job: null, unidades: [], modo: "CACHE_LOCAL_VIGENTE" });

    if (action === "archivos") {
      const [d, h] = await Promise.all([
        db.from("seguimiento_staging").select("id", { count: "exact", head: true }).eq("itinerario", IT).eq("origen", "DIARIO"),
        db.from("seguimiento_staging").select("id", { count: "exact", head: true }).eq("itinerario", IT).eq("origen", "HISTORICO"),
      ]);
      if (d.error) throw d.error; if (h.error) throw h.error;
      return reply(req, { archivos: [
        { nombre: "SEGUIMIENTO_DIARIO_CERRO_VERDE.xlsx", registros: d.count || 0 },
        { nombre: "SEGUIMIENTO_HISTORICO_CERRO_VERDE.xlsx", registros: h.count || 0 },
      ] });
    }

    if (action === "reporte") {
      const group = await groups(db);
      return reply(req, { unidades: group.length, fuente: "GRUPO_SMCV ACTIVO" });
    }
    return reply(req, { error: "Ruta no encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return reply(req, { error: e instanceof Error ? e.message : "Error" }, 400);
  }
});
