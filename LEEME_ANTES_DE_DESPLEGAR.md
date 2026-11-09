# LÉEME ANTES DE DESPLEGAR · cómo no "pisar" el trabajo de otro

> Lectura obligatoria antes de cualquier `git push` a `main` o `firebase deploy`.
> Tiempo de lectura: 2 minutos.

## 0. Método recomendado: despliegue AISLADO por itinerario (desde 12-oct-2026)

Para publicar **un solo itinerario sin tocar los demás**, NO usar `git push` a `main` ni `firebase deploy`.
Usar el workflow **"Desplegar UN itinerario (aislado, sin tocar los demás)"**:

1. GitHub → pestaña **Actions** → ese workflow → **Run workflow**.
2. `itinerarios`: `turno-amanecida` o `quellaveco` (uno solo, o los dos separados por coma). `simulacion`: dejar `true` la primera vez.
3. El workflow descarga el sitio **que está en vivo ahora**, reemplaza solo la carpeta (y el `.html`/`.css`) del itinerario elegido con lo que hay en `main`, comprueba que **todo lo demás quedó idéntico** y que no hay imports rotos, y recién entonces publica.
4. Con `simulacion=true` no publica; los avisos (annotations) del run muestran qué archivos cambiarían.
5. Si algo sale mal, se detiene antes de publicar.

Cambios de documentación (`*.md`) o de `.github/**` ya **no** disparan el despliegue automático de `main`.
Cemento y Cerro Verde todavía no tienen su opción aislada; mientras tanto se publican subiendo a `main` **solo después** de traer los cambios del otro (`git pull`).

## 1. Qué pasó (12-oct-2026)

- Se actualizó **Cerro Verde** desde una copia fuera de GitHub (se publicó con `firebase deploy` desde un equipo).
- Luego se subieron cambios de **Turno Amanecida** y **Quellaveco** a `main`. GitHub desplegó `main` y **borró** la versión nueva de Cerro Verde.
- Al restablecer Cerro Verde desde la otra copia, se **borró** lo último de Turno Amanecida.

Cada despliegue dejó atrás lo que el otro había publicado, aunque nadie tocó el código del otro.

## 2. Por qué pasa

Los itinerarios **se ven independientes, pero se publican juntos**:

- Hay **un solo sitio** de Firebase Hosting (`itinerarios-2fa6f.web.app`) con todos los itinerarios dentro de `frontend/public/`.
- **Cada despliegue reemplaza el sitio completo**, no solo la carpeta que cambió.
- El despliegue automático (`.github/workflows/firebase-hosting-merge.yml`) publica **exactamente lo que hay en `main`**.
- Entonces gana siempre el último que despliega, y solo conserva lo que **su copia** tenía.

Si una versión nueva existe solo en tu computadora (no en `main`), el siguiente despliegue desde otro lugar la elimina.

## 3. Reglas (fuente única de verdad = `main`)

1. **Todo cambio se publica con `git push` a `main`.** Nunca con `firebase deploy` manual.
2. **Antes de empezar a trabajar:** `git checkout main && git pull origin main`.
3. **Antes de subir:** `git pull origin main` otra vez. Si hay conflicto, se resuelve ahí, no se sobrescribe.
4. **No hacer `git push --force`** a `main`.
5. **Cada persona toca solo sus carpetas** (ver tabla). Lo compartido (`shared/`, `index.html`, `styles.css`) se avisa antes.
6. **Cambios grandes o riesgosos: usar rama** (`git checkout -b nombre`) y abrir Pull Request. La vista previa de Firebase se genera sola y no toca producción.
7. **Si cambias un `.js` o `.css`, sube el número de versión `?v=`** del HTML y del `registry.js` de ese itinerario (Hosting guarda esos archivos cerca de 1 hora).

| Itinerario | Carpetas |
|---|---|
| Cemento | `frontend/public/cemento*`, `backend/supabase/functions/cemento-*` |
| Cerro Verde | `frontend/public/cerro-verde*`, `backend/supabase/functions/cerro-verde-*` |
| Turno Amanecida | `frontend/public/turno-amanecida*`, `backend/supabase/functions/turno-amanecida-*`, `backend/cloudflare/clocator-proxy` |
| Quellaveco | `frontend/public/quellaveco*` |
| Compartido (avisar) | `frontend/public/shared/`, `index.html`, `styles.css`, `itinerarios.css`, `.github/` |

## 4. Checklist antes de desplegar

- [ ] `git status` limpio (nada sin commitear que deba salir).
- [ ] `git pull origin main` hecho **justo ahora**.
- [ ] Lo que tengo en mi computadora y que ya está publicado **ya está en `main`**. Si publiqué algo a mano antes, lo subo a `main` **primero**.
- [ ] Solo cambié mis carpetas (revisar con `git diff --stat origin/main`).
- [ ] Subí el `?v=` de lo que cambié.
- [ ] Voy a publicar con `git push origin main`, no con `firebase deploy`.
- [ ] Avisé al otro desarrollador si toqué algo compartido.

## 5. Si hay una versión "pisada": cómo recuperarla

1. **Primero no desplegar nada más.** Cada despliegue nuevo vuelve a cambiar el sitio.
2. Ver qué quedó en vivo y cuándo: GitHub → pestaña **Actions** (cada despliegue indica el commit) y Firebase Console → Hosting → **Historial de versiones**.
3. **Recuperación rápida (sin código):** en Firebase Console → Hosting → Historial, **Revertir** a la versión buena. Es temporal: el próximo push a `main` vuelve a pisar.
4. **Recuperación definitiva:**
   - Quien tiene la versión buena (la que no está en GitHub) hace `git pull origin main`, la fusiona en su copia y hace `git push origin main`.
   - El despliegue automático publicará todo junto: lo suyo y lo de los demás.
5. Verificar abriendo cada itinerario con Ctrl+F5.

## 6. Pendientes relacionados

- Rama `multicuenta-extractor` (sin fusionar): modifica `cerro-verde.html` y `cerro-verde/main.js`. **No fusionar hasta que la versión actual de Cerro Verde esté en `main`**, para evitar conflictos.
- Opción de fondo: un sitio de Hosting por itinerario (despliegue independiente por carpeta). Requiere decidirlo entre los dos desarrolladores, porque Cemento y Cerro Verde comparten `shared/`.

---

## Guardián de itinerarios protegidos (desde 15-oct-2026)

**Qué pasó:** Firebase Hosting reemplaza el sitio completo en cada `firebase deploy`. Cuando se publica desde una
computadora con una copia vieja, Turno Amanecida (y lo demás que esa copia no tiene al día) vuelve a una versión anterior.

**Qué hace el Guardián** (`.github/workflows/guardian-itinerarios.yml`): cada 30 min compara en vivo los itinerarios
listados en `.github/protegidos.txt` (hoy: `turno-amanecida`) contra `main`. Si difieren, repone solo esos
(lo demás queda como esté en vivo). En Actions se ve el aviso `GUARDIÁN` con quién publicó y cuándo.

**Reglas para quien publique:**
1. Antes de `firebase deploy`: `git checkout main && git pull`. No publicar desde una copia sin actualizar.
2. Mejor aún: publicar con el flujo **"Desplegar UN itinerario (aislado)"** (solo cambia lo elegido).
3. Para cambiar un itinerario protegido: primero se actualiza `main`; si no, el Guardián repone la versión de `main`.
4. A pedido: Actions → Guardián → Run workflow (`vigilar` solo informa, `reponer` corrige).
