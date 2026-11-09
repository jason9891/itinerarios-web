# clocator-proxy (Cloudflare Worker)

Intermediario ligero entre el navegador y CLocator (Comsatel). Sustituye, para itinerarios nuevos,
la consulta de rutas que hoy hace la función `cemento-clocator` de Supabase y que consume egress.

- **Sin cheerio**: solo cadenas y regex (el plan gratis de Workers da ~10 ms de CPU por petición).
- **Respuesta compacta**: `p: [[tSegUnix, lat, lng], ...]` con 5 decimales; sin análisis ni geocercas.
- **Autenticación**: ID token de Firebase (Web Crypto, sin dependencias) + lista `ALLOWED_EMAILS`.
- **Sesión propia por petición** (no se comparte: el resultado de `recorridoMBean` vive en la sesión y mezclaría unidades).
  El login + página principal cuestan ~12 s, por eso `rutas` agrupa hasta 4 unidades en una sola sesión.
- Un solo trabajo por petición: una unidad (`placa`/`tracto`) y un rango `desde`/`hasta`.

## API (POST JSON, cabecera `Authorization: Bearer <ID token Firebase>`)

| action | cuerpo | respuesta |
|---|---|---|
| `ping` | `{action:"ping"}` | `{ok:true,hora}` (solo valida el acceso) |
| `rutas` | `{action:"rutas", unidades:[{placa,tracto,desde,hasta?}] (máx. 4), debug?}` | `{ok, resultados:[{ok,n,p,...}|{ok:false,error}]}` |
| `ruta` (por defecto) | `{placa, tracto, desde:"dd/MM/yyyy HH:mm:ss", hasta?, debug?}` | `{ok,n,sin_movimiento,ultimo_monitoreo,p:[[t,lat,lng]...]}` |

`t` = segundos Unix (UTC) de la hora de Lima. Con `debug:true` añade `dbg` (subrequests, sesión reusada).

## Despliegue (sin tokens en el chat)

1. Cloudflare → Workers & Pages → `clocator-proxy` → Settings → Builds → conectar el repositorio
   `jason9891/itinerarios-2fa6f` (rama `main`, directorio raíz `backend/cloudflare/clocator-proxy`,
   comando de build vacío, comando de deploy `npx wrangler deploy`).
2. Settings → Variables and Secrets (tipo *Secret*): `CLOCATOR_USER`, `CLOCATOR_PASSWORD`,
   `ALLOWED_EMAILS` (correos separados por coma).
4. Probar desde el navegador con sesión iniciada (consola de `itinerarios-2fa6f.web.app`):

```js
const {auth}=await import('/shared/auth.js'); const t=await auth.currentUser.getIdToken();
const W='https://clocator-proxy.jasontupayachihurtado.workers.dev';
const call=(b)=>fetch(W,{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
console.log(await call({action:'ping'}));
const j=await call({placa:'C3W945',tracto:'20-R-546',desde:'08/10/2026 16:00:00',debug:true});
console.log(j.n,j.dbg,j.error);
```
5. Medir CPU: Worker → Metrics → *CPU time* (p50/p99). Error 1102 = se pasó de CPU → plan Workers Paid.

## Pruebas locales

`npm test` (Node 20+) ejecuta un CLocator simulado: login, tabla, partial/ajax y JSON-RPC.

## Acciones de Turno Amanecida (sin Supabase)

- `snapshot` → `{filas:[[placa,codigo,t_parada,lat,lng,color],...]}` (solo 20-R-; geocercas se filtran en el navegador).
- `config` → `{google_maps_api_key}` (secreto `GOOGLE_MAPS_API_KEY` en Cloudflare).
- `acoples_listar` / `acoples_guardar` → catálogo en KV (binding `ACOPLES`, clave `catalogo`).

Configuración: Workers & Pages → Storage & Databases → KV → crear namespace `ACOPLES`; en el Worker → Bindings → Add → KV namespace, variable `ACOPLES`. Secreto `GOOGLE_MAPS_API_KEY` en Variables.
