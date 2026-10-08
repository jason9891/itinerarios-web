import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import * as XLSX from "npm:xlsx@0.18.5";

const PROJECT = "itinerarios-2fa6f";
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
  if (!user?.activo) throw Error("Cuenta inactiva o sin acceso a la plataforma");
  return { db, user };
}

function normalizarClave(valor: unknown): string {
  if (valor == null) return "";
  let texto = String(valor).trim().toUpperCase();
  texto = texto.normalize("NFD").replace(/\p{M}/gu, "");
  texto = texto.replace(/\s+/g, "");
  return texto;
}

function sheetToRows(buf: Uint8Array, headerRow = 0): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    range: headerRow,
  });
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim()] = v;
    return out;
  });
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseDate(v: unknown): { iso: string | null; raw: string } {
  if (v == null || v === "") return { iso: null, raw: "" };
  const raw = String(v).trim();
  // Excel serial
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    // Excel epoch
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), raw };
  }
  // DD/MM/YYYY or ISO
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const hh = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const d = new Date(Date.UTC(yy, mm - 1, dd, hh + 5, mi, ss)); // approx PE→UTC
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), raw };
  }
  const d2 = new Date(raw);
  if (!Number.isNaN(d2.getTime())) return { iso: d2.toISOString(), raw };
  return { iso: null, raw };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, { ok: true });
  try {
    if (req.method !== "POST") return reply(req, { error: "POST requerido" }, 405);
    const { db, user } = await secure(req);
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "estado") {
      const { data: meta } = await db.from("amanecida_maestros_meta").select("*");
      const map = Object.fromEntries((meta || []).map((x: any) => [x.tipo, x]));
      return reply(req, {
        ok: true,
        oc: map.oc || { filas: 0 },
        acoples: map.acoples || { filas: 0 },
      });
    }

    if (action === "listar_acoples") {
      const { data, error } = await db
        .from("amanecida_tipo_acople")
        .select("codigo,carroceria,gestor,actualizado_en")
        .order("codigo");
      if (error) throw error;
      return reply(req, { ok: true, filas: data || [] });
    }

    if (action === "guardar_acoples") {
      const filas = Array.isArray(body.filas) ? body.filas : [];
      const clean = filas
        .map((r: any) => ({
          codigo: normalizarClave(r.codigo),
          carroceria: String(r.carroceria || "").trim() || null,
          gestor: String(r.gestor || "").trim() || null,
          actualizado_en: new Date().toISOString(),
          actualizado_por: user.email,
        }))
        .filter((r: any) => r.codigo);
      // replace all
      const { error: delErr } = await db
        .from("amanecida_tipo_acople")
        .delete()
        .neq("codigo", "");
      if (delErr) throw delErr;
      if (clean.length) {
        const { error } = await db.from("amanecida_tipo_acople").insert(clean);
        if (error) throw error;
      }
      await db.from("amanecida_maestros_meta").upsert({
        tipo: "acoples",
        filas: clean.length,
        actualizado_en: new Date().toISOString(),
        actualizado_por: user.email,
        nota: "edicion_grilla",
      });
      return reply(req, { ok: true, filas: clean.length });
    }

    if (action === "cargar_acoples") {
      const b64 = String(body.contenido_base64 || "");
      if (!b64) throw Error("Falta contenido_base64");
      const buf = decodeBase64(b64);
      let rows = sheetToRows(buf, 0);
      if (!rows.length) throw Error("Excel de acoples vacío");
      // 1ª columna = código
      const firstKey = Object.keys(rows[0])[0];
      const has = (c: string) =>
        Object.keys(rows[0]).some((k) => k.toUpperCase() === c.toUpperCase());
      if (!has("CARROCERIA") || !has("GESTOR")) {
        throw Error("TIPO_ACOPLE debe tener columnas CARROCERIA y GESTOR");
      }
      const byCode = new Map<string, any>();
      for (const r of rows) {
        const codigo = normalizarClave(r[firstKey]);
        if (!codigo) continue;
        const carroceria =
          r[
            Object.keys(r).find((k) => k.toUpperCase() === "CARROCERIA") ||
              "CARROCERIA"
          ];
        const gestor =
          r[
            Object.keys(r).find((k) => k.toUpperCase() === "GESTOR") || "GESTOR"
          ];
        byCode.set(codigo, {
          codigo,
          carroceria: carroceria != null ? String(carroceria).trim() : null,
          gestor: gestor != null ? String(gestor).trim() : null,
          actualizado_en: new Date().toISOString(),
          actualizado_por: user.email,
        });
      }
      const clean = [...byCode.values()];
      const { error: delErr } = await db
        .from("amanecida_tipo_acople")
        .delete()
        .neq("codigo", "");
      if (delErr) throw delErr;
      if (clean.length) {
        const { error } = await db.from("amanecida_tipo_acople").insert(clean);
        if (error) throw error;
      }
      await db.from("amanecida_maestros_meta").upsert({
        tipo: "acoples",
        nombre_archivo: String(body.nombre_archivo || ""),
        filas: clean.length,
        actualizado_en: new Date().toISOString(),
        actualizado_por: user.email,
        nota: "carga_excel",
      });
      return reply(req, { ok: true, filas: clean.length });
    }


    if (action === "guardar_oc") {
      // Filas YA deduplicadas en el cliente (última OC por equipo).
      // No recibe Excel ni base64: payload liviano.
      const filas = Array.isArray(body.filas) ? body.filas : [];
      if (!filas.length) throw Error("No hay filas OC para guardar");
      const clean = filas
        .map((r: any) => {
          const equipo = normalizarClave(r.equipo || r.equipo_raw);
          if (!equipo) return null;
          return {
            equipo,
            equipo_raw: String(r.equipo_raw || r.equipo || equipo).trim(),
            fec_ini_real: r.fec_ini_real || null,
            fec_ini_real_raw: r.fec_ini_real_raw != null ? String(r.fec_ini_real_raw) : "",
            acoplado_1: r.acoplado_1 != null ? String(r.acoplado_1).trim() : null,
            nombre_piloto: r.nombre_piloto != null ? String(r.nombre_piloto).trim() : null,
            descripcion_ruta: r.descripcion_ruta != null ? String(r.descripcion_ruta).trim() : null,
            material_servicio: r.material_servicio != null ? String(r.material_servicio).trim() : null,
            payload: {},
            actualizado_en: new Date().toISOString(),
            actualizado_por: user.email,
          };
        })
        .filter(Boolean) as any[];

      const { error: delErr } = await db
        .from("amanecida_oc_ultima")
        .delete()
        .neq("equipo", "");
      if (delErr) throw delErr;

      const chunk = 200;
      for (let i = 0; i < clean.length; i += chunk) {
        const slice = clean.slice(i, i + chunk);
        const { error } = await db.from("amanecida_oc_ultima").insert(slice);
        if (error) throw error;
      }
      await db.from("amanecida_maestros_meta").upsert({
        tipo: "oc",
        nombre_archivo: String(body.nombre_archivo || ""),
        filas: clean.length,
        actualizado_en: new Date().toISOString(),
        actualizado_por: user.email,
        nota: "guardar_oc_cliente_dedup",
      });
      return reply(req, { ok: true, filas: clean.length });
    }

    if (action === "cargar_oc") {
      const b64 = String(body.contenido_base64 || "");
      if (!b64) throw Error("Falta contenido_base64");
      const buf = decodeBase64(b64);
      const requeridas = [
        "FecIniReal",
        "Equipo",
        "Acoplado 1",
        "Nombre Piloto",
        "Descripción Ruta",
        "Material de Servicio",
      ];
      let rows = sheetToRows(buf, 0);
      const hasAll = (rs: Record<string, unknown>[]) =>
        rs.length > 0 &&
        requeridas.every((c) =>
          Object.keys(rs[0]).some(
            (k) => k.trim().toLowerCase() === c.toLowerCase(),
          ),
        );
      if (!hasAll(rows)) {
        rows = sheetToRows(buf, 1);
        if (!hasAll(rows)) {
          throw Error(
            "Faltan columnas OC requeridas: " + requeridas.join(", "),
          );
        }
      }
      const col = (row: Record<string, unknown>, name: string) => {
        const k = Object.keys(row).find(
          (x) => x.trim().toLowerCase() === name.toLowerCase(),
        );
        return k ? row[k] : null;
      };

      type Acc = {
        equipo: string;
        equipo_raw: string;
        fec_ini_real: string | null;
        fec_ini_real_raw: string;
        acoplado_1: string | null;
        nombre_piloto: string | null;
        descripcion_ruta: string | null;
        material_servicio: string | null;
        payload: Record<string, unknown>;
        _ts: number;
      };
      const best = new Map<string, Acc>();
      let total = 0;
      for (const r of rows) {
        const equipoRaw = col(r, "Equipo");
        const equipo = normalizarClave(equipoRaw);
        if (!equipo) continue;
        total++;
        const fec = parseDate(col(r, "FecIniReal"));
        const ts = fec.iso ? Date.parse(fec.iso) : 0;
        const prev = best.get(equipo);
        if (prev && prev._ts >= ts) continue;
        best.set(equipo, {
          equipo,
          equipo_raw: equipoRaw != null ? String(equipoRaw) : equipo,
          fec_ini_real: fec.iso,
          fec_ini_real_raw: fec.raw,
          acoplado_1:
            col(r, "Acoplado 1") != null
              ? String(col(r, "Acoplado 1")).trim()
              : null,
          nombre_piloto:
            col(r, "Nombre Piloto") != null
              ? String(col(r, "Nombre Piloto")).trim()
              : null,
          descripcion_ruta:
            col(r, "Descripción Ruta") != null
              ? String(col(r, "Descripción Ruta")).trim()
              : null,
          material_servicio:
            col(r, "Material de Servicio") != null
              ? String(col(r, "Material de Servicio")).trim()
              : null,
          payload: r,
          _ts: ts,
        });
      }
      const clean = [...best.values()].map(({ _ts, ...rest }) => ({
        ...rest,
        actualizado_en: new Date().toISOString(),
        actualizado_por: user.email,
      }));

      const { error: delErr } = await db
        .from("amanecida_oc_ultima")
        .delete()
        .neq("equipo", "");
      if (delErr) throw delErr;
      // insert in chunks
      const chunk = 500;
      for (let i = 0; i < clean.length; i += chunk) {
        const slice = clean.slice(i, i + chunk);
        const { error } = await db.from("amanecida_oc_ultima").insert(slice);
        if (error) throw error;
      }
      await db.from("amanecida_maestros_meta").upsert({
        tipo: "oc",
        nombre_archivo: String(body.nombre_archivo || ""),
        filas: clean.length,
        actualizado_en: new Date().toISOString(),
        actualizado_por: user.email,
        nota: `origen_filas=${total};unicas=${clean.length}`,
      });
      return reply(req, {
        ok: true,
        filas: total,
        filas_unicas: clean.length,
        filas_descartadas: Math.max(0, total - clean.length),
      });
    }

    return reply(req, { error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return reply(req, { error: msg }, 400);
  }
});
