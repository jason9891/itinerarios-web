from pathlib import Path
import json, collections, re
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'tests'

def load(p): return json.loads(Path(p).read_text(encoding='utf-8'))

group=load(ROOT/'tests/grupo94_pre_revision.json')
daily=load(SRC/'daily45.json')
sap=load(SRC/'sap205.json')
new=load(SRC/'new28.json')
equip=load(SRC/'equipos.json')
drivers=load(SRC/'conductores.json')
oracle=load(SRC/'oracle69.json')

sec=collections.Counter(x['payload']['SECCION_REPORTE'] for x in group)
assert len(group)==94 and sec=={'CAL VACIO':50,'CAL CARGADO':44}, (len(group),sec)
assert not any(x['codigo_tracto'].startswith('PLACA-') for x in group)
assert len(daily)==45 and len({str(x['ENTREGA SAP']) for x in daily})==45
plates=collections.Counter(x['PLACA TRACTO'] for x in daily)
assert sum(v>1 for v in plates.values())>=1 and len(plates)==39
assert len(sap)==205 and len({str(x['Entrega']) for x in sap})==205
assert len(new)==28
emap={x['placa']:x['codigo_sap'] for x in equip if x.get('placa') and x.get('codigo_sap')}
dmap={x['licencia']:x['conductor'] for x in drivers if x.get('licencia') and x.get('conductor')}
for r in new:
    raw=r.get('Placa','')
    parts=[x.strip().upper() for x in re.split(r'[/\s]+',raw) if x.strip()]
    assert len(parts)>=2 and parts[0] in emap and parts[1] in emap, ('master equipo',r.get('Entrega'),raw)
    lic=str(r.get('Denominación') or r.get('Denominacion') or '').strip().upper().replace(' ','')
    assert lic in {str(k).upper().replace(' ',''):v for k,v in dmap.items()}, ('master conductor',r.get('Entrega'),lic)
osc=collections.Counter(x['SECCION_REPORTE'] for x in oracle)
assert len(oracle)==69 and osc=={'CAL VACIO':40,'CAL CARGADO':29}
# El oráculo no puede ser la semilla productiva: la migración debe afirmar 94 pre-revisión.
sql=(ROOT/'supabase/migrations/20260913213000_cerro_verde_prueba_integral_01.sql').read_text(encoding='utf-8')
assert 'g<>94 OR v<>50 OR cg<>44' in sql
assert 'grupo PRE-REVISIÓN' in sql or 'GRUPO_SMCV PRE-REVISIÓN' in sql
assert 'g<>69 OR v<>40 OR cg<>29' not in sql
print('OK fixtures: 45 DIARIO · 39 placas · 205 SAP · 28 nuevas válidas · grupo pre-revisión 94=50/44 · oráculo 69=40/29 solo validación')
