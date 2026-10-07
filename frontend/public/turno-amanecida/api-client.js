/**
 * Cliente HTTP exclusivo de TURNO AMANECIDA.
 */
import { auth } from "../shared/auth.js";
import { API } from "./registry.js";

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(true);
}

export async function apiPost(url, body, { signal } = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
}

export function maestrosApi(body, opts) {
  return apiPost(API.maestros, body, opts);
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function moduleHead(title, sub, extra = "") {
  return `<div class="module-head"><div><p class="eyebrow">TURNO AMANECIDA</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</div>`;
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
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}
