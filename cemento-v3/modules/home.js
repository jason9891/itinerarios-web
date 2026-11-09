/**
 * Inicio CEMENTO V3 — arranque limpio y cierre de turno.
 */
import { apiGet, esc, fechaPE, moduleHead } from "../api-client.js";
import {
  sessionStatus,
  iniciarSeguimientoCemV2,
  wipeLocalCementoV2,
} from "../bootstrap.js";
import { consolidarSesionCemV2 } from "../consolidar.js";
import { listMovimientos, listDeltas } from "../session-store.js";
import { countPendingOps } from "../local-track.js";
import { auth } from "../../shared/auth.js";

let cleanup = [];

export async function mount(container) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando…</p></section>`;
  try {
    await render(container);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try {
      fn();
    } catch (_) {}
  }
  cleanup = [];
}

async function render(container) {
  let d = {};
  try {
    d = await apiGet("resumen");
  } catch (_) {
    d = {};
  }
  const st = await sessionStatus().catch(() => ({
    localFirst: false,
    deltas: 0,
    geocercas: 0,
  }));
  const email = auth.currentUser?.email || "—";

  container.innerHTML =
    moduleHead("Inicio", "Flujo local-first · sin pernoctes") +
    `<section class="metrics">
      <article><span>UNIDADES</span><strong>${d.unidades ?? d.total ?? "—"}</strong><small>maestro</small></article>
      <article><span>CORTE</span><strong class="small-value">${esc(d.corte || "—")}</strong><small>vigente</small></article>
      <article><span>USUARIO</span><strong class="small-value">${esc(email)}</strong><small>sesión</small></article>
      <article><span>COLA LOCAL</span><strong>${st.deltas ?? 0}</strong><small>pendientes</small></article>
    </section>


    <details class="panel" id="cem3-guia" ${st.localFirst ? "" : "open"} style="margin-top:12px;border:1px solid #38bdf8">
      <summary style="cursor:pointer;font-weight:900;font-size:16px">GUÍA DE USO · Cemento V3 (paso a paso)</summary>
      <div style="font-size:13px;line-height:1.5;max-width:56rem;margin-top:10px">
        <p style="margin:0 0 8px"><b>Idea central:</b> todo el turno se trabaja <b>en tu navegador</b>. El maestro (Supabase principal, con
          geocercas e históricos) solo interviene <b>al inicio</b> (para bajar datos) y <b>al final</b> (para recibir el resultado: horas
          editadas, OCs cerradas o editadas y placas revisadas). Las rutas GPS se consultan con <b>tu cuenta</b> y se analizan contra las
          geocercas en tu propio navegador.</p>

        <h3 style="margin:14px 0 4px">1 · Iniciar el turno</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li>Pulsa <b>INICIAR SEGUIMIENTO</b> (más abajo). Borra el caché local de V3 (no cierra tu sesión ni toca otros itinerarios).</li>
          <li>Baja del maestro: unidades y OCs del día, placas ya revisadas, geocercas, clave de mapas e históricos de cada tracto.</li>
          <li>Si tienes cambios locales sin enviar, el sistema <b>no te deja</b> iniciar: primero envíalos con <b>ENVIAR CAMBIOS AL MAESTRO</b>.</li>
        </ol>

        <h3 style="margin:14px 0 4px">2 · Actualizar SAP (una vez, antes de editar)</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li>En <b>Actualizar SAP</b> sube el Excel SAP (.xlsx o .xls). Se lee y compara con el histórico en tu navegador; al maestro solo van las OCs accionables.</li>
          <li>Si aparecen <b>rutas nuevas</b>, indica para cada una si es válida (<b>SÍ</b>) o no (<b>NO</b>); se guarda al instante.</li>
          <li>Revisa las <b>reaperturas</b> (REABRIR / CERRAR REVISIÓN) y pulsa <b>APLICAR n OCs APROBADAS</b>.</li>
          <li>Al aplicar, V3 vuelve a bajar el seguimiento del maestro. <b>Hazlo antes de editar</b>: si ya tienes cambios sin enviar, no actualizará hasta que los envíes.</li>
          <li>Si hay guías montadas, usa <b>GUARDAR MONTADOS</b>.</li>
        </ol>

        <h3 style="margin:14px 0 4px">3 · Precargar rutas</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li>En <b>Precargar rutas</b> pulsa <b>INICIAR PRECARGA</b> (o <b>REANUDAR</b> si quedó a medias). Corre en segundo plano: puedes cambiar de módulo.</li>
          <li>Cada unidad termina en <b>COMPLETO</b>, <b>SIN MOVIMIENTO</b> o <b>SIN PUNTOS</b> (listas). <b>REINTENTO</b> significa que está reintentando sola.</li>
          <li><b>APLICAR NUEVO CORTE</b> cambia la fecha de inicio y reinicia todas las placas. <b>ACTUALIZAR LISTA DE UNIDADES</b> solo suma unidades con OC abierta.</li>
          <li>Las rutas se piden a tu cuenta; si no responde, usa el respaldo del principal. Los puntos GPS quedan en tu navegador y <b>nunca se envían al maestro</b>.</li>
        </ol>

        <h3 style="margin:14px 0 4px">4 · Seguimiento (todo local)</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li>Filtra la lista con <b>TODAS / ACTIVAS / REVISADAS</b> y abre una unidad.</li>
          <li><b>VER HORAS</b> muestra ingreso y salida por geocerca. El mapa se abre cuando hay al menos 5 recorridos con puntos.</li>
          <li>Si la ruta está desactualizada usa <b>ACTUALIZAR RECORRIDO</b>: trae lo nuevo y <b>vuelve a analizar con las geocercas</b>.</li>
          <li>Edita fechas y observaciones de cada OC y pulsa <b>💾 GUARDAR</b>. <b>CERRAR</b> prepara el cierre de esa OC (aún puedes corregir y guardar).</li>
          <li>En las OCs cerradas del tracto puedes corregir datos sin reabrir el ciclo.</li>
          <li>Marca <b>✓</b> cuando la placa esté revisada. <b>PAUSAR Y VOLVER</b> te devuelve al inicio sin perder nada.</li>
          <li>Nada de esto llega al maestro todavía. El número <b>COLA LOCAL</b> (arriba) indica cuántos cambios están pendientes de enviar.</li>
        </ol>

        <h3 style="margin:14px 0 4px">5 · Cerrar el turno (aquí interviene el maestro)</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li><b>GUARDAR PARCIAL</b>: envía todo lo trabajado y guarda un corte <b>PARCIAL</b>. Sirve para sacar un reporte con placas aún activas.</li>
          <li><b>TERMINAR SEGUIMIENTO</b>: exige todas las placas revisadas (✓); envía todo y consolida en el maestro. Abre el módulo Reporte.</li>
          <li>Si el envío falla (sin internet, por ejemplo) <b>no se guarda el corte</b> y verás el error: reintenta. Solo se reenvía lo que faltó; no se duplica nada.</li>
          <li>También puedes enviar sin cerrar con <b>ENVIAR n CAMBIO(S) AL MAESTRO</b> (más abajo).</li>
        </ol>

        <h3 style="margin:14px 0 4px">6 · Reporte, archivos y fin</h3>
        <ol style="margin:0;padding-left:1.2rem">
          <li><b>Crear reporte</b> usa el último corte guardado en el maestro: genera el Excel final (31 columnas) y dos imágenes. Hazlo <b>después</b> de GUARDAR PARCIAL o TERMINAR SEGUIMIENTO.</li>
          <li><b>Archivos</b> solo consulta el maestro cuando pulsas <b>DESCARGAR</b>.</li>
          <li>Con el Excel ya generado, pulsa <b>FINALIZAR REPORTE</b>: envía lo que quede y borra el caché local.</li>
        </ol>

        <h3 style="margin:14px 0 4px">Reglas para no perder trabajo</h3>
        <ul style="margin:0;padding-left:1.2rem">
          <li>Usa <b>el mismo navegador y el mismo equipo</b> durante todo el turno. Lo que aún no enviaste vive solo ahí.</li>
          <li>No borres los datos del sitio ni uses ventana privada. Cerrar la pestaña o apagar el equipo no borra nada.</li>
          <li>Antes de irte revisa que <b>COLA LOCAL</b> esté en 0 o envía los cambios.</li>
          <li>Si algo falla al enviar, no repitas el trabajo: solo reintenta el envío.</li>
        </ul>
      </div>
    </details>
    <section class="panel" style="margin-top:12px;border:1px solid #0ea5e9">
      <div class="panel-title">
        <div>
          <h2>Iniciar seguimiento (turno limpio)</h2>
          <p class="muted" style="margin:6px 0 0;font-size:13px;max-width:52rem">
            Borra el caché local de <b>Cemento V3</b> (no toca login ni el Cemento oficial).
            Descarga del maestro: lista, geocercas propias de Cemento, resumen.
            Luego: SAP → maestro · precarga/seguimiento en local · subir al cierre.
          </p>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px">
        <button type="button" id="cemv2-iniciar" class="primary" style="font-size:15px;padding:12px 20px">INICIAR SEGUIMIENTO</button>
        <span id="cemv2-iniciar-msg" class="muted" style="font-size:13px"></span>
      </div>
      <ol class="muted" style="margin:14px 0 0;padding-left:1.2rem;font-size:13px;line-height:1.45;max-width:52rem">
        <li><b>INICIAR SEGUIMIENTO</b> — caché limpio + datos del maestro.</li>
        <li><b>Actualizar SAP</b> — metodología Cemento; nuevos despachos al maestro.</li>
        <li><b>Precarga</b> — rutas GPS solo local.</li>
        <li><b>Seguimiento</b> — ediciones en cola local.</li>
        <li><b>Enviar / Terminar / Finalizar</b> — inyección al maestro y limpieza.</li>
      </ol>
    </section>

    <section class="panel" style="margin-top:12px;border:1px solid #a3e635">
      <div class="panel-title">
        <div>
          <h2>Finalizar reporte (cierre de turno)</h2>
          <p class="muted" style="margin:6px 0 0;font-size:13px">
            Sube cola restante al maestro y borra caché local de V3.
            Genere el Excel del reporte <b>antes</b> (data del maestro).
          </p>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px">
        <button type="button" id="cemv2-finalizar" class="primary">FINALIZAR REPORTE</button>
        <span id="cemv2-finalizar-msg" class="muted" style="font-size:13px"></span>
      </div>
    </section>

    <section class="panel" style="margin-top:12px">
      <div class="panel-title"><h2>Avance local → maestro</h2></div>
      <p id="cemv2-status" class="notice" style="margin:12px 0">…</p>
      <details style="margin:10px 0;font-size:12px">
        <summary style="cursor:pointer;font-weight:700">Libro local (desde → hasta)</summary>
        <pre id="cemv2-libro" style="max-height:160px;overflow:auto;background:#0f172a;color:#cbd5e1;padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap"></pre>
      </details>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <button type="button" id="cemv2-sync" class="primary" ${(st.deltas || 0) < 1 ? "disabled" : ""}>
          ENVIAR ${st.deltas || 0} CAMBIO(S) AL MAESTRO
        </button>
        <span id="cemv2-sync-msg" class="muted" style="font-size:13px"></span>
      </div>
    </section>`;

  const bar = container.querySelector("#cemv2-status");
  if (st.localFirst) {
    bar.innerHTML = `<b>SESIÓN LOCAL V3:</b> activa · ${st.geocercas || 0} geocercas · <b>${st.deltas || 0}</b> en cola.`;
  } else {
    bar.innerHTML = `<b>SESIÓN:</b> use <b>INICIAR SEGUIMIENTO</b> para cargar el maestro en limpio.`;
  }

  const libro = container.querySelector("#cemv2-libro");
  const movs = listMovimientos();
  libro.textContent = movs.length
    ? movs
        .slice(-40)
        .map(
          (m) =>
            `${m.ts?.slice(11, 19) || ""} ${m.action} | ${m.placa || "—"} | ${m.desde} → ${m.hasta}`,
        )
        .join("\n")
    : "Sin movimientos en esta sesión.";

  const btnI = container.querySelector("#cemv2-iniciar");
  const msgI = container.querySelector("#cemv2-iniciar-msg");
  const onI = async () => {
    if (
      !confirm(
        "INICIAR SEGUIMIENTO (Cemento V3) borra el caché local de V3 y descarga datos del maestro.\n¿Continuar?",
      )
    )
      return;
    btnI.disabled = true;
    btnI.textContent = "CARGANDO…";
    try {
      const r = await iniciarSeguimientoCemV2();
      msgI.innerHTML = `<span style="color:#15803d;font-weight:700">Listo.</span> Geocercas: ${r.geocercas} · Placas: ${r.placas}. Siguiente: SAP → Precarga → Seguimiento.`;
      bar.innerHTML = `<b>SESIÓN LOCAL V3:</b> activa (recién iniciada) · ${r.geocercas} geocercas.`;
      libro.textContent = "Sin movimientos en esta sesión.";
    } catch (e) {
      msgI.textContent = e.message || String(e);
    }
    btnI.disabled = false;
    btnI.textContent = "INICIAR SEGUIMIENTO";
  };
  btnI.addEventListener("click", onI);
  cleanup.push(() => btnI.removeEventListener("click", onI));

  const btnS = container.querySelector("#cemv2-sync");
  const msgS = container.querySelector("#cemv2-sync-msg");
  const onS = async () => {
    if (!confirm("¿Enviar cola local al maestro?")) return;
    btnS.disabled = true;
    btnS.textContent = "ENVIANDO…";
    try {
      const r = await consolidarSesionCemV2();
      msgS.innerHTML = r.consolidado
        ? `<span style="color:#15803d;font-weight:700">${r.ok} aplicadas. Cola vacía.</span>`
        : `<span style="color:#b45309;font-weight:700">${r.ok} ok · ${r.failed} fallos.</span>`;
      btnS.textContent = `ENVIAR ${r.pending_left || 0} CAMBIO(S) AL MAESTRO`;
      if (r.pending_left) btnS.disabled = false;
    } catch (e) {
      msgS.textContent = e.message || String(e);
      btnS.disabled = false;
      btnS.textContent = "REINTENTAR";
    }
  };
  btnS.addEventListener("click", onS);
  cleanup.push(() => btnS.removeEventListener("click", onS));

  const btnF = container.querySelector("#cemv2-finalizar");
  const msgF = container.querySelector("#cemv2-finalizar-msg");
  const onF = async () => {
    if (
      !confirm(
        "FINALIZAR REPORTE: sube cola restante y borra caché V3.\nHágalo después de generar el Excel del maestro.\n¿Continuar?",
      )
    )
      return;
    btnF.disabled = true;
    try {
      let pending = (await listDeltas()).length + (await countPendingOps());
      if (pending > 0) {
        const r = await consolidarSesionCemV2();
        pending = r.pending_left || 0;
        if (pending > 0) {
          msgF.innerHTML = `<span style="color:#b45309;font-weight:700">Aún hay ${pending} fallos. No se borró caché.</span>`;
          btnF.disabled = false;
          return;
        }
      }
      await wipeLocalCementoV2();
      msgF.innerHTML = `<span style="color:#15803d;font-weight:700">Caché V3 borrado. Maestro es la fuente de verdad.</span>`;
      bar.innerHTML = `<b>SESIÓN:</b> limpia. Use INICIAR SEGUIMIENTO en el próximo turno.`;
    } catch (e) {
      msgF.textContent = e.message || String(e);
    }
    btnF.disabled = false;
  };
  btnF.addEventListener("click", onF);
  cleanup.push(() => btnF.removeEventListener("click", onF));
}
