# Proxy GPS Firebase (Cerro Verde) — Fase 1–2

## Objetivo
Consultas de puntos a Comsatel/CLocator **sin egress de Supabase**.

## Estado
- Cloud Function: `frontend/functions/` → export `cerroVerdeClocator`
- Frontend apunta a Firebase; **fallback automático a Supabase** si la function no está activa (plan Spark)

## Activar el proxy (obligatorio Blaze)
1. Upgrade: https://console.firebase.google.com/project/itinerarios-2fa6f/usage/details
2. Build + deploy:
   ```bash
   cd frontend/functions && npm install && npm run build
   cd .. && firebase deploy --only functions:cerroVerdeClocator
   ```
3. Env en la function:
   - CLOCATOR_USER
   - CLOCATOR_PASSWORD
   - GOOGLE_MAPS_API_KEY (opcional)
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY

## Verificación
Network: precarga → `cloudfunctions.net` / `run.app`, no `supabase.co/.../cerro-verde-clocator`.
