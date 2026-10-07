-- TURNO AMANECIDA: maestros OC (última por equipo) y tipo acople editable

create table if not exists public.amanecida_tipo_acople (
  codigo text primary key,
  carroceria text,
  gestor text,
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.amanecida_oc_ultima (
  equipo text primary key,              -- clave normalizada (Equipo / 20-R-xxx)
  equipo_raw text,
  fec_ini_real timestamptz,
  fec_ini_real_raw text,
  acoplado_1 text,
  nombre_piloto text,
  descripcion_ruta text,
  material_servicio text,
  payload jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.amanecida_maestros_meta (
  tipo text primary key,                -- 'oc' | 'acoples'
  nombre_archivo text,
  filas integer not null default 0,
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  nota text
);

create index if not exists amanecida_oc_ultima_fec_idx
  on public.amanecida_oc_ultima (fec_ini_real desc);

comment on table public.amanecida_oc_ultima is
  'Última OC por equipo (FecIniReal más reciente). Alimenta unidades 20-R- filtradas por geocerca _TN.';
comment on table public.amanecida_tipo_acople is
  'Catálogo de tipo de acople editable. Carga inicial desde TIPO_ACOPLE.xlsx.';
