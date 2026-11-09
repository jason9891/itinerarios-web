/**
 * Inicio Cerro Verde — punto de arranque limpio del turno.
 */
import { apiGet, esc, fechaPE, moduleHead } from "../api-client.js";
import { sessionStatus, iniciarSeguimientoCv, wipeLocalCerroVerde } from "../bootstrap.js";
import { consolidarSesionCv } from "../consolidar.js";
import { listMovimientos, listDeltas } from "../session-store.js";
import { tenantSummary } from "../../shared/multi-cuenta.js";
import { auth } from "../../shared/auth.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = `<section class="panel"><p class="muted">Cargando módulo home…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en home</h2><p>${esc(e.message)}</p></section>`;
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

async function render(container, runtime) {
  let d = {};
  try {
    d = await apiGet("resumen");
  } catch (_) {
    d = {};
  }

  const dest = tenantSummary(auth.currentUser);
  const st = await sessionStatus().catch(() => ({
    localFirst: false,
    deltas: 0,
    geocercas: 0,
  }));

  container.innerHTML =
    moduleHead("Inicio", "Arranque limpio · local → maestro") +
    `<section class="metrics">
      <article><span>UNIDADES</span><strong>${d.unidades ?? "—"}</strong><small>operación</small></article>
      <article><span>CORTE</span><strong class="small-value">${esc(d.corte || "—")}</strong><small>vigente</small></article>
      <article><span>ÚLTIMA ACTIVIDAD</span><strong class="small-value">${esc(fechaPE(d.ultima_actividad))}</strong><small>GPS</small></article>
      <article><span>EDICIONES LOCALES</span><strong>${st.deltas ?? 0}</strong><small>pendientes de subir</small></article>
    </section>

    <section class="panel" style="margin-top:12px;border:1px solid #0ea5e9">
      <div class="panel-title">
        <div>
          <h2>Iniciar seguimiento (turno limpio)</h2>
          <p class="muted" style="margin:6px 0 0;font-size:13px;max-width:52rem">
            Borra <b>todo el caché local</b> de Cerro Verde (sesión, rutas GPS, contadores, precarga)
            <b>excepto el login</b>. Luego descarga del <b>Supabase maestro</b>: lista, geocercas del itinerario,
            resumen y bases de paradas/pernoctes. Reinicia el contador de revisadas de <b>tu usuario</b> en el maestro.
            Después: SAP → nuevos despachos al maestro · trabajo en local · subir avance al final.
          </p>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px">
        <button type="button" id="cv-iniciar" class="primary" style="font-size:15px;padding:12px 20px">
          INICIAR SEGUIMIENTO
        </button>
        <span id="cv-iniciar-msg" class="muted" style="font-size:13px"></span>
      </div>
      <ol class="muted" style="margin:14px 0 0;padding-left:1.2rem;font-size:13px;line-height:1.45;max-width:52rem">
        <li><b>INICIAR SEGUIMIENTO</b> — caché limpio + datos iniciales del maestro.</li>
        <li><b>Actualizar SAP</b> — comparación local; <b>nuevos despachos se escriben en el maestro</b>.</li>
        <li><b>Precarga / rutas</b> — puntos GPS solo en local (no suben al consolidar).</li>
        <li><b>Seguimiento</b> — guardar/cerrar/revisada en cola local + libro desde→hasta.</li>
        <li><b>Enviar cambios / Excel</b> — inyección ordenada al maestro (auditoría).</li>
      </ol>
    </section>
    <section class="panel" style="margin-top:12px"><p class="muted" style="font-size:13px">Al terminar el Excel de <b>Crear reporte</b>, use allí <b>FINALIZAR REPORTE</b> (cierre de turno / limpia caché local).</p></section>

<section class="panel" id="cv-sync-panel" style="margin-top:12px">
      <div class="panel-title">
        <div>
          <h2>Avance local → Cerro Verde (principal)</h2>
          <p class="muted" style="margin:6px 0 0;font-size:13px">
            Sube cierres, guardados y revisadas sin terminar el Excel.
            No envía rutas GPS. Respeta orden: grupo → guardar → cerrar → revisada → sacar grupo.
          </p>
        </div>
      </div>
      <p id="cv-session-status" class="notice" style="margin:12px 0">…</p>
      <details style="margin:10px 0;font-size:12px">
        <summary style="cursor:pointer;font-weight:700">Libro local (desde → hasta)</summary>
        <pre id="cv-libro" style="max-height:180px;overflow:auto;background:#0f172a;color:#cbd5e1;padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap"></pre>
      </details>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <button type="button" id="cv-sync-now" class="primary" ${(st.deltas || 0) < 1 ? "disabled" : ""}>
          ENVIAR ${st.deltas || 0} CAMBIO(S) AL PRINCIPAL
        </button>
        <span id="cv-sync-msg" class="muted" style="font-size:13px"></span>
      </div>
    </section>`;

  const bar = container.querySelector("#cv-session-status");
  if (st.localFirst) {
    bar.innerHTML =
      `<b>SESIÓN LOCAL:</b> activa · <code>${esc(dest)}</code> · ` +
      `${st.geocercas || 0} geocercas · <b>${st.deltas || 0}</b> edición(es) en cola.`;
  } else {
    bar.innerHTML =
      `<b>SESIÓN:</b> <code>${esc(dest)}</code>. Usa <b>INICIAR SEGUIMIENTO</b> para cargar datos limpios del maestro.`;
  }

  const libro = container.querySelector("#cv-libro");
  if (libro) {
    const movs = listMovimientos();
    if (!movs.length) libro.textContent = "Sin movimientos aún en esta sesión.";
    else {
      libro.textContent = movs
        .slice(-40)
        .map(
          (m) =>
            `${m.ts?.slice(11, 19) || ""} ${m.action} | ${m.placa || "—"} ${m.orden_carga || ""} | ${m.desde} → ${m.hasta}`,
        )
        .join("\n");
    }
  }

  const btnIniciar = container.querySelector("#cv-iniciar");
  const msgIniciar = container.querySelector("#cv-iniciar-msg");
  const onIniciar = async () => {
    const ok = confirm(
      "INICIAR SEGUIMIENTO borra TODO el caché local de Cerro Verde (rutas, contadores, cola pendiente) y reinicia tus revisadas en el maestro.\n\n" +
        "No cierra tu sesión de login.\n\n¿Continuar?",
    );
    if (!ok) return;
    btnIniciar.disabled = true;
    btnIniciar.textContent = "LIMPIANDO Y CARGANDO…";
    msgIniciar.textContent = "Borrando caché local…";
    try {
      const r = await iniciarSeguimientoCv();
      msgIniciar.innerHTML =
        `<span style="color:#15803d;font-weight:700">Listo.</span> ` +
        `Geocercas: ${r.geocercas} · Placas: ${r.placas ?? "—"} · Revisadas ahora: ${r.revisadas ?? 0}. ` +
        `Siguiente: Actualizar SAP → Precarga → Seguimiento.`;
      btnIniciar.textContent = "INICIAR SEGUIMIENTO";
      btnIniciar.disabled = false;
      // refrescar métricas de sesión
      const st2 = await sessionStatus();
      if (bar && st2.localFirst) {
        bar.innerHTML =
          `<b>SESIÓN LOCAL:</b> activa (recién iniciada) · <code>${esc(dest)}</code> · ` +
          `${st2.geocercas || 0} geocercas · cola ${st2.deltas || 0}.`;
      }
      const syncBtn = container.querySelector("#cv-sync-now");
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = "ENVIAR 0 CAMBIO(S) AL PRINCIPAL";
      }
      if (libro) libro.textContent = "Sin movimientos aún en esta sesión.";
    } catch (e) {
      msgIniciar.textContent = e.message || String(e);
      btnIniciar.disabled = false;
      btnIniciar.textContent = "INICIAR SEGUIMIENTO";
    }
  };
  btnIniciar?.addEventListener("click", onIniciar);
  cleanup.push(() => btnIniciar?.removeEventListener("click", onIniciar));

  const btn = container.querySelector("#cv-sync-now");
  const msg = container.querySelector("#cv-sync-msg");
  const onSync = async () => {
    if (!confirm("¿Enviar ediciones locales al Supabase principal de Cerro Verde?")) return;
    btn.disabled = true;
    btn.textContent = "ENVIANDO…";
    msg.textContent = "Subiendo…";
    try {
      const r = await consolidarSesionCv({ includeSummary: true });
      if (r.consolidado) {
        const soft = r.soft ? ` · ${r.soft} omitida(s)` : "";
        msg.innerHTML = `<span style="color:#15803d;font-weight:700">Listo: ${r.ok} aplicadas${soft}. Cola vacía.</span>`;
        btn.textContent = "ENVIAR 0 CAMBIO(S) AL PRINCIPAL";
      } else {
        msg.innerHTML = `<span style="color:#b45309;font-weight:700">${r.ok} ok · ${r.soft || 0} omitidas · ${r.failed} fallos.</span>`;
        btn.textContent = `REINTENTAR ${r.pending_left || r.failed}`;
        btn.disabled = false;
      }
    } catch (e) {
      msg.textContent = e.message || String(e);
      btn.disabled = false;
      btn.textContent = "REINTENTAR ENVÍO";
    }
  };
  btn?.addEventListener("click", onSync);
  cleanup.push(() => btn?.removeEventListener("click", onSync));
}
