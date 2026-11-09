# QUELLAVECO — versión inicial (solo frontend)

## Estado

- Itinerario nuevo con **despachos** (como Cerro Verde), **sin Supabase**: no hay base de datos ni histórico.
- Todo lo que se carga vive **solo en la pestaña** (`sessionStorage` + memoria): hay que subir el Excel SAP en cada turno.
- Lee posiciones GPS del **Worker de Cloudflare** (`clocator-proxy`, acción `snapshot`, solo lectura), el mismo que usa Turno Amanecida.

## Estructura

```
frontend/public/
├── quellaveco.html              # shell (header + menú + #content)
└── quellaveco/
    ├── main.js                  # auth + router (ruta desconocida → inicio)
    ├── registry.js              # módulos + API (hoy solo el Worker)
    ├── config.js                # ★ FILTRO DE NEGOCIO (pendiente) + columnas SAP
    ├── procesar.js              # lógica pura: filtrar, tracto/carreta, deduplicar, filas del reporte
    ├── store.js                 # almacén de despachos de la sesión (punto de cambio a Supabase)
    ├── worker-client.js         # posiciones GPS + clave de Google Maps
    ├── api-client.js            # utilidades (placas, fechas, lector Excel)
    ├── quellaveco.css           # estilos propios (prefijo qv-)
    └── modules/
        ├── home.js              # estado de la sesión + flujo paso a paso
        ├── despachos.js         # Excel SAP → filtro → tabla, métricas y descartes
        ├── seguimiento.js       # mapa + tabla con GPS de cada tracto
        └── reporte.js           # Excel de despachos (+ columnas GPS si hay posiciones)
```

Comunicación entre módulos: `runtime.state` (`despachos`, `posiciones`) y `runtime.bus`
(`quellaveco:despachos-actualizados`, `quellaveco:posiciones-actualizadas`). Los módulos no se importan entre sí.

## Reglas de despachos (iguales a Cerro Verde)

1. Filtro de negocio por **Cliente** (y **Destino** si la regla lo indica) — `config.js`.
2. La **primera placa** de la columna `Placa` es el **tracto**; la segunda es la carreta y no bloquea.
3. Entrega no vacía.
4. Se deduplica por **Entrega** (queda la última fila).

Excel esperado: SAP ZSDF017. Columnas mínimas: `Entrega`, `Placa`, `Cliente`.

## Pendiente: definir el filtro de negocio

En `config.js`, `REGLAS_NEGOCIO` está vacío. Mientras lo esté, **no se filtra nada** y la plataforma lo avisa
en Inicio, Despachos y Reporte. Ejemplo del formato (el de Cerro Verde):

```js
export const REGLAS_NEGOCIO = [
  { cliente: "NOMBRE DEL CLIENTE" },                         // cualquier destino
  { cliente: "OTRO CLIENTE", destino: "DESTINO EXACTO" },    // cliente + destino
];
```

La comparación ignora tildes, mayúsculas y espacios repetidos.

## Para conectar Supabase más adelante

1. Crear las Edge Functions `quellaveco-*` (modelo: `cerro-verde-sap`, `cerro-verde-seguimiento`, `cerro-verde-reporte`)
   y la migración con las tablas de despachos e histórico.
2. Agregar sus URL en `registry.js` → `API`.
3. Cambiar `store.js` (hoy sessionStorage) por lectura/escritura contra esas funciones, manteniendo las mismas
   funciones exportadas (`guardarDespachos`, `leerDespachos`, `borrarDespachos`) para no tocar los módulos.
4. Mover el filtro de negocio y la validación de maestros al servidor, como en Cerro Verde.
5. Subir `?v=` (`V` en `registry.js` y los `?v=qv1` de `quellaveco.html` y `main.js`) en cada deploy.
