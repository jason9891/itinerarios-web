/**
 * INTERRUPTOR DE TURNO AMANECIDA.
 * false = el módulo NO hace ninguna consulta (rutas, snapshot, maestros).
 * Motivo (09/10/2026): consumo de egress de Supabase al 105 % del plan gratis.
 * Reactivado (10/10/2026): el módulo ya no usa Supabase; habla solo con el Worker de Cloudflare.
 * Para pausarlo de nuevo: ACTIVO = false (bloquea toda consulta del módulo).
 */
export const ACTIVO = true;
export const MENSAJE = "Turno Amanecida está en pausa temporalmente.";
