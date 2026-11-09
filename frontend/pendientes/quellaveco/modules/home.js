/**
 * Módulo QUELLAVECO · Inicio
 * Estado de la sesión y flujo de uso paso a paso.
 */
import { esc, fechaPE, moduleHead } from "../api-client.js";
import { filtroDefinido } from "../config.js";
import { leerDespachos } from "../store.js";

/** Un paso del flujo: número, título, módulo donde se hace y el detalle. */
function paso(n, titulo, modulo, cuerpo) {
  return `
    <article class="qv-step">
      <div class="qv-step-num">${n}</div>
      <div class="qv-step-body">
        <h3>${titulo} <span class="qv-step-mod">${modulo}</span></h3>
        ${cuerpo}
      </div>
    </article>`;
}

export async function mount(container, runtime) {
  const carga = leerDespachos();
  const p = runtime.state.get("posiciones") || null;

  container.innerHTML = `
    ${moduleHead("Inicio", "Despachos de Quellaveco y seguimiento GPS")}
    <section class="panel">
      <div class="panel-title"><div><h2>Estado de esta sesión</h2><p class="muted">Todo lo que cargas vive solo en esta pestaña: al cerrarla hay que volver a subir el Excel.</p></div></div>
      <div class="qv-grid">
        <div class="qv-card ${carga ? "ok" : "warn"}">
          <small>DESPACHOS CARGADOS</small>
          <b>${carga ? carga.resumen.en_alcance : 0}</b>
          <span class="muted" style="font-size:12px">${carga ? `${esc(carga.archivo)} · ${esc(fechaPE(carga.cargado_en))}` : "Falta: sube el Excel SAP en Despachos (paso 1)"}</span>
        </div>
        <div class="qv-card ${p ? "ok" : ""}">
          <small>POSICIONES GPS</small>
          <b>${p ? p.total : "—"}</b>
          <span class="muted" style="font-size:12px">${p ? `Consultadas ${esc(fechaPE(p.generado_en))}` : "Se consultan en Seguimiento (paso 2)"}</span>
        </div>
        <div class="qv-card ${filtroDefinido() ? "ok" : "warn"}">
          <small>FILTRO DE NEGOCIO</small>
          <b>${filtroDefinido() ? "Definido" : "Sin definir"}</b>
          <span class="muted" style="font-size:12px">${filtroDefinido() ? "Solo pasan los despachos de Quellaveco" : "Se muestran todas las filas del Excel"}</span>
        </div>
      </div>
      ${
        filtroDefinido()
          ? ""
          : `<div class="qv-aviso"><b>Pendiente:</b> definir el cliente (y destino) que identifica un despacho de Quellaveco. Mientras tanto no se filtra nada.</div>`
      }
      <div class="qv-aviso">Esta es la <b>versión inicial, solo frontend</b>: no hay base de datos ni histórico. Cuando se conecte Supabase, los despachos y el seguimiento se guardarán ahí.</div>
    </section>

    <section class="panel">
      <div class="panel-title"><div>
        <h2>Cómo se usa el itinerario, paso a paso</h2>
        <p class="muted">El orden es siempre: <b>Despachos → Seguimiento → Reporte</b>. Son los botones del menú de la izquierda.</p>
      </div></div>

      <div class="qv-steps">
        ${paso(1, "Subir el Excel SAP de despachos", "DESPACHOS", `
          <ol>
            <li>Entra a <b>Despachos</b> y pulsa <b>SELECCIONAR EXCEL SAP (.xlsx)</b>.</li>
            <li>El Excel es el de SAP (ZSDF017) y debe traer, como mínimo, las columnas <b>Entrega, Placa y Cliente</b>. También se leen Destino, Material, Descripcion, Neto, Fecha, Fecha Salida y Salida.</li>
            <li>La plataforma se queda solo con los despachos de <b>Quellaveco</b> (filtro por cliente y destino), toma la <b>primera placa como tracto</b> (la segunda es la carreta) y descarta las entregas repetidas, dejando la última fila.</li>
            <li>Revisa el resultado: <b>leídas</b>, <b>despachos en alcance</b>, <b>tractos únicos</b> y <b>descartadas</b>. En «Descartes» ves qué entregas se quedaron fuera y por qué (fuera del negocio, entrega vacía, placa de tracto incompleta).</li>
          </ol>
          <p class="qv-step-note">El Excel solo se lee en tu navegador, no se envía a ningún servidor, y <b>no se conserva entre sesiones</b>: súbelo en cada turno para no trabajar con datos viejos.</p>
        `)}

        ${paso(2, "Ver dónde está cada despacho", "SEGUIMIENTO", `
          <ol>
            <li>Entra a <b>Seguimiento</b>. La primera vez consulta solo las posiciones actuales de CLocator.</li>
            <li>El mapa muestra el tracto de cada despacho con su color de GPS: <b>verde</b> reporta, <b>amarillo</b> alerta de GPS, <b>rojo</b> no reporta, <b>gris</b> lleva mucho tiempo sin reportar. Los que no aparecen en CLocator salen como «SIN POSICIÓN».</li>
            <li>A la derecha está la tabla de despachos con su estado GPS y el tiempo de parada. Haz clic en una fila (o en un punto del mapa) para ubicar esa unidad.</li>
            <li>Usa <b>ACTUALIZAR POSICIONES</b> cuando quieras datos nuevos, o marca <b>Actualizar cada 1 min</b>. El buscador filtra por entrega, placa o destino.</li>
          </ol>
        `)}

        ${paso(3, "Descargar el reporte", "REPORTE", `
          <ol>
            <li>Entra a <b>Reporte</b> y revisa el resumen: despachos, cuántos tienen posición y si el filtro está definido.</li>
            <li>Si quieres las columnas de GPS llenas, actualiza primero las posiciones en <b>Seguimiento</b>; si no, esas columnas salen vacías.</li>
            <li>Pulsa <b>DESCARGAR EXCEL</b>. Se baja <b>QUELLAVECO_despachos_AAAA-MM-DD.xlsx</b> con una fila por despacho: entrega, fecha, cliente, destino, material, descripción, neto, guía, fecha y hora de salida, tracto, carreta, código CLocator, latitud, longitud, tiempo de parada y estado GPS.</li>
          </ol>
        `)}
      </div>
    </section>
  `;
}

export function unmount() {}
