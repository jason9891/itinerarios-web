/**
 * Entry point de TURNO AMANECIDA.
 * Solo: shell + auth + router de módulos.
 */
import { applyPlatformShell } from "../shared/platform-shell.js";
import { auth, onAuthStateChanged, wireLoginForm } from "../shared/auth.js";
import { createItineraryRuntime, loadModule } from "../shared/module-runtime.js";
import { modules, API } from "./registry.js";

applyPlatformShell({ itinerary: "turno-amanecida", subtitle: "TURNO AMANECIDA" });
wireLoginForm();

const runtime = createItineraryRuntime("turno-amanecida", { auth, api: API });
const content = () => document.getElementById("content");

function navState(route) {
  document
    .querySelectorAll("nav button[data-route]")
    .forEach((b) => b.classList.toggle("active", b.dataset.route === route));
}

async function go(route) {
  const r = route || "home";
  history.replaceState(null, "", `#/${r}`);
  navState(r);
  try {
    await loadModule(runtime, content(), modules, r);
  } catch (e) {
    console.error("[turno-amanecida] loadModule", e);
    content().innerHTML =
      `<section class="error-box"><h2>No se pudo cargar el módulo</h2><p>${esc(e.message)}</p></section>`;
  }
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

document.querySelectorAll("nav button[data-route]").forEach((b) => {
  b.addEventListener("click", () => go(b.dataset.route));
});

onAuthStateChanged(auth, async (user) => {
  const login = document.getElementById("login");
  const workspace = document.getElementById("workspace");
  document.body.classList.remove("auth-pending");
  if (login) login.classList.toggle("hidden", !!user);
  if (workspace) workspace.classList.toggle("hidden", !user);
  if (user) {
    await go(location.hash.replace(/^#\/?/, "") || "home");
  }
});

window.__turnoAmanecidaRuntime = runtime;
