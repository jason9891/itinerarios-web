/**
 * CEMENTO · Seguimiento diario (ventana operativa)
 *
 * Incluye:
 * - Cabecera: GUARDAR PARCIAL · TERMINAR · PAUSAR
 * - Navegación por placas
 * - Tarjetas OC con GUARDAR / FIN DE CICLO
 * - Parihuelas: fondo amarillo claro (.pg-parihuelas / .track-oc-parihuelas)
 * - Montados informativos
 * - Estado GPS de precarga en 2º plano
 *
 * No importa módulos SAP/precarga UI; solo APIs y precarga-engine.
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
let trackState = null;

const STATES = [
  "",
  "ESTACIONADO CARGADO",
  "ESTACIONADO VACÍO",
  "TRANSITO CARGADO",
  "TRANSITO VACÍO",
];

function field(p, k) {
  const s = String(p?.[k] ?? "").trim();
  if (!s) return "";
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : s;
}

function isParihuelas(payload) {
  const carga = String(payload?.CARGA || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return carga.includes("PARIHUELA");
}

function ocCreationDate(payload) {
  const key = payload?.["Fecha de Orden"]
    ? "Fecha de Orden"
    : payload?.["Fecha Carga Real"]
      ? "Fecha Carga Real"
      : payload?.FecIniReal
        ? "FecIniReal"
        : "Creado el";
  const value = field(payload, key);
  return value ? value.split(" ")[0] : "SIN FECHA REGISTRADA";
}

function stateOptions(current) {
  const list = [...STATES];
  if (current && !list.includes(current)) list.push(current);
  return list
    .map(
      (x) =>
        `<option value="${esc(x)}" ${x === current ? "selected" : ""}>${esc(x || "-")}</option>`,
    )
    .join("");
}

function collectOcData(card) {
  const id = card.dataset.id;
  const map = {
    salida_planta: "salida",
    llegada_destino: "llegada",
    inicio_retorno: "retorno",
    fin_de_ciclo: "fin",
    carga_retorno: "carga",
    observaciones: "obs",
    ubicacion: "ubi",
    estado_fisico: "estado",
  };
  const out = {};
  for (const [apiKey, suffix] of Object.entries(map)) {
    const el = card.querySelector(`#f-${id}-${suffix}`);
    if (!el) continue;
    const before = String(el.dataset.original ?? "").trim();
    const now = String(el.value ?? "").trim();
    if (now === before || (!now && !before)) continue;
    out[apiKey] = now || null;
  }
  return out;
}

function ocHtml(x) {
  const p = x.payload || {};
  const o = x.original_payload || p;
  const id = x.id;
  const parihuelas = isParihuelas(p);
  const draft = x.borrador?.accion ? String(x.borrador.accion) : "";
  const closedPrep = draft === "CERRAR";

  const inp = (suffix, label, key) => `
    <label class="track-field">
      <span>${label}</span>
      <div class="paste-input">
        <input id="f-${id}-${suffix}" data-original="${esc(field(o, key))}" value="${esc(field(p, key))}">
        <button type="button" data-paste="f-${id}-${suffix}" title="Pegar">📋</button>
      </div>
    </label>`;

  return `
    <article class="track-oc ${parihuelas ? "track-oc-parihuelas pg-parihuelas" : ""} ${closedPrep ? "pg-closed" : ""}"
      data-id="${id}">
      <header>
        <div>
          <b>OC ${esc(x.orden_carga)}</b>
          <strong>${esc(p.Ruta || "—")}</strong>
          <small>${esc(p.CARGA || "")}</small>
          <span class="oc-created">CREADA: ${esc(ocCreationDate(p))}</span>
          ${parihuelas ? `<span class="pg-special-tag">PARIHUELAS</span>` : ""}
        </div>
        <em>${esc(draft)}</em>
      </header>
      <div class="track-fields">
        ${inp("salida", "SALIDA PLANTA", "FECHA DE SALIDA PLANTA YURA/CARACOTO")}
        ${inp("llegada", "LLEGADA DESTINO", "FECHA LLEGADA A DESTINO")}
        ${inp("retorno", "INICIO RETORNO", "FECHA INICIO DE RETORNO")}
        ${inp("fin", "FIN DE CICLO", "FECHA FIN DE RETORNO AQP/YURA/CRCT")}
      </div>
      <label class="track-field">
        <span>CARGA DE RETORNO</span>
        <input id="f-${id}-carga" data-original="${esc(field(o, "CARGA DE RETORNO"))}" value="${esc(field(p, "CARGA DE RETORNO"))}">
      </label>
      <label class="track-field">
        <span>OBSERVACIONES</span>
        <textarea id="f-${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}">${esc(field(p, "OBSERVACIONES"))}</textarea>
      </label>
      ${inp("ubi", "UBICACIÓN", "UBICACIÓN")}
      <div class="track-actions">
        <select id="f-${id}-estado" data-original="${esc(field(o, "ESTADO"))}">
          ${stateOptions(field(p, "ESTADO") || p.ESTADO || "")}
        </select>
        <button type="button" data-save="${id}">GUARDAR OC</button>
        <button type="button" class="danger" data-close="${id}">FIN DE CICLO</button>
      </div>
    </article>`;
}

function gpsLabel(placa) {
  const st = getStatus(placa);
  const estado = st?.estado || (isRunning() ? "EN COLA" : "SIN PRECARGA");
  const pts = st?.puntos != null ? ` · ${st.puntos} pts` : "";
  return `${estado}${pts}`;
}

function montadosHtml(rels) {
  if (!rels?.length) return `<span class="muted">Sin montados en rango</span>`;
  return rels
    .map(
      (r) =>
        `<div class="mgf-relation ${r.tipo === "MONTADO EN" ? "mounted" : ""}">
          <span class="mgf-role">${esc(r.tipo)}</span>
          <span class="mgf-unit">${esc(r.relacionado)}</span>
          <span class="muted"> · ${esc(r.ruta)} · ${esc(r.fecha)}</span>
        </div>`,
    )
    .join("");
}

export async function mount(container, runtime) {
  cleanup = [];
  bindRuntime(runtime);
  document.body.classList.add("tracking-active");
  container.innerHTML = `<section class="panel"><p class="muted">Cargando seguimiento…</p></section>`;
  try {
    await openTracking(container, runtime);
  } catch (e) {
    document.body.classList.remove("tracking-active");
    container.innerHTML = `<section class="error-box"><h2>Error en seguimiento</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  document.body.classList.remove("tracking-active");
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
  trackState = null;
}

async function openTracking(container, runtime) {
  const lista = await trackApi({ action: "lista" });
  let placas = lista.placas || [];

  // Orden: GPS listo primero (operativo mientras precarga sigue)
  const rank = (p) => {
    const s = getStatus(p.placa)?.estado;
    if (s === "COMPLETO") return 0;
    if (s === "SIN MOVIMIENTO" || s === "SIN PUNTOS") return 1;
    if (s === "PROCESANDO" || s === "SEGUNDO INTENTO") return 2;
    return 3;
  };
  placas = [...placas].sort((a, b) => rank(a) - rank(b));

  // Revisadas persistidas en sesión de lista
  const reviewed = new Set(
    (placas || []).filter((p) => p.revisada).map((p) => nplate(p.placa)),
  );

  // Montados (informativo)
  const hasta = limaTodayKey();
  const desde = shiftDateKey(hasta, -14);
  let montadosMap = new Map();
  try {
    const mgf = await montadosApi({ action: "listar", desde, hasta });
    for (const r of mgf.rows || []) {
      const fecha = r.fecha_texto || r.fecha || "";
      const ruta = r.ruta || "";
      if (r.tracto_corto) {
        const list = montadosMap.get(r.tracto_corto) || [];
        list.push({ tipo: "MONTADO EN", relacionado: r.tracto_largo, ruta, fecha });
        montadosMap.set(r.tracto_corto, list);
      }
      if (r.tracto_largo) {
        const list = montadosMap.get(r.tracto_largo) || [];
        list.push({ tipo: "MONTANDO", relacionado: r.tracto_corto, ruta, fecha });
        montadosMap.set(r.tracto_largo, list);
      }
    }
  } catch (_) {}

  trackState = {
    list: placas,
    index: 0,
    reviewed,
    detail: null,
    montadosMap,
  };

  // Auto-marcar SIN MOVIMIENTO como en producción
  const meta = loadMeta();
  for (const u of placas) {
    const k = nplate(u.placa);
    if (meta?.resultados?.[k]?.estado === "SIN MOVIMIENTO" && !reviewed.has(k)) {
      try {
        await trackApi({ action: "marcar_revisada", placa: u.placa });
        reviewed.add(k);
      } catch (_) {}
    }
  }

  const c = counts(meta, placas.length);
  const running = isRunning();

  container.innerHTML = `
    <section class="desktop-tracking v2 v3 grid-test grid-03">
      <header>
        <div>
          <b>CEMENTO · SEGUIMIENTO</b>
          <small>Operativo · parihuelas en amarillo · GPS de precarga en 2º plano</small>
        </div>
        <span id="preload-global">${running ? `PRECARGA ${c.done}/${meta?.total || placas.length}` : c.ready ? `GPS LISTOS ${c.ready}` : "SIN PRECARGA"}</span>
        <span id="plate-position">PLACA 0/${placas.length}</span>
        <span id="review-count">REVISADAS ${reviewed.size}/${placas.length}</span>
        <button type="button" id="save-partial">GUARDAR PARCIAL</button>
        <button type="button" id="save-all">TERMINAR SEGUIMIENTO</button>
        <button type="button" id="exit-track">PAUSAR Y VOLVER</button>
      </header>
      <main>
        <section class="track-left">
          <div class="plate-nav">
            <button type="button" id="prev">◀</button>
            <div id="plate-strip"></div>
            <button type="button" id="next">▶</button>
          </div>
          <div class="route-refresh">
            <small id="route-update-status">GPS: —</small>
          </div>
          <div id="tracking-map" class="tracking-map-placeholder" style="min-height:180px;border:1px dashed #1e3a5f;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;padding:12px;text-align:center">
            Mapa del recorrido: se enlazará al caché GPS de precarga (siguiente iteración).
          </div>
          <footer>
            <b>RECORRIDO / PRECARGA</b>
            <span id="map-caption">—</span>
          </footer>
        </section>
        <section class="track-center">
          <div class="unit-head">
            <div>
              <small>TRACTO</small>
              <strong id="unit-name">—</strong>
              <span id="unit-sub">—</span>
            </div>
            <button type="button" id="reviewed">MARCAR REVISADA</button>
          </div>
          <div class="last-closed">
            <small>ÚLTIMA OC CERRADA</small>
            <b id="last-closed">—</b>
          </div>
          <div id="unit-montados" class="muted" style="padding:8px 14px"></div>
          <div id="oc-list"></div>
        </section>
        <section class="track-right">
          <header><b>ESTADO GPS · PRECARGA</b></header>
          <div id="gps-events" style="padding:10px">
            <p class="muted">Seleccione una unidad.</p>
          </div>
        </section>
      </main>
    </section>`;

  // Inject minimal parihuelas highlight if CSS specificity needs help on modular shell
  if (!document.getElementById("cem-parihuelas-style")) {
    const st = document.createElement("style");
    st.id = "cem-parihuelas-style";
    st.textContent = `
      .track-oc.track-oc-parihuelas,
      .track-oc.pg-parihuelas {
        background: #f2d778 !important;
        border: 1px solid #b28b17 !important;
      }
      .track-oc.track-oc-parihuelas input,
      .track-oc.track-oc-parihuelas textarea,
      .track-oc.track-oc-parihuelas select {
        background: #fff !important;
      }
      .pg-special-tag {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
        background: #dfb82f;
        border: 1px solid #98740c;
        color: #3f2c00;
      }
      .paste-input { display: flex; gap: 4px; align-items: center; }
      .paste-input input { flex: 1; }
      .track-oc { margin-bottom: 10px; padding: 10px; border-radius: 10px; border: 1px solid #1e3a5f; background: #0b1728; }
      .track-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .track-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
      #plate-strip { display: flex; gap: 6px; overflow: auto; max-width: 100%; }
      #plate-strip button { white-space: nowrap; }
      #plate-strip button.active { outline: 2px solid #38bdf8; }
      #plate-strip button.reviewed { opacity: 0.75; }
    `;
    document.head.appendChild(st);
  }

  const $ = (id) => container.querySelector("#" + id);

  function paintStrip() {
    const strip = $("plate-strip");
    if (!strip) return;
    strip.innerHTML = trackState.list
      .map((u, i) => {
        const k = nplate(u.placa);
        const rev = trackState.reviewed.has(k);
        const gps = getStatus(u.placa)?.estado || "";
        const active = i === trackState.index ? "active" : "";
        const cls = `${active} ${rev ? "reviewed" : ""}`.trim();
        return `<button type="button" data-i="${i}" class="${cls}" title="${esc(gps)}">${esc(String(u.tracto || u.placa).replace(/^20-/i, ""))}</button>`;
      })
      .join("");
    strip.querySelectorAll("button[data-i]").forEach((b) => {
      b.onclick = () => loadUnit(+b.dataset.i);
    });
    $("plate-position").textContent = `PLACA ${trackState.list.length ? trackState.index + 1 : 0}/${trackState.list.length}`;
    $("review-count").textContent = `REVISADAS ${trackState.reviewed.size}/${trackState.list.length}`;
  }

  async function loadUnit(i) {
    if (!trackState.list.length) return;
    trackState.index = Math.max(0, Math.min(i, trackState.list.length - 1));
    const u = trackState.list[trackState.index];
    paintStrip();
    $("unit-name").textContent = u.tracto || u.placa;
    $("unit-sub").textContent = `${u.placa} · cargando OCs…`;
    $("oc-list").innerHTML = `<p class="muted">Cargando…</p>`;
    $("reviewed").textContent = trackState.reviewed.has(nplate(u.placa))
      ? "REVISADA ✓"
      : "MARCAR REVISADA";
    $("reviewed").classList.toggle("done", trackState.reviewed.has(nplate(u.placa)));

    const rels = [
      ...(trackState.montadosMap.get(String(u.tracto || "").trim()) || []),
      ...(trackState.montadosMap.get(String(u.placa || "").trim()) || []),
    ];
    $("unit-montados").innerHTML = montadosHtml(rels);

    const gps = getStatus(u.placa);
    $("route-update-status").textContent = `GPS: ${gpsLabel(u.placa)}`;
    $("map-caption").textContent = gps
      ? `${gps.estado} · ${gps.puntos ?? 0} puntos · ${gps.visitas ?? 0} visitas`
      : isRunning()
        ? `En cola de precarga (actual: ${getCurrentPlaca() || "—"})`
        : "Sin precarga";
    $("gps-events").innerHTML = `
      <div class="gps-summary">
        <small>ESTADO PRECARGA</small><b>${esc(gps?.estado || "SIN PRECARGA")}</b>
        <small>PUNTOS</small><b>${esc(gps?.puntos ?? "—")}</b>
        <small>VISITAS</small><b>${esc(gps?.visitas ?? "—")}</b>
        <small>LISTA PARA REVISAR</small><b>${isReadyForSeguimiento(u.placa) ? "SÍ" : "AÚN NO"}</b>
      </div>
      ${gps?.mensaje ? `<p class="muted">${esc(gps.mensaje)}</p>` : ""}
      <p class="muted" style="margin-top:8px">Los eventos detallados del recorrido se enlazarán al caché GPS local en la siguiente iteración.</p>`;

    try {
      const d = await trackApi({ action: "detalle", placa: u.placa });
      trackState.detail = d;
      $("unit-sub").textContent = `${d.placa || u.placa} · ${(d.ocs || []).length} OC abiertas`;
      $("last-closed").textContent = d.ultima_oc_cerrada
        ? `OC ${d.ultima_oc_cerrada.orden_carga} · ${d.ultima_oc_cerrada.ruta || ""}`
        : "Sin OC cerrada registrada";
      const ocs = d.ocs || [];
      $("oc-list").innerHTML = ocs.length
        ? ocs.map(ocHtml).join("")
        : `<div class="pg-empty muted">SIN OC ABIERTA</div>`;
      wireOcActions();
    } catch (e) {
      $("oc-list").innerHTML = `<div class="error-box"><p>${esc(e.message)}</p></div>`;
    }
  }

  function wireOcActions() {
    const list = $("oc-list");
    list.querySelectorAll("[data-paste]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          const text = await navigator.clipboard.readText();
          const input = list.querySelector("#" + btn.dataset.paste);
          if (input) {
            input.value = text;
            input.dispatchEvent(new Event("input"));
          }
        } catch {
          alert("El navegador no permitió leer el portapapeles.");
        }
      };
    });
    list.querySelectorAll("[data-save]").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest(".track-oc");
        const datos = collectOcData(card);
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = "GUARDANDO…";
        try {
          await trackApi({ action: "guardar", id: +btn.dataset.save, datos });
          btn.textContent = "GUARDADO";
          card.classList.add("pg-saved");
          // actualizar originals
          card.querySelectorAll("[data-original]").forEach((el) => {
            el.dataset.original = el.value;
          });
        } catch (e) {
          alert(e.message);
          btn.textContent = old;
        } finally {
          btn.disabled = false;
        }
      };
    });
    list.querySelectorAll("[data-close]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("¿Preparar FIN DE CICLO (cerrar OC) para esta orden?")) return;
        const card = btn.closest(".track-oc");
        const datos = collectOcData(card);
        btn.disabled = true;
        try {
          await trackApi({ action: "cerrar", id: +btn.dataset.close, datos });
          btn.textContent = "CIERRE PREPARADO";
          card.classList.add("pg-closed");
          const em = card.querySelector("header em");
          if (em) em.textContent = "CERRAR";
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  $("prev").onclick = () => loadUnit(trackState.index - 1);
  $("next").onclick = () => loadUnit(trackState.index + 1);

  $("reviewed").onclick = async () => {
    const u = trackState.list[trackState.index];
    if (!u) return;
    try {
      await trackApi({ action: "marcar_revisada", placa: u.placa });
      trackState.reviewed.add(nplate(u.placa));
      paintStrip();
      $("reviewed").textContent = "REVISADA ✓";
      $("reviewed").classList.add("done");
      // avanzar si hay siguiente
      if (trackState.index < trackState.list.length - 1) {
        await loadUnit(trackState.index + 1);
      }
    } catch (e) {
      alert(e.message);
    }
  };

  $("exit-track").onclick = () => {
    // Pausar: volver al home del itinerario sin consolidar
    document.body.classList.remove("tracking-active");
    runtime.bus.emit("cemento:navigate", { route: "home" });
    // fallback: hash
    location.hash = "#/home";
    // trigger nav if main listens to hash - main uses buttons; call go via hashchange simulation
    document.querySelector('nav button[data-route="home"]')?.click();
  };

  $("save-partial").onclick = async () => {
    const b = $("save-partial");
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "GUARDANDO…";
    try {
      const x = await trackApi({
        action: "guardar_parcial",
        revisadas: [...trackState.reviewed],
      });
      alert(
        x.mensaje ||
          `Corte parcial guardado: ${trackState.reviewed.size}/${trackState.list.length} revisadas.`,
      );
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };

  $("save-all").onclick = async () => {
    if (trackState.reviewed.size !== trackState.list.length) {
      alert(
        `Seguimiento incompleto: ${trackState.reviewed.size}/${trackState.list.length} placas revisadas.`,
      );
      return;
    }
    if (!confirm("¿Terminar seguimiento y consolidar cambios?")) return;
    const b = $("save-all");
    b.disabled = true;
    b.textContent = "TERMINANDO…";
    try {
      const x = await trackApi({
        action: "consolidar",
        revisadas: [...trackState.reviewed],
      });
      alert(
        x.mensaje ||
          `Seguimiento terminado: ${x.revisadas ?? trackState.reviewed.size}/${x.total_placas ?? trackState.list.length} placas.`,
      );
      document.body.classList.remove("tracking-active");
      document.querySelector('nav button[data-route="reporte"]')?.click();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "TERMINAR SEGUIMIENTO";
    }
  };

  // Live precarga updates
  const offUnit = runtime.bus.on("cemento:precarga-unit", () => {
    const u = trackState.list[trackState.index];
    if (!u) return;
    $("route-update-status").textContent = `GPS: ${gpsLabel(u.placa)}`;
    const pre = $("preload-global");
    const m = loadMeta();
    const cc = counts(m, trackState.list.length);
    if (pre) {
      pre.textContent = isRunning()
        ? `PRECARGA ${cc.done}/${m?.total || trackState.list.length}`
        : `GPS LISTOS ${cc.ready}`;
    }
    paintStrip();
  });
  cleanup.push(offUnit);

  paintStrip();
  if (trackState.list.length) await loadUnit(0);
  else {
    $("oc-list").innerHTML = `<p class="muted">No hay unidades con OC abierta.</p>`;
  }
}
