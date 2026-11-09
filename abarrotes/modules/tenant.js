/**
 * Configurar Supabase operador (multi-cuenta).
 * GPS usa esta cuenta; SAP/seguimiento/histórico siguen en principal.
 */
import { auth } from "../propio/auth.js";
import { loadTenant, saveTenant, clearTenant, tenantSummary } from "../propio/multi-cuenta.js";
import { MULTI_CUENTA } from "../registry.js";

export async function mount(container) {
  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = `<p class="muted">Inicie sesión.</p>`;
    return;
  }
  const cfg = loadTenant(user);
  container.innerHTML = `
    <section class="panel" style="max-width:560px">
      <p class="eyebrow">MULTI-CUENTA</p>
      <h1>Mi Supabase (operador)</h1>
      <p class="muted" style="font-size:13px;line-height:1.45">
        Si configura su proyecto, las <b>rutas GPS</b> se consultan ahí (su cuota).
        <b>SAP, seguimiento, maestros, histórico y diario</b> siguen en la cuenta principal.
        Sin config → GPS también en principal (modo dueño).
        Estado: <code>${MULTI_CUENTA.enabled ? "activo" : "inactivo"}</code> ·
        ahora: <b id="t-now">${esc(tenantSummary(user))}</b>
      </p>
      <label style="display:block;font-size:11px;font-weight:700;margin-top:10px">Etiqueta</label>
      <input id="t-label" type="text" value="${esc(cfg.label)}" style="width:100%;padding:8px;margin-top:4px" placeholder="Sede / operador">
      <label style="display:block;font-size:11px;font-weight:700;margin-top:10px">Supabase URL</label>
      <input id="t-url" type="text" value="${esc(cfg.supabaseUrl)}" style="width:100%;padding:8px;margin-top:4px" placeholder="https://xxxx.supabase.co">
      <label style="display:block;font-size:11px;font-weight:700;margin-top:10px">Anon key (opcional)</label>
      <input id="t-anon" type="password" value="${esc(cfg.anonKey)}" style="width:100%;padding:8px;margin-top:4px">
      <label style="display:block;font-size:11px;font-weight:700;margin-top:10px">URL CLocator completa</label>
      <input id="t-clocator" type="text" value="${esc(cfg.clocatorUrl)}" style="width:100%;padding:8px;margin-top:4px" placeholder="https://xxxx.supabase.co/functions/v1/…-clocator">
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button type="button" id="t-save" class="primary">GUARDAR</button>
        <button type="button" id="t-clear" class="ghost">USAR PRINCIPAL</button>
      </div>
      <p id="t-msg" class="muted" style="margin-top:10px"></p>
    </section>
  `;
  const msg = container.querySelector("#t-msg");
  container.querySelector("#t-save").onclick = () => {
    saveTenant(user, {
      label: container.querySelector("#t-label").value,
      supabaseUrl: container.querySelector("#t-url").value,
      anonKey: container.querySelector("#t-anon").value,
      clocatorUrl: container.querySelector("#t-clocator").value,
    });
    const now = container.querySelector("#t-now");
    if (now) now.textContent = tenantSummary(user);
    msg.textContent = "Guardado · GPS → " + tenantSummary(user);
    msg.style.color = "#15803d";
  };
  container.querySelector("#t-clear").onclick = () => {
    clearTenant(user);
    container.querySelector("#t-label").value = "";
    container.querySelector("#t-url").value = "";
    container.querySelector("#t-anon").value = "";
    container.querySelector("#t-clocator").value = "";
    const now = container.querySelector("#t-now");
    if (now) now.textContent = "principal";
    msg.textContent = "Config borrada · GPS → principal";
    msg.style.color = "#475569";
  };
}

export function unmount() {}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
