# Convenciones de Shell y CLocator

Estas reglas existen para que **todos los itinerarios se vean y se comporten igual** y para evitar que al agregar un mapa o un módulo nuevo se reinvente lógica que ya está resuelta.

## 1. Shell de ventana (header + sidebar)

### Estructura HTML obligatoria

Todo itinerario nuevo (Cemento, Cerro Verde, Quellaveco, etc.) **debe** copiar este esqueleto:

```html
<header class="top">
  <div class="logo" id="platform-logo">R</div>
  <div class="brand">
    <b id="platform-brand">RACIEMSA</b>
    <small id="platform-subtitle">SUBTÍTULO DEL ITINERARIO</small>
  </div>
  <div class="grow"></div>
  <a class="itinerary-link" href="/">VOLVER A ITINERARIOS</a>
</header>

<div id="workspace" class="workspace hidden">
  <aside>
    <div class="side-title">
      <span>CÓDIGO</span>
      <b>Control operativo</b>
    </div>
    <nav>
      <!-- botones data-route="..." -->
    </nav>
    <div class="side-foot">
      <b>ÁREA SATELITAL</b>
      <small>texto de versión</small>
    </div>
  </aside>
  <main id="content" class="content"></main>
</div>
```

### Logo centralizado

- El contenido del logo se controla en **un solo archivo**:  
  `frontend/public/shared/platform-shell.js` → objeto `PLATFORM.logoContent`
- Para poner una imagen más adelante:

```js
// shared/platform-shell.js
logoContent: '<img src="/logo-raciensa.png" alt="RACIEMSA">',
```

Eso se refleja automáticamente en **todos** los itinerarios que usen `applyPlatformShell()`.

### Dimensiones bloqueadas (CSS)

En `styles.css` hay variables:

```css
--shell-header-h: 70px;
--shell-sidebar-w: 270px;
--shell-logo-size: 40px;
--shell-nav-font: 13px;
--shell-nav-small: 9px;
--shell-side-title: 20px;
```

**No las cambies desde el CSS de un módulo concreto.** Si un itinerario necesita algo distinto, se discute y se cambia en el shell compartido.

## 2. Consultas a CLocator (regla de oro)

**Nunca reiniciar / copiar-pegar la lógica de consulta a CLocator** dentro de un mapa o de un módulo nuevo.

Usar siempre:

```js
import { queryClocator, clocatorEndpoint } from "/shared/clocator-client.js";

const data = await queryClocator({
  endpoint: clocatorEndpoint("cemento"),   // o "cerro-verde"
  token: await auth.currentUser.getIdToken(),
  placa: "AKU-861",
  tracto: "20-R-752",
  desde: "...",
  hasta: "...",
  includeMap: false,
  signal: abortController?.signal,
});
```

### Por qué

- Timeouts, formato del body, manejo de errores y reintentos quedan en **un solo sitio**.
- Cuando el backend de CLocator cambie, se actualiza una sola función.
- Al agregar un itinerario nuevo solo se agrega su endpoint en `clocatorEndpoint()` del shared.

### Endpoints actuales

| Itinerario   | Function                  |
|-------------|---------------------------|
| cemento     | `cemento-clocator`        |
| cerro-verde | `cerro-verde-clocator`    |

Los backends pueden seguir siendo funciones separadas (tienen geocercas distintas), pero el **cliente** es único.

## 3. Checklist al crear un itinerario nuevo

- [ ] Copiar el HTML shell de `cemento.html` o `cerro-verde.html`
- [ ] Cambiar solo: `data-itinerary`, textos de side-title, botones de nav y subtítulo
- [ ] Llamar `applyPlatformShell({ itinerary: "...", subtitle: "..." })`
- [ ] Para GPS/CLocator: importar y usar `queryClocator` + `clocatorEndpoint`
- [ ] No tocar anchos de columna ni tamaños de letra del menú lateral
- [ ] No inventar un nuevo `fetch` a CLocator

## 4. Archivos clave

| Archivo | Rol |
|---------|-----|
| `frontend/public/shared/platform-shell.js` | Logo, marca, subtítulo |
| `frontend/public/shared/clocator-client.js` | Consulta CLocator unificada |
| `frontend/public/styles.css` | Dimensiones y tipografía del shell (variables) |
| `cemento.html` / `cerro-verde.html` | Plantillas de referencia del shell |
