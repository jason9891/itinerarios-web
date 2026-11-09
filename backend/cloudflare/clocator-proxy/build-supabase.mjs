// Genera supabase-user/index.ts: UNA sola Edge Function (un archivo) para pegar en el
// proyecto de Supabase de cada usuario. Reutiliza exactamente el código del Worker.
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(`./src/${f}`, import.meta.url), "utf8");
const limpiar = (s) =>
  s.replace(/^import[^;]*;\s*$/gm, "").replace(/^export (async function|function|const|let)/gm, "$1").replace(/^export \{[^}]*\};?\s*$/gm, "");
const cuerpo = ["auth.js", "clocator.js", "geocercas-tn.js", "router.js"].map((f) => `// ───── ${f} ─────\n${limpiar(leer(f))}`).join("\n");
const out = `// @ts-nocheck
// Extractor de rutas CLocator para el proyecto de Supabase de cada usuario.
// GENERADO por build-supabase.mjs a partir de src/ (no editar a mano).
// Secretos requeridos (Edge Functions → Secrets): CLOCATOR_USER, CLOCATOR_PASSWORD, ALLOWED_EMAILS
// Desplegar con "Verify JWT" DESACTIVADO (la identidad se valida con el token de Firebase).
${cuerpo}
Deno.serve((request) => {
  const env = { CLOCATOR_USER: Deno.env.get("CLOCATOR_USER"), CLOCATOR_PASSWORD: Deno.env.get("CLOCATOR_PASSWORD"), ALLOWED_EMAILS: Deno.env.get("ALLOWED_EMAILS") };
  return manejar(request, env);
});
`;
fs.writeFileSync(new URL("./supabase-user/index.ts", import.meta.url), out);
console.log("OK", out.length, "bytes");
