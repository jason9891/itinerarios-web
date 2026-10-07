# TURNO AMANECIDA — Control nocturno

## Propósito

Control de pernocta entre **22:00 y 04:00** (fecha del turno = noche de inicio).  
Solo unidades **20-R-**, filtradas por geocercas del itinerario (sufijo `_TN`), enriquecidas con la **última OC** por equipo y el **tipo de acople**.

## Origen

Port del desktop `REPORTE_NOCHE` (PyQt6) a la plataforma web modular, aislado de Cemento y Cerro Verde.

## Estructura frontend

```
frontend/public/
├── turno-amanecida.html
└── turno-amanecida/
    ├── main.js
    ├── registry.js
    ├── api-client.js
    ├── turno-amanecida.css
    └── modules/
        ├── home.js
        ├── maestros.js      # carga única OC + TIPO_ACOPLE
        ├── acoples.js       # grilla CRUD catálogo
        ├── base.js          # (próx.) snapshot
        ├── monitoreo.js     # (próx.) poll 3 min
        ├── clasificacion.js # (próx.)
        ├── historico.js
        └── reporte.js
```

## Geocercas `_TN`

Importadas al maestro del Editor de geocercas y **asignadas al itinerario `TURNO AMANECIDA`**:

| ID maestro | Nombre operativo |
|------------|------------------|
| ZGTN01 | Filtro_Macro_Sur_TN |
| ZGTN02 | Planta_Yura_TN |
| ZGTN03 | Raciemsa_Aqp_TN |
| ZGTN04 | Base_Mpquegua_TN |
| ZGTN05 | Or_Tacna_TN |
| ZGTN06 | Cesur_Caracoto_TN |
| ZGTN07 | Aconstruir_Huasao_TN |
| ZGTN08 | SMCV_SanJose_TN |
| ZGTN09 | Planta_Gloria_TN |
| ZGTN10 | Guardia_Civil_TN |
| ZGTN11 | Gloria_Majes_TN |
| ZGTN12 | Volvo_Aqp_TN |
| ZGTN13 | Juliaca_TN |

- `Filtro_Macro_Sur_TN`: filtro general (fuera → descartada).
- Resto: zona específica; si está en el macro y no en ninguna zona → `Transito` (universo de seguimiento, igual que el desktop).

Revisión: abrir **Editor de geocercas** → scope **TURNO AMANECIDA** → validar geometrías → **Publicar**.

Si el maestro en Supabase ya existía antes de este cambio, al abrir el editor el seed se fusiona en objetos; conviene **Guardar maestro** y revisar asignaciones del itinerario.

## Maestros (carga única)

### OC (`amanecida_oc_ultima`)

Misma lógica que `snapshot_base_clocator.cargar_oc`:

1. Lee Excel (header 0 o 1).
2. Columnas: FecIniReal, Equipo, Acoplado 1, Nombre Piloto, Descripción Ruta, Material de Servicio.
3. Ordena por FecIniReal desc y **deja una fila por Equipo** (la más reciente).
4. Esa fila alimenta piloto, acople, ruta y material de la unidad 20-R- filtrada por geocerca.

### Tipo acople (`amanecida_tipo_acople`)

1. Carga inicial desde Excel (código + CARROCERIA + GESTOR).
2. Editable en módulo **Tipo Acople** (agregar / editar / guardar).

## Backend

- Migración: `20261007050000_turno_amanecida_maestros.sql`
- Edge Function: `turno-amanecida-maestros`  
  Acciones: `estado`, `cargar_oc`, `cargar_acoples`, `listar_acoples`, `guardar_acoples`

## Despliegue necesario

1. Aplicar migración SQL en Supabase.
2. Desplegar function `turno-amanecida-maestros` (`--no-verify-jwt` si el resto usa ese patrón + validación JWT interna).
3. Desplegar frontend (Hosting / GitHub Pages).
4. En Editor de geocercas: confirmar itinerario **TURNO AMANECIDA**, guardar/publicar geocercas `_TN`.
5. En el itinerario: módulo **Maestros** → subir una vez OC y TIPO_ACOPLE.

## Próximos módulos

1. Snapshot CLocator + filtro 20-R- + geocercas publicadas + join OC/acople.
2. Monitoreo (poll 3 min) + mapa.
3. Clasificación (status, riesgo, punto autorizado, cobertura GPS, tipo lugar, punto pernocte, obs).
4. Cierre de turno + export Excel.
