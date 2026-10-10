/**
 * Itinerario PRUEBA — mapa + lista de placas.
 * Tras login, GPS apunta al Supabase del operador (tenant).
 */
import { applyPlatformShell, bindActiveUser } from "../shared/platform-shell.js";
import { auth, onAuthStateChanged, wireLoginForm } from "../shared/auth.js";
import { createItineraryRuntime, loadModule } from "../shared/module-runtime.js";
import { modules, CENTRAL } from "./registry.js";
import { loadTenant, tenantSummary } from "./tenant.js";

applyPlatformShell({ itinerary: "prueba", subtitle: "PRUEBA · MULTI-SUPABASE" });
wireLoginForm();

const runtime = createItineraryRuntime("prueba", {
  auth,
  api: { central: CENTRAL },
});

const content = () => document.getElementById("content");

function refreshTenantBadge() {
  const el = document.getElementById("tenant-badge");
  if (!el || !auth.currentUser) return;
  const cfg = loadTenant(auth.currentUser);
  el.textContent = tenantSummary(cfg);
  el.title = cfg.clocatorUrl || cfg.supabaseUrl || "Configure su Supabase en la pestaña MI SUPABASE";
}

function navState(route) {
  document
    .querySelectorAll("nav button[data-route]")
    .forEach((b) => b.classList.toggle("active", b.dataset.route === route));
}

async function go(route) {
  const r = route || "seguimiento";
  history.replaceState(null, "", `#/${r}`);
  navState(r);
  refreshTenantBadge();
  try {
    await loadModule(runtime, content(), modules, r);
  } catch (e) {
    console.error("[prueba] loadModule", e);
    content().innerHTML = `<section class="error-box"><h2>Error</h2><p>${String(e.message || e)}</p></section>`;
  }
}

document.querySelectorAll("nav button[data-route]").forEach((b) => {
  b.addEventListener("click", () => go(b.dataset.route));
});

onAuthStateChanged(auth, async (user) => {
  bindActiveUser(user);
  const login = document.getElementById("login");
  const workspace = document.getElementById("workspace");
  document.body.classList.remove("auth-pending");
  if (login) login.classList.toggle("hidden", !!user);
  if (workspace) workspace.classList.toggle("hidden", !user);
  if (user) {
    refreshTenantBadge();
    await go(location.hash.replace(/^#\/?/, "") || "seguimiento");
  }
});

window.addEventListener("hashchange", () => {
  if (!auth.currentUser) return;
  go(location.hash.replace(/^#\/?/, "") || "seguimiento");
});

window.__pruebaGo = go;
window.__pruebaRuntime = runtime;
