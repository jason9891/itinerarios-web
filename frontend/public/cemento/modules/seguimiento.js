/**
 * Módulo CEMENTO · Seguimiento diario
 * Lista unidades/OCs abiertas + montados + estado GPS de precarga (segundo plano).
 *
 * No importa el UI de precarga. Solo lee precarga-engine / eventos de bus.
 */
import { esc, moduleHead, trackApi, montadosApi } from "../api-client.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getCurrentPlaca,
  getStatus,
  isReadyForSeguimiento,
  nplate,
} from "../precarga-engine.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  bindRuntime(runtime);
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento…</p></section>`;
  try {
    await render(container, runtime);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en seguimiento</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

function indexMontados(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const fecha = r.fecha_texto || r.fecha || "";
    const ruta = r.ruta || "";
    if (r.tracto_corto) {
      const list = map.get(r.tracto_corto) || [];
      list.push({ tipo: "MONTADO EN", relacionado: r.tracto_largo, ruta, fecha });
      map.set(r.tracto_corto, list);
    }
    if (r.tracto_largo) {
      const list = map.get(r.tracto_largo) || [];
      list.push({ tipo: "MONTANDO", relacionado: r.tracto_corto, ruta, fecha });
      map.set(r.tracto_largo, list);
    }
  }
  return map;
}

function relHtml(rels) {
  if (!rels?.length) return `<span class="muted">—</span>`;
  return rels
    .map(
      (r) =>
        `<div style="margin:2px 0">
          <span style="color:${r.tipo === "MONTADO EN" ? "#38bdf8" : "#a3e635"};font-weight:700">${esc(r.tipo)}</span>
          <b>${esc(r.relacionado)}</b>
          <span class="muted"> · ${esc(r.ruta)} · ${esc(r.fecha)}</span>
        </div>`,
    )
    .join("");
}

function gpsBadge(placa) {
  const st = getStatus(placa);
  const estado = st?.estado || (isRunning() ? "EN COLA" : "SIN PRECARGA");
  const color =
    estado === "COMPLETO"
      ? "#22c55e"
      : estado === "SIN MOVIMIENTO" || estado === "SIN PUNTOS"
        ? "#eab308"
        : estado === "PROCESANDO" || estado === "SEGUNDO INTENTO"
          ? "#38bdf8"
          : estado === "ERROR FINAL"
            ? "#ef4444"
            : "#94a3b8";
  const extra =
    st?.puntos != null
      ? ` · ${st.puntos} pts`
      : estado === "PROCESANDO" && nplate(getCurrentPlaca()) === nplate(placa)
        ? " · ahora"
        : "";
  return `<span style="color:${color};font-weight:700">${esc(estado)}</span><span class="muted">${esc(extra)}</span>`;
}

async function render(container, runtime) {
  const offSap = runtime.bus.on("cemento:sap-applied", () => {
    render(container, runtime).catch(() => {});
  });
  const offMgf = runtime.bus.on("cemento:montados-updated", () => {
    render(container, runtime).catch(() => {});
  });
  cleanup.push(offSap, offMgf);

  let lista;
  try {
    lista = await trackApi({ action: "lista" });
  } catch (e) {
    container.innerHTML =
      moduleHead("Seguimiento diario", "OC · unidades") +
      `<section class="error-box"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></section>`;
    return;
  }

  const placas = lista.placas || [];
  const revisadas = lista.revisadas ?? placas.filter((p) => p.revisada).length;

  const hasta = limaTodayKey();
  const desde = shiftDateKey(hasta, -14);
  let montadosMap = new Map();
  let montadosTotal = 0;
  try {
    const mgf = await montadosApi({ action: "listar", desde, hasta });
    montadosTotal = mgf.total || (mgf.rows || []).length;
    montadosMap = indexMontados(mgf.rows || []);
  } catch (e) {
    console.warn("Montados listar:", e.message);
  }

  const meta = loadMeta();
  const c = counts(meta, placas.length);
  const running = isRunning();

  // Ordenar: listas para trabajar primero, luego en proceso, luego pendientes
  const rank = (p) => {
    const s = getStatus(p.placa)?.estado;
    if (s === "COMPLETO") return 0;
    if (s === "SIN MOVIMIENTO" || s === "SIN PUNTOS") return 1;
    if (s === "PROCESANDO" || s === "SEGUNDO INTENTO") return 2;
    if (s === "REINTENTO") return 3;
    if (s === "ERROR FINAL") return 4;
    return 5;
  };
  const sorted = [...placas].sort((a, b) => rank(a) - rank(b));

  container.innerHTML =
    moduleHead(
      "Seguimiento diario",
      `${placas.length} unidades · ${lista.total_ocs || 0} OCs · GPS listos ${c.ready}${running ? " · precarga en 2º plano" : ""}`,
    ) +
    `<section class="notice" id="cem-track-pre-banner">
      ${
        running
          ? `<b>Precarga en segundo plano.</b> Unidad actual: <b id="cem-track-pre-current">${esc(getCurrentPlaca() || "—")}</b>
             · progreso <b id="cem-track-pre-prog">${c.done}/${meta?.total || placas.length}</b>.
             Puede avanzar con las unidades en <b>COMPLETO</b> / <b>SIN MOVIMIENTO</b> mientras el resto termina.`
          : meta?.completo
            ? `<b>Precarga completa.</b> ${c.ready} unidades con GPS evaluado${c.errors ? ` · ${c.errors} con error` : ""}.`
            : c.ready
              ? `<b>${c.ready} unidades ya tienen GPS</b> de una precarga anterior. El resto aparece como SIN PRECARGA hasta que inicie/reanude en Precargar rutas.`
              : `Sin precarga activa. Puede iniciar en <b>Precargar rutas</b> y volver aquí: la descarga sigue en segundo plano.`
      }
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>Unidades en seguimiento</h2>
        <button type="button" id="cem-track-refresh" class="secondary">ACTUALIZAR</button>
      </div>
      ${
        !sorted.length
          ? `<p class="muted">Sin OCs abiertas. Aplique un SAP con OCs nuevas.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">PLACA / TRACTO</th>
                <th style="text-align:left;padding:8px">CONDUCTOR</th>
                <th style="text-align:right;padding:8px">OCs</th>
                <th style="text-align:left;padding:8px">GPS PRECARGA</th>
                <th style="text-align:left;padding:8px">MONTADOS</th>
                <th style="text-align:center;padding:8px">REVISADA</th>
              </tr></thead>
              <tbody id="cem-track-body">
                ${sorted
                  .map((p) => {
                    const rels = [
                      ...(montadosMap.get(String(p.tracto || "").trim()) || []),
                      ...(montadosMap.get(String(p.placa || "").trim()) || []),
                    ];
                    const seen = new Set();
                    const uniq = rels.filter((r) => {
                      const k = `${r.tipo}|${r.relacionado}|${r.fecha}|${r.ruta}`;
                      if (seen.has(k)) return false;
                      seen.add(k);
                      return true;
                    });
                    const ready = isReadyForSeguimiento(p.placa);
                    return `<tr style="border-top:1px solid #1e3a5f;vertical-align:top" data-placa="${esc(nplate(p.placa))}">
                      <td style="padding:8px">
                        <b>${esc(p.placa)}</b>
                        <div class="muted">${esc(p.tracto)}</div>
                        ${ready ? `<div style="color:#22c55e;font-size:11px;font-weight:700">LISTA PARA REVISAR</div>` : ""}
                      </td>
                      <td style="padding:8px">${esc(p.conductor)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.ocs)}</td>
                      <td style="padding:8px" class="col-gps">${gpsBadge(p.placa)}</td>
                      <td style="padding:8px">${relHtml(uniq)}</td>
                      <td style="padding:8px;text-align:center">${p.revisada ? "✓" : "—"}</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table></div>`
      }
      <p class="muted" style="margin-top:12px">
        Próximo: detalle por unidad con mapa/eventos GPS cuando el estado sea COMPLETO.
        Montados: pegar en Actualizar SAP.
      </p>
    </section>`;

  const patchGpsCell = (placaNorm, payload) => {
    const tr = container.querySelector(`tr[data-placa="${CSS.escape(placaNorm)}"]`);
    if (!tr) return;
    const cell = tr.querySelector(".col-gps");
    if (cell) cell.innerHTML = gpsBadge(placaNorm);
    // badge LISTA PARA REVISAR
    const ready = isReadyForSeguimiento(placaNorm);
    const td = tr.querySelector("td");
    if (td) {
      let mark = td.querySelector(".ready-mark");
      if (ready && !mark) {
        mark = document.createElement("div");
        mark.className = "ready-mark";
        mark.style.cssText = "color:#22c55e;font-size:11px;font-weight:700";
        mark.textContent = "LISTA PARA REVISAR";
        td.appendChild(mark);
      } else if (!ready && mark) {
        mark.remove();
      }
    }
  };

  const offUnit = runtime.bus.on("cemento:precarga-unit", (p) => {
    if (p?.placa) patchGpsCell(nplate(p.placa), p);
    const prog = container.querySelector("#cem-track-pre-prog");
    const cur = container.querySelector("#cem-track-pre-current");
    const m = loadMeta();
    const cc = counts(m, placas.length);
    if (prog) prog.textContent = `${cc.done}/${m?.total || placas.length}`;
    if (cur) cur.textContent = getCurrentPlaca() || p?.placa || "—";
  });
  const offProg = runtime.bus.on("cemento:precarga-progress", (p) => {
    const prog = container.querySelector("#cem-track-pre-prog");
    const cur = container.querySelector("#cem-track-pre-current");
    if (prog && p) prog.textContent = `${p.done ?? 0}/${p.total ?? placas.length}`;
    if (cur) cur.textContent = p?.currentPlaca || getCurrentPlaca() || "—";
    const banner = container.querySelector("#cem-track-pre-banner");
    if (banner && !isRunning() && p && p.running === false) {
      // soft refresh banner text without full re-render
    }
  });
  const offBatch = runtime.bus.on("cemento:precarga-batch", () => {
    // Al terminar el lote, refrescar orden (listas arriba)
    render(container, runtime).catch(() => {});
  });
  cleanup.push(offUnit, offProg, offBatch);

  const btn = container.querySelector("#cem-track-refresh");
  if (btn) {
    const onR = () => render(container, runtime).catch((e) => alert(e.message));
    btn.addEventListener("click", onR);
    cleanup.push(() => btn.removeEventListener("click", onR));
  }
}
