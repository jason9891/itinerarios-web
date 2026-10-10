/**
 * Mensaje multi-cuenta: escribe en PRINCIPAL y se ve desde cualquier sesión.
 */
import { auth } from "../../shared/auth.js";
import { API, PRINCIPAL, OPERADOR } from "../registry.js";

export async function mount(container) {
  container.innerHTML = `
    <section class="panel" style="max-width:720px;margin:0 auto;padding:16px">
      <p class="eyebrow">MULTI-CUENTA</p>
      <h1>Mensaje al principal</h1>
      <p style="color:#475569;font-size:14px;line-height:1.5">
        Este itinerario usa la cuenta <b>operador</b>
        (<code>${OPERADOR.ref}</code>) para GPS y datos de trabajo.
        El mensaje de abajo se guarda en la cuenta <b>principal</b>
        y puede verse al abrir Cemento Prueba con <b>otra sesión</b>.
      </p>
      <label style="display:block;font-size:12px;font-weight:700;margin-top:12px">Mensaje</label>
      <textarea id="m-text" rows="4" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px"
        placeholder="Ej. Cierre de prueba 10/10 — multi-cuenta OK"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button type="button" id="m-send" class="primary" style="padding:10px 16px;font-weight:800;background:#0b2f68;color:#fff;border:none;border-radius:8px;cursor:pointer">ENVIAR AL PRINCIPAL</button>
        <button type="button" id="m-refresh" style="padding:10px 16px;font-weight:800;background:#fff;border:1px solid #94a3b8;border-radius:8px;cursor:pointer">ACTUALIZAR LISTA</button>
      </div>
      <p id="m-status" style="font-size:13px;color:#475569;margin-top:10px"></p>
      <h2 style="font-size:15px;margin-top:20px">Últimos mensajes (principal)</h2>
      <div id="m-list" style="display:flex;flex-direction:column;gap:8px"></div>
    </section>
  `;

  const status = container.querySelector("#m-status");
  const list = container.querySelector("#m-list");

  async function token() {
    const u = auth.currentUser;
    if (!u) throw new Error("Sin sesión");
    return u.getIdToken(true);
  }

  async function api(body) {
    const t = await token();
    const r = await fetch(API.mensaje, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  }

  async function refresh() {
    status.textContent = "Cargando mensajes del principal…";
    try {
      const data = await api({ action: "listar" });
      const rows = data.mensajes || [];
      if (!rows.length) {
        list.innerHTML = `<p style="color:#64748b">Aún no hay mensajes.</p>`;
      } else {
        list.innerHTML = rows
          .map(
            (m) => `
          <article style="border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;background:#f8fafc">
            <div style="font-size:11px;color:#64748b">${esc(m.created_at || "")} · <b>${esc(m.autor_email || "—")}</b></div>
            <div style="margin-top:4px;font-size:14px;color:#0f172a">${esc(m.texto)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">id ${esc(m.id)} · origen ${esc(m.origen || "cemento-prueba")}</div>
          </article>`,
          )
          .join("");
      }
      status.textContent = `${rows.length} mensaje(s) en principal.`;
      status.style.color = "#15803d";
    } catch (e) {
      status.textContent = e.message || String(e);
      status.style.color = "#b91c1c";
    }
  }

  container.querySelector("#m-send").onclick = async () => {
    const texto = container.querySelector("#m-text").value.trim();
    if (!texto) {
      status.textContent = "Escriba un mensaje.";
      status.style.color = "#b91c1c";
      return;
    }
    const btn = container.querySelector("#m-send");
    btn.disabled = true;
    btn.textContent = "ENVIANDO…";
    try {
      const out = await api({
        action: "enviar",
        texto,
        origen: "cemento-prueba",
        operador_ref: OPERADOR.ref,
      });
      status.textContent = out.mensaje || "Enviado al principal.";
      status.style.color = "#15803d";
      container.querySelector("#m-text").value = "";
      await refresh();
    } catch (e) {
      status.textContent = e.message || String(e);
      status.style.color = "#b91c1c";
    } finally {
      btn.disabled = false;
      btn.textContent = "ENVIAR AL PRINCIPAL";
    }
  };

  container.querySelector("#m-refresh").onclick = () => refresh();
  await refresh();
}

export function unmount() {}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
