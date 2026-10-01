# Plataforma de Itinerarios — RACIEMSA

Proyecto **paralelo y ordenado** de la plataforma de seguimiento operativo de itinerarios (Cemento, Cerro Verde, Editor de Geocercas).

Este repositorio se creó a partir del backup maestro del **2026-09-26** para separar el código limpio del desorden acumulado en Firebase Hosting + Supabase de producción.

## Objetivo

- Tener un repositorio Git limpio y versionado.
- Separar claramente **frontend** (Firebase Hosting) y **backend** (Supabase Edge Functions + Postgres).
- Facilitar cambios sin que se pisen entre módulos.
- Permitir trabajo en paralelo a producción sin riesgo.

## Estructura del repositorio

```
itinerarios-platform/
├── frontend/                 # Código de Firebase Hosting
│   ├── public/               # Archivos estáticos (HTML, JS, CSS)
│   ├── firebase.json
│   └── .firebaserc
├── backend/
│   ├── supabase/
│   │   ├── functions/        # 16 Edge Functions activas + _shared
│   │   ├── migrations/       # Migraciones SQL ordenadas por fecha
│   │   └── config.toml
│   └── database/             # schema.sql + data.sql (referencia del dump)
├── docs/
│   ├── README_BACKUP.txt     # Notas del backup original
│   ├── FUNCTIONS_PRODUCCION.txt
│   └── historial/            # Todos los LEEME_*.txt de pruebas y hotfixes
└── scripts/                  # Herramientas y tests auxiliares
```

## Módulos principales

| Módulo              | Frontend              | Edge Functions principales                          |
|---------------------|-----------------------|-----------------------------------------------------|
| Hub / Login         | `index.html` + `itinerarios.js` | —                                                  |
| Cemento             | `cemento.html` + `app.js` | cemento-seguimiento, cemento-sap, cemento-reporte, cemento-clocator, cemento-estado, cemento-consulta, cemento-montados, cemento-admin, cemento-manual |
| Cerro Verde         | `cerro-verde.html` + `cerro-verde*.js` | cerro-verde-seguimiento, cerro-verde-sap, cerro-verde-reporte, cerro-verde-clocator, cerro-verde-consulta |
| Editor Geocercas    | `editor-geocercas.html` + `editor-geocercas.js` | editor-geocercas                                   |

## Cómo trabajar con este proyecto

### 1. Clonar / usar localmente

```bash
git clone <url-de-tu-repo>
cd itinerarios-platform
```

### 2. Frontend (Firebase)

```bash
cd frontend
# Instalar Firebase CLI si no lo tienes: npm i -g firebase-tools
firebase login
firebase use itinerarios-2fa6f   # o el proyecto que quieras
firebase serve                  # para probar local
# firebase deploy --only hosting
```

**Importante:** No hagas deploy a producción desde este repo hasta que esté estabilizado. Usa un proyecto Firebase de staging o un canal de preview.

### 3. Backend (Supabase)

```bash
cd backend
# Instalar Supabase CLI: https://supabase.com/docs/guides/cli
supabase link --project-ref otvdwqbrqvxahyzfkhds
# o crear un proyecto nuevo de desarrollo
supabase start                  # local
supabase functions serve
```

Los secrets de las Edge Functions **no están incluidos** (por seguridad). Deben configurarse de nuevo en cualquier instancia nueva.

### 4. Base de datos

- `backend/database/schema.sql` → estructura
- `backend/database/data.sql` → datos del dump (11 MB)
- Migraciones en `backend/supabase/migrations/` (aplicadas en el orden del nombre)

**Nota de seguridad del backup original:** la tabla `public.cerro_verde_pernoctes_historico_maestro` tenía RLS deshabilitado. Revisar y corregir antes de usar en entornos nuevos.

## Flujo de trabajo recomendado (para evitar el desorden)

1. Trabajar siempre en ramas (`git checkout -b feature/xxx`).
2. Un módulo a la vez (no mezclar cambios de Cemento + Cerro Verde en el mismo PR).
3. Probar en local o en un proyecto Firebase/Supabase de **desarrollo**.
4. Solo después de validar, merge a `main` y deploy controlado.
5. Documentar cada cambio relevante en `docs/` o en el mensaje del commit.

## Próximos pasos sugeridos

- [ ] Crear repositorio privado en GitHub y hacer el primer push.
- [ ] Configurar un proyecto Firebase + Supabase de **desarrollo/staging**.
- [ ] Revisar y activar RLS en todas las tablas.
- [ ] Extraer lógica común de `app.js` (muy grande) a módulos más pequeños.
- [ ] Añadir `.env.example` con las variables necesarias (sin valores reales).
- [ ] Automatizar deploys con GitHub Actions (opcional).

## Origen

Extraído del backup maestro `ITINERARIOS_BACKUP_MAESTRO_2026-09-26.zip`  
Firebase: `itinerarios-2fa6f`  
Supabase: `otvdwqbrqvxahyzfkhds`

---

**Este es un proyecto paralelo.** Producción sigue intacta. Aquí se ordena y se versiona.
