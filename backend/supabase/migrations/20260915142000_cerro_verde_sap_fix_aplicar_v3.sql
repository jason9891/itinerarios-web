-- CERRO VERDE WEB
-- FIX SAP APLICAR 01
-- Corrige conflicto PL/pgSQL entre la variable record `x` y los alias SQL `x`
-- dentro de cerro_verde_aplicar_sap_v3.
-- Alcance: CERRO VERDE solamente. No modifica CEMENTO.

CREATE OR REPLACE FUNCTION public.cerro_verde_aplicar_sap_v3(
 p_nombre_archivo text,
 p_hash_sha256 text,
 p_filas_recibidas integer,
 p_filas_validas integer,
 p_filas_fuera_alcance integer,
 p_sap_rows jsonb,
 p_daily_rows jsonb,
 p_group_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
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

REVOKE ALL ON FUNCTION public.cerro_verde_aplicar_sap_v3(
  text,text,integer,integer,integer,jsonb,jsonb,jsonb
) FROM public,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.cerro_verde_aplicar_sap_v3(
  text,text,integer,integer,integer,jsonb,jsonb,jsonb
) TO service_role;
