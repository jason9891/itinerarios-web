CERRO VERDE WEB - BASE DE PARTIDA OFICIAL
CORTE REAL: 12/09/2026 12:29:26

ESTADO INICIAL
- GRUPO SMCV: 91 unidades = 66 CAL VACIO + 25 CAL CARGADO.
- SAP: 177 entregas del 01/09 al 12/09.
- DIARIO: 17 ciclos abiertos.
- HISTORICO: 160 ciclos cerrados desde 01/09.
- PARADAS: 185 eventos desde 01/09 (153 pernoctes + 32 pausas).
- Se elimina el histórico masivo de junio/agosto.

REGLA FUNDAMENTAL
CERRAR CICLO NO SIGNIFICA SACAR DEL GRUPO SMCV.
Al completar el retorno, la unidad normalmente pasa de CAL CARGADO a CAL VACIO y sigue en ENVIAR.

ACCIONES WEB NECESARIAS
1) SACAR DEL GRUPO SMCV: acción explícita cuando se confirma otra operación.
2) AGREGAR AL GRUPO SMCV: para retornos/reincorporaciones sin nueva carga; nueva carga SMCV hace alta automática.
3) REVISAR SIN NUEVA CARGA: al final del seguimiento, mostrar unidades activas sin nueva entrega y permitir MANTENER o SACAR.

PRUEBA DE ACEPTACION 12->13
Partiendo de esta base, subir el SAP actualizado y ejecutar el seguimiento. Sin usar el manual del 13 como entrada, el resultado debe ser exactamente:
- 69 unidades
- 40 CAL VACIO
- 29 CAL CARGADO
- mismas placas que el manual del 13.
El archivo VALIDACION_12_A_13_NO_CARGAR.xlsx es solo el oráculo de prueba.
