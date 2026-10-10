/**
 * BASE DEL TURNO
 * 1) Snapshot CLocator filtrado (Transito + 20-R- + geocercas _TN) vía Edge Function
 * 2) Match LOCAL con última OC (solo equipos 20-R-) desde cache tn_oc_ultima_v1
 * 3) Tipo acople desde Supabase (única lectura al iniciar) o cache
 * 4) Resultado → localStorage tn_base_turno_v1 → Monitoreo
 * Supabase no recibe el cruce intermedio; solo el resultado final si se sincroniza después.
 */
import { moduleHead, esc, maestrosApi, fechaPE } from "../api-client.js";
import { auth } from "../../shared/auth.js";
import { API } from "../registry.js";
import { startPrecarga } from "../precarga-engine.js";

const OC_KEY = "tn_oc_ultima_v1";
const ACOPLE_KEY = "tn_acoples_v1";
const BASE_KEY = "tn_base_turno_v1";

let disposed = false;

function normalizarClave(v) {
  if (v == null) return "";
  return String(v)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "");
}

function loadOcLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(OC_KEY) || "null");
    if (!raw?.filas?.length) return { filas: [], meta: null };
    // Solo equipos 20-R-
    const filas = raw.filas.filter((f) =>
      String(f.equipo || f.equipo_raw || "").toUpperCase().includes("20-R-"),
    );
    return { filas, meta: raw };
  } catch {
    return { filas: [], meta: null };
  }
}

async function loadAcoples() {
  // Preferir cache local; si no, una sola lectura a Supabase
  try {
    const cached = JSON.parse(localStorage.getItem(ACOPLE_KEY) || "null");
    if (cached?.filas?.length) return cached.filas;
  } catch {
    /* ignore */
  }
  try {
    const r = await maestrosApi({ action: "listar_acoples" });
    const filas = (r.filas || []).map((x) => ({
      codigo: normalizarClave(x.codigo),
      carroceria: x.carroceria || "",
      gestor: x.gestor || "",
    }));
    localStorage.setItem(
      ACOPLE_KEY,
      JSON.stringify({ actualizado_en: new Date().toISOString(), filas }),
    );
    return filas;
  } catch (e) {
    console.warn("[TN] acoples:", e);
    return [];
  }
}

function matchLocal(unidadesSnap, ocFilas, acoples) {
  const ocByEquipo = new Map();
  for (const o of ocFilas) {
    const k = normalizarClave(o.equipo || o.equipo_raw);
    if (k) ocByEquipo.set(k, o);
  }
  const acByCode = new Map();
  for (const a of acoples) {
    const k = normalizarClave(a.codigo);
    if (k) acByCode.set(k, a);
  }

  let conOc = 0;
  let conAcople = 0;
  const unidades = unidadesSnap.map((u) => {
    const cod = normalizarClave(u.codigo);
    const oc = ocByEquipo.get(cod) || null;
    if (oc) conOc++;
    const acopleCod = normalizarClave(oc?.acoplado_1 || "");
    const ac = acByCode.get(acopleCod) || null;
    if (ac) conAcople++;
    return {
      codigo: u.codigo,
      placa: u.placa,
      lat: u.lat,
      lng: u.lng,
      t_parada: u.t_parada || "",
      clase_html: u.clase_html || "",
      color_html: u.color_html || "",
      reporte_gps: u.reporte_gps || "",
      movimiento_nocturno_m: 0,
      zona: u.zona || "Transito",
      // desde OC (local)
      piloto: oc?.nombre_piloto || "",
      acoplado: oc?.acoplado_1 || "",
      ruta: oc?.descripcion_ruta || "",
      mercaderia: oc?.material_servicio || "",
      fec_oc: oc?.fec_ini_real_raw || oc?.fec_ini_real || "",
      // desde acople
      tipo_acople: ac?.carroceria || "",
      gestor: ac?.gestor || "",
      // clasificación vacía
      status: "-",
      riesgo: "-",
      punto_autorizado: "-",
      cobertura_gps: "-",
      tipo_lugar: "",
      punto_pernocte: "",
      observaciones: "",
      estado_clasificacion: "PENDIENTE",
    };
  });
  return { unidades, conOc, conAcople };
}

async function token() {
  const u = auth.currentUser;
  if (!u) throw new Error("No hay sesión activa");
  return u.getIdToken(true);
}

async function fetchSnapshot() {
  const r = await fetch(API.snapshot, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "snapshot" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
  return d;
}

export async function mount(container) {
  disposed = false;
  const oc = loadOcLocal();

  container.innerHTML = `
    ${moduleHead(
      "Base del turno",
      "Snapshot real CLocator + match local última OC 20-R- · resultado a monitoreo",
    )}
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Preparar unidades del turno</h2>
          <p class="muted">
            1) Snapshot filtrado (geocercas _TN · Transito · 20-R-) ·
            2) Cruce local con OC ·
            3) Tipo acople desde maestro ·
            4) Enviar a Monitoreo
          </p>
        </div>
        <button type="button" class="primary" id="tn-run-snap">GENERAR SNAPSHOT REAL</button>
      </div>
      <div class="tn-grid" id="tn-prep">
        <div class="tn-card ${oc.filas.length ? "ok" : "warn"}">
          <small>OC LOCAL (20-R-)</small>
          <b>${oc.filas.length}</b>
          <span class="muted" style="font-size:12px">${
            oc.meta
              ? `${esc(oc.meta.nombre_archivo || "")} · ${esc(fechaPE(oc.meta.actualizado_en))}`
              : "Carga el Excel en Maestros primero"
          }</span>
        </div>
        <div class="tn-card" id="tn-card-ac">
          <small>TIPO ACOPLE</small>
          <b>…</b>
          <span class="muted" style="font-size:12px">Cargando maestro…</span>
        </div>
        <div class="tn-card" id="tn-card-base">
          <small>ÚLTIMA BASE</small>
          <b>—</b>
          <span class="muted" style="font-size:12px">Aún no generada en este navegador</span>
        </div>
      </div>
      <div id="tn-log" class="muted" style="margin-top:12px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap"></div>
      <div id="tn-result"></div>
    </section>
  `;

  const logEl = container.querySelector("#tn-log");
  const resultEl = container.querySelector("#tn-result");
  const cardAc = container.querySelector("#tn-card-ac");
  const cardBase = container.querySelector("#tn-card-base");
  const btn = container.querySelector("#tn-run-snap");

  function log(msg) {
    logEl.textContent += `${msg}\n`;
  }

  // Show existing base
  try {
    const prev = JSON.parse(localStorage.getItem(BASE_KEY) || "null");
    if (prev?.unidades?.length) {
      cardBase.className = "tn-card ok";
      cardBase.innerHTML = `<small>ÚLTIMA BASE</small><b>${prev.unidades.length}</b>
        <span class="muted" style="font-size:12px">${esc(fechaPE(prev.generado_en))} · match OC ${prev.stats?.conOc ?? "—"}</span>`;
    }
  } catch {
    /* ignore */
  }

  let acoples = [];
  try {
    acoples = await loadAcoples();
    if (disposed) return;
    cardAc.className = `tn-card ${acoples.length ? "ok" : "warn"}`;
    cardAc.innerHTML = `<small>TIPO ACOPLE</small><b>${acoples.length}</b>
      <span class="muted" style="font-size:12px">${acoples.length ? "Listo (cache/Supabase)" : "Sin catálogo — cruza solo OC"}</span>`;
  } catch (e) {
    cardAc.className = "tn-card warn";
    cardAc.innerHTML = `<small>TIPO ACOPLE</small><b>0</b><span class="muted" style="font-size:12px">${esc(e.message)}</span>`;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "GENERANDO…";
    logEl.textContent = "";
    resultEl.innerHTML = "";
    try {
      if (!oc.filas.length) {
        log("⚠ Sin OC local 20-R-. El snapshot saldrá sin piloto/ruta/acople. Carga OC en Maestros.");
      } else {
        log(`OC local 20-R-: ${oc.filas.length} equipos (última por equipo)`);
      }
      log(`Acoples: ${acoples.length}`);
      log("Consultando snapshot CLocator (geocercas _TN)…");

      const snap = await fetchSnapshot();
      if (disposed) return;
      const n = snap.unidades?.length ?? 0;
      const st = snap.stats || {};
      log(`Snapshot OK · filas ${st.filas_tabla ?? "—"} · con placa ${st.con_placa ?? "—"} · con coord ${st.con_coord ?? "—"}`);
      log(`  20-R-: ${st.con_20r ?? "—"} · fuera macro: ${st.fuera_macro ?? "—"} · en planta: ${st.en_planta ?? "—"} · macro sin planta: ${st.macro_sin_planta ?? "—"}`);
      log(`  → unidades finales (macro − planta + 20-R-): ${n}`);
      if (st.por_planta && Object.keys(st.por_planta).length) {
        log(`  Plantas excluidas: ${JSON.stringify(st.por_planta)}`);
      }
      if (st.muestras_irAMonitoreo?.length) {
        log(`  Muestras irAMonitoreo: ${st.muestras_irAMonitoreo.join(" | ")}`);
      } else if (!st.con_coord) {
        log(`  ⚠ Sin irAMonitoreo en HTML de tabla — no hay lat/lng para filtrar geocercas`);
      }

      if (!n) {
        throw new Error(
          "Snapshot devolvió 0 unidades. Revisa geocercas _TN, filtro Transito o credenciales CLocator.",
        );
      }

      log("Match local OC + acoples…");
      const { unidades, conOc, conAcople } = matchLocal(snap.unidades, oc.filas, acoples);
      log(`Match: ${conOc}/${unidades.length} con OC · ${conAcople} con tipo acople`);

      const payload = {
        generado_en: new Date().toISOString(),
        stats: {
          ...(snap.stats || {}),
          conOc,
          conAcople,
          total: unidades.length,
        },
        unidades,
      };
      localStorage.setItem(BASE_KEY, JSON.stringify(payload));
      // Precarga de recorridos en 2º plano (caché) — mismo rango 16:00→ahora
      try {
        const now = new Date();
        // Fecha local (no UTC): madrugada → turno del día anterior
        const turno = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() < 12) turno.setDate(turno.getDate() - 1);
        const y = turno.getFullYear();
        const mo = String(turno.getMonth() + 1).padStart(2, "0");
        const d = String(turno.getDate()).padStart(2, "0");
        const fechaTurno = `${y}-${mo}-${d}`;
        startPrecarga(
          unidades.map((u) => ({ codigo: u.codigo, placa: u.placa })).filter((u) => u.placa || u.codigo),
          fechaTurno,
          { reason: "base-turno" },
        );
        log(`Precarga rutas iniciada en 2º plano (16:00 ${fechaTurno} → ahora)`);
      } catch (err) {
        console.warn("[TN] precarga", err);
        log(`Precarga: ${err.message || err}`);
      }

      cardBase.className = "tn-card ok";
      cardBase.innerHTML = `<small>ÚLTIMA BASE</small><b>${unidades.length}</b>
        <span class="muted" style="font-size:12px">${esc(fechaPE(payload.generado_en))} · OC ${conOc}</span>`;

      const sample = unidades.slice(0, 8);
      resultEl.innerHTML = `
        <div class="tn-card ok" style="margin-top:12px">
          <small>RESULTADO LISTO PARA MONITOREO</small>
          <b>${unidades.length} unidades</b>
          <p style="margin-top:8px">Esperado operativo: ~70–80. ${
            unidades.length >= 60 && unidades.length <= 100
              ? "Rango coherente."
              : "Fuera del rango típico; conviene revisar geocercas o filtro."
          }</p>
          <div class="tn-table-wrap" style="max-height:240px;margin-top:10px">
            <table class="tn-table">
              <thead><tr><th>CÓDIGO</th><th>PLACA</th><th>ESTADO</th><th>PILOTO</th><th>RUTA</th><th>T.PARADA</th></tr></thead>
              <tbody>
                ${sample
                  .map(
                    (u) =>
                      `<tr><td>${esc(u.codigo)}</td><td>${esc(u.placa)}</td><td>${esc(u.estado_monitoreo)}</td><td>${esc(u.piloto)}</td><td>${esc(u.ruta)}</td><td>${esc(u.t_parada)}</td></tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <p style="margin-top:12px">
            <button type="button" class="primary" id="tn-go-mon">ABRIR MONITOREO CON ESTA BASE</button>
          </p>
        </div>`;

      resultEl.querySelector("#tn-go-mon")?.addEventListener("click", () => {
        document.querySelector('nav button[data-route="monitoreo"]')?.click();
      });
    } catch (e) {
      log(`ERROR: ${e.message || e}`);
      resultEl.innerHTML = `<p class="tn-badge err">${esc(e.message || e)}</p>
        <p class="muted" style="margin-top:8px">Verifica el endpoint Work (Firebase) <code>turnoAmanecidaSnapshot</code>.</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "GENERAR SNAPSHOT REAL";
    }
  });
}

export function unmount() {
  disposed = true;
}
