/**
 * Módulo ABARROTES · Inicio
 * Estado de la sesión y flujo de uso paso a paso.
 */
import { esc, fechaPE, moduleHead } from "../api-client.js";
import { contadores } from "../consolidado.js";
import { leerCarga, leerSeguimiento } from "../store.js";

/** Un paso del flujo: número, título, módulo donde se hace y el detalle. */
function paso(n, titulo, modulo, cuerpo) {
  return `
    <article class="ab-step">
      <div class="ab-step-num">${n}</div>
      <div class="ab-step-body">
        <h3>${titulo} <span class="ab-step-mod">${modulo}</span></h3>
        ${cuerpo}
      </div>
    </article>`;
}

export async function mount(container) {
  const carga = leerCarga();
  const c = carga ? contadores(carga.viajes, leerSeguimiento()) : null;

  container.innerHTML = `
    ${moduleHead("Inicio", "Consolidado de unidades y seguimiento por geocercas")}
    <section class="panel">
      <div class="panel-title"><div><h2>Estado de esta sesión</h2><p class="muted">Todo lo que cargas vive solo en esta pestaña: en cada turno hay que volver a subir los Excel.</p></div></div>
      <div class="ab-grid">
        <div class="ab-card ${c ? "ok" : "warn"}">
          <small>VIAJES A SEGUIR</small><b>${c ? c.total : 0}</b>
          <span class="muted" style="font-size:12px">${carga ? `${c.tractos} tractos · cargado ${esc(fechaPE(carga.cargado_en))}` : "Falta: sube los Excel en Carga (paso 1)"}</span>
        </div>
        <div class="ab-card ${c && c.sin_seguimiento ? "warn" : c ? "ok" : ""}">
          <small>SIN SEGUIMIENTO</small><b>${c ? c.sin_seguimiento : "—"}</b>
          <span class="muted" style="font-size:12px">${c ? `${c.sin_gps} sin GPS consultado · ${c.con_sugerencia} por revisar` : "Se ve en Seguimiento (paso 2)"}</span>
        </div>
        <div class="ab-card ${c && c.revisadas ? "ok" : ""}">
          <small>REVISADAS</small><b>${c ? c.revisadas : "—"}</b>
          <span class="muted" style="font-size:12px">Listas para el Excel de control</span>
        </div>
      </div>
      <div class="ab-aviso">Esta es la <b>versión de prueba, solo frontend</b>: no hay base de datos ni histórico. Los maestros fijos (rutas, tiempos promedio, estados y geocercas) ya vienen dentro del itinerario; solo se sube lo que cambia cada día.</div>
    </section>

    <section class="panel">
      <div class="panel-title"><div>
        <h2>Cómo se usa el itinerario, paso a paso</h2>
        <p class="muted">El orden es siempre: <b>Carga → Seguimiento → Reporte</b>.</p>
      </div></div>
      <div class="ab-steps">
        ${paso(1, "Subir los dos Excel del turno", "CARGA", `
          <ol>
            <li>En <b>Carga</b> sube el <b>Excel SAP</b> (órdenes de carga AQP-LIM) y el <b>Excel de programación TD de Lima</b> (hoja SATELITAL LIMA). Puedes subir uno o los dos.</li>
            <li>De SAP entran las OC que no están concluidas, de los últimos N días (por defecto 10). De TD entran solo las filas <b>MONITOREO</b> (las «FIN DE RUTA» ya terminaron).</li>
            <li>Se cruzan por la <b>placa del tracto</b> (sin guiones): si una unidad de TD ya tiene OC de Huachipa en SAP, se une a esa OC y aporta DT, salida programada y carga; si no, queda como viaje propio.</li>
            <li>Verás cuántos <b>viajes</b>, <b>tractos únicos</b> y de qué <b>origen</b> hay. Los Excel solo se leen en tu navegador y no se envían a ningún servidor.</li>
          </ol>
        `)}
        ${paso(2, "Hacer el seguimiento con sugerencias", "SEGUIMIENTO", `
          <ol>
            <li>Arriba aparece el <b>conteo de unidades sin seguimiento</b>; haz clic en cada tarjeta para filtrar (sin GPS consultado, con sugerencia por revisar, revisadas).</li>
            <li>Pulsa <b>CONSULTAR GPS DE LAS SIN SEGUIMIENTO</b>: se baja la ruta de cada tracto desde tu Supabase de operador y el navegador analiza las geocercas tocadas.</li>
            <li>Cada viaje queda con <b>sugerencias</b>: salida de Gloria/Huachipa, llegada al destino, inicio y fin de retorno, ubicación y estado (estacionado/tránsito cargado o vacío, descarguío, GPS no actualiza). También calcula tiempo de ida y lo compara con el promedio de la ruta (±20 %).</li>
            <li>Selecciona una unidad, corrige lo que haga falta (los destinos sin geocerca dibujada se llenan a mano) y pulsa <b>MARCAR REVISADA</b>: pasa a la siguiente sin seguimiento.</li>
          </ol>
        `)}
        ${paso(3, "Descargar el Excel de control", "REPORTE", `
          <ol>
            <li>En <b>Reporte</b> revisa cuántas están revisadas, sugeridas sin revisar o sin GPS.</li>
            <li>Pulsa <b>DESCARGAR EXCEL</b>: trae la hoja <b>MONITOREO</b> con las mismas columnas del control manual, la hoja <b>SIN SEGUIMIENTO</b> y el <b>RESUMEN POR RUTA</b> y estado.</li>
          </ol>
        `)}
      </div>
    </section>`;
}

export function unmount() {}
