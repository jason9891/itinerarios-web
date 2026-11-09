# Extractor de rutas en tu propio Supabase (una vez por usuario)

Cada compañero usa SU proyecto gratuito de Supabase solo para descargar rutas de CLocator.
La cuota de egress (5 GB) es por proyecto, así no depende de la cuenta principal.

1. Crear cuenta y proyecto en supabase.com (plan Free). Anotar la URL: `https://<ref>.supabase.co`.
2. Edge Functions → **Deploy a new function** → nombre `extractor` → pegar el contenido de `index.ts`
   (también sirve `supabase functions deploy extractor --no-verify-jwt`).
   En la configuración de la función: **Verify JWT = OFF**.
3. Edge Functions → **Secrets** → agregar:
   - `CLOCATOR_USER` y `CLOCATOR_PASSWORD`: usuario y clave de Comsatel de ese compañero.
   - `ALLOWED_EMAILS`: correo(s) con que inicia sesión en la web (separados por coma).
4. En la web: ajustes del extractor → pegar `https://<ref>.supabase.co/functions/v1/extractor`.
5. Probar con la acción `ping` (debe devolver la hora de Lima).

Regenerar `index.ts` tras cambios en `src/`: `node build-supabase.mjs`.
Solo extraen puntos: no guardan tablas ni datos; el resultado vuelve al navegador.
