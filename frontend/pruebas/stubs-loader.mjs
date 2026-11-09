export async function resolve(specifier, context, next) {
  if (specifier.endsWith("shared/auth.js")) return { url: new URL("./auth-falso.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
