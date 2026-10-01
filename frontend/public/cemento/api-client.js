/**
 * Cliente HTTP exclusivo de CEMENTO.
 * Cerro Verde tiene el suyo. No compartir este archivo entre itinerarios.
 */
import { auth } from "/shared/auth.js";
import { API } from "./registry.js";

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken();
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
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    const name =
      (r.headers.get("content-disposition") || "").match(/filename="([^"]+)/)?.[1] ||
      "descarga.xlsx";
    return { blob: await r.blob(), name };
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
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
  return `<div class="module-head"><div><p class="eyebrow">CEMENTO</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</div>`;
}
