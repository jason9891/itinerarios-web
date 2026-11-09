import { verificarFirebase } from "./auth.js";
import { alarmas, alarmasSesion, explorarHistorial, recorrido, recorridos, snapshot } from "./clocator.js";
import { GEOCERCAS_TN } from "./geocercas-tn.js";

const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);
const FECHA = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

function limaNow() {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function reply(request, body, status = 200) {
  const o = request.headers.get("origin") || "";
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (ORIGINS.has(o)) h["access-control-allow-origin"] = o;
  return new Response(JSON.stringify(body), { status, headers: h });
}

export async function manejar(request, env) {
  {
    if (request.method === "OPTIONS") return reply(request, { ok: true });
    if (request.method !== "POST") return reply(request, { error: "Método no permitido" }, 405);
    const origin = request.headers.get("origin") || "";
    if (!ORIGINS.has(origin)) return reply(request, { error: "Origen no autorizado" }, 403);
    try {
      const auth = request.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) throw Object.assign(new Error("Falta iniciar sesión"), { status: 401 });
      try {
        await verificarFirebase(auth.slice(7), env);
      } catch (e) {
        throw Object.assign(e, { status: 401 });
      }
      const body = await request.json().catch(() => ({}));
      const action = String(body.action || "ruta");
      if (action === "ping") return reply(request, { ok: true, hora: limaNow() });
      if (action === "snapshot") return reply(request, await snapshot(env));
      if (action === "alarmas") return reply(request, body.persistente ? await alarmasSesion(env, body.sesion || "", fetch, { debug: !!body.debug }) : await alarmas(env, fetch, { debug: !!body.debug }));
      if (action === "alarmas_historial_diag") return reply(request, await explorarHistorial(env, body.sesion || ""));
      if (action === "geocercas") return reply(request, { ok: true, geocercas: GEOCERCAS_TN });
      if (action === "config") return reply(request, { ok: true, google_maps_api_key: env.GOOGLE_MAPS_API_KEY || "" });
      if (action === "acoples_listar" || action === "acoples_guardar") {
        if (!env.ACOPLES) throw new Error("Falta el KV ACOPLES (binding) en el Worker");
        if (action === "acoples_listar") {
          const v = await env.ACOPLES.get("catalogo", "json");
          return reply(request, { ok: true, filas: v?.filas || [], actualizado_en: v?.actualizado_en || null });
        }
        const filas = (Array.isArray(body.filas) ? body.filas : [])
          .map((r) => [String(r[0] ?? r.codigo ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, ""), String(r[1] ?? r.carroceria ?? "").trim(), String(r[2] ?? r.gestor ?? "").trim()])
          .filter((r) => r[0]);
        if (filas.length > 20000) throw new Error("Demasiadas filas");
        const actualizado_en = new Date().toISOString();
        await env.ACOPLES.put("catalogo", JSON.stringify({ filas, actualizado_en }));
        return reply(request, { ok: true, filas: filas.length, actualizado_en });
      }
      if (action === "rutas") {
        const lista = Array.isArray(body.unidades) ? body.unidades : [];
        if (!lista.length) throw new Error("Falta unidades[]");
        if (lista.length > 4) throw new Error("Máximo 4 unidades por petición");
        const ahora = limaNow();
        const norm = lista.map((u) => ({
          placa: String(u.placa || "").trim(),
          tracto: String(u.tracto || "").trim(),
          desde: String(u.desde || "").trim(),
          hasta: FECHA.test(String(u.hasta || "").trim()) ? String(u.hasta).trim() : ahora,
        }));
        for (const u of norm) {
          if (!u.placa && !u.tracto) throw new Error("Falta placa o tracto");
          if (!FECHA.test(u.desde)) throw new Error("Falta una fecha de inicio válida (dd/MM/yyyy HH:mm:ss)");
        }
        const out = await recorridos(env, norm);
        return reply(request, { ok: true, resultados: out.resultados.map((r, i) => ({ ...r, desde: norm[i].desde, hasta: norm[i].hasta })), ...(body.debug ? { dbg: out.dbg } : {}) });
      }
      if (action !== "ruta") return reply(request, { error: `Acción desconocida: ${action}` }, 400);

      const placa = String(body.placa || "").trim();
      const tracto = String(body.tracto || "").trim();
      const desde = String(body.desde || "").trim();
      const hasta = FECHA.test(String(body.hasta || "").trim()) ? String(body.hasta).trim() : limaNow();
      if (!placa && !tracto) throw new Error("Falta placa o tracto");
      if (!FECHA.test(desde)) throw new Error("Falta una fecha de inicio válida (dd/MM/yyyy HH:mm:ss)");
      const out = await recorrido(env, { placa, tracto, desde, hasta });
      if (!body.debug) delete out.dbg;
      return reply(request, { ...out, placa, tracto, desde, hasta });
    } catch (e) {
      return reply(request, { error: e instanceof Error ? e.message : "Error CLocator" }, e?.status || 400);
    }
  }
}
