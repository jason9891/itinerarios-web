import { moduleHead, esc, maestrosApi } from "../api-client.js";

let disposed = false;

export async function mount(container) {
  disposed = false;
  container.innerHTML = `
    ${moduleHead("Tipo acople", "Catálogo editable · se vincula al Acoplado 1 de la última OC")}
    <section class="panel">
      <div class="panel-title">
        <div><h2>Catálogo</h2><p class="muted">Agregar o modificar cuando entren unidades nuevas (meses).</p></div>
        <div class="tn-actions">
          <button id="tn-ac-add" class="ghost">AGREGAR</button>
          <button id="tn-ac-save" class="primary">GUARDAR CAMBIOS</button>
        </div>
      </div>
      <div id="tn-ac-msg"></div>
      <div class="tn-table-wrap">
        <table class="tn-table">
          <thead><tr><th>CÓDIGO</th><th>CARROCERÍA</th><th>GESTOR</th><th></th></tr></thead>
          <tbody id="tn-ac-body"></tbody>
        </table>
      </div>
    </section>
  `;

  const body = container.querySelector("#tn-ac-body");
  const msg = container.querySelector("#tn-ac-msg");
  let rows = [];

  function render() {
    body.innerHTML = rows
      .map(
        (r, i) => `
      <tr data-i="${i}">
        <td><input data-f="codigo" value="${esc(r.codigo || "")}" style="width:100%;background:transparent;border:1px solid #ffffff18;color:inherit;padding:4px 6px;border-radius:6px"></td>
        <td><input data-f="carroceria" value="${esc(r.carroceria || "")}" style="width:100%;background:transparent;border:1px solid #ffffff18;color:inherit;padding:4px 6px;border-radius:6px"></td>
        <td><input data-f="gestor" value="${esc(r.gestor || "")}" style="width:100%;background:transparent;border:1px solid #ffffff18;color:inherit;padding:4px 6px;border-radius:6px"></td>
        <td><button data-del="${i}" class="ghost" style="padding:4px 8px">✕</button></td>
      </tr>`,
      )
      .join("");
  }

  function collect() {
    rows = [...body.querySelectorAll("tr")].map((tr) => ({
      codigo: tr.querySelector('[data-f="codigo"]').value.trim(),
      carroceria: tr.querySelector('[data-f="carroceria"]').value.trim(),
      gestor: tr.querySelector('[data-f="gestor"]').value.trim(),
    }));
  }

  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    collect();
    rows.splice(Number(btn.dataset.del), 1);
    render();
  });

  container.querySelector("#tn-ac-add").addEventListener("click", () => {
    collect();
    rows.push({ codigo: "", carroceria: "", gestor: "" });
    render();
  });

  container.querySelector("#tn-ac-save").addEventListener("click", async () => {
    collect();
    const clean = rows.filter((r) => r.codigo);
    msg.innerHTML = `<span class="tn-badge warn">Guardando ${clean.length}…</span>`;
    try {
      const r = await maestrosApi({ action: "guardar_acoples", filas: clean });
      msg.innerHTML = `<span class="tn-badge ok">Guardado · ${r.filas ?? clean.length} filas</span>`;
      await load();
    } catch (e) {
      msg.innerHTML = `<span class="tn-badge err">${esc(e.message)}</span>`;
    }
  });

  async function load() {
    try {
      const r = await maestrosApi({ action: "listar_acoples" });
      if (disposed) return;
      rows = (r.filas || []).map((x) => ({
        codigo: x.codigo || x.clave || "",
        carroceria: x.carroceria || "",
        gestor: x.gestor || "",
      }));
      render();
    } catch (e) {
      if (disposed) return;
      msg.innerHTML = `<span class="tn-badge err">${esc(e.message)}</span>`;
      rows = [];
      render();
    }
  }

  await load();
}

export function unmount() {
  disposed = true;
}
