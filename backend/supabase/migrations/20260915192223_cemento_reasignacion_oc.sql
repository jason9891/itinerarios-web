begin;

create or replace function public.cemento_aplicar_sap_reasignacion(
  p_nombre_archivo text,
  p_hash_sha256 text,
  p_filas_recibidas integer,
  p_rows jsonb,
  p_usuario text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.cemento_aplicar_sap_reasignacion(text,text,integer,jsonb,text)
from public,anon,authenticated;
grant execute on function public.cemento_aplicar_sap_reasignacion(text,text,integer,jsonb,text)
to service_role;

commit;
