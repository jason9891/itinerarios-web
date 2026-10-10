const V = "prueba02";

export const modules = {
  seguimiento: () => import(`./modules/seguimiento.js?v=${V}`),
  config: () => import(`./modules/config.js?v=${V}`),
};

/**
 * PRINCIPAL (solo referencia / futuro cierre).
 * El GPS de PRUEBA usa la URL del tenant del usuario logueado.
 */
/** Proyecto operador de prueba (cuenta Itinerarios). */
export const OPERATOR_DEMO = {
  supabaseUrl: "https://wvhwmgmrhpmapthxqbun.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aHdtZ21yaHBtYXB0aHhxYnVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTgyMTYsImV4cCI6MjEwNzE3NDIxNn0.gMoJGjYDrLNEzmHrVtGlrEYBy_AhLcNlXZ_R9LEwJ4Q",
  clocatorUrl: "https://wvhwmgmrhpmapthxqbun.supabase.co/functions/v1/prueba-clocator",
};

export const CENTRAL = {
  supabaseUrl: "https://otvdwqbrqvxahyzfkhds.supabase.co",
  /** Fallback temporal si el operador aún no tiene function propia */
  clocatorFallback:
    "https://otvdwqbrqvxahyzfkhds.supabase.co/functions/v1/cerro-verde-clocator",
};
