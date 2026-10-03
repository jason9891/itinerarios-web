/**
 * Módulo CEMENTO · Seguimiento diario
 * Lista unidades/OCs abiertas + relaciones de montados (MONTADO EN / MONTANDO A).
 */
import { esc, moduleHead, trackApi, montadosApi } from "../api-client.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
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

/** Índice: tracto → lista de relaciones visibles */
function indexMontados(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const fecha = r.fecha_texto || r.fecha || "";
    const ruta = r.ruta || "";
    // tracto_corto is MONTADO EN tracto_largo
    if (r.tracto_corto) {
      const list = map.get(r.tracto_corto) || [];
      list.push({
        tipo: "MONTADO EN",
        relacionado: r.tracto_largo,
        ruta,
        fecha,
      });
      map.set(r.tracto_corto, list);
    }
    // tracto_largo is MONTANDO (transporta) tracto_corto
    if (r.tracto_largo) {
      const list = map.get(r.tracto_largo) || [];
      list.push({
        tipo: "MONTANDO",
        relacionado: r.tracto_corto,
        ruta,
        fecha,
      });
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

  // Rango de montados: últimos 14 días (hora Lima)
  const hasta = limaTodayKey();
  const desde = shiftDateKey(hasta, -14);
  let montadosMap = new Map();
  let montadosTotal = 0;
  try {
    const mgf = await montadosApi({ action: "listar", desde, hasta });
    montadosTotal = mgf.total || (mgf.rows || []).length;
    montadosMap = indexMontados(mgf.rows || []);
  } catch (e) {
    // no bloquear seguimiento si montados falla
    console.warn("Montados listar:", e.message);
  }

  container.innerHTML =
    moduleHead(
      "Seguimiento diario",
      `${placas.length} unidades · ${lista.total_ocs || 0} OCs abiertas · revisadas ${revisadas}`,
    ) +
    `<section class="notice">
      Las OCs nuevas/reasignadas aplicadas desde <b>Actualizar SAP</b> alimentan esta lista.
      Las relaciones de <b>montados</b> (fecha de salida · montado en / montando a) se cargan del rango ${esc(desde)} → ${esc(hasta)}
      (${montadosTotal} registros).
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>Unidades en seguimiento</h2>
        <button type="button" id="cem-track-refresh" class="secondary">ACTUALIZAR</button>
      </div>
      ${
        !placas.length
          ? `<p class="muted">Sin OCs abiertas. Aplique un SAP con OCs nuevas.</p>`
          : `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr>
                <th style="text-align:left;padding:8px">PLACA / TRACTO</th>
                <th style="text-align:left;padding:8px">CONDUCTOR</th>
                <th style="text-align:right;padding:8px">OCs</th>
                <th style="text-align:left;padding:8px">MONTADOS</th>
                <th style="text-align:center;padding:8px">REVISADA</th>
              </tr></thead>
              <tbody>
                ${placas
                  .map((p) => {
                    const key = String(p.tracto || "").trim() || String(p.placa || "").trim();
                    // buscar por tracto y por placa por si el listado usa distintos campos
                    const rels = [
                      ...(montadosMap.get(String(p.tracto || "").trim()) || []),
                      ...(montadosMap.get(String(p.placa || "").trim()) || []),
                    ];
                    // dedupe
                    const seen = new Set();
                    const uniq = rels.filter((r) => {
                      const k = `${r.tipo}|${r.relacionado}|${r.fecha}|${r.ruta}`;
                      if (seen.has(k)) return false;
                      seen.add(k);
                      return true;
                    });
                    return `<tr style="border-top:1px solid #1e3a5f;vertical-align:top">
                      <td style="padding:8px">
                        <b>${esc(p.placa)}</b>
                        <div class="muted">${esc(p.tracto)}</div>
                      </td>
                      <td style="padding:8px">${esc(p.conductor)}</td>
                      <td style="padding:8px;text-align:right">${esc(p.ocs)}</td>
                      <td style="padding:8px">${relHtml(uniq)}</td>
                      <td style="padding:8px;text-align:center">${p.revisada ? "✓" : "—"}</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table></div>`
      }
      <p class="muted" style="margin-top:12px">
        Pegue guías de montados en <b>Actualizar SAP</b> (panel inferior). Luego actualice esta lista.
      </p>
    </section>`;

  const btn = container.querySelector("#cem-track-refresh");
  if (btn) {
    const onR = () => render(container, runtime).catch((e) => alert(e.message));
    btn.addEventListener("click", onR);
    cleanup.push(() => btn.removeEventListener("click", onR));
  }
}
