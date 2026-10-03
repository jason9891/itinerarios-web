/**
 * CEMENTO · Seguimiento
 * Pestañas R-XXX (navegación) + panel detalle a ancho completo (inputs usables)
 * Layout: mapa | detalle | GPS  — split 40/50/10 redimensionable
 */
import { esc, trackApi, montadosApi } from "../api-client.js";
import { API } from "../registry.js";
import { limaTodayKey, shiftDateKey } from "../sap-parse.js";
import {
  bindRuntime,
  loadMeta,
  counts,
  isRunning,
  getStatus,
  nplate,
  formatPE,
} from "../precarga-engine.js";
import { readGPS, cacheGPS, gpsKey } from "../gps-cache.js";
import { queryClocator } from "../../shared/clocator-client.js";
import { ensureTrackingMap, drawTrackingRoute, toggleInspection, resetMapState } from "../map-draw.js";

let cleanup = [];
let state = null;
let trackingSplit = { mapa: 40, grilla: 50, gps: 10 };

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
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
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
  for (const key of ["Fecha de Orden", "Fecha Carga Real", "FecIniReal", "Creado el"]) {
    const v = field(payload, key);
    if (v) return v.split(" ")[0];
  }
  return "SIN FECHA";
}

function stateOptions(current) {
  const list = [...STATES];
  if (current && !list.includes(current)) list.push(current);
  return list
    .map((x) => `<option value="${esc(x)}" ${x === current ? "selected" : ""}>${esc(x || "-")}</option>`)
    .join("");
}

function shortTracto(v) {
  return String(v || "—").replace(/^20-/i, "");
}

function peToInput(pe) {
  const m = String(pe || "").match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
}

function inputToPE(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}`;
}

function collectOcData(row) {
  const id = row.dataset.ocId;
  const map = {
    estado_fisico: "estado",
    salida_planta: "salida",
    llegada_destino: "llegada",
    carga_retorno: "carga",
    observaciones: "obs",
    inicio_retorno: "retorno",
    fin_de_ciclo: "fin",
    ubicacion: "ubi",
  };
  const out = {};
  for (const [apiKey, suffix] of Object.entries(map)) {
    const el = row.querySelector(`[data-f="${id}-${suffix}"]`);
    if (!el) continue;
    const before = String(el.dataset.original ?? "").trim();
    const now = String(el.value ?? "").trim();
    if (now === before || (!now && !before)) continue;
    out[apiKey] = now || null;
  }
  return out;
}

function montadosFor(unit) {
  if (!state) return [];
  const keys = [unit.tracto, unit.placa, nplate(unit.placa)].map((x) => String(x || "").trim());
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    for (const r of state.montadosMap.get(k) || []) {
      const id = `${r.tipo}|${r.relacionado}|${r.fecha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function montadosHtml(unit) {
  const parts = montadosFor(unit).map((r) => {
    const arrow = r.tipo === "MONTADO EN" ? "←" : "→";
    return `<span class="sg-mont ${r.tipo === "MONTADO EN" ? "in" : "out"}"><b>${esc(r.tipo)}</b> ${arrow} ${esc(shortTracto(r.relacionado))}</span>`;
  });
  return parts.length ? `<div class="sg-mont-row">${parts.join("")}</div>` : "";
}

function fieldInput(id, suffix, label, value, original) {
  return `<div style="display:block;width:100%;margin:0 0 10px 0;box-sizing:border-box">
  <div style="display:block;font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">${label}</div>
  <div style="display:flex;gap:6px;align-items:stretch;width:100%">
    <input type="text" data-f="${id}-${suffix}" data-original="${esc(original)}" value="${esc(value)}"
      autocomplete="off"
      style="flex:1 1 auto;width:100%;min-width:0;min-height:40px;height:40px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600">
    <button type="button" data-paste="${id}-${suffix}" title="Pegar"
      style="flex:0 0 40px;width:40px;height:40px;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;cursor:pointer">📋</button>
  </div>
</div>`;
}

function ocRowHtml(oc, unitIndex, ocIndex, totalOcs, unit) {
  const p = oc.payload || {};
  const o = oc.original_payload || p;
  const id = oc.id;
  const parihuelas = isParihuelas(p);
  const draft = oc.borrador?.accion ? String(oc.borrador.accion) : "";
  const reviewed = state.reviewed.has(nplate(unit.placa));
  const estado = field(p, "ESTADO") || p.ESTADO || "";
  const bg = parihuelas ? "#fffbeb" : "#ffffff";
  const border = parihuelas ? "#eab308" : "#64748b";

  const head =
    ocIndex === 0
      ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 10px 0;padding:8px 10px;background:#eff6ff;border-radius:8px 8px 0 0;border:2px solid ${border};border-bottom:0">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-weight:900;font-size:13px">${unitIndex}</span>
            <strong style="font-size:20px;color:#0f172a">${esc(shortTracto(unit.tracto || unit.placa))}</strong>
            <span style="font-size:12px;color:#64748b">${totalOcs} OC</span>
            ${reviewed ? `<span style="color:#16a34a;font-weight:900">✓ REVISADA</span>` : ""}
            ${parihuelas ? `<span style="background:#fde68a;border:1px solid #d97706;color:#78350f;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:900">PARIHUELAS</span>` : ""}
          </div>
          <button type="button" data-review="${esc(unit.placa)}"
            style="background:${reviewed ? "#dcfce7" : "#16a34a"};color:${reviewed ? "#166534" : "#fff"};border:1px solid #15803d;border-radius:6px;padding:8px 12px;font-weight:800;font-size:12px;cursor:pointer">
            ${reviewed ? "✓ REVISADA" : "VALIDAR REVISADA"}
          </button>
        </div>`
      : "";

  return `
  <div style="margin:0 0 12px 0">
    ${head}
    <article class="pg-oc-row" data-oc-id="${id}" data-placa="${esc(nplate(unit.placa))}"
      style="display:block!important;width:100%!important;box-sizing:border-box;padding:12px;background:${bg};border:2px solid ${border};border-radius:${ocIndex === 0 ? "0 0 8px 8px" : "8px"};min-width:0!important;grid-template-columns:none!important;grid-template-rows:none!important">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin:0 0 12px 0">
        <div>
          <div style="font-size:16px;font-weight:900;color:#0f172a">OC ${esc(oc.orden_carga || "—")}
            <span style="color:#1d4ed8;font-weight:700;margin-left:8px">${esc(p.Ruta || "—")}</span>
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">FECHA CARGA REAL: ${esc(ocCreationDate(p))}${draft ? " · " + esc(draft) : ""}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" data-save="${id}"
            style="background:#2563eb;color:#fff;border:1px solid #1d4ed8;border-radius:6px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer">GUARDAR</button>
          <button type="button" data-close="${id}"
            style="background:#fff;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer">FIN DE CICLO</button>
        </div>
      </div>

      <div style="display:block;width:100%">
        <div style="display:block;width:100%;margin:0 0 10px 0">
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">ESTADO</div>
          <select data-f="${id}-estado" data-original="${esc(field(o, "ESTADO") || "")}"
            style="display:block;width:100%;min-height:40px;height:40px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600">
            ${stateOptions(estado)}
          </select>
        </div>
        ${fieldInput(id, "salida", "SALIDA DE PLANTA", field(p, "FECHA DE SALIDA PLANTA YURA/CARACOTO"), field(o, "FECHA DE SALIDA PLANTA YURA/CARACOTO"))}
        ${fieldInput(id, "llegada", "LLEGADA A DESTINO", field(p, "FECHA LLEGADA A DESTINO"), field(o, "FECHA LLEGADA A DESTINO"))}
        ${fieldInput(id, "carga", "CARGA DE RETORNO", field(p, "CARGA DE RETORNO"), field(o, "CARGA DE RETORNO"))}
        ${fieldInput(id, "retorno", "INICIO DE RETORNO", field(p, "FECHA INICIO DE RETORNO"), field(o, "FECHA INICIO DE RETORNO"))}
        ${fieldInput(id, "fin", "FIN DE RETORNO", field(p, "FECHA FIN DE RETORNO AQP/YURA/CRCT"), field(o, "FECHA FIN DE RETORNO AQP/YURA/CRCT"))}
        ${fieldInput(id, "ubi", "UBICACIÓN", field(p, "UBICACIÓN"), field(o, "UBICACIÓN"))}
        <div style="display:block;width:100%;margin:0 0 10px 0">
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin:0 0 4px 0">OBSERVACIONES</div>
          <textarea data-f="${id}-obs" data-original="${esc(field(o, "OBSERVACIONES"))}"
            style="display:block;width:100%;min-height:72px;box-sizing:border-box;padding:8px 10px;border:2px solid #334155;border-radius:6px;background:#fff;color:#0f172a;font-size:15px;font-weight:600;resize:vertical">${esc(field(p, "OBSERVACIONES"))}</textarea>
        </div>
      </div>
      <p class="pg-save-hint" data-save-hint="${id}" hidden style="color:#15803d;font-weight:800;margin:6px 0 0">✓ Guardado</p>
    </article>
  </div>`;
}

function unitGroupHtml(unit, ordinal) {
  const ocs = unit.ocs || [];
  if (!ocs.length) {
    return `<div style="margin:0 0 12px 0;padding:12px;border:2px solid #cbd5e1;border-radius:8px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong style="font-size:18px">${ordinal}. ${esc(shortTracto(unit.tracto || unit.placa))}</strong>
        <button type="button" data-review="${esc(unit.placa)}"
          style="background:#16a34a;color:#fff;border:0;border-radius:6px;padding:8px 12px;font-weight:800;cursor:pointer">VALIDAR REVISADA</button>
      </div>
      <p style="color:#64748b;margin:8px 0 0">SIN OC ABIERTA</p>
      ${montadosHtml(unit)}
    </div>`;
  }
  return `<div style="margin:0 0 16px 0" data-placa="${esc(nplate(unit.placa))}">
    ${ocs.map((oc, i) => ocRowHtml(oc, ordinal, i, ocs.length, unit)).join("")}
    ${montadosHtml(unit)}
  </div>`;
}

function filteredUnits() {
  if (state.filter === "revisadas") {
    return state.units.filter((u) => state.reviewed.has(nplate(u.placa)));
  }
  if (state.filter === "todas") return state.units;
  return state.units.filter((u) => !state.reviewed.has(nplate(u.placa)));
}

function paintUnitList(container) {
  const list = container.querySelector("#unit-list");
  if (!list) return;
  const units = filteredUnits();
  if (!units.length) {
    list.innerHTML = `<p style="padding:16px;color:#64748b">No hay unidades en este filtro.</p>`;
    return;
  }
  list.innerHTML = units.map((u, i) => unitGroupHtml(u, i + 1)).join("");
}

async function focusUnit(container, key, runtime) {
  state.selectedKey = key;
  paintUnitList(container);

  const idx = state.units.findIndex((u) => nplate(u.placa) === key);
  const pos = container.querySelector("#plate-position");
  if (pos) pos.textContent = `PLACA ${idx >= 0 ? idx + 1 : 0}/${state.units.length}`;

  const unit = state.units.find((u) => nplate(u.placa) === key);
  if (!unit) return;

  const meta = loadMeta();
  const gps = await readGPS(gpsKey(meta?.id, unit.tracto, unit.placa));
  const st = getStatus(unit.placa);
  const statusEl = container.querySelector("#route-update-status");
  const cap = container.querySelector("#map-caption");
  if (gps?.ok) {
    if (statusEl) statusEl.textContent = `ANÁLISIS LISTO · ${gps.puntos ?? st?.puntos ?? 0} PUNTOS`;
    if (cap) cap.textContent = `${gps.desde || meta?.desde || ""} — ${gps.hasta || meta?.hasta || ""}`;
  } else {
    if (statusEl) statusEl.textContent = st ? `PRECARGA: ${st.estado}` : "SIN RECORRIDO PRECARGADO";
    if (cap) cap.textContent = "Sin caché GPS para esta unidad";
  }

  const events = container.querySelector("#gps-events");
  if (events) {
    events.innerHTML = renderEventsHtml(gps || { ok: false });
    events.querySelectorAll("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy || "");
        } catch (_) {}
      };
    });
  }

  const mapEl = container.querySelector("#tracking-map");

  try {
    if (gps?.ok || (gps?.puntos_gps || gps?.puntos_lista || []).length) {
      await ensureTrackingMap(mapEl, () => runtime.auth.currentUser.getIdToken(true));
      // re-get mapEl content cleared by Maps
      const mapNode = container.querySelector("#tracking-map");
      drawTrackingRoute(gps, mapNode, cap);
    } else if (mapEl) {
      mapEl.dataset.mapsBound = "";
      mapEl.innerHTML = `<div style="padding:12px;text-align:center">Sin puntos GPS en caché para ${esc(shortTracto(unit.tracto))}.</div>`;
    }
  } catch (e) {
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:12px;text-align:center;color:#fca5a5">Mapa: ${esc(e.message)}</div>`;
    }
  }
}

function flashBtn(btn, mark) {
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = mark;
  setTimeout(() => {
    btn.textContent = old;
  }, 900);
}

function wire(container, runtime) {
  const $ = (id) => container.querySelector("#" + id);

  $("exit-track").onclick = () => {
    document.body.classList.remove("tracking-active");
    document.querySelector('nav button[data-route="home"]')?.click();
  };

  $("save-partial").onclick = async () => {
    const b = $("save-partial");
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "GUARDANDO…";
    try {
      const x = await trackApi({ action: "guardar_parcial", revisadas: [...state.reviewed] });
      alert(x.mensaje || `Parcial: ${state.reviewed.size}/${state.units.length} revisadas.`);
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  };

  $("save-all").onclick = async () => {
    if (state.reviewed.size !== state.units.length) {
      alert(`Incompleto: ${state.reviewed.size}/${state.units.length} revisadas.`);
      return;
    }
    if (!confirm("¿Terminar seguimiento y consolidar?")) return;
    const b = $("save-all");
    b.disabled = true;
    b.textContent = "TERMINANDO…";
    try {
      await trackApi({ action: "consolidar", revisadas: [...state.reviewed] });
      alert("Seguimiento terminado.");
      document.body.classList.remove("tracking-active");
      document.querySelector('nav button[data-route="reporte"]')?.click();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
      b.textContent = "TERMINAR SEGUIMIENTO";
    }
  };

  container.querySelectorAll(".pg-filter[data-filter]").forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.filter;
      container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
        b.classList.toggle("active", b.dataset.filter === state.filter);
      });
      // prefer selected still in filter; else first of filter
      const list = filteredUnits();
      if (!list.some((u) => nplate(u.placa) === state.selectedKey)) {
        state.selectedKey = list[0] ? nplate(list[0].placa) : "";
      }
      paintUnitList(container);
      if (state.selectedKey) focusUnit(container, state.selectedKey, runtime);
    };
  });

  $("toggle-closed").onclick = async () => {
    const body = $("pg-closed-body");
    const opening = body.classList.contains("hidden");
    body.classList.toggle("hidden", !opening);
    $("toggle-closed").textContent = opening ? "CERRADAS · OCULTAR" : "CERRADAS · VER";
    if (!opening) return;
    const box = $("pg-closed-content");
    if (!box || box.dataset.loaded === "1") return;
    box.innerHTML = `<p class="muted">Consultando histórico…</p>`;
    const parts = [];
    for (const u of state.units.slice(0, 40)) {
      try {
        const d = await trackApi({ action: "cerradas_por_tracto", tracto: u.tracto || u.placa });
        const rows = d.rows || d.ocs || d.cerradas || [];
        if (!rows.length) continue;
        parts.push(
          `<div class="sg-closed-unit"><b>${esc(shortTracto(u.tracto || u.placa))}</b><ul>${rows
            .slice(0, 8)
            .map((r) => `<li>OC ${esc(r.orden_carga || r.OC || "—")} · ${esc(r.ruta || r.payload?.Ruta || "")}</li>`)
            .join("")}</ul></div>`,
        );
      } catch (_) {}
    }
    box.innerHTML = parts.length ? parts.join("") : `<p class="muted">Sin OCs cerradas recientes.</p>`;
    box.dataset.loaded = "1";
  };

  $("refresh-route").onclick = async () => {
    const unit = state.units.find((u) => nplate(u.placa) === state.selectedKey);
    if (!unit) return alert("Seleccione una unidad.");
    const desde = inputToPE($("route-from").value);
    const hasta = inputToPE($("route-to").value) || formatPE(new Date());
    if (!desde) return alert("Indique DESDE válido.");
    $("route-update-status").textContent = "CONSULTANDO CLocator…";
    try {
      const token = await runtime.auth.currentUser.getIdToken(true);
      const data = await queryClocator({
        endpoint: API.clocator,
        token,
        placa: unit.placa,
        tracto: unit.tracto,
        desde,
        hasta,
        includeMap: false,
      });
      const meta = loadMeta();
      await cacheGPS(
        { ...data, placa: unit.placa, tracto: unit.tracto, run_id: meta?.id, desde, hasta },
        gpsKey(meta?.id, unit.tracto, unit.placa),
      );
      await focusUnit(container, state.selectedKey, runtime);
    } catch (e) {
      $("route-update-status").textContent = "ERROR";
      alert(e.message);
    }
  };

  $("view-hours").onclick = () => {
    const b = $("view-hours");
    toggleInspection(b);
  };

  // Center column delegation
  const center = container.querySelector(".track-center");
  const onCenter = async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;

    if (btn.dataset.select) {
      await focusUnit(container, btn.dataset.select, runtime);
      return;
    }
    if (btn.dataset.map) {
      await focusUnit(container, btn.dataset.map, runtime);
      return;
    }
    if (btn.dataset.copyPlate) {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyPlate);
        flashBtn(btn, "✓");
      } catch {
        flashBtn(btn, "!");
      }
      return;
    }
    if (btn.dataset.paste) {
      try {
        const text = await navigator.clipboard.readText();
        const input = center.querySelector(`[data-f="${btn.dataset.paste}"]`);
        if (input) {
          input.value = text;
          input.dispatchEvent(new Event("input"));
          flashBtn(btn, "✓");
        }
      } catch {
        flashBtn(btn, "!");
      }
      return;
    }
    if (btn.hasAttribute("data-copy-val")) {
      const wrap = btn.closest(".pg-control");
      const live = wrap?.querySelector("input, select, textarea");
      const text = live ? String(live.value || "") : "";
      try {
        await navigator.clipboard.writeText(text);
        flashBtn(btn, "✓");
      } catch {
        flashBtn(btn, "!");
      }
      return;
    }
    if (btn.dataset.review) {
      try {
        const placa = btn.dataset.review;
        await trackApi({ action: "marcar_revisada", placa });
        state.reviewed.add(nplate(placa));
        const nAct = state.units.filter((u) => !state.reviewed.has(nplate(u.placa))).length;
        const nRev = state.reviewed.size;
        container.querySelector("#review-count").textContent = `REVISADAS ${nRev}/${state.units.length}`;
        container.querySelectorAll(".pg-filter[data-filter]").forEach((b) => {
          if (b.dataset.filter === "activas") b.textContent = `ACTIVAS · ${nAct}`;
          if (b.dataset.filter === "revisadas") b.textContent = `REVISADAS · ${nRev}`;
        });
        // En filtro ACTIVAS: pasar a la siguiente pendiente
        if (state.filter === "activas") {
          const next = state.units.find(
            (u) => !state.reviewed.has(nplate(u.placa)) && nplate(u.placa) !== nplate(placa),
          );
          state.selectedKey = next ? nplate(next.placa) : "";
        }
        paintUnitList(container);
        if (state.selectedKey) await focusUnit(container, state.selectedKey, runtime);
      } catch (e) {
        alert(e.message);
      }
      return;
    }
    if (btn.dataset.save) {
      const row = btn.closest(".pg-oc-row");
      const datos = collectOcData(row);
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "GUARDANDO…";
      try {
        await trackApi({ action: "guardar", id: +btn.dataset.save, datos });
        btn.textContent = "GUARDADO";
        row.querySelectorAll("[data-original]").forEach((el) => {
          el.dataset.original = el.value;
        });
        const hint = row.querySelector(`[data-save-hint="${btn.dataset.save}"]`);
        if (hint) {
          hint.hidden = false;
          setTimeout(() => {
            hint.hidden = true;
            btn.textContent = "GUARDAR";
          }, 1500);
        } else {
          setTimeout(() => {
            btn.textContent = "GUARDAR";
          }, 1500);
        }
      } catch (e) {
        alert(e.message);
        btn.textContent = old;
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (btn.dataset.close) {
      if (!confirm("¿Preparar FIN DE CICLO?")) return;
      const row = btn.closest(".pg-oc-row");
      const datos = collectOcData(row);
      btn.disabled = true;
      try {
        await trackApi({ action: "cerrar", id: +btn.dataset.close, datos });
        btn.textContent = "CIERRE PREPARADO";
        row.classList.add("cem-oc-closed");
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    }
  };
  center.addEventListener("click", onCenter);
  center.addEventListener("change", (ev) => {
    const sel = ev.target.closest("select[data-f$='-estado']");
    if (!sel) return;
    const label = sel.closest(".pg-state-select-wrap")?.querySelector(".pg-state-selected");
    if (label) label.textContent = sel.options[sel.selectedIndex]?.textContent || sel.value || "-";
  });

  cleanup.push(() => center.removeEventListener("click", onCenter));

  const off = runtime.bus.on("cemento:precarga-unit", () => {
    const m = loadMeta();
    const c = counts(m, state.units.length);
    const el = $("preload-global");
    if (el) {
      el.textContent = isRunning()
        ? `PRECARGA ${c.done}/${m?.total || state.units.length}`
        : `GPS ${c.ready}/${state.units.length}`;
    }
  });
  cleanup.push(off);
}

function ensureStyles() {
  document.querySelectorAll("style[id^='cem-sg-v3-style']").forEach((n) => n.remove());
  const st = document.createElement("style");
  st.id = "cem-sg-v3-style-13";
  st.textContent = `
    body.tracking-active {
      overflow: hidden !important;
    }
    body.tracking-active #content,
    body.tracking-active .content,
    body.tracking-active main#content {
      height: 100% !important; max-height: 100% !important; overflow: hidden !important;
    }
    body.tracking-active .desktop-tracking.grid-03 {
      display: flex !important; flex-direction: column !important;
      height: 100vh !important; max-height: 100vh !important;
      background: #eef2f7 !important; color: #1f2937 !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > header {
      display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: center !important;
      padding: 8px 10px !important; background: #fff !important; border-bottom: 1px solid #dbe3ef !important; flex: 0 0 auto !important;
    }
    body.tracking-active .desktop-tracking.grid-03 > main {
      display: grid !important;
      grid-template-columns: minmax(200px, 28fr) 7px minmax(400px, 57fr) 7px minmax(140px, 15fr) !important;
      gap: 0 !important; padding: 8px !important; flex: 1 1 auto !important; min-height: 0 !important; overflow: hidden !important;
    }
    body.tracking-active .track-left,
    body.tracking-active .track-center,
    body.tracking-active .track-right {
      display: flex !important; flex-direction: column !important; min-width: 0 !important; min-height: 0 !important;
      overflow: hidden !important; background: #fff !important; border: 1px solid #dbe3ef !important; border-radius: 8px !important;
    }
    body.tracking-active .track-center {
      overflow: hidden !important; display: flex !important; flex-direction: column !important;
      min-height: 0 !important; height: 100% !important;
    }
    body.tracking-active .plate-grid-scroll {
      overflow: auto !important;
    }

    body.tracking-active .tracking-splitter {
      position: relative !important; cursor: col-resize !important; background: #dbe4ef !important;
      border-left: 1px solid #aabbd0 !important; border-right: 1px solid #aabbd0 !important;
      z-index: 20 !important; width: 7px !important; min-width: 7px !important; max-width: 7px !important; align-self: stretch !important;
    }
    body.tracking-active .tracking-splitter:hover,
    body.tracking-resizing .tracking-splitter { background: #7db4ef !important; }
    body.tracking-active .tracking-splitter::after {
      content: "⋮" !important; position: absolute !important; top: 50% !important; left: 50% !important;
      transform: translate(-50%,-50%) !important; color: #315d8f !important; font-size: 18px !important; font-weight: 900 !important;
    }
    body.tracking-resizing { cursor: col-resize !important; user-select: none !important; }

    /* Filtros */
    body.tracking-active .pg-filter-bar {
      display: flex !important; flex-wrap: wrap !important; gap: 6px !important; padding: 8px !important;
      border-bottom: 1px solid #e2e8f0 !important; flex: 0 0 auto !important; background: #f8fafc !important;
    }
    body.tracking-active .pg-filter {
      border: 1px solid #cbd5e1 !important; background: #fff !important; color: #334155 !important;
      border-radius: 999px !important; padding: 6px 12px !important; font-size: 12px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-filter.active {
      background: #dbeafe !important; border-color: #2563eb !important; color: #1e3a8a !important;
    }

    body.tracking-active .plate-grid-scroll {
      flex: 1 1 auto !important; overflow: auto !important; min-height: 0 !important;
      padding: 6px 8px !important;
    }
    body.tracking-active .pg-section-body {
      display: flex !important; flex-direction: column !important; gap: 10px !important;
    }
    body.tracking-active .pg-unit-group {
      width: 100% !important;
    }

    

    body.tracking-active .sg-mont-row { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; margin-top: 6px !important; }
    body.tracking-active .sg-mont {
      font-size: 12px !important; padding: 3px 10px !important; border-radius: 999px !important;
      border: 1px solid #cbd5e1 !important; background: #f8fafc !important;
    }
    body.tracking-active .sg-mont.out { border-color: #65a30d !important; color: #3f6212 !important; }
    body.tracking-active .sg-mont.in { border-color: #0284c7 !important; color: #075985 !important; }

    /* OC form — etiqueta visible + inputs anchos */
    body.tracking-active .pg-oc-row {
      border: 1px solid #cbd5e1 !important; border-radius: 10px !important; padding: 14px !important; background: #fff !important;
    }
    body.tracking-active .pg-oc-row.pg-parihuelas {
      background: #fffbeb !important; border-color: #eab308 !important;
    }
    body.tracking-active .pg-oc-top {
      display: flex !important; justify-content: space-between !important; gap: 10px !important; flex-wrap: wrap !important;
      margin-bottom: 12px !important; align-items: flex-start !important;
    }
    body.tracking-active .pg-oc-title b { font-size: 16px !important; margin-right: 8px !important; }
    body.tracking-active .pg-oc-title strong { color: #1d4ed8 !important; font-size: 14px !important; margin-right: 8px !important; }
    body.tracking-active .pg-oc-title small { display: block !important; margin-top: 4px !important; color: #64748b !important; font-size: 12px !important; }
    body.tracking-active .pg-draft { color: #b45309 !important; font-weight: 800 !important; }
    body.tracking-active .pg-special-tag {
      display: inline-block !important; margin-left: 6px !important; padding: 2px 8px !important; border-radius: 999px !important;
      font-size: 11px !important; font-weight: 900 !important; background: #fde68a !important; border: 1px solid #d97706 !important; color: #78350f !important;
    }
    body.tracking-active .pg-oc-form {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      width: 100% !important;
    }
    body.tracking-active .pg-oc-row {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    body.tracking-active .pg-field { display: flex !important; flex-direction: column !important; gap: 5px !important; min-width: 0 !important; }
    body.tracking-active .pg-field-wide { grid-column: 1 / -1 !important; }
    body.tracking-active .pg-label {
      display: block !important; font-size: 13px !important; font-weight: 800 !important;
      color: #0f172a !important; letter-spacing: 0.02em !important; line-height: 1.25 !important;
      white-space: normal !important; margin-bottom: 2px !important;
    }
    body.tracking-active .pg-control {
      display: flex !important; gap: 6px !important; align-items: stretch !important; min-height: 48px !important;
      width: 100% !important;
    }
    body.tracking-active .pg-control input,
    body.tracking-active .pg-control select {
      flex: 1 1 auto !important; min-width: 0 !important; width: 100% !important; box-sizing: border-box !important;
      min-height: 48px !important; padding: 12px 14px !important; border-radius: 8px !important;
      border: 1px solid #475569 !important; background: #fff !important; color: #0f172a !important;
      font-size: 16px !important; font-weight: 600 !important;
    }
    body.tracking-active .pg-control input:focus,
    body.tracking-active .pg-control select:focus {
      outline: 2px solid #93c5fd !important; border-color: #2563eb !important;
    }
    body.tracking-active .pg-icon-btn {
      flex: 0 0 40px !important; width: 40px !important; border: 1px solid #cbd5e1 !important;
      background: #f1f5f9 !important; border-radius: 6px !important; cursor: pointer !important; font-size: 15px !important;
    }
    body.tracking-active .pg-icon-btn:hover { background: #e2e8f0 !important; }
    body.tracking-active .pg-top-actions { display: flex !important; gap: 8px !important; }
    body.tracking-active .pg-save-action {
      background: #2563eb !important; color: #fff !important; border: 1px solid #1d4ed8 !important;
      border-radius: 6px !important; padding: 9px 16px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-close-action {
      background: #fff !important; color: #b91c1c !important; border: 1px solid #fca5a5 !important;
      border-radius: 6px !important; padding: 9px 16px !important; font-size: 13px !important; font-weight: 800 !important; cursor: pointer !important;
    }
    body.tracking-active .pg-save-hint { margin: 8px 0 0 !important; color: #15803d !important; font-size: 13px !important; font-weight: 800 !important; }
    body.tracking-active .sg-empty-msg { padding: 12px !important; color: #64748b !important; font-size: 13px !important; }
    body.tracking-active .sg-closed-unit { margin: 8px 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; }
    body.tracking-active .hidden { display: none !important; }

    body.tracking-active .track-right #gps-events { padding: 8px !important; overflow: auto !important; flex: 1 !important; }
    body.tracking-active .gps-summary {
      display: grid !important; grid-template-columns: auto 1fr !important; gap: 2px 8px !important; font-size: 11px !important;
      margin-bottom: 10px !important; background: #f8fafc !important; border: 1px solid #e2e8f0 !important; border-radius: 6px !important; padding: 8px !important;
    }
    body.tracking-active .gps-event {
      margin: 6px 0 !important; padding: 6px 8px !important; border-left: 3px solid #2563eb !important; background: #f8fafc !important; font-size: 11px !important;
    }
    body.tracking-active .route-refresh {
      display: grid !important; grid-template-columns: 1fr 1fr auto !important; gap: 6px !important; align-items: end !important; margin: 8px !important;
    }
    body.tracking-active .route-refresh label { display: flex !important; flex-direction: column !important; gap: 2px !important; font-size: 10px !important; font-weight: 800 !important; }
    body.tracking-active .route-refresh input {
      padding: 6px !important; border-radius: 6px !important; border: 1px solid #cbd5e1 !important; background: #fff !important; color: #0f172a !important;
    }
    body.tracking-active .tracking-map-wrap { position: relative !important; flex: 1 !important; min-height: 180px !important; margin: 0 8px !important; }
    body.tracking-active #tracking-map {
      height: 100% !important; min-height: 220px !important; background: #e2e8f0 !important; border-radius: 8px !important;
      color: #64748b !important;
    }
    body.tracking-active #tracking-map:not([data-maps-bound="1"]) {
      display: flex !important; align-items: center !important; justify-content: center !important;
    }
    body.tracking-active #view-hours { position: absolute !important; top: 8px !important; right: 8px !important; z-index: 2 !important; }
    body.tracking-active .track-left > footer { padding: 8px 10px !important; border-top: 1px solid #e2e8f0 !important; font-size: 10px !important; }


    


    body.tracking-active article.pg-oc-row {
      display: block !important;
      grid-template-columns: none !important;
      grid-template-rows: none !important;
      min-width: 0 !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    body.tracking-active #unit-list,
    body.tracking-active .plate-grid-scroll {
      overflow: auto !important;
      flex: 1 1 auto !important;
      min-height: 200px !important;
    }

    @media (max-width: 1100px) {
      body.tracking-active .desktop-tracking.grid-03 > main { grid-template-columns: 1fr !important; overflow: auto !important; }
      body.tracking-active .tracking-splitter { display: none !important; }
      body.tracking-active .pg-oc-form { flex-direction: column !important; }
    }
  `;
  document.head.appendChild(st);
}
