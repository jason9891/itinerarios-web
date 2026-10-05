# Itinerarios · plataforma modular

## Cemento (versión definitiva)

Código canónico del itinerario Cemento:

- Frontend: `frontend/public/cemento/`
- Entrada: `frontend/public/cemento.html`
- Edge Functions: `backend/supabase/functions/cemento-*`

Módulos finales:

| Ruta | Módulo |
|------|--------|
| home | Inicio |
| sap | Actualizar SAP |
| precarga | Precargar rutas GPS |
| seguimiento | Seguimiento diario |
| archivos | Descargas Excel bajo demanda |
| reporte | Crear reporte (parcial/completo) |
| admin | Administración (solo rol ADMIN) |

**No** usar monolitos antiguos ni hojas `prueba*`. Cualquier cambio de Cemento se hace solo bajo `frontend/public/cemento/` y `backend/supabase/functions/cemento-*`.

## Cerro Verde

Separado en `frontend/public/cerro-verde/` y `cerro-verde-*` functions. No comparte módulos con Cemento.

## Preview

GitHub Pages: `https://jason9891.github.io/itinerarios-web/cemento.html`
