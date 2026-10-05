# VERSIÓN DEFINITIVA CEMENTO

A partir de 2026-10-05 el código bajo `frontend/public/cemento/` es la única referencia de Cemento. Se eliminaron monolitos de prueba (`app.js`, `prueba*.css`, `seguimiento19.css`) y el módulo manual.

# Arquitectura modular — Independencia garantizada

## Principio

> Modificar un módulo no modifica los demás.  
> Modificar un itinerario no toca el otro.  
> Los módulos pueden intercambiar datos solo de forma explícita.

## Mapa de carpetas

```
frontend/public/
├── shared/                          # ÚNICO código compartido entre itinerarios
│   ├── platform-shell.js            # logo / marca / header
│   ├── clocator-client.js           # consulta CLocator unificada
│   ├── auth.js                      # Firebase auth
│   └── module-runtime.js            # bus de eventos + estado por itinerario
│
├── cemento/                         # TODO Cemento (aislado)
│   ├── main.js                      # entry: auth + router
│   ├── registry.js                  # lista de módulos + endpoints de Cemento
│   ├── api-client.js                # fetch helpers solo de Cemento
│   └── modules/
│       ├── home.js
│       ├── sap.js
│       ├── precarga.js
│       ├── seguimiento.js
│       ├── manual.js
│       ├── archivos.js
│       ├── reporte.js
│       └── admin.js
│
├── cerro-verde/                     # TODO Cerro Verde (aislado)
│   ├── main.js
│   ├── registry.js
│   ├── api-client.js
│   └── modules/
│       ├── home.js
│       ├── sap.js
│       ├── precarga.js
│       ├── seguimiento.js
│       ├── grupo.js
│       ├── paradas.js
│       ├── archivos.js
│       └── reporte.js
│
├── cemento.html                     # shell HTML → carga cemento/main.js
└── cerro-verde.html                 # shell HTML → carga cerro-verde/main.js
```

## Contrato de un módulo

Todo módulo exporta exactamente:

```js
export async function mount(container, runtime) { /* pintar UI */ }
export function unmount() { /* quitar listeners, timers, mapas */ }
```

- `container` = el `#content` (ya vacío).
- `runtime` = objeto creado por `createItineraryRuntime("cemento" | "cerro-verde")`.

### Comunicación entre módulos (solo dentro del mismo itinerario)

```js
// Módulo SAP (cemento)
runtime.bus.emit("cemento:sap-updated", { fileName: "x.xlsx" });
runtime.state.set("sap.lastFile", "x.xlsx");

// Módulo Seguimiento (cemento) — se suscribe si le interesa
const off = runtime.bus.on("cemento:sap-updated", (payload) => { ... });
// en unmount: off()
```

- Prefijo de eventos por itinerario: `cemento:` / `cerro-verde:`.
- Cerro Verde **no** puede escuchar `cemento:*` porque tiene otro `runtime`.
- Un módulo **no importa** el archivo de otro módulo.

## Cómo agregar un módulo nuevo (ej. en Cemento)

1. Crear `frontend/public/cemento/modules/mi-modulo.js` con `mount` / `unmount`.
2. Agregar en `cemento/registry.js`:
   ```js
   "mi-modulo": () => import("./modules/mi-modulo.js"),
   ```
3. Agregar el botón en `cemento.html`:
   ```html
   <button data-route="mi-modulo">...</button>
   ```

**No tocar** `cerro-verde/`, ni otros módulos de Cemento, ni `shared/` (salvo infraestructura real).

## Cómo agregar un itinerario nuevo (ej. Quellaveco)

1. Copiar la carpeta `cemento/` → `quellaveco/`.
2. Cambiar endpoints en su `registry.js`.
3. Crear `quellaveco.html` con el shell canónico.
4. Registrar la tarjeta en el hub (`index.html`).

Cero cambios en Cemento o Cerro Verde.

## Qué queda compartido (y por qué)

| Archivo | Motivo |
|---------|--------|
| `shared/platform-shell.js` | Logo y marca en un solo sitio |
| `shared/clocator-client.js` | Misma forma de consultar CLocator |
| `shared/auth.js` | Una sola config Firebase |
| `shared/module-runtime.js` | Bus/estado; cada itinerario crea el suyo |
| `styles.css` | Dimensiones del shell bloqueadas |

Todo lo demás es por itinerario.

## Estado de migración

Los módulos nuevos ya cargan con el router modular.  
La lógica de negocio pesada que aún vive en `app.js` / `cerro-verde.js` se irá moviendo **módulo por módulo** a su archivo correspondiente. Mientras tanto, los módulos tienen una implementación base funcional y demuestran el aislamiento.

Al migrar un módulo:
- Se copia la lógica al archivo del módulo.
- Se elimina del monolito.
- Se verifica que ningún otro archivo lo importaba.
