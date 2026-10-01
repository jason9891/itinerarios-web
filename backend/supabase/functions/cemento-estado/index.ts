import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const FIREBASE_PROJECT_ID = "itinerarios-2fa6f";
const ALLOWED_ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://5000-cs-a2a47bf9-3b6a-4a54-b115-36fc3cb753b5.cs-us-east1-vpcf.cloudshell.dev",
]);
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-headers"] = "authorization, content-type";
  headers["access-control-allow-methods"] = "GET, OPTIONS";
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, { ok: true });
  if (req.method !== "GET") return response(req, { error: "Método no permitido" }, 405);
  const origin = req.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return response(req, { error: "Origen no autorizado" }, 403);

  try {
    const header = req.headers.get("authorization") || "";
    if (!header.startsWith("Bearer ")) throw new Error("Falta iniciar sesión");
    const token = header.slice(7);
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    const email = String(payload.email || "").toLowerCase();
    const uid = String(payload.sub || "");
    if (!email || payload.email_verified !== true || !uid) throw new Error("Identidad de Firebase no válida");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: user, error: userError } = await supabase
      .from("app_usuarios")
      .select("id,email,nombre,rol,itinerarios,activo,firebase_uid")
      .eq("email", email)
      .maybeSingle();
    if (userError) throw userError;
    if (!user || !user.activo || !user.itinerarios?.includes("CEMENTO")) {
      return response(req, { error: "Tu cuenta no está autorizada para CEMENTO" }, 403);
    }
    if (user.firebase_uid && user.firebase_uid !== uid) {
      return response(req, { error: "La cuenta autorizada está vinculada a otra identidad" }, 403);
    }
    await supabase.from("app_usuarios").update({ firebase_uid: uid, ultimo_acceso_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }).eq("id", user.id);

    const [sap, diario, historico, snapshot] = await Promise.all([
      supabase.from("sap_registros_staging").select("id", { count: "exact", head: true }).eq("itinerario", "CEMENTO"),
      supabase.from("seguimiento_staging").select("id", { count: "exact", head: true }).eq("itinerario", "CEMENTO").eq("origen", "DIARIO"),
      supabase.from("seguimiento_staging").select("id", { count: "exact", head: true }).eq("itinerario", "CEMENTO").eq("origen", "HISTORICO"),
      supabase.from("snapshots_base").select("fecha_corte").eq("itinerario", "CEMENTO").order("fecha_corte", { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const result of [sap, diario, historico, snapshot]) if (result.error) throw result.error;
    return response(req, {
      ok: true,
      usuario: { email: user.email, nombre: user.nombre, rol: user.rol },
      cemento: {
        data_sap: sap.count ?? 0,
        seguimiento_diario: diario.count ?? 0,
        seguimiento_historico: historico.count ?? 0,
        snapshot_fecha: snapshot.data?.fecha_corte ?? null,
      },
    });
  } catch (error) {
    return response(req, { error: error instanceof Error ? error.message : "Error de autenticación" }, 401);
  }
});