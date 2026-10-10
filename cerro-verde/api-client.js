/**
 * Cliente HTTP exclusivo de CERRO VERDE.
 * Independiente de Cemento.
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(true);
}

export async function apiGet(path) {
  const r = await fetch(`${API.consulta}/${path}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export async function apiPost(url, body, { signal, binary = false } = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (binary) {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      if (ct.includes("application/json")) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || d.message || `HTTP ${r.status}`);
      }
      const t = await r.text().catch(() => "");
      throw new Error(t.slice(0, 300) || `HTTP ${r.status}`);
    }
    // A veces el edge devuelve JSON de error con 200: detectar
    if (ct.includes("application/json")) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || d.message || "Respuesta JSON inesperada al pedir Excel");
    }
    const name =
      (r.headers.get("content-disposition") || "").match(/filename="([^"]+)/)?.[1] ||
      "CERRO_VERDE.xlsx";
    return { blob: await r.blob(), name };
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
}

/** SAP Edge Function (filtro negocio CV en servidor). */
export function sapApi(body, opts) {
  return apiPost(API.sap, body, opts);
}

/** Seguimiento / grupo / lista Edge Function. */
export function trackApi(body, opts) {
  return apiPost(API.track, body, opts);
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function fechaPE(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}

export function moduleHead(title, sub, extra = "") {
  return `<div class="module-head"><div><p class="eyebrow">CERRO VERDE</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</div>`;
}

/** ArrayBuffer → base64 (por chunks, para Excel grandes). */
export function bufferToBase64(buffer) {
  const u = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < u.length; i += 32768) {
    s += String.fromCharCode(...u.subarray(i, i + 32768));
  }
  return btoa(s);
}
