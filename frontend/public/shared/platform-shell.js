/**
 * Shell de plataforma unificado.
 *
 * Objetivo:
 * - Un solo lugar para cambiar logo, nombre de empresa y textos de cabecera.
 * - Todos los itinerarios (Cemento, Cerro Verde, futuros) usan la misma estructura de ventana.
 * - Evitar que al agregar un itinerario nuevo se rompan anchos de columna o tamaños de letra.
 *
 * Uso en cada HTML de itinerario:
 *   <header class="top" data-itinerary="cemento">
 *     <div class="logo" id="platform-logo">R</div>
 *     <div class="brand">
 *       <b id="platform-brand">RACIEMSA</b>
 *       <small id="platform-subtitle">OPERADOR LOGÍSTICO</small>
 *     </div>
 *     <div class="grow"></div>
 *     <a class="itinerary-link" href="/">VOLVER A ITINERARIOS</a>
 *   </header>
 *
 * Luego en el JS del módulo:
 *   import { applyPlatformShell } from "/shared/platform-shell.js";
 *   applyPlatformShell({ itinerary: "cemento", subtitle: "CEMENTO · CONTROL OPERATIVO" });
 */

/** Configuración central. Cambiar aquí se refleja en todos los itinerarios. */
export const PLATFORM = {
  brand: "RACIEMSA",
  /** Texto o HTML del logo. Más adelante se puede poner: '<img src="/logo.png" alt="RACIEMSA">' */
  logoContent: "R",
  /** Clase extra opcional para el logo (ej. cuando sea imagen) */
  logoClass: "",
  defaultSubtitle: "PLATAFORMA DE ITINERARIOS",
};

/**
 * Aplica branding y subtítulo al header ya presente en el DOM.
 * No recrea el HTML; solo rellena los elementos canónicos.
 */
export function applyPlatformShell({
  itinerary = "",
  subtitle = null,
  logoContent = null,
} = {}) {
  const logoEl = document.getElementById("platform-logo") || document.querySelector(".top .logo");
  const brandEl = document.getElementById("platform-brand") || document.querySelector(".top b");
  const subEl = document.getElementById("platform-subtitle") || document.querySelector(".top small");

  if (logoEl) {
    const content = logoContent ?? PLATFORM.logoContent;
    if (content.startsWith("<")) {
      logoEl.innerHTML = content;
    } else {
      logoEl.textContent = content;
    }
    if (PLATFORM.logoClass) logoEl.classList.add(PLATFORM.logoClass);
  }

  if (brandEl) brandEl.textContent = PLATFORM.brand;
  if (subEl) subEl.textContent = subtitle ?? PLATFORM.defaultSubtitle;

  // Marca el body para estilos específicos si se necesita
  if (itinerary) {
    document.body.dataset.itinerary = itinerary;
  }
}

/**
 * Plantilla HTML del header canónico (para referencia o generación futura).
 * Mantener este string sincronizado con los HTML de cada itinerario.
 */
export const HEADER_TEMPLATE = `
<header class="top">
  <div class="logo" id="platform-logo">R</div>
  <div class="brand">
    <b id="platform-brand">RACIEMSA</b>
    <small id="platform-subtitle">PLATAFORMA DE ITINERARIOS</small>
  </div>
  <div class="grow"></div>
  <a class="itinerary-link" href="/">VOLVER A ITINERARIOS</a>
</header>
`.trim();
