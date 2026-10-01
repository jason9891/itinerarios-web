from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "base_cerro_verde_corte_12_09_final"
OUTPUT = ROOT / "supabase/migrations/20260912_detalles1_corte_inicial_cerro_verde.sql"


def clean(value):
    if pd.isna(value): return ""
    if isinstance(value, (pd.Timestamp, datetime, date)): return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, float) and value.is_integer(): return int(value)
    return value


def rows(file_name, sheet):
    frame = pd.read_excel(SOURCE / file_name, sheet_name=sheet, dtype=object)
    return [{str(k): clean(v) for k, v in row.items()} for row in frame.to_dict("records")]


def literal(value):
    return "$json$" + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "$json$::jsonb"


def tracking_payload(row):
    payload = dict(row)
    payload["TRACTO"] = payload.get("CODIGO TRACTO", "")
    payload["Placa"] = payload.get("PLACA TRACTO", "") or str(payload.get("PLACA", "")).split("/")[0]
    payload["SECCION REPORTE"] = ""
    payload["PERNOCTES_VALIDADOS"] = []
    payload["PAUSAS_ACTIVAS_VALIDADAS"] = []
    return payload


sap = rows("01_SAP_HISTORICO_WEB_CORTE_12_09.xlsx", "SAP_HISTORICO")
daily = rows("02_SEGUIMIENTO_DIARIO_WEB_CORTE_12_09.xlsx", "SEGUIMIENTO_DIARIO")
history = rows("03_SEGUIMIENTO_HISTORICO_WEB_CORTE_12_09.xlsx", "SEGUIMIENTO_HISTORICO")
events = rows("03_SEGUIMIENTO_HISTORICO_WEB_CORTE_12_09.xlsx", "EVENTOS_PARADAS")
group = rows("04_GRUPO_SMCV_WEB_CORTE_12_09.xlsx", "GRUPO_SMCV")
group_history = rows("04_GRUPO_SMCV_WEB_CORTE_12_09.xlsx", "HISTORIAL_GRUPO")
pernoctes_mail = rows("HISTORICO_PERNOCTES_SMCV_DESDE_09_09.xlsx", "Historico")

group_by_tract = {str(x["CODIGO_TRACTO"]).strip().upper(): x for x in group}
tracking = []
for origin, source in (("DIARIO", daily), ("HISTORICO", history)):
    for row in source:
        payload = tracking_payload(row)
        g = group_by_tract.get(str(row.get("CODIGO TRACTO", "")).strip().upper())
        if g and int(g.get("ACTIVO_GRUPO") or 0) == 1: payload["SECCION REPORTE"] = g["SECCION_REPORTE"]
        tracking.append({"orden_carga": str(row["ENTREGA SAP"]), "origen": origin, "payload": payload})

sap_payload = [{"orden_carga": str(x["Entrega"]), "payload": x} for x in sap]
drivers = sorted({(str(x.get("LICENCIA", "")).strip().upper(), str(x.get("CONDUCTOR", "")).strip().upper()) for x in group if str(x.get("LICENCIA", "")).strip() and str(x.get("CONDUCTOR", "")).strip()})
equipment = sorted({(str(x.get("PLACA_TRACTO", "")).strip().upper(), str(x.get("CODIGO_TRACTO", "")).strip().upper()) for x in group if str(x.get("PLACA_TRACTO", "")).strip() and str(x.get("CODIGO_TRACTO", "")).strip()})

sql = f"""-- DETALLES 1 · CORTE OFICIAL CERRO VERDE 12/09/2026 12:29:26
-- Reemplaza exclusivamente CERRO VERDE. No modifica CEMENTO.
begin;
create table if not exists public.cerro_verde_maestro_conductores(licencia text not null,conductor text not null,actualizado_en timestamptz not null default now(),primary key(licencia,conductor));
create table if not exists public.cerro_verde_maestro_equipos(placa text not null,codigo_sap text not null,actualizado_en timestamptz not null default now(),primary key(placa,codigo_sap));
create table if not exists public.cerro_verde_grupo_smcv(codigo_tracto text primary key,payload jsonb not null,activo boolean not null default true,actualizado_en timestamptz not null default now());
create table if not exists public.cerro_verde_grupo_historial(id bigint generated always as identity primary key,payload jsonb not null,actualizado_en timestamptz not null default now());
create table if not exists public.cerro_verde_eventos_paradas(evento_origen_id bigint primary key,tipo text not null,entrega_sap text,payload jsonb not null,actualizado_en timestamptz not null default now());
create table if not exists public.cerro_verde_pernoctes_enviable(numero integer primary key,conductor text,codigo_tracto text,placa text,fecha_carga date,salida_caracoto timestamptz,destino_esperado text,pernocto_en text,cumplimiento text,inicio_pernocte timestamptz,actualizado_en timestamptz not null default now());
create table if not exists public.cerro_verde_convoy_diario(posicion smallint primary key check(posicion between 1 and 10),conductor text,licencia text,codigo_tracto text,placa_tracto text,codigo_carreta text,placa_carreta text,hito_1 timestamptz,hito_2 timestamptz,hito_3 timestamptz,hito_4 timestamptz,estado text,monitoreo text,observacion text,fecha_operativa date not null default (now() at time zone 'America/Lima')::date,actualizado_en timestamptz not null default now());
alter table public.cerro_verde_maestro_conductores enable row level security; alter table public.cerro_verde_maestro_equipos enable row level security; alter table public.cerro_verde_grupo_smcv enable row level security; alter table public.cerro_verde_grupo_historial enable row level security; alter table public.cerro_verde_eventos_paradas enable row level security; alter table public.cerro_verde_pernoctes_enviable enable row level security; alter table public.cerro_verde_convoy_diario enable row level security;
revoke all on public.cerro_verde_maestro_conductores,public.cerro_verde_maestro_equipos,public.cerro_verde_grupo_smcv,public.cerro_verde_grupo_historial,public.cerro_verde_eventos_paradas,public.cerro_verde_pernoctes_enviable,public.cerro_verde_convoy_diario from anon,authenticated;
grant all on public.cerro_verde_maestro_conductores,public.cerro_verde_maestro_equipos,public.cerro_verde_grupo_smcv,public.cerro_verde_grupo_historial,public.cerro_verde_eventos_paradas,public.cerro_verde_pernoctes_enviable,public.cerro_verde_convoy_diario to service_role;
delete from public.seguimiento_sesion_web where itinerario='CERRO VERDE'; delete from public.cemento_reporte_control where itinerario='CERRO VERDE'; delete from public.seguimiento_staging where itinerario='CERRO VERDE'; delete from public.sap_registros_staging where itinerario='CERRO VERDE'; delete from public.sap_importaciones where itinerario='CERRO VERDE';
truncate public.cerro_verde_maestro_conductores,public.cerro_verde_maestro_equipos,public.cerro_verde_grupo_smcv,public.cerro_verde_grupo_historial,public.cerro_verde_eventos_paradas,public.cerro_verde_pernoctes_enviable,public.cerro_verde_convoy_diario restart identity;
do $$ begin
 if to_regclass('public.cerro_verde_pernoctes_revision') is not null then execute 'truncate public.cerro_verde_pernoctes_revision'; end if;
 if to_regclass('public.cerro_verde_reporte_diario_corte') is not null then execute 'truncate public.cerro_verde_reporte_diario_corte'; end if;
 if to_regclass('public.cerro_verde_paradas_validadas') is not null then execute 'truncate public.cerro_verde_paradas_validadas'; end if;
 if to_regclass('public.cerro_verde_ranking_paradas') is not null then execute 'truncate public.cerro_verde_ranking_paradas'; end if;
end $$;
with imp as (insert into public.sap_importaciones(itinerario,nombre_archivo,hash_sha256,filas_recibidas,filas_validas,filas_fuera_alcance,estado) values('CERRO VERDE','01_SAP_HISTORICO_WEB_CORTE_12_09.xlsx','CORTE_OFICIAL_CV_20260912',177,177,0,'APLICADO') returning id)
insert into public.sap_registros_staging(itinerario,importacion_id,orden_carga,payload) select 'CERRO VERDE',imp.id,x.orden_carga,x.payload from imp,jsonb_to_recordset({literal(sap_payload)}) x(orden_carga text,payload jsonb);
insert into public.seguimiento_staging(itinerario,origen,orden_carga,payload,observacion_migracion) select 'CERRO VERDE',x.origen,x.orden_carga,x.payload,'CORTE OFICIAL 12/09/2026 12:29:26' from jsonb_to_recordset({literal(tracking)}) x(orden_carga text,origen text,payload jsonb);
insert into public.cerro_verde_maestro_conductores(licencia,conductor) select x.licencia,x.conductor from jsonb_to_recordset({literal([{"licencia":a,"conductor":b} for a,b in drivers])}) x(licencia text,conductor text);
insert into public.cerro_verde_maestro_equipos(placa,codigo_sap) select x.placa,x.codigo_sap from jsonb_to_recordset({literal([{"placa":a,"codigo_sap":b} for a,b in equipment])}) x(placa text,codigo_sap text);
insert into public.cerro_verde_grupo_smcv(codigo_tracto,payload,activo) select x.codigo_tracto,x.payload,x.activo from jsonb_to_recordset({literal([{"codigo_tracto":str(r["CODIGO_TRACTO"]),"payload":r,"activo":bool(int(r["ACTIVO_GRUPO"] or 0))} for r in group])}) x(codigo_tracto text,payload jsonb,activo boolean);
insert into public.cerro_verde_grupo_historial(payload) select value from jsonb_array_elements({literal(group_history)});
insert into public.cerro_verde_eventos_paradas(evento_origen_id,tipo,entrega_sap,payload) select x.evento_origen_id,x.tipo,x.entrega_sap,x.payload from jsonb_to_recordset({literal([{"evento_origen_id":int(r["id"]),"tipo":r["tipo_parada"],"entrega_sap":str(r["entrega"]),"payload":r} for r in events])}) x(evento_origen_id bigint,tipo text,entrega_sap text,payload jsonb);
insert into public.cerro_verde_pernoctes_enviable(numero,conductor,codigo_tracto,placa,fecha_carga,salida_caracoto,destino_esperado,pernocto_en,cumplimiento,inicio_pernocte)
select x.numero,x.conductor,x.codigo_tracto,x.placa,nullif(x.fecha_carga,'')::date,nullif(x.salida_caracoto,'')::timestamp at time zone 'America/Lima',x.destino_esperado,x.pernocto_en,x.cumplimiento,nullif(x.inicio_pernocte,'')::timestamp at time zone 'America/Lima'
from jsonb_to_recordset({literal([{"numero":int(r["N°"]),"conductor":r["CONDUCTOR"],"codigo_tracto":r["CODIGO TRACTO"],"placa":r["PLACA"],"fecha_carga":clean(r["FECHA DE CARGA"]),"salida_caracoto":clean(r["SALIDA DE CARACOTO"]),"destino_esperado":r["DEBIO PERNOCTAR / DESTINO"],"pernocto_en":r["PERNOCTO EN"],"cumplimiento":r["CUMPLIMIENTO"],"inicio_pernocte":clean(r["HORA DE INICIO DE PERNOCTE"])} for r in pernoctes_mail])}) x(numero integer,conductor text,codigo_tracto text,placa text,fecha_carga text,salida_caracoto text,destino_esperado text,pernocto_en text,cumplimiento text,inicio_pernocte text);
insert into public.cerro_verde_convoy_diario(posicion) select generate_series(1,10);
insert into public.cemento_configuracion(itinerario,fecha_inicio_recorrido,origen,nota,actualizado_en) values('CERRO VERDE','2026-09-12 12:29:26-05','CORTE_OFICIAL_WEB_20260912','177 ciclos: 17 abiertos y 160 cerrados; grupo SMCV 91: 66 vacio y 25 cargado; 153 pernoctes, 32 pausas; histórico enviable desde 09/09',now()) on conflict(itinerario) do update set fecha_inicio_recorrido=excluded.fecha_inicio_recorrido,origen=excluded.origen,nota=excluded.nota,actualizado_en=now();
do $$ declare sap_n int;diario_n int;hist_n int;grupo_n int;vacio_n int;cargado_n int;pern_n int;pausa_n int;mail_n int;convoy_n int; begin
select count(*) into sap_n from public.sap_registros_staging where itinerario='CERRO VERDE'; select count(*) filter(where origen='DIARIO'),count(*) filter(where origen='HISTORICO') into diario_n,hist_n from public.seguimiento_staging where itinerario='CERRO VERDE'; select count(*),count(*) filter(where payload->>'SECCION_REPORTE'='CAL VACIO'),count(*) filter(where payload->>'SECCION_REPORTE'='CAL CARGADO') into grupo_n,vacio_n,cargado_n from public.cerro_verde_grupo_smcv where activo; select count(*) filter(where tipo='PERNOCTE'),count(*) filter(where tipo='PAUSA_ACTIVA') into pern_n,pausa_n from public.cerro_verde_eventos_paradas; select count(*) into mail_n from public.cerro_verde_pernoctes_enviable; select count(*) into convoy_n from public.cerro_verde_convoy_diario;
if (sap_n,diario_n,hist_n,grupo_n,vacio_n,cargado_n,pern_n,pausa_n,mail_n,convoy_n)<>(177,17,160,91,66,25,153,32,53,10) then raise exception 'Corte CV inválido: SAP %, diario %, histórico %, grupo %, vacío %, cargado %, pernoctes %, pausas %, enviable %, convoy %',sap_n,diario_n,hist_n,grupo_n,vacio_n,cargado_n,pern_n,pausa_n,mail_n,convoy_n; end if; end $$;
analyze public.sap_registros_staging; analyze public.seguimiento_staging; analyze public.cerro_verde_grupo_smcv; analyze public.cerro_verde_eventos_paradas; commit;
"""
OUTPUT.write_text(sql, encoding="utf-8")
print(OUTPUT)
print(json.dumps({"sap":len(sap),"diario":len(daily),"historico":len(history),"grupo":len(group),"pernoctes":sum(x["tipo_parada"]=="PERNOCTE" for x in events),"pausas":sum(x["tipo_parada"]=="PAUSA_ACTIVA" for x in events),"enviable":len(pernoctes_mail)}, ensure_ascii=False))
