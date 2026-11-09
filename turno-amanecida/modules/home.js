import { moduleHead, esc, maestrosApi, fechaPE } from "../api-client.js?v=tn30";

/** Un paso del flujo: número, título, módulo donde se hace y el detalle. */
function paso(n, titulo, modulo, cuerpo) {
  return `
    <article class="tn-step">
      <div class="tn-step-num">${n}</div>
      <div class="tn-step-body">
        <h3>${titulo} <span class="tn-step-mod">${modulo}</span></h3>
        ${cuerpo}
      </div>
    </article>`;
}

export async function mount(container) {
  container.innerHTML = `
    ${moduleHead("Inicio", "Identificar tránsitos después de las 22:00 · clasificar pernocte y riesgo")}
    <section class="panel">
      <div class="panel-title"><div><h2>Estado antes de empezar</h2><p class="muted">La OC se pide en cada turno; el catálogo de acoples ya viene cargado.</p></div></div>
      <div id="tn-home-status" class="tn-grid"><div class="tn-card"><small>CARGANDO…</small><b>—</b></div></div>
    </section>

    <section class="panel">
      <div class="panel-title"><div>
        <h2>Cómo se usa el itinerario, paso a paso</h2>
        <p class="muted">El orden es siempre el mismo: <b>Maestros → Base del turno → Monitoreo → Reporte</b>. Son los botones del menú de la izquierda.</p>
      </div></div>

      <div class="tn-steps">
        ${paso(1, "Subir el Excel de OC", "MAESTROS", `
          <ol>
            <li>Entra a <b>Maestros</b> y pulsa <b>SELECCIONAR OC (.xlsx)</b>.</li>
            <li>El archivo debe traer estas columnas: <b>FecIniReal, Equipo, Acoplado 1, Nombre Piloto, Descripción Ruta, Material de Servicio</b>. Los títulos pueden estar en la fila 1 o en la fila 2.</li>
            <li>La plataforma deja <b>una sola OC por equipo</b>: la de <b>FecIniReal</b> más reciente (si empatan, la de mayor <b>OrdCarga</b>). De ahí salen el piloto, la ruta, la mercadería y el acople de cada unidad.</li>
            <li>Comprueba que aparezca <b>✔ OC cargada para esta sesión</b> con el número de equipos. Si aparece «Cabeceras incompletas», revisa los títulos de las columnas.</li>
          </ol>
          <p class="tn-step-note">La OC vale <b>solo para esta pestaña</b>: no se guarda entre sesiones. Si cierras la pestaña o vas a generar la base de nuevo, vuelve a subir el Excel actualizado.</p>
          <p class="tn-step-note">Si falta un acople en el catálogo (ya hay cerca de 1.800), añádelo en la misma pantalla con <b>Añadir acople</b>: código, carrocería y gestor.</p>
        `)}

        ${paso(2, "Generar la base del turno", "BASE DEL TURNO", `
          <ol>
            <li>Entra a <b>Base del turno</b> y revisa que las tarjetas muestren la OC de esta sesión y el catálogo de acoples.</li>
            <li>Pulsa <b>GENERAR SNAPSHOT REAL</b>. La plataforma consulta la posición de las unidades en CLocator y se queda solo con las que cumplen las tres reglas: están dentro de <b>Filtro_Macro_Sur_TN</b>, <b>no</b> están dentro de una planta o base conocida (zona de tránsito) y son tractos <b>20-R-</b>.</li>
            <li>Cada unidad se cruza con su última OC y con su tipo de acople. Mira en el registro de la pantalla la línea <b>«Match: X/Y con OC»</b>: si X es muy bajo, probablemente subiste una OC equivocada o vieja.</li>
            <li>Al terminar empieza sola la <b>precarga de recorridos</b> (desde las 16:00 del día del turno hasta ahora). No hace falta esperarla para seguir.</li>
            <li>Pulsa <b>ABRIR MONITOREO CON ESTA BASE</b>.</li>
          </ol>
          <p class="tn-step-note">Si no subiste la OC, la base se genera igual pero las unidades salen <b>sin piloto, ruta ni acople</b>, y el registro te lo avisa.</p>
        `)}

        ${paso(3, "Vigilar el mapa y revisar cada unidad", "MONITOREO", `
          <p><b>Qué ves en la pantalla</b></p>
          <ul>
            <li><b>Arriba:</b> fecha del turno (la noche en que empieza), contadores <b>pendientes / calificadas / revisar / total</b>, hora de la última actualización y los botones <b>REFRESCAR</b>, <b>🔔 SONIDO</b> y <b>DETENER</b>. Las posiciones se actualizan solas <b>cada 1 minuto</b>.</li>
            <li><b>Color del punto:</b> verde = reporta, amarillo = alerta de GPS, rojo = no reporta, gris (plomo) = lleva mucho tiempo sin reportar.</li>
            <li><b>Círculos alrededor del punto</b> (su tamaño en pantalla es fijo, se ven aunque alejes el mapa):
              <b>🟡 amarillo</b> = se movió 100 m o más entre las 22:00 y las 23:00; <b>🔴 rojo</b> = se movió 100 m o más desde las 23:00. Una unidad que está quieta desde antes de las 22:00 no lleva círculo.</li>
            <li><b>Alertas:</b> cuando una unidad <b>pasa</b> a amarillo o a rojo aparece un aviso arriba a la derecha del mapa y suena un beep. Haz clic en el aviso para ir a esa unidad. El botón <b>🔔 SONIDO</b> activa o apaga el beep. No se repite el aviso por la misma unidad y el mismo nivel.</li>
            <li><b>Lista de unidades</b> a la derecha, ordenada por prioridad: primero las <b>en movimiento</b>, luego las <b>detenidas</b> con más tiempo de parada y al final las de <b>GPS perdido</b>.</li>
            <li><b>Filtros:</b> POR CLASIFICAR (el que se abre por defecto), EN TRÁNSITO, DETENIDAS, ZONA TRÁNSITO, CALIFICADAS, REVISAR y TODAS. Además hay un buscador por código, placa, piloto o ruta.</li>
          </ul>
          <p><b>Qué haces con cada unidad</b></p>
          <ol>
            <li>Haz clic en la unidad (en la lista o en el mapa). Se dibuja su <b>recorrido</b>: línea <b>azul</b> de 16:00 a 22:00 y línea <b>roja</b> después de las 22:00.</li>
            <li>Rellena la ficha de abajo: <b>STATUS</b> (tránsito cargado, tránsito vacío, estacionado cargado o estacionado vacío), <b>RIESGO</b> (bajo, medio o alto), <b>PUNTO AUTORIZADO</b> SI/NO, <b>COBERTURA GPS</b> SI/NO, <b>TIPO DE LUGAR</b>, <b>PUNTO DE PERNOCTE</b> y <b>OBSERVACIONES</b>. El campo <b>RUTA</b> viene de la OC y puedes corregirlo.</li>
            <li>Pulsa <b>GUARDAR</b>. La unidad pasa a <b>CALIFICADA</b> y sale de la lista de pendientes.</li>
            <li><b>COPIAR</b> y <b>PEGAR</b> repiten la misma clasificación en otra unidad (no copian la ruta), útil cuando varias están en el mismo lugar. <b>LIMPIAR</b> vacía los campos de la ficha.</li>
            <li><b>NO VA</b> marca una unidad que no corresponde al turno: queda en <b>REVISAR</b> y sale así en el reporte.</li>
          </ol>
          <p class="tn-step-note">Cuando todas las unidades están clasificadas, la plataforma <b>detiene sola</b> la actualización de posiciones y rutas, y te avisa que pases a Reporte. También puedes detenerla con <b>DETENER</b> y retomarla con <b>REANUDAR</b>.</p>
          <p class="tn-step-note">Las clasificaciones y la base quedan guardadas <b>en este navegador</b>. Usa el mismo equipo y el mismo navegador durante todo el turno y no borres los datos del sitio.</p>
        `)}

        ${paso(4, "Cerrar el turno y descargar el reporte", "REPORTE", `
          <ol>
            <li>Entra a <b>Reporte</b> y confirma la <b>fecha del turno</b>.</li>
            <li>Revisa el resumen: unidades, <b>calificadas</b>, <b>revisar / NO VA</b> y <b>pendientes</b>.</li>
            <li>Si quedan pendientes, puedes volver con <b>VOLVER A MONITOREO</b>. Si las descargas así, las pendientes salen con las columnas de clasificación vacías, y las que no reportan (punto rojo) salen automáticamente como <b>GPS PERDIDO</b>.</li>
            <li>Pulsa <b>DESCARGAR EXCEL</b>. Se baja <b>base_pernocta_AAAA-MM-DD.xlsx</b> con una fila por unidad y 17 columnas: fecha, código externo, código y tipo de acople, gestor, operador, mercadería, ruta, status, riesgo, punto autorizado, punto de pernocte, tipo de lugar, cobertura GPS, latitud, longitud y observaciones.</li>
            <li>Si aún sigue la alimentación de rutas, pulsa <b>DETENER ALIMENTACIÓN DE RUTAS</b> para cerrar el turno.</li>
          </ol>
        `)}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title"><div><h2>Reglas del itinerario</h2></div></div>
      <ul class="muted" style="line-height:1.7">
        <li><b>Objetivo:</b> detectar unidades que siguen en tránsito o detenidas <b>pasadas las 22:00</b>. La ventana del turno va de <b>22:00 a 04:00</b>.</li>
        <li>Universo: solo tractos <b>20-R-</b> dentro de <b>Filtro_Macro_Sur_TN</b>.</li>
        <li>«Tránsito» = dentro del macro pero <b>fuera de un punto conocido</b> (planta, base, etc.).</li>
        <li>Última OC por equipo + tipo de acople alimentan la ficha de cada unidad.</li>
      </ul>
    </section>

    <section class="panel">
      <div class="panel-title"><div><h2>Geocercas _TN</h2><p class="muted">Solo si cambian los puntos: revisar y publicar desde el Editor de geocercas · itinerario TURNO AMANECIDA.</p></div>
        <a class="ghost" href="editor-geocercas.html" style="text-decoration:none">ABRIR EDITOR →</a>
      </div>
      <p class="muted">Nombres: Filtro_Macro_Sur_TN, Planta_Yura_TN, Raciemsa_Aqp_TN, Base_Mpquegua_TN, Or_Tacna_TN, Cesur_Caracoto_TN, Aconstruir_Huasao_TN, SMCV_SanJose_TN, Planta_Gloria_TN, Guardia_Civil_TN, Gloria_Majes_TN, Volvo_Aqp_TN, Juliaca_TN.</p>
    </section>
  `;

  const box = container.querySelector("#tn-home-status");
  try {
    const st = await maestrosApi({ action: "estado" });
    let oc = {};
    try {
      const l = JSON.parse(sessionStorage.getItem("tn_oc_ultima_v1") || "{}") || {};
      oc = { filas: l.filas?.length || 0, actualizado_en: l.actualizado_en };
    } catch {
      oc = {};
    }
    const ac = st.acoples || {};
    box.innerHTML = `
      <div class="tn-card ${oc.filas ? "ok" : "warn"}">
        <small>OC DE ESTA SESIÓN (ÚLTIMA POR EQUIPO)</small>
        <b>${oc.filas ?? 0}</b>
        <span class="muted" style="font-size:12px">${oc.filas ? `Cargada ${esc(fechaPE(oc.actualizado_en))}` : "Falta: sube el Excel de OC en Maestros (paso 1)"}</span>
      </div>
      <div class="tn-card ${ac.filas ? "ok" : "warn"}">
        <small>TIPO ACOPLE</small>
        <b>${ac.filas ?? 0}</b>
        <span class="muted" style="font-size:12px">${ac.filas ? `Actualizado ${esc(fechaPE(ac.actualizado_en))}` : "Pendiente de carga única"}</span>
      </div>
      <div class="tn-card">
        <small>VENTANA</small>
        <b>22:00–04:00</b>
        <span class="muted" style="font-size:12px">Fecha del turno = noche de inicio</span>
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div class="tn-card warn"><small>MAESTROS</small><b>Sin backend</b><span class="muted" style="font-size:12px">${esc(e.message)}. Despliega la función turno-amanecida-maestros.</span></div>`;
  }
}

export function unmount() {}
