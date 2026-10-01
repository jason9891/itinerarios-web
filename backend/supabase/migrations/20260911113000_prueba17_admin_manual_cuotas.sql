-- PRUEBA 17 FINAL · ADMIN / CUOTAS / IMPORTACION SEGUIMIENTO MANUAL
-- La regla operativa es inequívoca: Viaje = F -> HISTORICO; cualquier otro valor -> DIARIO.

create table if not exists public.seguimiento_manual_importaciones (
  id bigserial primary key,
  itinerario text not null,
  nombre_archivo text not null,
  hash_sha256 text,
  usuario text not null,
  filas_recibidas integer not null default 0,
  abiertas integer not null default 0,
  cerradas integer not null default 0,
  insertadas integer not null default 0,
  actualizadas integer not null default 0,
  movidas integer not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists idx_seg_manual_import_itinerario_fecha on public.seguimiento_manual_importaciones(itinerario,creado_en desc);
alter table public.seguimiento_manual_importaciones enable row level security;
revoke all on table public.seguimiento_manual_importaciones from anon, authenticated;
grant select,insert,update,delete on table public.seguimiento_manual_importaciones to service_role;
grant usage,select on sequence public.seguimiento_manual_importaciones_id_seq to service_role;

create table if not exists public.app_egress_log (
  id bigserial primary key,
  itinerario text not null,
  servicio text not null,
  bytes bigint not null check(bytes >= 0),
  usuario text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_app_egress_itin_fecha on public.app_egress_log(itinerario,creado_en desc);
alter table public.app_egress_log enable row level security;
revoke all on table public.app_egress_log from anon, authenticated;
grant select,insert,update,delete on table public.app_egress_log to service_role;
grant usage,select on sequence public.app_egress_log_id_seq to service_role;

create or replace function public.cemento_importar_seguimiento_manual(
  p_nombre_archivo text,
  p_hash_sha256 text,
  p_usuario text,
  p_filas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_item jsonb;
  v_oc text;
  v_viaje text;
  v_target text;
  v_payload jsonb;
  v_id bigint;
  v_old_origin text;
  v_insertadas integer := 0;
  v_actualizadas integer := 0;
  v_movidas integer := 0;
  v_abiertas integer := 0;
  v_cerradas integer := 0;
  v_extra integer := 0;
begin
  if jsonb_typeof(coalesce(p_filas,'[]'::jsonb)) <> 'array' then
    raise exception 'p_filas debe ser un arreglo JSON';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) loop
    v_oc := regexp_replace(trim(coalesce(v_item->>'orden_carga','')), '\.0+$', '', 'g');
    if nullif(v_oc,'') is null then continue; end if;
    v_viaje := upper(trim(coalesce(v_item->>'viaje', v_item->'payload'->>'Viaje', '')));
    v_target := case when v_viaje = 'F' then 'HISTORICO' else 'DIARIO' end;
    v_payload := coalesce(v_item->'payload','{}'::jsonb) || jsonb_build_object(
      'Orden de Carga', v_oc,
      'Viaje', v_viaje,
      'ESTADO OC', case when v_target='HISTORICO' then 'CERRADO' else 'ABIERTO' end
    );

    v_id := null; v_old_origin := null;
    select s.id, s.origen into v_id, v_old_origin
      from public.seguimiento_staging s
     where s.itinerario='CEMENTO' and s.orden_carga=v_oc
     order by case when s.origen=v_target then 0 else 1 end, s.id desc
     limit 1 for update;

    if v_id is null then
      insert into public.seguimiento_staging(itinerario,origen,orden_carga,payload,observacion_migracion)
      values('CEMENTO',v_target,left(v_oc,255),v_payload,'IMPORTACION MANUAL PRUEBA 17')
      returning id into v_id;
      v_insertadas := v_insertadas + 1;
    else
      update public.seguimiento_staging
         set origen=v_target, payload=v_payload, observacion_migracion='IMPORTACION MANUAL PRUEBA 17'
       where id=v_id;
      v_actualizadas := v_actualizadas + 1;
      if coalesce(v_old_origin,'') <> v_target then v_movidas := v_movidas + 1; end if;
    end if;

    delete from public.seguimiento_staging
     where itinerario='CEMENTO' and orden_carga=v_oc and id<>v_id;
    get diagnostics v_extra = row_count;

    insert into public.seguimiento_auditoria(
      itinerario,seguimiento_id,orden_carga,accion,campo,valor_anterior,valor_nuevo,usuario
    ) values(
      'CEMENTO',v_id,left(v_oc,255),'IMPORTACION_MANUAL','ORIGEN',v_old_origin,v_target,left(coalesce(p_usuario,'ADMIN'),255)
    );

    if v_target='HISTORICO' then v_cerradas := v_cerradas + 1; else v_abiertas := v_abiertas + 1; end if;
  end loop;

  delete from public.seguimiento_sesion_web where itinerario='CEMENTO';
  delete from public.cemento_reporte_control where itinerario='CEMENTO';

  insert into public.seguimiento_manual_importaciones(
    itinerario,nombre_archivo,hash_sha256,usuario,filas_recibidas,abiertas,cerradas,insertadas,actualizadas,movidas
  ) values(
    'CEMENTO',left(coalesce(p_nombre_archivo,'SEGUIMIENTO MANUAL.xlsx'),255),left(coalesce(p_hash_sha256,''),255),left(coalesce(p_usuario,'ADMIN'),255),
    jsonb_array_length(coalesce(p_filas,'[]'::jsonb)),v_abiertas,v_cerradas,v_insertadas,v_actualizadas,v_movidas
  );

  return jsonb_build_object(
    'ok',true,'filas',v_abiertas+v_cerradas,'abiertas',v_abiertas,'cerradas',v_cerradas,
    'insertadas',v_insertadas,'actualizadas',v_actualizadas,'movidas',v_movidas
  );
end;
$$;
revoke all on function public.cemento_importar_seguimiento_manual(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.cemento_importar_seguimiento_manual(text,text,text,jsonb) to service_role;

create or replace function public.itinerarios_cuotas_prueba17()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_database_total bigint := 0;
  v_storage_total bigint := 0;
  v_egress_total bigint := 0;
  v_it text;
  v_table text;
  v_tmp bigint := 0;
  v_db_it bigint := 0;
  v_storage_it bigint := 0;
  v_egress_it bigint := 0;
  v_items jsonb := '[]'::jsonb;
begin
  select pg_database_size(current_database()) into v_database_total;
  begin
    execute 'select coalesce(sum((metadata->>''size'')::bigint),0) from storage.objects' into v_storage_total;
  exception when others then v_storage_total := 0; end;
  select coalesce(sum(bytes),0) into v_egress_total from public.app_egress_log where creado_en >= date_trunc('month',now());

  for v_it in
    select distinct itinerario from (
      values ('CEMENTO'::text),('CERRO VERDE'::text),('QUELLAVECO'::text)
    ) as base(itinerario)
    union
    select distinct itinerario from public.seguimiento_staging where nullif(trim(itinerario),'') is not null
    union
    select distinct itinerario from public.sap_registros_staging where nullif(trim(itinerario),'') is not null
    union
    select distinct itinerario from public.app_egress_log where nullif(trim(itinerario),'') is not null
  loop
    v_db_it := 0;
    foreach v_table in array array[
      'cemento_configuracion','cemento_reporte_control','configuracion_documentos','gps_precarga_jobs','gps_precarga_unidades',
      'sap_importaciones','sap_registros_staging','sap_sync_filas','sap_sync_previews','seguimiento_auditoria','seguimiento_sesion_web',
      'seguimiento_staging','snapshots_base','seguimiento_manual_importaciones','app_egress_log'
    ] loop
      begin
        execute format('select coalesce(sum(pg_column_size(t)),0) from public.%I t where t.itinerario=$1',v_table) into v_tmp using v_it;
        v_db_it := v_db_it + coalesce(v_tmp,0);
      exception when undefined_table or undefined_column then null;
      end;
    end loop;

    begin
      execute 'select coalesce(sum((metadata->>''size'')::bigint),0) from storage.objects where regexp_replace(upper(bucket_id),''[^A-Z0-9]'','''',''g'') like ''%'' || regexp_replace(upper($1),''[^A-Z0-9]'','''',''g'') || ''%''' into v_storage_it using v_it;
    exception when others then v_storage_it := 0; end;
    select coalesce(sum(bytes),0) into v_egress_it from public.app_egress_log where itinerario=v_it and creado_en>=date_trunc('month',now());
    v_items := v_items || jsonb_build_array(jsonb_build_object('itinerario',v_it,'database_row_bytes',v_db_it,'storage_bytes',v_storage_it,'egress_bytes_mes',v_egress_it));
  end loop;

  return jsonb_build_object(
    'global',jsonb_build_object('database_total_bytes',v_database_total,'storage_total_bytes',v_storage_total,'egress_app_bytes_mes',v_egress_total),
    'itinerarios',v_items,
    'nota_egress','Registro interno de descargas pesadas desde PRUEBA 17; el Usage oficial de Supabase prevalece.'
  );
end;
$$;
revoke all on function public.itinerarios_cuotas_prueba17() from public, anon, authenticated;
grant execute on function public.itinerarios_cuotas_prueba17() to service_role;

analyze public.seguimiento_staging;
analyze public.seguimiento_manual_importaciones;
analyze public.app_egress_log;
