


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cemento_actualizar_corte"("p_fecha" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.cemento_configuracion (
    itinerario, fecha_inicio_recorrido, origen, nota, actualizado_en
  ) values (
    'CEMENTO', p_fecha, 'EDICION_WEB_PRUEBA_16',
    'Último seguimiento confirmado; inicio de la siguiente precarga CLocator', now()
  )
  on conflict (itinerario) do update set
    fecha_inicio_recorrido = excluded.fecha_inicio_recorrido,
    origen = excluded.origen,
    nota = excluded.nota,
    actualizado_en = excluded.actualizado_en;

  -- Un nuevo rango exige terminar nuevamente todas las placas antes de reportar.
  delete from public.cemento_reporte_control where itinerario = 'CEMENTO';
  return p_fecha;
end;
$$;


ALTER FUNCTION "public"."cemento_actualizar_corte"("p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cemento_aplicar_sap_reasignacion"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_rows" "jsonb", "p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_importacion_id bigint;
  v_item jsonb;
  v_oc text;
  v_accion text;
  v_sap jsonb;
  v_daily jsonb;
  v_sap_id bigint;
  v_seg_id bigint;
  v_seg_origen text;
  v_anterior jsonb;
  v_nuevo jsonb;
  v_nuevas integer := 0;
  v_diario integer := 0;
  v_vacias jsonb := '[]'::jsonb;
  v_con_info jsonb := '[]'::jsonb;
  v_ignoradas jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas de reasignación deben ser un arreglo JSON';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then
    raise exception 'La actualización excede 2000 OCs';
  end if;

  insert into public.sap_importaciones(
    itinerario,nombre_archivo,hash_sha256,filas_recibidas,
    filas_validas,filas_fuera_alcance,estado
  ) values (
    'CEMENTO',left(coalesce(p_nombre_archivo,'SAP_WEB.xlsx'),255),
    left(coalesce(p_hash_sha256,''),255),greatest(coalesce(p_filas_recibidas,0),0),
    0,0,'APLICANDO'
  ) returning id into v_importacion_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_oc := left(trim(coalesce(v_item->>'orden_carga','')),255);
    v_accion := coalesce(v_item->>'accion','');
    v_sap := coalesce(v_item->'sap_payload','{}'::jsonb);
    v_daily := coalesce(v_item->'daily_payload','{}'::jsonb);
    if v_oc = '' or jsonb_typeof(v_sap) <> 'object' or jsonb_typeof(v_daily) <> 'object' then
      continue;
    end if;
    if v_accion not in ('NUEVA','REASIGNAR_VACIA','REABRIR_CON_INFORMACION') then
      raise exception 'Acción de reasignación no permitida para OC %',v_oc;
    end if;

    select id into v_sap_id
    from public.sap_registros_staging
    where itinerario='CEMENTO' and orden_carga=v_oc
    order by id desc limit 1 for update;

    if v_sap_id is null then
      insert into public.sap_registros_staging(itinerario,importacion_id,orden_carga,payload)
      values('CEMENTO',v_importacion_id,v_oc,v_sap)
      returning id into v_sap_id;
      v_nuevas := v_nuevas+1;
    else
      update public.sap_registros_staging
      set importacion_id=v_importacion_id,payload=v_sap
      where itinerario='CEMENTO' and orden_carga=v_oc;
    end if;

    select id,origen,payload into v_seg_id,v_seg_origen,v_anterior
    from public.seguimiento_staging
    where itinerario='CEMENTO' and orden_carga=v_oc
    order by case when origen='DIARIO' then 0 else 1 end,id desc
    limit 1 for update;

    if v_accion='NUEVA' and v_seg_id is null then
      insert into public.seguimiento_staging(
        itinerario,origen,orden_carga,payload,observacion_migracion
      ) values ('CEMENTO','DIARIO',v_oc,v_daily,'ALTA SAP WEB · REASIGNACIÓN OC V1');
      v_diario := v_diario+1;
      continue;
    end if;

    if v_seg_id is null or v_seg_origen <> 'HISTORICO' then
      v_ignoradas := v_ignoradas || jsonb_build_array(v_oc);
      continue;
    end if;

    delete from public.seguimiento_sesion_web
    where itinerario='CEMENTO' and seguimiento_id=v_seg_id;

    if v_accion='REASIGNAR_VACIA' then
      v_nuevo := v_daily;
      update public.seguimiento_staging
      set origen='DIARIO',payload=v_nuevo,
          observacion_migracion='OC VACÍA REASIGNADA DESDE SAP'
      where id=v_seg_id;
      v_vacias := v_vacias || jsonb_build_array(v_oc);
    elsif v_accion='REABRIR_CON_INFORMACION' then
      v_nuevo := v_daily || (
        coalesce(v_anterior,'{}'::jsonb) - array[
          'Fecha Carga Real','Fecha de Orden','Orden de Carga','CONDUCTOR','Celular',
          'TRACTO','Placa Tracto','Código Carreta','Placa Carreta','Ruta','CARGA',
          'DESTINO','PRESENTACION','GESTOR','USUARIO SAP','ESTADO OC','Viaje'
        ]::text[]
      );
      v_nuevo := v_nuevo || jsonb_build_object('ESTADO OC','','Viaje','');
      update public.seguimiento_staging
      set origen='DIARIO',payload=v_nuevo,
          observacion_migracion='OC REASIGNADA CON INFORMACIÓN PREVIA · VALIDAR'
      where id=v_seg_id;
      v_con_info := v_con_info || jsonb_build_array(v_oc);
    end if;
    v_diario := v_diario+1;

    insert into public.seguimiento_auditoria(
      itinerario,seguimiento_id,orden_carga,accion,campo,
      valor_anterior,valor_nuevo,usuario
    ) values (
      'CEMENTO',v_seg_id,v_oc,'REABRIR_OC_REASIGNADA','ORIGEN',
      'HISTORICO','DIARIO',coalesce(nullif(trim(p_usuario),''),'WEB')
    );
  end loop;

  update public.sap_importaciones
  set filas_validas=jsonb_array_length(coalesce(p_rows,'[]'::jsonb)),
      filas_fuera_alcance=greatest(coalesce(p_filas_recibidas,0)-jsonb_array_length(coalesce(p_rows,'[]'::jsonb)),0),
      estado='APLICADO'
  where id=v_importacion_id;

  if v_diario>0 then
    delete from public.cemento_reporte_control where itinerario='CEMENTO';
  end if;

  return jsonb_build_object(
    'agregadas_sap',v_nuevas,
    'agregadas_diario',v_diario,
    'vacias_reasignadas',v_vacias,
    'con_informacion_reabiertas',v_con_info,
    'ignoradas_por_cambio_de_estado',v_ignoradas,
    'importacion_id',v_importacion_id
  );
end;
$$;


ALTER FUNCTION "public"."cemento_aplicar_sap_reasignacion"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_rows" "jsonb", "p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cemento_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_importacion_id bigint;
  v_sap_count integer := 0;
  v_daily_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_sap_rows, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_daily_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas SAP deben ser arreglos JSON';
  end if;

  insert into public.sap_importaciones (
    itinerario, nombre_archivo, hash_sha256, filas_recibidas,
    filas_validas, filas_fuera_alcance, estado
  ) values (
    'CEMENTO', left(coalesce(p_nombre_archivo, 'SAP_WEB.xlsx'), 255),
    left(coalesce(p_hash_sha256, ''), 255), greatest(coalesce(p_filas_recibidas, 0), 0),
    0, 0, 'APLICANDO'
  ) returning id into v_importacion_id;

  insert into public.sap_registros_staging (itinerario, importacion_id, orden_carga, payload)
  select 'CEMENTO', v_importacion_id, left(trim(x.orden_carga), 255), x.payload
  from jsonb_to_recordset(coalesce(p_sap_rows, '[]'::jsonb)) as x(orden_carga text, payload jsonb)
  where nullif(trim(x.orden_carga), '') is not null
    and jsonb_typeof(x.payload) = 'object'
    and not exists (
      select 1 from public.sap_registros_staging s
      where s.itinerario = 'CEMENTO' and s.orden_carga = trim(x.orden_carga)
    )
  on conflict do nothing;
  get diagnostics v_sap_count = row_count;

  insert into public.seguimiento_staging (
    itinerario, origen, orden_carga, payload, observacion_migracion
  )
  select 'CEMENTO', 'DIARIO', left(trim(x.orden_carga), 255), x.payload,
         'ALTA SAP WEB PRUEBA 16'
  from jsonb_to_recordset(coalesce(p_daily_rows, '[]'::jsonb)) as x(orden_carga text, payload jsonb)
  where nullif(trim(x.orden_carga), '') is not null
    and jsonb_typeof(x.payload) = 'object'
    and not exists (
      select 1 from public.seguimiento_staging s
      where s.itinerario = 'CEMENTO' and s.orden_carga = trim(x.orden_carga)
    );
  get diagnostics v_daily_count = row_count;

  update public.sap_importaciones
     set filas_validas = v_sap_count,
         filas_fuera_alcance = greatest(coalesce(p_filas_recibidas, 0) - v_sap_count, 0),
         estado = 'APLICADO'
   where id = v_importacion_id;

  if v_daily_count > 0 then
    delete from public.cemento_reporte_control where itinerario = 'CEMENTO';
  end if;

  return jsonb_build_object(
    'agregadas_sap', v_sap_count,
    'agregadas_diario', v_daily_count,
    'ignoradas_existentes', greatest(jsonb_array_length(coalesce(p_sap_rows, '[]'::jsonb)) - v_sap_count, 0),
    'importacion_id', v_importacion_id
  );
end;
$$;


ALTER FUNCTION "public"."cemento_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cemento_consolidar_seguimiento"("p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  fila public.seguimiento_staging%rowtype;
  nuevo jsonb;
  k text;
  v jsonb;
  n_guardadas int := 0;
  n_cerradas int := 0;
  tiene_cambios boolean;
begin
  for r in
    select *
      from public.seguimiento_sesion_web
     where itinerario='CEMENTO' and usuario=p_usuario
     order by id
     for update
  loop
    -- PostgreSQL no tiene jsonb_object_length(jsonb).
    -- Para este caso basta comparar contra el objeto JSON vacío.
    tiene_cambios := coalesce(r.cambios, '{}'::jsonb) <> '{}'::jsonb;

    -- REVISADA sin edición ni cierre es solo una marca de avance.
    if r.accion <> 'CERRAR' and not tiene_cambios then
      continue;
    end if;

    select * into fila
      from public.seguimiento_staging
     where id=r.seguimiento_id
       and itinerario='CEMENTO'
       and origen='DIARIO'
     for update;

    if not found then
      continue;
    end if;

    nuevo := fila.payload;

    for k,v in select * from jsonb_each(coalesce(r.cambios, '{}'::jsonb)) loop
      if k=any(array[
        'FECHA DE SALIDA PLANTA YURA/CARACOTO',
        'FECHA LLEGADA A DESTINO',
        'FECHA INICIO DE RETORNO',
        'FECHA FIN DE RETORNO AQP/YURA/CRCT',
        'CARGA DE RETORNO',
        'OBSERVACIONES',
        'UBICACIÓN',
        'ESTADO'
      ]) then
        if nuevo->k is distinct from v then
          insert into public.seguimiento_auditoria(
            itinerario,seguimiento_id,orden_carga,accion,campo,
            valor_anterior,valor_nuevo,usuario
          ) values (
            'CEMENTO',fila.id,fila.orden_carga,
            case when r.accion='CERRAR' then 'CERRAR_ACTUALIZACION' else 'GUARDAR' end,
            k,nuevo->>k,case when v='null'::jsonb then null else v#>>'{}' end,p_usuario
          );
          if v='null'::jsonb then
            nuevo := nuevo-k;
          else
            nuevo := jsonb_set(nuevo,array[k],v,true);
          end if;
        end if;
      end if;
    end loop;

    if r.accion='CERRAR' then
      -- JSON string válido, sin barras invertidas dentro del valor JSON.
      nuevo := jsonb_set(nuevo,'{ESTADO OC}',to_jsonb('CERRADA'::text),true);
      insert into public.seguimiento_staging(
        itinerario,origen,orden_carga,payload,observacion_migracion
      ) values (
        'CEMENTO','HISTORICO',fila.orden_carga,nuevo,
        'Cierre consolidado por CEMENTO WEB'
      );
      insert into public.seguimiento_auditoria(
        itinerario,seguimiento_id,orden_carga,accion,campo,
        valor_anterior,valor_nuevo,usuario
      ) values (
        'CEMENTO',fila.id,fila.orden_carga,'CERRAR','ESTADO OC',
        fila.payload->>'ESTADO OC','CERRADA',p_usuario
      );
      delete from public.seguimiento_staging where id=fila.id;
      n_cerradas := n_cerradas+1;
    else
      update public.seguimiento_staging set payload=nuevo where id=fila.id;
      n_guardadas := n_guardadas+1;
    end if;
  end loop;

  delete from public.seguimiento_sesion_web
   where itinerario='CEMENTO' and usuario=p_usuario;

  return jsonb_build_object('guardadas',n_guardadas,'cerradas',n_cerradas);
end
$$;


ALTER FUNCTION "public"."cemento_consolidar_seguimiento"("p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cemento_importar_seguimiento_manual"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_usuario" "text", "p_filas" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."cemento_importar_seguimiento_manual"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_usuario" "text", "p_filas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_actualizar_corte"("p_fecha" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.cemento_configuracion(itinerario,fecha_inicio_recorrido,origen,nota,actualizado_en)
  values('CERRO VERDE',p_fecha,'EDICION_WEB','Último seguimiento Cerro Verde confirmado',now())
  on conflict(itinerario) do update set fecha_inicio_recorrido=excluded.fecha_inicio_recorrido,actualizado_en=now();
  delete from public.cemento_reporte_control where itinerario='CERRO VERDE';
  return p_fecha;
end$$;


ALTER FUNCTION "public"."cerro_verde_actualizar_corte"("p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_aplicar_sap_v3"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_validas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  imp bigint;
  n_sap int:=0;
  n_daily int:=0;
  n_group int:=0;
  r_group record;
  old_payload jsonb;
  now_pe text;
BEGIN
  now_pe:=to_char(now() at time zone 'America/Lima','YYYY-MM-DD HH24:MI:SS');

  INSERT INTO public.sap_importaciones(
    itinerario,nombre_archivo,hash_sha256,filas_recibidas,
    filas_validas,filas_fuera_alcance,estado
  )
  VALUES(
    'CERRO VERDE',left(p_nombre_archivo,255),p_hash_sha256,
    p_filas_recibidas,p_filas_validas,p_filas_fuera_alcance,'APLICADO'
  )
  RETURNING id INTO imp;

  INSERT INTO public.sap_registros_staging(
    itinerario,importacion_id,orden_carga,payload
  )
  SELECT
    'CERRO VERDE',imp,sr.orden_carga,sr.payload
  FROM jsonb_to_recordset(coalesce(p_sap_rows,'[]'::jsonb))
       AS sr(orden_carga text,payload jsonb)
  WHERE NOT EXISTS(
    SELECT 1
    FROM public.sap_registros_staging s
    WHERE s.itinerario='CERRO VERDE'
      AND s.orden_carga=sr.orden_carga
  );
  GET DIAGNOSTICS n_sap=ROW_COUNT;

  INSERT INTO public.seguimiento_staging(
    itinerario,origen,orden_carga,payload,observacion_migracion
  )
  SELECT
    'CERRO VERDE','DIARIO',dr.orden_carga,dr.payload,
    'ALTA SAP WEB · DETALLES 6'
  FROM jsonb_to_recordset(coalesce(p_daily_rows,'[]'::jsonb))
       AS dr(orden_carga text,payload jsonb)
  WHERE NOT EXISTS(
    SELECT 1
    FROM public.seguimiento_staging s
    WHERE s.itinerario='CERRO VERDE'
      AND s.orden_carga=dr.orden_carga
  );
  GET DIAGNOSTICS n_daily=ROW_COUNT;

  FOR r_group IN
    SELECT *
    FROM jsonb_to_recordset(coalesce(p_group_rows,'[]'::jsonb))
         AS gr(codigo_tracto text,placa text,payload jsonb)
  LOOP
    SELECT payload
      INTO old_payload
    FROM public.cerro_verde_grupo_smcv
    WHERE codigo_tracto=r_group.codigo_tracto;

    old_payload:=coalesce(old_payload,'{}'::jsonb);

    INSERT INTO public.cerro_verde_grupo_smcv(
      codigo_tracto,payload,activo,actualizado_en
    )
    VALUES(
      r_group.codigo_tracto,
      old_payload||jsonb_build_object(
        'CODIGO_TRACTO',r_group.codigo_tracto,
        'PLACA_TRACTO',r_group.placa,
        'LICENCIA',r_group.payload->>'LICENCIA',
        'CONDUCTOR',r_group.payload->>'CONDUCTOR',
        'CONDUCTOR_REPORTE',r_group.payload->>'CONDUCTOR',
        'CODIGO_CARRETA',r_group.payload->>'CODIGO CARRETA',
        'PLACA_CARRETA',r_group.payload->>'PLACA CARRETA',
        'ACTIVO_GRUPO',1,
        'SECCION_REPORTE','CAL CARGADO',
        'ESTADO','ESTACIONADO CARGADO',
        'MONITOREO','',
        'OBSERVACION','',
        'ULTIMA_ENTREGA',r_group.payload->>'ENTREGA SAP',
        'FECHA_ULTIMA_CARGA',r_group.payload->>'FECHA DE CARGA',
        'CICLO_ABIERTO',1,
        'ORIGEN_FOTO','SAP WEB',
        'MOTIVO_ALTA','NUEVA CARGA SMCV',
        'FECHA_ALTA_GRUPO',now_pe,
        'FECHA_BAJA_GRUPO','',
        'MOTIVO_BAJA','',
        'SNAPSHOT_CICLO',r_group.payload,
        'HITO_1_REPORTE','-',
        'HITO_2_REPORTE','-',
        'HITO_3_REPORTE','-',
        'HITO_4_REPORTE','-'
      ),
      true,
      now()
    )
    ON CONFLICT(codigo_tracto) DO UPDATE
      SET payload=excluded.payload,
          activo=true,
          actualizado_en=excluded.actualizado_en;

    n_group:=n_group+1;

    DELETE FROM public.cerro_verde_revision_unidades
    WHERE placa=upper(regexp_replace(r_group.placa,'[^A-Za-z0-9]','','g'));

    UPDATE public.cerro_verde_arrastre_operativo
       SET activo=false,
           situacion='NUEVO_CICLO',
           fecha_salida_arrastre=now(),
           motivo_salida='NUEVA_CARGA_SMCV',
           nueva_entrega=r_group.payload->>'ENTREGA SAP',
           actualizado_en=now()
     WHERE placa=upper(regexp_replace(r_group.placa,'[^A-Za-z0-9]','','g'));
  END LOOP;

  DELETE FROM public.cemento_reporte_control
  WHERE itinerario='CERRO VERDE';

  RETURN jsonb_build_object(
    'agregadas_sap',n_sap,
    'agregadas_diario',n_daily,
    'unidades_grupo_actualizadas',n_group
  );
END
$$;


ALTER FUNCTION "public"."cerro_verde_aplicar_sap_v3"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_validas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n_sap int:=0;n_daily int:=0;imp bigint;
begin
  insert into public.sap_importaciones(itinerario,nombre_archivo,hash_sha256,filas_recibidas,filas_validas,filas_fuera_alcance,estado)
  values('CERRO VERDE',left(coalesce(p_nombre_archivo,'SAP_CERRO_VERDE.xlsx'),255),p_hash_sha256,greatest(coalesce(p_filas_recibidas,0),0),0,0,'APLICANDO') returning id into imp;
  insert into public.sap_registros_staging(itinerario,importacion_id,orden_carga,payload)
  select 'CERRO VERDE',imp,left(trim(x.orden_carga),255),x.payload from jsonb_to_recordset(coalesce(p_sap_rows,'[]')) x(orden_carga text,payload jsonb)
  where nullif(trim(x.orden_carga),'') is not null and not exists(select 1 from public.sap_registros_staging s where s.itinerario='CERRO VERDE' and s.orden_carga=trim(x.orden_carga));
  get diagnostics n_sap=row_count;
  insert into public.seguimiento_staging(itinerario,origen,orden_carga,payload,observacion_migracion)
  select 'CERRO VERDE','DIARIO',left(trim(x.orden_carga),255),x.payload,'ALTA SAP WEB CERRO VERDE' from jsonb_to_recordset(coalesce(p_daily_rows,'[]')) x(orden_carga text,payload jsonb)
  where nullif(trim(x.orden_carga),'') is not null and not exists(select 1 from public.seguimiento_staging s where s.itinerario='CERRO VERDE' and s.orden_carga=trim(x.orden_carga));
  get diagnostics n_daily=row_count;
  update public.sap_importaciones set filas_validas=n_sap,filas_fuera_alcance=greatest(p_filas_recibidas-n_sap,0),estado='APLICADO' where id=imp;
  delete from public.cemento_reporte_control where itinerario='CERRO VERDE';
  return jsonb_build_object('agregadas_sap',n_sap,'agregadas_diario',n_daily,'importacion_id',imp);
end$$;


ALTER FUNCTION "public"."cerro_verde_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_aplicar_sap_web_v2"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n_sap int:=0;n_daily int:=0;n_group int:=0;imp bigint;
begin
  insert into public.sap_importaciones(itinerario,nombre_archivo,hash_sha256,filas_recibidas,filas_validas,filas_fuera_alcance,estado)
  values('CERRO VERDE',left(coalesce(p_nombre_archivo,'SAP_CERRO_VERDE.xls'),255),coalesce(p_hash_sha256,''),greatest(coalesce(p_filas_recibidas,0),0),0,greatest(coalesce(p_filas_fuera_alcance,0),0),'APLICANDO') returning id into imp;
  insert into public.sap_registros_staging(itinerario,importacion_id,orden_carga,payload)
  select 'CERRO VERDE',imp,left(trim(x.orden_carga),255),x.payload from jsonb_to_recordset(coalesce(p_sap_rows,'[]')) x(orden_carga text,payload jsonb)
  where nullif(trim(x.orden_carga),'') is not null and not exists(select 1 from public.sap_registros_staging s where s.itinerario='CERRO VERDE' and s.orden_carga=trim(x.orden_carga));
  get diagnostics n_sap=row_count;
  insert into public.seguimiento_staging(itinerario,origen,orden_carga,payload,observacion_migracion)
  select 'CERRO VERDE','DIARIO',left(trim(x.orden_carga),255),x.payload,'ALTA SAP WEB CERRO VERDE' from jsonb_to_recordset(coalesce(p_daily_rows,'[]')) x(orden_carga text,payload jsonb)
  where nullif(trim(x.orden_carga),'') is not null and not exists(select 1 from public.seguimiento_staging s where s.itinerario='CERRO VERDE' and s.orden_carga=trim(x.orden_carga));
  get diagnostics n_daily=row_count;
  insert into public.cerro_verde_grupo_smcv(codigo_tracto,payload,activo,actualizado_en)
  select coalesce(nullif(trim(x.codigo_tracto),''),'PLACA-'||trim(x.placa_tracto)),x.payload,true,now()
  from jsonb_to_recordset(coalesce(p_group_rows,'[]')) x(codigo_tracto text,placa_tracto text,payload jsonb)
  where nullif(trim(x.placa_tracto),'') is not null
  on conflict(codigo_tracto) do update set payload=public.cerro_verde_grupo_smcv.payload||excluded.payload,activo=true,actualizado_en=now();
  get diagnostics n_group=row_count;
  update public.sap_importaciones set filas_validas=n_sap,filas_fuera_alcance=greatest(coalesce(p_filas_fuera_alcance,0),0),estado='APLICADO' where id=imp;
  delete from public.cemento_reporte_control where itinerario='CERRO VERDE';
  return jsonb_build_object('agregadas_sap',n_sap,'agregadas_diario',n_daily,'unidades_grupo_actualizadas',n_group,'importacion_id',imp);
end$$;


ALTER FUNCTION "public"."cerro_verde_aplicar_sap_web_v2"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_consolidar_seguimiento"("p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;n_guardadas int:=0;n_cerradas int:=0;new_payload jsonb;
begin
  for r in select w.*,s.payload from public.seguimiento_sesion_web w join public.seguimiento_staging s on s.id=w.seguimiento_id where w.itinerario='CERRO VERDE' and w.usuario=p_usuario for update of s loop
    new_payload:=coalesce(r.payload,'{}')||coalesce(r.cambios,'{}');
    if r.accion='CERRAR' then
      update public.seguimiento_staging set payload=new_payload||jsonb_build_object('ESTADO CICLO','CERRADO','FECHA CIERRE SEGUIMIENTO',now()),origen='HISTORICO' where id=r.seguimiento_id;
      n_cerradas:=n_cerradas+1;
    else
      update public.seguimiento_staging set payload=new_payload where id=r.seguimiento_id;
      n_guardadas:=n_guardadas+1;
    end if;
  end loop;
  delete from public.seguimiento_sesion_web where itinerario='CERRO VERDE' and usuario=p_usuario;
  return jsonb_build_object('guardadas',n_guardadas,'cerradas',n_cerradas);
end$$;


ALTER FUNCTION "public"."cerro_verde_consolidar_seguimiento"("p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerro_verde_consolidar_seguimiento_v3"("p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
 r record; g record; drow record; arow record; hrow record;
 n_guardadas int:=0; n_cerradas int:=0; n_total int:=0; n_rev int:=0;
 new_payload jsonb; pplate text; section text; state text; snap jsonb; placas jsonb;
BEGIN
 CREATE TEMP TABLE _cv_active(placa text PRIMARY KEY,codigo_tracto text) ON COMMIT DROP;
 CREATE TEMP TABLE _cv_closed_this_run(seguimiento_id bigint,orden_carga text,placa text,payload jsonb) ON COMMIT DROP;
 INSERT INTO _cv_active
 SELECT upper(regexp_replace(coalesce(payload->>'PLACA_TRACTO',payload->>'PLACA TRACTO',split_part(payload->>'PLACA','/',1)),'[^A-Za-z0-9]','','g')),codigo_tracto
 FROM public.cerro_verde_grupo_smcv WHERE activo=true AND coalesce(payload->>'PLACA_TRACTO',payload->>'PLACA TRACTO',payload->>'PLACA','')<>'';
 SELECT count(*) INTO n_total FROM _cv_active;
 SELECT count(*) INTO n_rev FROM _cv_active a WHERE EXISTS(SELECT 1 FROM public.cerro_verde_revision_unidades v WHERE v.usuario=p_usuario AND v.placa=a.placa AND v.revisada);
 IF n_total=0 OR n_rev<>n_total THEN RAISE EXCEPTION 'Seguimiento incompleto: %/% placas revisadas',n_rev,n_total; END IF;

 FOR r IN
   SELECT w.*,s.payload FROM public.seguimiento_sesion_web w JOIN public.seguimiento_staging s ON s.id=w.seguimiento_id
   WHERE w.itinerario='CERRO VERDE' AND w.usuario=p_usuario AND s.itinerario='CERRO VERDE' AND s.origen='DIARIO'
   FOR UPDATE OF s
 LOOP
   new_payload:=coalesce(r.payload,'{}'::jsonb)||coalesce(r.cambios,'{}'::jsonb);
   IF r.accion='CERRAR' THEN
     new_payload:=new_payload||jsonb_build_object('ESTADO CICLO','CERRADO_MANUAL','FECHA CIERRE SEGUIMIENTO',to_char(now() at time zone 'America/Lima','YYYY-MM-DD HH24:MI:SS'),'ORIGEN REGISTRO','CIERRE_MANUAL_WEB');
     UPDATE public.seguimiento_staging SET payload=new_payload,origen='HISTORICO' WHERE id=r.seguimiento_id;
     INSERT INTO _cv_closed_this_run(seguimiento_id,orden_carga,placa,payload) VALUES(
       r.seguimiento_id,r.orden_carga,upper(regexp_replace(coalesce(new_payload->>'PLACA TRACTO',new_payload->>'PLACA_TRACTO',split_part(new_payload->>'PLACA','/',1)),'[^A-Za-z0-9]','','g')),new_payload
     );
     n_cerradas:=n_cerradas+1;
   ELSE
     UPDATE public.seguimiento_staging SET payload=new_payload WHERE id=r.seguimiento_id;
     n_guardadas:=n_guardadas+1;
   END IF;
 END LOOP;

 -- Refresca UNA fila por placa en GRUPO_SMCV usando el despacho vigente más reciente.
 FOR g IN SELECT s.codigo_tracto,s.payload FROM public.cerro_verde_grupo_smcv s WHERE s.activo=true LOOP
   pplate:=upper(regexp_replace(coalesce(g.payload->>'PLACA_TRACTO',g.payload->>'PLACA TRACTO',split_part(g.payload->>'PLACA','/',1)),'[^A-Za-z0-9]','','g'));
   SELECT s.id,s.orden_carga,s.payload INTO drow
   FROM public.seguimiento_staging s
   WHERE s.itinerario='CERRO VERDE' AND s.origen='DIARIO'
     AND upper(regexp_replace(coalesce(s.payload->>'PLACA TRACTO',s.payload->>'PLACA_TRACTO',split_part(s.payload->>'PLACA','/',1)),'[^A-Za-z0-9]','','g'))=pplate
   ORDER BY coalesce(s.payload->>'FECHA DE CARGA','') DESC, s.id DESC LIMIT 1;

   IF drow.id IS NOT NULL THEN
     snap:=drow.payload;
     IF nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO','') IS NOT NULL OR nullif(snap->>'SALIDA DE SMCV','') IS NOT NULL THEN section:='CAL VACIO';
     ELSIF nullif(snap->>'INGRESO A SMCV','') IS NOT NULL OR nullif(snap->>'SALIDA DE BASE RACIEMSA CARGADO','') IS NOT NULL OR nullif(snap->>'LLEGADA A BASE RACIEMSA','') IS NOT NULL OR nullif(snap->>'SALIDA DE CARACOTO','') IS NOT NULL OR nullif(snap->>'SALIDA DE CARGUIO','') IS NOT NULL THEN section:='CAL CARGADO';
     ELSIF nullif(snap->>'LLEGADA A CARACOTO','') IS NOT NULL OR nullif(snap->>'INGRESO A CARGUIO','') IS NOT NULL OR nullif(snap->>'SALIDA DE BASE RACIEMSA','') IS NOT NULL THEN section:='CAL VACIO';
     ELSE section:=coalesce(nullif(g.payload->>'SECCION_REPORTE',''),'CAL CARGADO'); END IF;
     state:=nullif(snap->>'ESTADO','');
     IF state IS NULL OR upper(state)='FIN DE CICLO' THEN
       IF section='CAL CARGADO' THEN state:=CASE WHEN nullif(snap->>'INGRESO A SMCV','') IS NOT NULL THEN 'PROCESO DE DESCARGUIO' ELSE 'TRANSITO CARGADO' END;
       ELSE state:=CASE WHEN nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO','') IS NOT NULL THEN 'ESTACIONADO VACIO' ELSE 'TRANSITO VACIO' END; END IF;
     END IF;
     UPDATE public.cerro_verde_grupo_smcv SET payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
       'CONDUCTOR',coalesce(nullif(snap->>'CONDUCTOR',''),payload->>'CONDUCTOR'),
       'CONDUCTOR_REPORTE',coalesce(nullif(snap->>'CONDUCTOR',''),payload->>'CONDUCTOR_REPORTE',payload->>'CONDUCTOR'),
       'CODIGO_CARRETA',coalesce(nullif(snap->>'CODIGO CARRETA',''),payload->>'CODIGO_CARRETA'),
       'PLACA_CARRETA',coalesce(nullif(snap->>'PLACA CARRETA',''),payload->>'PLACA_CARRETA'),
       'ULTIMA_ENTREGA',drow.orden_carga,'FECHA_ULTIMA_CARGA',snap->>'FECHA DE CARGA','CICLO_ABIERTO',1,
       'SECCION_REPORTE',section,'ESTADO',state,'MONITOREO',coalesce(snap->>'MONITOREO',''),'OBSERVACION',coalesce(snap->>'OBSERVACION',''),'SNAPSHOT_CICLO',snap,
       'HITO_1_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE CARACOTO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA',''),'-') END,
       'HITO_2_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A CARACOTO',''),'-') END,
       'HITO_3_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA CARGADO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE SMCV',''),'-') END,
       'HITO_4_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'INGRESO A SMCV',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO',''),'-') END
     ),actualizado_en=now() WHERE codigo_tracto=g.codigo_tracto;
   ELSE
     -- Si el despacho vigente fue cerrado en ESTA consolidación, su snapshot tiene
     -- prioridad sobre un arrastre viejo de la misma placa. Esto conserva cierres
     -- preparados antes de desplegar esta versión (ej. CHF754 / CHD789).
     SELECT c.* INTO hrow FROM _cv_closed_this_run c WHERE c.placa=pplate
     ORDER BY coalesce(c.payload->>'FECHA DE CARGA','') DESC,c.seguimiento_id DESC LIMIT 1;
     IF hrow.seguimiento_id IS NOT NULL THEN
       snap:=hrow.payload;
       IF nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO','') IS NOT NULL OR nullif(snap->>'SALIDA DE SMCV','') IS NOT NULL THEN section:='CAL VACIO';
       ELSIF nullif(snap->>'INGRESO A SMCV','') IS NOT NULL OR nullif(snap->>'SALIDA DE BASE RACIEMSA CARGADO','') IS NOT NULL OR nullif(snap->>'LLEGADA A BASE RACIEMSA','') IS NOT NULL OR nullif(snap->>'SALIDA DE CARACOTO','') IS NOT NULL OR nullif(snap->>'SALIDA DE CARGUIO','') IS NOT NULL THEN section:='CAL CARGADO';
       ELSE section:=coalesce(nullif(g.payload->>'SECCION_REPORTE',''),'CAL VACIO'); END IF;
       state:=nullif(snap->>'ESTADO','');
       IF state IS NULL OR upper(state)='FIN DE CICLO' THEN state:=CASE WHEN section='CAL CARGADO' THEN 'ESTACIONADO CARGADO' ELSE 'ESTACIONADO VACIO' END; END IF;
       INSERT INTO public.cerro_verde_arrastre_operativo(placa,ultima_entrega,codigo_tracto,codigo_carreta,placa_carreta,licencia,conductor,fecha_carga,fecha_cierre_ciclo,estado_base,grupo_reporte,situacion,monitoreo_previo,observacion_previa,origen,activo,actualizado_en,fecha_salida_arrastre,motivo_salida,nueva_entrega,payload)
       VALUES(pplate,hrow.orden_carga,coalesce(nullif(snap->>'CODIGO TRACTO',''),g.codigo_tracto),snap->>'CODIGO CARRETA',snap->>'PLACA CARRETA',snap->>'LICENCIA',snap->>'CONDUCTOR',snap->>'FECHA DE CARGA',now(),state,section,'ESPERA_NUEVO_CICLO',coalesce(snap->>'MONITOREO',''),coalesce(snap->>'OBSERVACION',''),'CONSOLIDACION_WEB',true,now(),NULL,NULL,NULL,snap)
       ON CONFLICT(placa) DO UPDATE SET ultima_entrega=excluded.ultima_entrega,codigo_tracto=excluded.codigo_tracto,codigo_carreta=excluded.codigo_carreta,placa_carreta=excluded.placa_carreta,licencia=excluded.licencia,conductor=excluded.conductor,fecha_carga=excluded.fecha_carga,fecha_cierre_ciclo=excluded.fecha_cierre_ciclo,estado_base=excluded.estado_base,grupo_reporte=excluded.grupo_reporte,situacion='ESPERA_NUEVO_CICLO',monitoreo_previo=excluded.monitoreo_previo,observacion_previa=excluded.observacion_previa,origen=excluded.origen,activo=true,actualizado_en=now(),fecha_salida_arrastre=NULL,motivo_salida=NULL,nueva_entrega=NULL,payload=excluded.payload;
       UPDATE public.cerro_verde_grupo_smcv SET payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
         'ULTIMA_ENTREGA',hrow.orden_carga,'FECHA_ULTIMA_CARGA',snap->>'FECHA DE CARGA','CICLO_ABIERTO',0,'SECCION_REPORTE',section,'ESTADO',state,
         'MONITOREO',coalesce(snap->>'MONITOREO',''),'OBSERVACION',coalesce(snap->>'OBSERVACION',''),'SNAPSHOT_CICLO',snap,
         'HITO_1_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE CARACOTO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA',''),'-') END,
         'HITO_2_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A CARACOTO',''),'-') END,
         'HITO_3_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA CARGADO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE SMCV',''),'-') END,
         'HITO_4_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'INGRESO A SMCV',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO',''),'-') END
       ),actualizado_en=now() WHERE codigo_tracto=g.codigo_tracto;
     ELSE
       SELECT a.* INTO arow FROM public.cerro_verde_arrastre_operativo a WHERE a.placa=pplate AND a.activo=true LIMIT 1;
       IF arow.placa IS NOT NULL THEN
         snap:=arow.payload; section:=coalesce(nullif(arow.grupo_reporte,''),'CAL VACIO'); state:=coalesce(nullif(arow.estado_base,''),'ESTACIONADO VACIO');
         UPDATE public.cerro_verde_grupo_smcv SET payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
           'ULTIMA_ENTREGA',arow.ultima_entrega,'FECHA_ULTIMA_CARGA',arow.fecha_carga,'CICLO_ABIERTO',0,'SECCION_REPORTE',section,'ESTADO',state,
           'MONITOREO',coalesce(arow.monitoreo_previo,''),'OBSERVACION',coalesce(arow.observacion_previa,''),'SNAPSHOT_CICLO',snap,
           'HITO_1_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE CARACOTO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA',''),'-') END,
           'HITO_2_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A CARACOTO',''),'-') END,
           'HITO_3_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'SALIDA DE BASE RACIEMSA CARGADO',''),'-') ELSE coalesce(nullif(snap->>'SALIDA DE SMCV',''),'-') END,
           'HITO_4_REPORTE',CASE WHEN section='CAL CARGADO' THEN coalesce(nullif(snap->>'INGRESO A SMCV',''),'-') ELSE coalesce(nullif(snap->>'LLEGADA A BASE RACIEMSA VACIO',''),'-') END
         ),actualizado_en=now() WHERE codigo_tracto=g.codigo_tracto;
       END IF;
     END IF;
   END IF;
 END LOOP;

 DELETE FROM public.seguimiento_sesion_web WHERE itinerario='CERRO VERDE' AND usuario=p_usuario;
 SELECT coalesce(jsonb_agg(placa order by placa),'[]'::jsonb) INTO placas FROM _cv_active;
 INSERT INTO public.cemento_reporte_control(itinerario,usuario,estado,total_placas,revisadas,firma_diario,completado_en,placas_revisadas)
 VALUES('CERRO VERDE',p_usuario,'COMPLETO',n_total,n_rev,'CV_DETALLES6_PLACA',now(),placas)
 ON CONFLICT(itinerario) DO UPDATE SET usuario=excluded.usuario,estado=excluded.estado,total_placas=excluded.total_placas,revisadas=excluded.revisadas,firma_diario=excluded.firma_diario,completado_en=excluded.completado_en,placas_revisadas=excluded.placas_revisadas;
 RETURN jsonb_build_object('guardadas',n_guardadas,'cerradas',n_cerradas,'total_placas',n_total,'revisadas',n_rev);
END $$;


ALTER FUNCTION "public"."cerro_verde_consolidar_seguimiento_v3"("p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editor_publicar_geocercas"("p_itinerario" "text", "p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare v public.editor_geocercas_proyectos; nueva integer;
begin
  select * into v from public.editor_geocercas_proyectos where itinerario=p_itinerario for update;
  if v.itinerario is null or v.validado is null or v.estado<>'VALIDADO' then raise exception 'Primero debe validar el borrador'; end if;
  if v.publicado is not null then
    insert into public.editor_geocercas_versiones(itinerario,version,documentos,publicado_por)
    values(v.itinerario,v.version_publicada,v.publicado,p_usuario) on conflict(itinerario,version) do nothing;
  end if;
  nueva:=v.version_publicada+1;
  update public.editor_geocercas_proyectos set publicado=validado,version_publicada=nueva,estado='PUBLICADO',actualizado_por=p_usuario,actualizado_en=now(),publicado_en=now() where itinerario=p_itinerario;
  return jsonb_build_object('ok',true,'estado','PUBLICADO','version_publicada',nueva);
end$$;


ALTER FUNCTION "public"."editor_publicar_geocercas"("p_itinerario" "text", "p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editor_validar_geocercas"("p_itinerario" "text", "p_usuario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare v public.editor_geocercas_proyectos;
begin
  select * into v from public.editor_geocercas_proyectos where itinerario=p_itinerario for update;
  if v.itinerario is null or v.borrador is null then raise exception 'No existe un borrador para validar'; end if;
  if v.estado <> 'BORRADOR' then raise exception 'Sólo se puede validar un borrador pendiente'; end if;
  if not (v.borrador ?& array['geocercas','rutas_madre','geocerca_tramo']) then
    raise exception 'El borrador debe contener los tres documentos canónicos';
  end if;
  update public.editor_geocercas_proyectos set validado=borrador,estado='VALIDADO',actualizado_por=p_usuario,actualizado_en=now() where itinerario=p_itinerario;
  return jsonb_build_object('ok',true,'estado','VALIDADO');
end$$;


ALTER FUNCTION "public"."editor_validar_geocercas"("p_itinerario" "text", "p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."itinerarios_cuotas_prueba17"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."itinerarios_cuotas_prueba17"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_egress_log" (
    "id" bigint NOT NULL,
    "itinerario" "text" NOT NULL,
    "servicio" "text" NOT NULL,
    "bytes" bigint NOT NULL,
    "usuario" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_egress_log_bytes_check" CHECK (("bytes" >= 0))
);


ALTER TABLE "public"."app_egress_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."app_egress_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."app_egress_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."app_egress_log_id_seq" OWNED BY "public"."app_egress_log"."id";



CREATE TABLE IF NOT EXISTS "public"."app_usuarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "firebase_uid" "text",
    "email" "text" NOT NULL,
    "nombre" "text",
    "rol" "text" DEFAULT 'LECTOR'::"text" NOT NULL,
    "itinerarios" "text"[] DEFAULT ARRAY['CEMENTO'::"text"] NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "ultimo_acceso_en" timestamp with time zone,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_usuarios_rol_check" CHECK (("rol" = ANY (ARRAY['ADMIN'::"text", 'EDITOR'::"text", 'LECTOR'::"text"])))
);


ALTER TABLE "public"."app_usuarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cemento_configuracion" (
    "itinerario" "text" NOT NULL,
    "fecha_inicio_recorrido" timestamp with time zone NOT NULL,
    "origen" "text" NOT NULL,
    "nota" "text",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cemento_configuracion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cemento_montados" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "fecha" "date" NOT NULL,
    "ruta" "text" NOT NULL,
    "ruta_norm" "text" NOT NULL,
    "tracto_largo" "text" NOT NULL,
    "acople_largo" "text",
    "tracto_corto" "text" NOT NULL,
    "acople_corto" "text",
    "oc_largo" "text",
    "oc_corto" "text",
    "guia" "text",
    "usuario" "text" DEFAULT 'WEB'::"text" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cemento_montados_itinerario_check" CHECK (("itinerario" = 'CEMENTO'::"text"))
);


ALTER TABLE "public"."cemento_montados" OWNER TO "postgres";


ALTER TABLE "public"."cemento_montados" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cemento_montados_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cemento_reporte_control" (
    "itinerario" "text" NOT NULL,
    "usuario" "text" NOT NULL,
    "estado" "text" NOT NULL,
    "total_placas" integer NOT NULL,
    "revisadas" integer NOT NULL,
    "firma_diario" "text" NOT NULL,
    "completado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "placas_revisadas" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "cemento_reporte_control_estado_check" CHECK (("estado" = ANY (ARRAY['PARCIAL'::"text", 'COMPLETO'::"text"])))
);


ALTER TABLE "public"."cemento_reporte_control" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cemento_seguimiento_cortes" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "usuario" "text" NOT NULL,
    "estado" "text" NOT NULL,
    "total_placas" integer NOT NULL,
    "revisadas" integer NOT NULL,
    "placas_revisadas" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "firma_diario" "text" NOT NULL,
    "guardadas" integer DEFAULT 0 NOT NULL,
    "cerradas" integer DEFAULT 0 NOT NULL,
    "guardado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cemento_seguimiento_cortes_estado_check" CHECK (("estado" = ANY (ARRAY['PARCIAL'::"text", 'COMPLETO'::"text"])))
);


ALTER TABLE "public"."cemento_seguimiento_cortes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cemento_seguimiento_cortes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cemento_seguimiento_cortes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cemento_seguimiento_cortes_id_seq" OWNED BY "public"."cemento_seguimiento_cortes"."id";



CREATE TABLE IF NOT EXISTS "public"."cerro_verde_arrastre_operativo" (
    "placa" "text" NOT NULL,
    "ultima_entrega" "text",
    "codigo_tracto" "text",
    "codigo_carreta" "text",
    "placa_carreta" "text",
    "licencia" "text",
    "conductor" "text",
    "fecha_carga" "text",
    "fecha_cierre_ciclo" timestamp with time zone,
    "estado_base" "text" DEFAULT 'ESTACIONADO VACIO'::"text" NOT NULL,
    "grupo_reporte" "text" DEFAULT 'CAL VACIO'::"text" NOT NULL,
    "situacion" "text" DEFAULT 'ESPERA_NUEVO_CICLO'::"text" NOT NULL,
    "monitoreo_previo" "text",
    "observacion_previa" "text",
    "origen" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "registrado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha_salida_arrastre" timestamp with time zone,
    "motivo_salida" "text",
    "nueva_entrega" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."cerro_verde_arrastre_operativo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_convoy_diario" (
    "posicion" smallint NOT NULL,
    "conductor" "text",
    "licencia" "text",
    "codigo_tracto" "text",
    "placa_tracto" "text",
    "codigo_carreta" "text",
    "placa_carreta" "text",
    "hito_1" timestamp with time zone,
    "hito_2" timestamp with time zone,
    "hito_3" timestamp with time zone,
    "hito_4" timestamp with time zone,
    "estado" "text",
    "monitoreo" "text",
    "observacion" "text",
    "fecha_operativa" "date" DEFAULT (("now"() AT TIME ZONE 'America/Lima'::"text"))::"date" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cerro_verde_convoy_diario_posicion_check" CHECK ((("posicion" >= 1) AND ("posicion" <= 10)))
);


ALTER TABLE "public"."cerro_verde_convoy_diario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_eventos_paradas" (
    "evento_origen_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "entrega_sap" "text",
    "payload" "jsonb" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_eventos_paradas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_grupo_historial" (
    "id" bigint NOT NULL,
    "payload" "jsonb" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_grupo_historial" OWNER TO "postgres";


ALTER TABLE "public"."cerro_verde_grupo_historial" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cerro_verde_grupo_historial_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cerro_verde_grupo_smcv" (
    "codigo_tracto" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_grupo_smcv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_maestro_conductores" (
    "licencia" "text" NOT NULL,
    "conductor" "text" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_maestro_conductores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_maestro_equipos" (
    "placa" "text" NOT NULL,
    "codigo_sap" "text" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_maestro_equipos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_migracion_backups" (
    "id" bigint NOT NULL,
    "etiqueta" "text" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" NOT NULL
);


ALTER TABLE "public"."cerro_verde_migracion_backups" OWNER TO "postgres";


ALTER TABLE "public"."cerro_verde_migracion_backups" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cerro_verde_migracion_backups_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cerro_verde_pernoctes_enviable" (
    "numero" integer NOT NULL,
    "conductor" "text",
    "codigo_tracto" "text",
    "placa" "text",
    "fecha_carga" "date",
    "salida_caracoto" timestamp with time zone,
    "destino_esperado" "text",
    "pernocto_en" "text",
    "cumplimiento" "text",
    "inicio_pernocte" timestamp with time zone,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_pernoctes_enviable" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_pernoctes_historico_maestro" (
    "id" bigint NOT NULL,
    "numero" integer,
    "conductor" "text" DEFAULT ''::"text" NOT NULL,
    "codigo_tracto" "text" DEFAULT ''::"text" NOT NULL,
    "fecha_carga" "date",
    "salida_caracoto" timestamp without time zone,
    "llegada_smcv" timestamp without time zone,
    "llegada_texto" "text",
    "destino_esperado" "text" DEFAULT ''::"text" NOT NULL,
    "pernocto_en" "text" DEFAULT ''::"text" NOT NULL,
    "cumplimiento" "text" DEFAULT ''::"text" NOT NULL,
    "placa" "text" DEFAULT ''::"text" NOT NULL,
    "inicio_pernocte" timestamp without time zone,
    "fin_pernocte" timestamp without time zone,
    "entrega_sap" "text",
    "evento_origen_id" bigint,
    "fuente" "text" DEFAULT 'CHECKPOINT_21_09_2026'::"text" NOT NULL,
    "clave_registro" "text",
    "bloqueado" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_pernoctes_historico_maestro" OWNER TO "postgres";


ALTER TABLE "public"."cerro_verde_pernoctes_historico_maestro" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cerro_verde_pernoctes_historico_maestro_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cerro_verde_pernoctes_validacion" (
    "evento_origen_id" bigint NOT NULL,
    "entrega_sap" "text" NOT NULL,
    "placa" "text" NOT NULL,
    "codigo_tracto" "text" NOT NULL,
    "limite_permitido" "text" NOT NULL,
    "zona_detectada" "text" NOT NULL,
    "propuesta_motor" "text" NOT NULL,
    "cumple_final" "text" NOT NULL,
    "observacion" "text",
    "validado_por" "text" NOT NULL,
    "validado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "cerro_verde_pernoctes_validacion_cumple_final_check" CHECK (("cumple_final" = ANY (ARRAY['SI'::"text", 'NO'::"text"])))
);


ALTER TABLE "public"."cerro_verde_pernoctes_validacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_revision_estado" (
    "usuario" "text" NOT NULL,
    "legacy_sync_bloqueado" boolean DEFAULT false NOT NULL,
    "ultima_limpieza_en" timestamp with time zone,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cerro_verde_revision_estado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cerro_verde_revision_unidades" (
    "usuario" "text" NOT NULL,
    "placa" "text" NOT NULL,
    "revisada" boolean DEFAULT true NOT NULL,
    "orden_revision" integer,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origen_revision" "text" DEFAULT 'LEGACY'::"text" NOT NULL
);


ALTER TABLE "public"."cerro_verde_revision_unidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_documentos" (
    "id" bigint NOT NULL,
    "itinerario" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "version" "text",
    "hash_sha256" character varying(64),
    "contenido" "jsonb" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_documentos" OWNER TO "postgres";


ALTER TABLE "public"."configuracion_documentos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."configuracion_documentos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."editor_geocercas_maestro" (
    "id" smallint DEFAULT 1 NOT NULL,
    "estado" "text" DEFAULT 'SIN_BORRADOR'::"text" NOT NULL,
    "version_publicada" integer DEFAULT 0 NOT NULL,
    "borrador" "jsonb",
    "validado" "jsonb",
    "publicado" "jsonb",
    "actualizado_por" "text",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "publicado_en" timestamp with time zone,
    CONSTRAINT "editor_geocercas_maestro_estado_check" CHECK (("estado" = ANY (ARRAY['SIN_BORRADOR'::"text", 'BORRADOR'::"text", 'VALIDADO'::"text", 'PUBLICADO'::"text"]))),
    CONSTRAINT "editor_geocercas_maestro_id_check" CHECK (("id" = 1)),
    CONSTRAINT "editor_geocercas_maestro_version_publicada_check" CHECK (("version_publicada" >= 0)),
    CONSTRAINT "editor_maestro_borrador_objeto" CHECK ((("borrador" IS NULL) OR ("jsonb_typeof"("borrador") = 'object'::"text"))),
    CONSTRAINT "editor_maestro_publicado_objeto" CHECK ((("publicado" IS NULL) OR ("jsonb_typeof"("publicado") = 'object'::"text"))),
    CONSTRAINT "editor_maestro_validado_objeto" CHECK ((("validado" IS NULL) OR ("jsonb_typeof"("validado") = 'object'::"text")))
);


ALTER TABLE "public"."editor_geocercas_maestro" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."editor_geocercas_maestro_versiones" (
    "version" integer NOT NULL,
    "documento" "jsonb" NOT NULL,
    "publicado_por" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "editor_geocercas_maestro_versiones_documento_check" CHECK (("jsonb_typeof"("documento") = 'object'::"text")),
    CONSTRAINT "editor_geocercas_maestro_versiones_version_check" CHECK (("version" >= 0))
);


ALTER TABLE "public"."editor_geocercas_maestro_versiones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."editor_geocercas_proyectos" (
    "itinerario" "text" NOT NULL,
    "estado" "text" DEFAULT 'SIN_BORRADOR'::"text" NOT NULL,
    "version_publicada" integer DEFAULT 0 NOT NULL,
    "borrador" "jsonb",
    "validado" "jsonb",
    "publicado" "jsonb",
    "actualizado_por" "text",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "publicado_en" timestamp with time zone,
    CONSTRAINT "editor_documentos_borrador_objeto" CHECK ((("borrador" IS NULL) OR ("jsonb_typeof"("borrador") = 'object'::"text"))),
    CONSTRAINT "editor_documentos_publicado_objeto" CHECK ((("publicado" IS NULL) OR ("jsonb_typeof"("publicado") = 'object'::"text"))),
    CONSTRAINT "editor_documentos_validado_objeto" CHECK ((("validado" IS NULL) OR ("jsonb_typeof"("validado") = 'object'::"text"))),
    CONSTRAINT "editor_geocercas_proyectos_estado_check" CHECK (("estado" = ANY (ARRAY['SIN_BORRADOR'::"text", 'BORRADOR'::"text", 'VALIDADO'::"text", 'PUBLICADO'::"text"]))),
    CONSTRAINT "editor_geocercas_proyectos_version_publicada_check" CHECK (("version_publicada" >= 0))
);


ALTER TABLE "public"."editor_geocercas_proyectos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."editor_geocercas_versiones" (
    "id" bigint NOT NULL,
    "itinerario" "text" NOT NULL,
    "version" integer NOT NULL,
    "documentos" "jsonb" NOT NULL,
    "publicado_por" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "editor_geocercas_versiones_documentos_check" CHECK (("jsonb_typeof"("documentos") = 'object'::"text")),
    CONSTRAINT "editor_geocercas_versiones_version_check" CHECK (("version" >= 0))
);


ALTER TABLE "public"."editor_geocercas_versiones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."editor_geocercas_versiones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."editor_geocercas_versiones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."editor_geocercas_versiones_id_seq" OWNED BY "public"."editor_geocercas_versiones"."id";



CREATE TABLE IF NOT EXISTS "public"."gps_precarga_jobs" (
    "id" character varying(40) NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "estado" character varying(30) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    "desde_base" character varying(30) NOT NULL,
    "hasta_solicitado" character varying(30) NOT NULL,
    "total_unidades" integer DEFAULT 0 NOT NULL,
    "completas" integer DEFAULT 0 NOT NULL,
    "errores" integer DEFAULT 0 NOT NULL,
    "mensaje" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "iniciado_en" timestamp with time zone,
    "finalizado_en" timestamp with time zone
);


ALTER TABLE "public"."gps_precarga_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gps_precarga_unidades" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "job_id" character varying(40) NOT NULL,
    "placa" character varying(30) NOT NULL,
    "tracto" character varying(30),
    "desde" character varying(30) NOT NULL,
    "hasta_solicitado" character varying(30) NOT NULL,
    "estado" character varying(30) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    "ocs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "puntos" integer DEFAULT 0 NOT NULL,
    "eventos" integer DEFAULT 0 NOT NULL,
    "ultima_posicion_gps" character varying(30),
    "archivo_temporal" "text",
    "resultado" "jsonb",
    "error" "text",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."gps_precarga_unidades" OWNER TO "postgres";


ALTER TABLE "public"."gps_precarga_unidades" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."gps_precarga_unidades_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sap_importaciones" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "nombre_archivo" character varying(255) NOT NULL,
    "hash_sha256" character varying(64) NOT NULL,
    "filas_recibidas" integer NOT NULL,
    "filas_validas" integer NOT NULL,
    "filas_fuera_alcance" integer NOT NULL,
    "estado" character varying(30) DEFAULT 'VALIDADO'::character varying NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sap_importaciones" OWNER TO "postgres";


ALTER TABLE "public"."sap_importaciones" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sap_importaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sap_registros_staging" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "importacion_id" bigint DEFAULT 0 NOT NULL,
    "orden_carga" character varying(50) NOT NULL,
    "payload" "jsonb" NOT NULL
);


ALTER TABLE "public"."sap_registros_staging" OWNER TO "postgres";


ALTER TABLE "public"."sap_registros_staging" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sap_registros_staging_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sap_rutas_reglas" (
    "itinerario" "text" NOT NULL,
    "descripcion_normalizada" "text" NOT NULL,
    "descripcion" "text" NOT NULL,
    "usar" boolean NOT NULL,
    "actualizado_por" "text",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sap_rutas_reglas_descripcion_no_vacia" CHECK ((("btrim"("descripcion_normalizada") <> ''::"text") AND ("btrim"("descripcion") <> ''::"text"))),
    CONSTRAINT "sap_rutas_reglas_itinerario_no_vacio" CHECK (("btrim"("itinerario") <> ''::"text"))
);


ALTER TABLE "public"."sap_rutas_reglas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sap_sync_filas" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "preview_id" bigint NOT NULL,
    "orden_carga" character varying(50) NOT NULL,
    "clasificacion" character varying(40) NOT NULL,
    "accion_data_sap" character varying(40) NOT NULL,
    "accion_seguimiento" character varying(40) NOT NULL,
    "payload" "jsonb" NOT NULL,
    "alertas" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."sap_sync_filas" OWNER TO "postgres";


ALTER TABLE "public"."sap_sync_filas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sap_sync_filas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sap_sync_previews" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "nombre_archivo" character varying(255) NOT NULL,
    "hash_sha256" character varying(64) NOT NULL,
    "fecha_inicio" character varying(10),
    "fecha_fin" character varying(10),
    "estado" character varying(30) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    "bloqueado" boolean DEFAULT false NOT NULL,
    "resumen" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aplicado_en" timestamp with time zone
);


ALTER TABLE "public"."sap_sync_previews" OWNER TO "postgres";


ALTER TABLE "public"."sap_sync_previews" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sap_sync_previews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."seguimiento_auditoria" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "seguimiento_id" bigint,
    "orden_carga" character varying(50),
    "accion" character varying(30) NOT NULL,
    "campo" character varying(120),
    "valor_anterior" "text",
    "valor_nuevo" "text",
    "usuario" character varying(100) DEFAULT 'WEB'::character varying NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."seguimiento_auditoria" OWNER TO "postgres";


ALTER TABLE "public"."seguimiento_auditoria" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."seguimiento_auditoria_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."seguimiento_manual_importaciones" (
    "id" bigint NOT NULL,
    "itinerario" "text" NOT NULL,
    "nombre_archivo" "text" NOT NULL,
    "hash_sha256" "text",
    "usuario" "text" NOT NULL,
    "filas_recibidas" integer DEFAULT 0 NOT NULL,
    "abiertas" integer DEFAULT 0 NOT NULL,
    "cerradas" integer DEFAULT 0 NOT NULL,
    "insertadas" integer DEFAULT 0 NOT NULL,
    "actualizadas" integer DEFAULT 0 NOT NULL,
    "movidas" integer DEFAULT 0 NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."seguimiento_manual_importaciones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seguimiento_manual_importaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seguimiento_manual_importaciones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."seguimiento_manual_importaciones_id_seq" OWNED BY "public"."seguimiento_manual_importaciones"."id";



CREATE TABLE IF NOT EXISTS "public"."seguimiento_sesion_web" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "usuario" "text" NOT NULL,
    "seguimiento_id" bigint NOT NULL,
    "orden_carga" character varying,
    "cambios" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "accion" character varying DEFAULT 'GUARDAR'::character varying NOT NULL,
    "revisada" boolean DEFAULT false NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "seguimiento_sesion_web_accion_check" CHECK ((("accion")::"text" = ANY ((ARRAY['GUARDAR'::character varying, 'CERRAR'::character varying])::"text"[])))
);


ALTER TABLE "public"."seguimiento_sesion_web" OWNER TO "postgres";


ALTER TABLE "public"."seguimiento_sesion_web" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."seguimiento_sesion_web_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."seguimiento_staging" (
    "id" bigint NOT NULL,
    "itinerario" "text" DEFAULT 'CEMENTO'::"text" NOT NULL,
    "origen" character varying(20) NOT NULL,
    "orden_carga" character varying(50),
    "payload" "jsonb" NOT NULL,
    "observacion_migracion" "text",
    CONSTRAINT "seguimiento_staging_origen_check" CHECK ((("origen")::"text" = ANY ((ARRAY['DIARIO'::character varying, 'HISTORICO'::character varying])::"text"[])))
);


ALTER TABLE "public"."seguimiento_staging" OWNER TO "postgres";


ALTER TABLE "public"."seguimiento_staging" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."seguimiento_staging_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."snapshot_sap_registros" (
    "id" bigint NOT NULL,
    "snapshot_id" bigint NOT NULL,
    "posicion" integer NOT NULL,
    "orden_carga" character varying(50) NOT NULL,
    "payload" "jsonb" NOT NULL
);


ALTER TABLE "public"."snapshot_sap_registros" OWNER TO "postgres";


ALTER TABLE "public"."snapshot_sap_registros" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."snapshot_sap_registros_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."snapshot_seguimiento_registros" (
    "id" bigint NOT NULL,
    "snapshot_id" bigint NOT NULL,
    "posicion" integer NOT NULL,
    "origen" character varying(20) NOT NULL,
    "orden_carga" character varying(50),
    "payload" "jsonb" NOT NULL,
    CONSTRAINT "snapshot_seguimiento_registros_origen_check" CHECK ((("origen")::"text" = ANY ((ARRAY['DIARIO'::character varying, 'HISTORICO'::character varying])::"text"[])))
);


ALTER TABLE "public"."snapshot_seguimiento_registros" OWNER TO "postgres";


ALTER TABLE "public"."snapshot_seguimiento_registros" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."snapshot_seguimiento_registros_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."snapshots_base" (
    "id" bigint NOT NULL,
    "itinerario" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "fecha_corte" timestamp with time zone NOT NULL,
    "sap_registros" integer NOT NULL,
    "diario_registros" integer NOT NULL,
    "historico_registros" integer NOT NULL,
    "historico_ocs_unicas" integer NOT NULL,
    "estado" "text" DEFAULT 'VALIDADO'::"text" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."snapshots_base" OWNER TO "postgres";


ALTER TABLE "public"."snapshots_base" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."snapshots_base_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."app_egress_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."app_egress_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cemento_seguimiento_cortes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cemento_seguimiento_cortes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."editor_geocercas_versiones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."editor_geocercas_versiones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."seguimiento_manual_importaciones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."seguimiento_manual_importaciones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_egress_log"
    ADD CONSTRAINT "app_egress_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_usuarios"
    ADD CONSTRAINT "app_usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."app_usuarios"
    ADD CONSTRAINT "app_usuarios_firebase_uid_key" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."app_usuarios"
    ADD CONSTRAINT "app_usuarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cemento_configuracion"
    ADD CONSTRAINT "cemento_configuracion_pkey" PRIMARY KEY ("itinerario");



ALTER TABLE ONLY "public"."cemento_montados"
    ADD CONSTRAINT "cemento_montados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cemento_reporte_control"
    ADD CONSTRAINT "cemento_reporte_control_pkey" PRIMARY KEY ("itinerario");



ALTER TABLE ONLY "public"."cemento_seguimiento_cortes"
    ADD CONSTRAINT "cemento_seguimiento_cortes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cerro_verde_arrastre_operativo"
    ADD CONSTRAINT "cerro_verde_arrastre_operativo_pkey" PRIMARY KEY ("placa");



ALTER TABLE ONLY "public"."cerro_verde_convoy_diario"
    ADD CONSTRAINT "cerro_verde_convoy_diario_pkey" PRIMARY KEY ("posicion");



ALTER TABLE ONLY "public"."cerro_verde_eventos_paradas"
    ADD CONSTRAINT "cerro_verde_eventos_paradas_pkey" PRIMARY KEY ("evento_origen_id");



ALTER TABLE ONLY "public"."cerro_verde_grupo_historial"
    ADD CONSTRAINT "cerro_verde_grupo_historial_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cerro_verde_grupo_smcv"
    ADD CONSTRAINT "cerro_verde_grupo_smcv_pkey" PRIMARY KEY ("codigo_tracto");



ALTER TABLE ONLY "public"."cerro_verde_maestro_conductores"
    ADD CONSTRAINT "cerro_verde_maestro_conductores_pkey" PRIMARY KEY ("licencia", "conductor");



ALTER TABLE ONLY "public"."cerro_verde_maestro_equipos"
    ADD CONSTRAINT "cerro_verde_maestro_equipos_pkey" PRIMARY KEY ("placa", "codigo_sap");



ALTER TABLE ONLY "public"."cerro_verde_migracion_backups"
    ADD CONSTRAINT "cerro_verde_migracion_backups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cerro_verde_pernoctes_enviable"
    ADD CONSTRAINT "cerro_verde_pernoctes_enviable_pkey" PRIMARY KEY ("numero");



ALTER TABLE ONLY "public"."cerro_verde_pernoctes_historico_maestro"
    ADD CONSTRAINT "cerro_verde_pernoctes_historico_maestro_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cerro_verde_pernoctes_validacion"
    ADD CONSTRAINT "cerro_verde_pernoctes_validacion_pkey" PRIMARY KEY ("evento_origen_id");



ALTER TABLE ONLY "public"."cerro_verde_revision_estado"
    ADD CONSTRAINT "cerro_verde_revision_estado_pkey" PRIMARY KEY ("usuario");



ALTER TABLE ONLY "public"."cerro_verde_revision_unidades"
    ADD CONSTRAINT "cerro_verde_revision_unidades_pkey" PRIMARY KEY ("usuario", "placa");



ALTER TABLE ONLY "public"."configuracion_documentos"
    ADD CONSTRAINT "configuracion_documentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."editor_geocercas_maestro"
    ADD CONSTRAINT "editor_geocercas_maestro_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."editor_geocercas_maestro_versiones"
    ADD CONSTRAINT "editor_geocercas_maestro_versiones_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."editor_geocercas_proyectos"
    ADD CONSTRAINT "editor_geocercas_proyectos_pkey" PRIMARY KEY ("itinerario");



ALTER TABLE ONLY "public"."editor_geocercas_versiones"
    ADD CONSTRAINT "editor_geocercas_versiones_itinerario_version_key" UNIQUE ("itinerario", "version");



ALTER TABLE ONLY "public"."editor_geocercas_versiones"
    ADD CONSTRAINT "editor_geocercas_versiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gps_precarga_jobs"
    ADD CONSTRAINT "gps_precarga_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gps_precarga_unidades"
    ADD CONSTRAINT "gps_precarga_unidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sap_importaciones"
    ADD CONSTRAINT "sap_importaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sap_registros_staging"
    ADD CONSTRAINT "sap_registros_staging_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sap_rutas_reglas"
    ADD CONSTRAINT "sap_rutas_reglas_pkey" PRIMARY KEY ("itinerario", "descripcion_normalizada");



ALTER TABLE ONLY "public"."sap_sync_filas"
    ADD CONSTRAINT "sap_sync_filas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sap_sync_previews"
    ADD CONSTRAINT "sap_sync_previews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_auditoria"
    ADD CONSTRAINT "seguimiento_auditoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_manual_importaciones"
    ADD CONSTRAINT "seguimiento_manual_importaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_sesion_web"
    ADD CONSTRAINT "seguimiento_sesion_web_itinerario_usuario_seguimiento_id_key" UNIQUE ("itinerario", "usuario", "seguimiento_id");



ALTER TABLE ONLY "public"."seguimiento_sesion_web"
    ADD CONSTRAINT "seguimiento_sesion_web_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_staging"
    ADD CONSTRAINT "seguimiento_staging_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshot_sap_registros"
    ADD CONSTRAINT "snapshot_sap_registros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshot_sap_registros"
    ADD CONSTRAINT "snapshot_sap_registros_snapshot_id_posicion_key" UNIQUE ("snapshot_id", "posicion");



ALTER TABLE ONLY "public"."snapshot_seguimiento_registros"
    ADD CONSTRAINT "snapshot_seguimiento_registros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshot_seguimiento_registros"
    ADD CONSTRAINT "snapshot_seguimiento_registros_snapshot_id_origen_posicion_key" UNIQUE ("snapshot_id", "origen", "posicion");



ALTER TABLE ONLY "public"."snapshots_base"
    ADD CONSTRAINT "snapshots_base_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."snapshots_base"
    ADD CONSTRAINT "snapshots_base_pkey" PRIMARY KEY ("id");



CREATE INDEX "cemento_montados_corto_idx" ON "public"."cemento_montados" USING "btree" ("tracto_corto", "fecha");



CREATE INDEX "cemento_montados_fecha_idx" ON "public"."cemento_montados" USING "btree" ("fecha");



CREATE INDEX "cemento_montados_largo_idx" ON "public"."cemento_montados" USING "btree" ("tracto_largo", "fecha");



CREATE UNIQUE INDEX "cemento_montados_relacion_uq" ON "public"."cemento_montados" USING "btree" ("itinerario", "fecha", "ruta_norm", "tracto_largo", "tracto_corto");



CREATE INDEX "cv_arrastre_activo_idx" ON "public"."cerro_verde_arrastre_operativo" USING "btree" ("activo");



CREATE INDEX "cv_arrastre_entrega_idx" ON "public"."cerro_verde_arrastre_operativo" USING "btree" ("ultima_entrega");



CREATE UNIQUE INDEX "cv_pernoctes_maestro_clave_uidx" ON "public"."cerro_verde_pernoctes_historico_maestro" USING "btree" ("clave_registro") WHERE ("clave_registro" IS NOT NULL);



CREATE INDEX "cv_pernoctes_maestro_entrega_idx" ON "public"."cerro_verde_pernoctes_historico_maestro" USING "btree" ("entrega_sap");



CREATE UNIQUE INDEX "cv_pernoctes_maestro_evento_uidx" ON "public"."cerro_verde_pernoctes_historico_maestro" USING "btree" ("evento_origen_id") WHERE ("evento_origen_id" IS NOT NULL);



CREATE INDEX "cv_pernoctes_maestro_placa_idx" ON "public"."cerro_verde_pernoctes_historico_maestro" USING "btree" ("placa");



CREATE INDEX "cv_pernoctes_maestro_salida_idx" ON "public"."cerro_verde_pernoctes_historico_maestro" USING "btree" ("salida_caracoto");



CREATE INDEX "idx_app_egress_itin_fecha" ON "public"."app_egress_log" USING "btree" ("itinerario", "creado_en" DESC);



CREATE INDEX "idx_cemento_seguimiento_cortes_fecha" ON "public"."cemento_seguimiento_cortes" USING "btree" ("itinerario", "guardado_en" DESC);



CREATE INDEX "idx_cv_pernocte_validacion_entrega" ON "public"."cerro_verde_pernoctes_validacion" USING "btree" ("entrega_sap");



CREATE INDEX "idx_cv_pernocte_validacion_fecha" ON "public"."cerro_verde_pernoctes_validacion" USING "btree" ("validado_en" DESC);



CREATE INDEX "idx_cv_pernocte_validacion_placa" ON "public"."cerro_verde_pernoctes_validacion" USING "btree" ("placa");



CREATE INDEX "idx_editor_geocercas_versiones_itinerario_fecha" ON "public"."editor_geocercas_versiones" USING "btree" ("itinerario", "creado_en" DESC);



CREATE INDEX "idx_sap_registros_cemento_oc" ON "public"."sap_registros_staging" USING "btree" ("itinerario", "orden_carga");



CREATE INDEX "idx_sap_rutas_reglas_itinerario_usar" ON "public"."sap_rutas_reglas" USING "btree" ("itinerario", "usar");



CREATE INDEX "idx_seg_manual_import_itinerario_fecha" ON "public"."seguimiento_manual_importaciones" USING "btree" ("itinerario", "creado_en" DESC);



CREATE INDEX "idx_seguimiento_cemento_origen_oc" ON "public"."seguimiento_staging" USING "btree" ("itinerario", "origen", "orden_carga");



CREATE INDEX "idx_seguimiento_sesion_usuario" ON "public"."seguimiento_sesion_web" USING "btree" ("itinerario", "usuario", "seguimiento_id");



CREATE INDEX "ix_auditoria_accion" ON "public"."seguimiento_auditoria" USING "btree" ("accion");



CREATE INDEX "ix_auditoria_oc" ON "public"."seguimiento_auditoria" USING "btree" ("orden_carga");



CREATE INDEX "ix_auditoria_seg" ON "public"."seguimiento_auditoria" USING "btree" ("seguimiento_id");



CREATE INDEX "ix_config_doc_activo" ON "public"."configuracion_documentos" USING "btree" ("itinerario", "tipo", "activo");



CREATE INDEX "ix_gps_jobs_estado" ON "public"."gps_precarga_jobs" USING "btree" ("estado");



CREATE INDEX "ix_gps_unidades_estado" ON "public"."gps_precarga_unidades" USING "btree" ("estado");



CREATE INDEX "ix_gps_unidades_job" ON "public"."gps_precarga_unidades" USING "btree" ("job_id");



CREATE INDEX "ix_gps_unidades_placa" ON "public"."gps_precarga_unidades" USING "btree" ("placa");



CREATE INDEX "ix_gps_unidades_ultimo" ON "public"."gps_precarga_unidades" USING "btree" ("ultima_posicion_gps");



CREATE INDEX "ix_sap_importaciones_hash" ON "public"."sap_importaciones" USING "btree" ("hash_sha256");



CREATE INDEX "ix_sap_registros_itinerario" ON "public"."sap_registros_staging" USING "btree" ("itinerario");



CREATE INDEX "ix_sap_registros_oc" ON "public"."sap_registros_staging" USING "btree" ("orden_carga");



CREATE INDEX "ix_sap_sync_filas_clas" ON "public"."sap_sync_filas" USING "btree" ("clasificacion");



CREATE INDEX "ix_sap_sync_filas_oc" ON "public"."sap_sync_filas" USING "btree" ("orden_carga");



CREATE INDEX "ix_sap_sync_filas_preview" ON "public"."sap_sync_filas" USING "btree" ("preview_id");



CREATE INDEX "ix_sap_sync_previews_estado" ON "public"."sap_sync_previews" USING "btree" ("estado");



CREATE INDEX "ix_sap_sync_previews_hash" ON "public"."sap_sync_previews" USING "btree" ("hash_sha256");



CREATE INDEX "ix_seguimiento_itinerario" ON "public"."seguimiento_staging" USING "btree" ("itinerario");



CREATE INDEX "ix_seguimiento_oc" ON "public"."seguimiento_staging" USING "btree" ("orden_carga");



CREATE INDEX "ix_seguimiento_origen" ON "public"."seguimiento_staging" USING "btree" ("origen");



CREATE INDEX "ix_snapshot_sap_oc" ON "public"."snapshot_sap_registros" USING "btree" ("snapshot_id", "orden_carga");



CREATE INDEX "ix_snapshot_seg_oc" ON "public"."snapshot_seguimiento_registros" USING "btree" ("snapshot_id", "origen", "orden_carga");



CREATE UNIQUE INDEX "ux_sap_registros_cemento_oc" ON "public"."sap_registros_staging" USING "btree" ("itinerario", "orden_carga") WHERE ("orden_carga" IS NOT NULL);



ALTER TABLE ONLY "public"."gps_precarga_unidades"
    ADD CONSTRAINT "gps_precarga_unidades_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."gps_precarga_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sap_sync_filas"
    ADD CONSTRAINT "sap_sync_filas_preview_id_fkey" FOREIGN KEY ("preview_id") REFERENCES "public"."sap_sync_previews"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seguimiento_sesion_web"
    ADD CONSTRAINT "seguimiento_sesion_web_seguimiento_id_fkey" FOREIGN KEY ("seguimiento_id") REFERENCES "public"."seguimiento_staging"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."snapshot_sap_registros"
    ADD CONSTRAINT "snapshot_sap_registros_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots_base"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."snapshot_seguimiento_registros"
    ADD CONSTRAINT "snapshot_seguimiento_registros_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots_base"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."app_egress_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_usuarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cemento_configuracion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cemento_montados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cemento_reporte_control" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cemento_seguimiento_cortes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_arrastre_operativo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_convoy_diario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_eventos_paradas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_grupo_historial" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_grupo_smcv" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_maestro_conductores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_maestro_equipos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_migracion_backups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_pernoctes_enviable" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_pernoctes_validacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_revision_estado" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cerro_verde_revision_unidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_documentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editor_geocercas_maestro" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editor_geocercas_maestro_versiones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editor_geocercas_proyectos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editor_geocercas_versiones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gps_precarga_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gps_precarga_unidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sap_importaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sap_registros_staging" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sap_rutas_reglas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sap_sync_filas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sap_sync_previews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seguimiento_auditoria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seguimiento_manual_importaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seguimiento_sesion_web" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seguimiento_staging" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."snapshot_sap_registros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."snapshot_seguimiento_registros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."snapshots_base" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."cemento_actualizar_corte"("p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cemento_actualizar_corte"("p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cemento_aplicar_sap_reasignacion"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_rows" "jsonb", "p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cemento_aplicar_sap_reasignacion"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_rows" "jsonb", "p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cemento_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cemento_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cemento_consolidar_seguimiento"("p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cemento_consolidar_seguimiento"("p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cemento_importar_seguimiento_manual"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_usuario" "text", "p_filas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cemento_importar_seguimiento_manual"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_usuario" "text", "p_filas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_actualizar_corte"("p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_actualizar_corte"("p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_v3"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_validas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_v3"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_validas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_web"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_web_v2"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_aplicar_sap_web_v2"("p_nombre_archivo" "text", "p_hash_sha256" "text", "p_filas_recibidas" integer, "p_filas_fuera_alcance" integer, "p_sap_rows" "jsonb", "p_daily_rows" "jsonb", "p_group_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_consolidar_seguimiento"("p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_consolidar_seguimiento"("p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerro_verde_consolidar_seguimiento_v3"("p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerro_verde_consolidar_seguimiento_v3"("p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."editor_publicar_geocercas"("p_itinerario" "text", "p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."editor_publicar_geocercas"("p_itinerario" "text", "p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."editor_validar_geocercas"("p_itinerario" "text", "p_usuario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."editor_validar_geocercas"("p_itinerario" "text", "p_usuario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."itinerarios_cuotas_prueba17"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."itinerarios_cuotas_prueba17"() TO "service_role";


















GRANT ALL ON TABLE "public"."app_egress_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_egress_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_egress_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_egress_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."app_usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."cemento_configuracion" TO "anon";
GRANT ALL ON TABLE "public"."cemento_configuracion" TO "authenticated";
GRANT ALL ON TABLE "public"."cemento_configuracion" TO "service_role";



GRANT ALL ON TABLE "public"."cemento_montados" TO "anon";
GRANT ALL ON TABLE "public"."cemento_montados" TO "authenticated";
GRANT ALL ON TABLE "public"."cemento_montados" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cemento_montados_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cemento_montados_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cemento_montados_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cemento_reporte_control" TO "service_role";



GRANT ALL ON TABLE "public"."cemento_seguimiento_cortes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cemento_seguimiento_cortes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cemento_seguimiento_cortes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cemento_seguimiento_cortes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_arrastre_operativo" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_convoy_diario" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_eventos_paradas" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_grupo_historial" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cerro_verde_grupo_historial_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cerro_verde_grupo_historial_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cerro_verde_grupo_historial_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_grupo_smcv" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_maestro_conductores" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_maestro_equipos" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_migracion_backups" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cerro_verde_migracion_backups_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cerro_verde_migracion_backups_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cerro_verde_migracion_backups_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_pernoctes_enviable" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_pernoctes_historico_maestro" TO "anon";
GRANT ALL ON TABLE "public"."cerro_verde_pernoctes_historico_maestro" TO "authenticated";
GRANT ALL ON TABLE "public"."cerro_verde_pernoctes_historico_maestro" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cerro_verde_pernoctes_historico_maestro_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cerro_verde_pernoctes_historico_maestro_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cerro_verde_pernoctes_historico_maestro_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_pernoctes_validacion" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_revision_estado" TO "anon";
GRANT ALL ON TABLE "public"."cerro_verde_revision_estado" TO "authenticated";
GRANT ALL ON TABLE "public"."cerro_verde_revision_estado" TO "service_role";



GRANT ALL ON TABLE "public"."cerro_verde_revision_unidades" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_documentos" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_documentos" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_documentos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."configuracion_documentos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."configuracion_documentos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."configuracion_documentos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."editor_geocercas_maestro" TO "service_role";



GRANT ALL ON TABLE "public"."editor_geocercas_maestro_versiones" TO "service_role";



GRANT ALL ON TABLE "public"."editor_geocercas_proyectos" TO "service_role";



GRANT ALL ON TABLE "public"."editor_geocercas_versiones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."editor_geocercas_versiones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."gps_precarga_jobs" TO "anon";
GRANT ALL ON TABLE "public"."gps_precarga_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."gps_precarga_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."gps_precarga_unidades" TO "anon";
GRANT ALL ON TABLE "public"."gps_precarga_unidades" TO "authenticated";
GRANT ALL ON TABLE "public"."gps_precarga_unidades" TO "service_role";



GRANT ALL ON SEQUENCE "public"."gps_precarga_unidades_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."gps_precarga_unidades_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."gps_precarga_unidades_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sap_importaciones" TO "anon";
GRANT ALL ON TABLE "public"."sap_importaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."sap_importaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sap_importaciones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sap_importaciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sap_importaciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sap_registros_staging" TO "anon";
GRANT ALL ON TABLE "public"."sap_registros_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."sap_registros_staging" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sap_registros_staging_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sap_registros_staging_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sap_registros_staging_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sap_rutas_reglas" TO "service_role";



GRANT ALL ON TABLE "public"."sap_sync_filas" TO "anon";
GRANT ALL ON TABLE "public"."sap_sync_filas" TO "authenticated";
GRANT ALL ON TABLE "public"."sap_sync_filas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sap_sync_filas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sap_sync_filas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sap_sync_filas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sap_sync_previews" TO "anon";
GRANT ALL ON TABLE "public"."sap_sync_previews" TO "authenticated";
GRANT ALL ON TABLE "public"."sap_sync_previews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sap_sync_previews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sap_sync_previews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sap_sync_previews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_auditoria" TO "anon";
GRANT ALL ON TABLE "public"."seguimiento_auditoria" TO "authenticated";
GRANT ALL ON TABLE "public"."seguimiento_auditoria" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seguimiento_auditoria_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seguimiento_auditoria_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seguimiento_auditoria_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_manual_importaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seguimiento_manual_importaciones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seguimiento_manual_importaciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seguimiento_manual_importaciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_sesion_web" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seguimiento_sesion_web_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seguimiento_sesion_web_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seguimiento_sesion_web_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_staging" TO "anon";
GRANT ALL ON TABLE "public"."seguimiento_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."seguimiento_staging" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seguimiento_staging_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seguimiento_staging_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seguimiento_staging_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."snapshot_sap_registros" TO "anon";
GRANT ALL ON TABLE "public"."snapshot_sap_registros" TO "authenticated";
GRANT ALL ON TABLE "public"."snapshot_sap_registros" TO "service_role";



GRANT ALL ON SEQUENCE "public"."snapshot_sap_registros_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."snapshot_sap_registros_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."snapshot_sap_registros_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."snapshot_seguimiento_registros" TO "anon";
GRANT ALL ON TABLE "public"."snapshot_seguimiento_registros" TO "authenticated";
GRANT ALL ON TABLE "public"."snapshot_seguimiento_registros" TO "service_role";



GRANT ALL ON SEQUENCE "public"."snapshot_seguimiento_registros_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."snapshot_seguimiento_registros_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."snapshot_seguimiento_registros_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."snapshots_base" TO "anon";
GRANT ALL ON TABLE "public"."snapshots_base" TO "authenticated";
GRANT ALL ON TABLE "public"."snapshots_base" TO "service_role";



GRANT ALL ON SEQUENCE "public"."snapshots_base_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."snapshots_base_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."snapshots_base_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































