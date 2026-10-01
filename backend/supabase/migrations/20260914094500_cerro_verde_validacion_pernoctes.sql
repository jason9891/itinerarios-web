-- CERRO VERDE · VALIDACIÓN MANUAL DE PERNOCTES
-- Exclusivo CERRO VERDE. No altera CEMENTO ni otros itinerarios.

create table if not exists public.cerro_verde_pernoctes_validacion (
  evento_origen_id bigint primary key,
  entrega_sap text not null,
  placa text not null,
  codigo_tracto text not null,
  limite_permitido text not null,
  zona_detectada text not null,
  propuesta_motor text not null,
  cumple_final text not null check (cumple_final in ('SI','NO')),
  observacion text,
  validado_por text not null,
  validado_en timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb
);

create index if not exists idx_cv_pernocte_validacion_entrega
  on public.cerro_verde_pernoctes_validacion(entrega_sap);
create index if not exists idx_cv_pernocte_validacion_placa
  on public.cerro_verde_pernoctes_validacion(placa);
create index if not exists idx_cv_pernocte_validacion_fecha
  on public.cerro_verde_pernoctes_validacion(validado_en desc);

alter table public.cerro_verde_pernoctes_validacion enable row level security;
revoke all on table public.cerro_verde_pernoctes_validacion from anon, authenticated;
grant select,insert,update,delete on table public.cerro_verde_pernoctes_validacion to service_role;
