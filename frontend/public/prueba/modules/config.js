/**
 * Configurar Supabase del operador (ligado al usuario Firebase).
 */
import { auth } from "../../shared/auth.js";
import { loadTenant, saveTenant, clearTenant, tenantSummary } from "../tenant.js";
import { OPERATOR_DEMO } from "../registry.js";

export async function mount(container) {
  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = `<p class="muted">Inicie sesión.</p>`;
    return;
  }
  const cfg = loadTenant(user);

  container.innerHTML = `
    <section class="prueba-panel" style="max-width:560px">
      <h2>Mi Supabase (operador)</h2>
      <p class="prueba-hint">
        Al trabajar en <b>PRUEBA</b>, las consultas de rutas usan <b>su</b> proyecto.
        El cierre oficial hacia la cuenta principal se agregará después.
        Usuario: <code>${esc(user.email || user.uid)}</code>
      </p>
      <label>Etiqueta (opcional)</label>
      <input id="t-label" type="text" value="${esc(cfg.label)}" placeholder="Ej. Sede A · Juan">
      <label>Supabase URL del proyecto</label>
      <input id="t-url" type="text" value="${esc(cfg.supabaseUrl)}" placeholder="https://xxxxx.supabase.co">
      <label>Anon key (public)</label>
      <input id="t-anon" type="password" value="${esc(cfg.anonKey)}" placeholder="eyJhbGciOi...">
      <label>URL completa del CLocator (recomendado)</label>
      <input id="t-clocator" type="text" value="${esc(cfg.clocatorUrl)}" placeholder="https://xxxxx.supabase.co/functions/v1/prueba-clocator">
      <p class="prueba-hint">
        Si no indica CLocator, se intentará <code>{url}/functions/v1/prueba-clocator</code>.
        Debe tener la function desplegada y secretos CLocator en <b>su</b> proyecto.
      </p>
      <div class="prueba-actions">
        <button type="button" id="t-demo" class="secondary">USAR PROYECTO ITINERARIOS</button>
        <button type="button" id="t-save">GUARDAR</button>
        <button type="button" id="t-clear" class="secondary">BORRAR CONFIG</button>
      </div>
      <p id="t-msg" class="prueba-status"></p>
    </section>
  `;

  const msg = container.querySelector("#t-msg");
  container.querySelector("#t-demo").onclick = () => {
    container.querySelector("#t-url").value = OPERATOR_DEMO.supabaseUrl;
    container.querySelector("#t-anon").value = OPERATOR_DEMO.anonKey;
    container.querySelector("#t-clocator").value = OPERATOR_DEMO.clocatorUrl;
    container.querySelector("#t-label").value = "Itinerarios (operador)";
    msg.className = "prueba-status";
    msg.textContent = "Valores cargados. Pulse GUARDAR.";
  };
  container.querySelector("#t-save").onclick = () => {
    const next = saveTenant(user, {
      label: container.querySelector("#t-label").value,
      supabaseUrl: container.querySelector("#t-url").value,
      anonKey: container.querySelector("#t-anon").value,
      clocatorUrl: container.querySelector("#t-clocator").value,
    });
    msg.className = "prueba-status ok";
    msg.textContent = "Guardado · " + tenantSummary(next);
    const badge = document.getElementById("tenant-badge");
    if (badge) badge.textContent = tenantSummary(next);
  };
  container.querySelector("#t-clear").onclick = () => {
    clearTenant(user);
    container.querySelector("#t-label").value = "";
    container.querySelector("#t-url").value = "";
    container.querySelector("#t-anon").value = "";
    container.querySelector("#t-clocator").value = "";
    msg.className = "prueba-status";
    msg.textContent = "Config eliminada de este navegador.";
    const badge = document.getElementById("tenant-badge");
    if (badge) badge.textContent = "SIN PROYECTO";
  };
}

export function unmount() {}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
