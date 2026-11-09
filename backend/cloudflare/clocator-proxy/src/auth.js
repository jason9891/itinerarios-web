// Verificación de ID tokens de Firebase con Web Crypto (sin dependencias → poca CPU).
const PROJECT = "itinerarios-2fa6f";
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwks = null;
let jwksAt = 0;
const keyCache = new Map();

const b64uToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

async function getKey(kid, fetchFn) {
  if (keyCache.has(kid) && Date.now() - jwksAt < 3600_000) return keyCache.get(kid);
  if (!jwks || Date.now() - jwksAt >= 3600_000 || !jwks.keys.some((k) => k.kid === kid)) {
    const r = await fetchFn(JWKS_URL);
    if (!r.ok) throw new Error("No se pudo leer las llaves de Firebase");
    jwks = await r.json();
    jwksAt = Date.now();
    keyCache.clear();
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("Llave de token desconocida");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  keyCache.set(kid, key);
  return key;
}

/** Devuelve { uid, email } o lanza error. */
export async function verificarFirebase(token, env, fetchFn = fetch) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Token inválido");
  const header = b64uToJson(parts[0]);
  const payload = b64uToJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Token inválido");
  const key = await getKey(header.kid, fetchFn);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64uToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error("Firma de token inválida");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT || payload.iss !== `https://securetoken.google.com/${PROJECT}`) {
    throw new Error("Token de otro proyecto");
  }
  if (!payload.exp || payload.exp < now - 30) throw new Error("Sesión vencida");
  if (!payload.sub) throw new Error("Token sin identidad");
  const email = String(payload.email || "").toLowerCase();
  const permitidos = String(env.ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!permitidos.length) throw new Error("Usuario sin acceso: el secreto ALLOWED_EMAILS no está configurado en el Worker");
  if (!email) throw new Error("Usuario sin acceso: el token no trae correo");
  if (!payload.email_verified) throw new Error(`Usuario sin acceso: el correo ${email} no está verificado`);
  if (!permitidos.includes(email)) throw new Error(`Usuario sin acceso: ${email} no está en ALLOWED_EMAILS`);
  return { uid: payload.sub, email };
}
