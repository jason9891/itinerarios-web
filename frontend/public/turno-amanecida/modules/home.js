import { moduleHead, esc, maestrosApi, fechaPE } from "../api-client.js";

export async function mount(container) {
  container.innerHTML = `
    ${moduleHead("Inicio", "Control nocturno de pernocta · 22:00 a 04:00")}
    <section class="panel">
      <div class="panel-title"><div><h2>Estado de maestros</h2><p class="muted">Carga única de OC y catálogo de acoples. Requeridos para generar la base.</p></div></div>
      <div id="tn-home-status" class="tn-grid"><div class="tn-card"><small>CARGANDO…</small><b>—</b></div></div>
    </section>
    <section class="panel">
      <div class="panel-title"><div><h2>Reglas del itinerario</h2></div></div>
      <ul class="muted" style="line-height:1.7">
        <li>Solo unidades con código <b>20-R-</b>.</li>
        <li>Filtro espacial: geocercas publicadas del itinerario <b>TURNO AMANECIDA</b> (sufijo <b>_TN</b>).</li>
        <li>De cada equipo se usa la <b>última OC</b> (por FecIniReal).</li>
        <li>Tipo de acople se resuelve desde el maestro editable en Supabase.</li>
        <li>Monitoreo: recarga de posiciones cada <b>3 minutos</b> (ajustable).</li>
      </ul>
    </section>
    <section class="panel">
      <div class="panel-title"><div><h2>Geocercas _TN</h2><p class="muted">Revisar y publicar desde el Editor de geocercas · itinerario TURNO AMANECIDA.</p></div>
        <a class="ghost" href="editor-geocercas.html" style="text-decoration:none">ABRIR EDITOR →</a>
      </div>
      <p class="muted">Nombres: Filtro_Macro_Sur_TN, Planta_Yura_TN, Raciemsa_Aqp_TN, Base_Mpquegua_TN, Or_Tacna_TN, Cesur_Caracoto_TN, Aconstruir_Huasao_TN, SMCV_SanJose_TN, Planta_Gloria_TN, Guardia_Civil_TN, Gloria_Majes_TN, Volvo_Aqp_TN, Juliaca_TN.</p>
    </section>
  `;

  const box = container.querySelector("#tn-home-status");
  try {
    const st = await maestrosApi({ action: "estado" });
    const oc = st.oc || {};
    const ac = st.acoples || {};
    box.innerHTML = `
      <div class="tn-card ${oc.filas ? "ok" : "warn"}">
        <small>OC (ÚLTIMA POR EQUIPO)</small>
        <b>${oc.filas ?? 0}</b>
        <span class="muted" style="font-size:12px">${oc.filas ? `Actualizado ${esc(fechaPE(oc.actualizado_en))}` : "Pendiente de carga única"}</span>
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
