BACKUP MAESTRO - PLATAFORMA ITINERARIOS
Fecha: 2026-09-26

FIREBASE
Proyecto: itinerarios-2fa6f
Hosting producción:
Version: 5af8934d5775b6b3
Release: 1790418870323000

La carpeta FIREBASE_WEB corresponde al código local que fue comparado
contra los archivos actualmente publicados en Firebase Hosting.

SUPABASE
Project ref: otvdwqbrqvxahyzfkhds

Incluye:
- 16 Edge Functions activas
- _shared
- archivos auxiliares de las funciones
- EDGE_FUNCTIONS_SHA256.txt
- listado de funciones de producción
- database/schema.sql
- database/data.sql
- database/roles.sql
- DATABASE_SHA256.txt

IMPORTANTE:
- No se incluyen contraseñas, tokens, API secrets ni archivos .env.
- Los secrets de Edge Functions deberán configurarse nuevamente si
  alguna vez se restaura el proyecto en otra instancia.
- Firebase /__/firebase/init.js e init.json son generados por Firebase
  y no forman parte del código fuente que necesita conservarse.

REVISIÓN DE SEGURIDAD PENDIENTE:
public.cerro_verde_pernoctes_historico_maestro tenía RLS deshabilitado
al momento de realizar este backup. No se modificó para evitar alterar
el funcionamiento de producción durante el respaldo.
