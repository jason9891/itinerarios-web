# Cerro Verde CLocator — Deno Deploy (sin egress Supabase)

Proxy GPS/Comsatel. Los puntos **no** pasan por la cuota de Supabase.

## 1. Cuenta
- https://dash.deno.com → crear cuenta (GitHub)
- New Project → nombre sugerido: `itinerarios-cv-clocator`

## 2. Secretos (Settings → Environment Variables)
```
CLOCATOR_USER=...
CLOCATOR_PASSWORD=...
GOOGLE_MAPS_API_KEY=...          # opcional
SUPABASE_URL=https://otvdwqbrqvxahyzfkhds.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...    # solo auth usuario + geocercas publicadas (pocos KB)
```

## 3. Deploy
```bash
deno install -A jsr:@deno/deployctl
cd deploy/deno-clocator-cv
deployctl deploy --project=itinerarios-cv-clocator --entrypoint=main.ts --prod
```

URL típica: `https://itinerarios-cv-clocator.deno.dev`

## 4. Frontend
En `cerro-verde/registry.js`:
```js
clocator: "https://itinerarios-cv-clocator.deno.dev",
clocatorSupabase: "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-clocator", // fallback
```

## 5. Probar
```bash
curl -X POST https://itinerarios-cv-clocator.deno.dev \
  -H "Origin: https://itinerarios-2fa6f.web.app" \
  -H "Authorization: Bearer FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"health"}'
```

Esperado: `{ "ok": true, "clocator": "CONECTADO", ... }`
