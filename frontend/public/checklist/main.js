/**
 * CHECK LIST DE SEGUIMIENTO — página independiente (no comparte código con ningún itinerario).
 * Por itinerario: 3 espacios (quién · fecha · hora · dónde se quedó). El botón corre 3→2→1 y deja el 3 en blanco.
 */
import { applyPlatformShell } from "./propio/platform-shell.js";
import { auth, onAuthStateChanged, wireLoginForm } from "./propio/auth.js";
import { ITINERARIOS, problema, registrar, fechaHora, ahoraLima } from "./logica.js";
import { leer, guardar } from "./almacen.js";

applyPlatformShell({ itinerary: "checklist", subtitle: "CHECK LIST DE SEGUIMIENTO" });
wireLoginForm();

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nombreDe = (u) => u?.displayName || (u?.email ? u.email.split("@")[0] : "");

function espacio(e, titulo) {
  if (!e) return `<div class="chk-slot vacio"><small>${titulo}</small><p class="muted">Sin registro</p></div>`;
  return `<div class="chk-slot"><small>${titulo}</small><b>${esc(fechaHora(e))}</b><div>${esc(e.quien)}</div><div class="chk-donde">${esc(e.donde || "—")}</div></div>`;
}

function pintar(root, user, datos) {
  root.innerHTML = `
    <section class="panel">
      <h1 style="margin:0 0 4px">Check list de seguimiento</h1>
      <p class="muted" style="margin:0 0 14px">Anota quién hizo el seguimiento, cuándo y dónde se quedó. Al registrar, el espacio 3 pasa al 2, el 2 pasa al 1 y el 3 queda en blanco.</p>
      ${ITINERARIOS.map((it) => {
        const f = datos[it.id], b = f.borrador;
        return `<article class="chk-fila" data-it="${it.id}">
          <h2>${esc(it.nombre)}</h2>
          <div class="chk-grid">
            ${espacio(f.e1, "1 · MÁS ANTIGUO")}
            ${espacio(f.e2, "2 · ÚLTIMO REGISTRO")}
            <div class="chk-slot nuevo">
              <small>3 · NUEVO</small>
              <label>Quién<input data-c="quien" type="text" value="${esc(b.quien)}" placeholder="${esc(nombreDe(user))}"></label>
              <div class="chk-fh"><label>Fecha<input data-c="fecha" type="date" value="${esc(b.fecha)}"></label>
              <label>Hora<input data-c="hora" type="time" value="${esc(b.hora)}"></label></div>
              <label>Dónde se quedó<input data-c="donde" type="text" value="${esc(b.donde)}" placeholder="Unidad, OC o paso"></label>
              <div class="chk-botones"><button type="button" class="ghost" data-a="ahora">AHORA</button>
              <button type="button" class="primary" data-a="registrar">REGISTRAR</button></div>
              <p class="chk-msg" aria-live="polite"></p>
            </div>
          </div>
        </article>`;
      }).join("")}
    </section>`;

  root.querySelectorAll(".chk-fila").forEach((art) => {
    const id = art.dataset.it, msg = art.querySelector(".chk-msg");
    const leerBorrador = () => Object.fromEntries([...art.querySelectorAll("[data-c]")].map((i) => [i.dataset.c, i.value]));
    art.querySelectorAll("[data-c]").forEach((i) => i.addEventListener("input", () => { datos[id].borrador = leerBorrador(); guardar(user.uid, datos); }));
    art.querySelector('[data-a="ahora"]').addEventListener("click", () => {
      const a = ahoraLima();
      art.querySelector('[data-c="fecha"]').value = a.fecha;
      art.querySelector('[data-c="hora"]').value = a.hora;
      if (!art.querySelector('[data-c="quien"]').value) art.querySelector('[data-c="quien"]').value = nombreDe(user);
      datos[id].borrador = leerBorrador(); guardar(user.uid, datos);
    });
    art.querySelector('[data-a="registrar"]').addEventListener("click", () => {
      const fila = { ...datos[id], borrador: leerBorrador() };
      const p = problema(fila.borrador);
      if (p) { msg.textContent = p; msg.className = "chk-msg err"; return; }
      datos[id] = registrar(fila);
      guardar(user.uid, datos);
      pintar(root, user, datos);
      root.querySelector(`[data-it="${id}"] .chk-msg`).textContent = "Registrado.";
    });
  });
}

onAuthStateChanged(auth, (user) => {
  document.body.classList.remove("auth-pending");
  document.getElementById("login")?.classList.toggle("hidden", !!user);
  document.getElementById("workspace")?.classList.toggle("hidden", !user);
  const who = document.getElementById("chk-user");
  if (who) who.textContent = user?.email || "";
  if (user) pintar(document.getElementById("content"), user, leer(user.uid));
});
