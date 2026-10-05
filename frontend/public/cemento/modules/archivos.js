/**
 * CEMENTO · Archivos
 * Solo muestra opciones de descarga. El Excel se genera en Supabase al hacer clic.
 */
import { apiPost, esc, moduleHead } from "../api-client.js";
import { API } from "../registry.js";

let cleanup = [];

export async function mount(container, runtime) {
  cleanup = [];
  container.innerHTML = "";
  try {
    await render(container);
  } catch (e) {
    container.innerHTML = `<section class="error-box"><h2>Error en archivos</h2><p>${esc(e.message)}</p></section>`;
  }
}

export function unmount() {
  for (const fn of cleanup) {
    try { fn(); } catch (_) {}
  }
  cleanup = [];
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function render(container) {
  const files = [
    {
      id: "DIARIO",
      title: "Seguimiento diario",
      file: "SEGUIMIENTO_DIARIO.xlsx",
      desc: "OCs abiertas actuales (origen DIARIO en Supabase). Se genera solo al descargar.",
      color: "#dbeafe",
      stroke: "#1d4ed8",
    },
    {
      id: "HISTORICO",
      title: "Seguimiento histórico",
      file: "SEGUIMIENTO_HISTORICO.xlsx",
      desc: "OCs cerradas / histórico (origen HISTORICO). Se genera solo al descargar.",
      color: "#f1f5f9",
      stroke: "#475569",
    },
  ];

  container.innerHTML =
    moduleHead("Archivos", "Descargas bajo demanda · sin precarga") +
    `<section class="panel" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc">
      <b style="color:#0f172a">Egress controlado</b>
      <p class="muted" style="margin:6px 0 0;font-size:13px">
        Al abrir este módulo <b>no</b> se consulta ni se genera ningún Excel.
        Solo al pulsar <b>DESCARGAR</b> se lee Supabase y se arma el archivo.
      </p>
    </section>
    <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
      ${files
        .map(
          (f) => `
        <article style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#fff">
          <div style="width:42px;height:42px;border-radius:10px;background:${f.color};display:grid;place-items:center;margin-bottom:10px">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="${f.stroke}" stroke-width="1.8"/>
              <path d="M14 2v4h4M8 13h8M8 17h5" stroke="${f.stroke}" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 style="margin:0 0 6px;font-size:16px;color:#0f172a">${esc(f.title)}</h2>
          <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.4">${esc(f.desc)}</p>
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#334155">${esc(f.file)}</p>
          <button type="button" data-archivo="${f.id}"
            style="width:100%;padding:11px;border-radius:8px;border:1px solid ${f.stroke};background:#fff;color:${f.stroke};font-weight:900;cursor:pointer">
            DESCARGAR EXCEL
          </button>
          <p data-status="${f.id}" class="muted" style="margin:8px 0 0;font-size:12px;min-height:16px"></p>
        </article>`,
        )
        .join("")}
    </section>`;

  container.querySelectorAll("[data-archivo]").forEach((btn) => {
    btn.onclick = async () => {
      const origin = btn.getAttribute("data-archivo");
      const st = container.querySelector(`[data-status="${origin}"]`);
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = "GENERANDO…";
      if (st) st.textContent = "Leyendo Supabase y armando Excel…";
      try {
        const x = await apiPost(API.report, { action: "archivo", origen: origin }, { binary: true });
        downloadBlob(x.blob, x.name || `SEGUIMIENTO_${origin}.xlsx`);
        if (st) st.textContent = "Descarga iniciada: " + (x.name || origin);
      } catch (e) {
        if (st) st.textContent = e.message || String(e);
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    };
  });
}
