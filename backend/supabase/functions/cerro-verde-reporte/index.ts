import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";
import ExcelJS from "npm:exceljs@4.4.0";
import {activeGroupRows,reportRowFromGroup,reportSort,text,norm,parseDate,fmtLocal} from "../_shared/cv-operativa.js";

const PROJECT="itinerarios-2fa6f",IT="CERRO VERDE",ORIGINS = new Set([
 "https://itinerarios-2fa6f.web.app","https://itinerarios-2fa6f.firebaseapp.com","https://itinerarios-2fa6f--prueba-fin-ciclo-t0s1424a.web.app","https://itinerarios-2fa6f--prueba-fin-ciclo-t0s1424a-dwhuohoz.web.app","http://localhost:5000","http://127.0.0.1:5000",
  "https://jason9891.github.io"
]),JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const COLORS={dark:"15344F",blue:"1F4E78",lightBlue:"D9EAF7",greenText:"166534",green:"E2F0D9",red:"FCE4D6",yellow:"FFF2CC",gray:"F3F6F9",grayText:"44546A",black:"111827",white:"FFFFFF",border:"B7C9DD"};
const RAW_HEADERS=["LICENCIA","CONDUCTOR","CODIGO TRACTO","PLACA TRACTO","CODIGO CARRETA","ESTADO","FECHA DE CARGA","SALIDA DE BASE RACIEMSA","LLEGADA A CARACOTO","INGRESO A CARGUIO","SALIDA DE CARGUIO","SALIDA DE CARACOTO","LLEGADA A BASE RACIEMSA","SALIDA DE BASE RACIEMSA CARGADO","INGRESO A SMCV","SALIDA DE SMCV","LLEGADA A BASE RACIEMSA VACIO","MONITOREO","OBSERVACION","ENTREGA SAP","TRANSPORTE SAP","NRO PEDIDO SAP","GUIA SAP","GRE-R SAP","TIMESTAMP INGRESO SAP","TIMESTAMP SALIDA SAP","PLACA TRACTO","PLACA CARRETA","MATERIAL SAP","DESCRIPCION MATERIAL SAP","CANTIDAD SAP","ESTADO CICLO","FECHA ALTA SEGUIMIENTO","FECHA CIERRE SEGUIMIENTO","ORIGEN REGISTRO","OBSERVACION SISTEMA","CONTROL INTERNO PERNOCTE"];
const COLS_VACIO=["CONDUCTOR / COPILOTO","CÓDIGO TRACTO","CÓDIGO CARRETA","FECHA Y HORA SALIDA RACIEMSA","FECHA Y HORA INGRESO A CESUR","FECHA Y HORA SALIDA DE MINA","FECHA Y HORA INGRESO RACIEMSA","ESTADO","MONITOREO","OBSERVACIÓN"];
const COLS_CARGADO=["CONDUCTOR / COPILOTO","CÓDIGO TRACTO","CÓDIGO CARRETA","FECHA Y HORA SALIDA CESUR","FECHA Y HORA INGRESO / CARGADO RACIEMSA","FECHA Y HORA SALIDA / CARGADO RACIEMSA","FECHA Y HORA INGRESO A SMCV / SAN EXPEDITO","ESTADO","MONITOREO","OBSERVACIÓN"];
const PER_HEADERS=["N°","CONDUCTOR","CODIGO TRACTO","FECHA DE CARGA","SALIDA DE CARACOTO","LLEGADA SAN JOSE / SMCV","DEBIO PERNOCTAR / DESTINO","PERNOCTO EN","SE CUMPLIO","PLACA","ENTREGA SAP","INICIO PERNOCTE","FIN PERNOCTE","OBSERVACION"];
const PER_HEADERS_ENVIABLE=["N°","CONDUCTOR","CODIGO TRACTO","FECHA DE CARGA","SALIDA DE CARACOTO","LLEGADA SAN JOSE / SMCV","DEBIO PERNOCTAR","PERNOCTO EN","SE CUMPLIO","PLACA","INICIO PERNOCTE","FIN PERNOCTE"];
const PERNOCTE_MASTER_TABLE="cerro_verde_pernoctes_historico_maestro";
const PERNOCTE_NEW_FROM_DATE="2026-09-21";
const PERNOCTE_INTERNAL_FROM=new Date(Date.UTC(2026,8,1));
const PERNOCTE_ENVIABLE_FROM=new Date(Date.UTC(2026,8,9));
const PERNOCTE_VALIDATION_FROM=new Date(Date.UTC(2026,8,14));

function cors(req:Request){const o=req.headers.get("origin")||"",h:Record<string,string>={"access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS","vary":"Origin"};if(ORIGINS.has(o))h["access-control-allow-origin"]=o;return h}
function responseJson(req:Request,b:any,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors(req),"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function errorText(e:any){return text(e?.message||e?.details||e?.hint||e?.code||(typeof e==="string"?e:"Error interno de CERRO VERDE"))||"Error interno de CERRO VERDE"}
async function secure(req:Request){const o=req.headers.get("origin")||"";if(!ORIGINS.has(o))throw Error("Origen no autorizado");const h=req.headers.get("authorization")||"";if(!h.startsWith("Bearer "))throw Error("Falta iniciar sesión");const{payload}=await jwtVerify(h.slice(7),JWKS,{algorithms:["RS256"],issuer:`https://securetoken.google.com/${PROJECT}`,audience:PROJECT});const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});const{data:u,error}=await db.from("app_usuarios").select("email,itinerarios,activo").eq("firebase_uid",String(payload.sub||"")).maybeSingle();if(error)throw error;if(!u?.activo||!u.itinerarios?.includes(IT))throw Error("Cuenta sin acceso a CERRO VERDE");return{db,user:u}}
async function allPages(makeQuery:any){const out:any[]=[];for(let from=0;;from+=1000){const{data,error}=await makeQuery(from,from+999);if(error)throw error;out.push(...(data||[]));if(!data||data.length<1000)break}return out}
async function trackingRows(db:any,origin:string){return allPages((from:number,to:number)=>db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario",IT).eq("origen",origin).order("id").range(from,to))}
async function operational(db:any){const{data,error}=await db.from("cerro_verde_grupo_smcv").select("codigo_tracto,payload,activo,actualizado_en").eq("activo",true);if(error)throw error;const active=activeGroupRows(data||[]),report=active.map((x:any)=>{const r=reportRowFromGroup(x);if(norm(r.estado).includes("PROCESO DE DESCARGUIO"))r.grupo="CARGADO";return r});const vacio=report.filter((x:any)=>x.grupo==="VACIO").sort(reportSort),cargado=report.filter((x:any)=>x.grupo==="CARGADO").sort(reportSort);return{rows:active,vacio,cargado}}
function excelDate(v:any,dateOnly=false){const d=parseDate(v);if(!d)return text(v)||"-";return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),dateOnly?0:d.getUTCHours(),dateOnly?0:d.getUTCMinutes(),dateOnly?0:d.getUTCSeconds()))}
function border(cell:any){cell.border={top:{style:"thin",color:{argb:`FF${COLORS.border}`}},left:{style:"thin",color:{argb:`FF${COLORS.border}`}},bottom:{style:"thin",color:{argb:`FF${COLORS.border}`}},right:{style:"thin",color:{argb:`FF${COLORS.border}`}}}}
function setStateStyle(c:any){const s=norm(c.value);if(s.includes("VACIO")){c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.green}`}};c.font={bold:true,color:{argb:`FF${COLORS.greenText}`}}}else if(s.includes("DESCARGUIO")){c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.yellow}`}};c.font={bold:true,color:{argb:"FF9C6500"}}}else if(s.includes("CARGADO")){c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.lightBlue}`}};c.font={bold:true,color:{argb:`FF${COLORS.blue}`}}}}
function writeBlock(ws:any,start:number,title:string,headers:string[],rows:any[],titleColor:string){ws.mergeCells(start,1,start,headers.length);const t=ws.getCell(start,1);t.value=title;t.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${titleColor}`}};t.font={bold:true,color:{argb:`FF${COLORS.white}`},size:14};t.alignment={horizontal:"left",vertical:"middle"};ws.getRow(start).height=24;const hr=start+1;headers.forEach((h,i)=>{const c=ws.getCell(hr,i+1);c.value=h;c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.dark}`}};c.font={bold:true,color:{argb:`FF${COLORS.white}`},size:10};c.alignment={horizontal:"center",vertical:"middle",wrapText:true};border(c)});ws.getRow(hr).height=50;let r=hr+1;for(const [idx,x] of rows.entries()){const vals=[x.conductor,x.tracto,x.carreta,x.h1,x.h2,x.h3,x.h4,x.estado,x.monitoreo,x.observacion];vals.forEach((v,i)=>{const c=ws.getCell(r,i+1);c.value=i>=3&&i<=6?excelDate(v):v;c.fill={type:"pattern",pattern:"solid",fgColor:{argb:idx%2?"FFF7FAFC":"FFFFFFFF"}};c.alignment={horizontal:[0,8,9].includes(i)?"left":"center",vertical:"middle",wrapText:true};c.font={color:{argb:`FF${COLORS.black}`},size:10};border(c);if(c.value instanceof Date)c.numFmt="d/m/yyyy hh:mm";if(i===7)setStateStyle(c)});ws.getRow(r).height=30;r++}return r}
function localDatePE(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),g=(t:string)=>p.find(x=>x.type===t)?.value||"";return`${g("year")}-${g("month")}-${g("day")}`}
/** Hora actual Lima como Date.UTC(y,m,d,h,mi,s) — comparable con parseDate (strings operativos PE). */
function peNowUtcMs(){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date());
  const g=(t:string)=>Number(p.find(x=>x.type===t)?.value||0);
  return Date.UTC(g("year"),g("month")-1,g("day"),g("hour"),g("minute"),g("second"));
}
/** Umbral de exigibilidad de pernocte: 06:30 del día calendario siguiente a SALIDA DE CARACOTO. */
function pernocteExigibleDesde(salida:any){
  const d=parseDate(salida);if(!d)return null;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,6,30,0);
}
function equipmentLookup(rows:any[]){const byCode=new Map<string,any>(),byPlate=new Map<string,any>();for(const x of rows){const code=text(x.codigo_sap),plate=norm(x.placa).replace(/[^A-Z0-9]/g,"");if(code)byCode.set(norm(code),{codigo_sap:code,placa:plate});if(plate)byPlate.set(plate,{codigo_sap:code,placa:plate})}return(value:any)=>byCode.get(norm(value))||byPlate.get(norm(value).replace(/[^A-Z0-9]/g,""))||null}
async function convoyMasters(db:any){const[equipment,drivers]=await Promise.all([allPages((from:number,to:number)=>db.from("cerro_verde_maestro_equipos").select("placa,codigo_sap").range(from,to)),allPages((from:number,to:number)=>db.from("cerro_verde_maestro_conductores").select("licencia,conductor").range(from,to))]);const tractos=equipment.filter((x:any)=>/^20-R-/i.test(text(x.codigo_sap))).map((x:any)=>({codigo_sap:text(x.codigo_sap),placa:norm(x.placa).replace(/[^A-Z0-9]/g,"")})).filter((x:any)=>x.codigo_sap&&x.placa).sort((a:any,b:any)=>norm(a.codigo_sap).localeCompare(norm(b.codigo_sap),undefined,{numeric:true})),carretas=equipment.filter((x:any)=>/^20-(T|P)-/i.test(text(x.codigo_sap))).map((x:any)=>({codigo_sap:text(x.codigo_sap),placa:norm(x.placa).replace(/[^A-Z0-9]/g,"")})).filter((x:any)=>x.codigo_sap&&x.placa).sort((a:any,b:any)=>norm(a.codigo_sap).localeCompare(norm(b.codigo_sap),undefined,{numeric:true})),conductores=drivers.map((x:any)=>({licencia:text(x.licencia),conductor:text(x.conductor)})).filter((x:any)=>x.licencia&&x.conductor).sort((a:any,b:any)=>norm(a.conductor).localeCompare(norm(b.conductor)));return{equipment,drivers,tractos,carretas,conductores}}
async function convoyRows(db:any){const fecha=localDatePE(),{data,error}=await db.from("cerro_verde_convoy_diario").select("posicion,conductor,licencia,codigo_tracto,placa_tracto,codigo_carreta,placa_carreta,hito_1,hito_2,hito_3,hito_4,estado,monitoreo,observacion,fecha_operativa,actualizado_en").order("posicion");if(error)throw error;const today=(data||[]).filter((x:any)=>text(x.fecha_operativa)===fecha),by=new Map(today.map((x:any)=>[Number(x.posicion),x]));return Array.from({length:10},(_,i)=>by.get(i+1)||{posicion:i+1})}
function convoyReportRows(rows:any[]){return rows.map((x:any)=>({conductor:text(x.conductor),tracto:text(x.codigo_tracto),carreta:text(x.codigo_carreta),h1:x.hito_1||"",h2:x.hito_2||"",h3:x.hito_3||"",h4:x.hito_4||"",estado:text(x.estado),monitoreo:text(x.monitoreo),observacion:text(x.observacion)}))}
function writeConvoyBlock(ws:any,start:number,headers:string[],rows:any[]){ws.mergeCells(start,1,start,headers.length);const t=ws.getCell(start,1);t.value="CONVOY / UNIDADES SIN DESPACHO";t.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.grayText}`}};t.font={bold:true,color:{argb:`FF${COLORS.white}`},size:13};t.alignment={horizontal:"left",vertical:"middle"};const hr=start+1;headers.forEach((h,i)=>{const c=ws.getCell(hr,i+1);c.value=h;c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.dark}`}};c.font={bold:true,color:{argb:`FF${COLORS.white}`},size:9};c.alignment={horizontal:"center",vertical:"middle",wrapText:true};border(c)});ws.getRow(hr).height=50;let r=hr+1;for(let i=0;i<10;i++,r++){const x=rows[i]||{},vals=[x.conductor||"",x.tracto||"",x.carreta||"",x.h1||"",x.h2||"",x.h3||"",x.h4||"",x.estado||"",x.monitoreo||"",x.observacion||""];vals.forEach((v,j)=>{const c=ws.getCell(r,j+1);c.value=j>=3&&j<=6&&v?excelDate(v):v;c.fill={type:"pattern",pattern:"solid",fgColor:{argb:i%2?"FFF7FAFC":"FFFFFFFF"}};c.alignment={horizontal:[0,8,9].includes(j)?"left":"center",vertical:"middle",wrapText:true};border(c);if(c.value instanceof Date)c.numFmt="d/m/yyyy hh:mm";if(j===7&&c.value)setStateStyle(c)});ws.getRow(r).height=30}return r}
async function operationalBook(db:any){const[op,convoy]=await Promise.all([operational(db),convoyRows(db)]);const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet("ENVIAR",{views:[{showGridLines:false}]});ws.mergeCells("A1:J1");ws.getCell("A1").value="CERRO VERDE · REPORTE OPERATIVO";ws.getCell("A1").font={bold:true,size:16,color:{argb:`FF${COLORS.dark}`}};ws.getCell("A1").alignment={horizontal:"center",vertical:"middle"};ws.getRow(1).height=28;ws.mergeCells("A2:J2");ws.getCell("A2").value=`CORTE: ${new Intl.DateTimeFormat("es-PE",{timeZone:"America/Lima",dateStyle:"short",timeStyle:"medium",hour12:false}).format(new Date())} · TOTAL: ${op.rows.length} · CAL VACÍO: ${op.vacio.length} · CONVOY: ${convoy.filter((x:any)=>x.codigo_tracto).length}/10 · CAL CARGADO: ${op.cargado.length}`;ws.getCell("A2").font={italic:true,color:{argb:`FF${COLORS.grayText}`}};let r=writeBlock(ws,4,"CAL VACÍO",COLS_VACIO,op.vacio,COLORS.blue);r+=2;r=writeConvoyBlock(ws,r,COLS_VACIO,convoyReportRows(convoy));r+=2;writeBlock(ws,r,"CAL CARGADO",COLS_CARGADO,op.cargado,"2E7D32");[34,17,17,23,24,24,26,23,34,36].forEach((w,i)=>ws.getColumn(i+1).width=w);ws.views=[{state:"frozen",ySplit:5,showGridLines:false}];ws.pageSetup={orientation:"landscape",fitToWidth:1,fitToPage:true,margins:{left:.2,right:.2,top:.4,bottom:.4,header:.2,footer:.2}};ws.headerFooter.oddHeader="&CCERRO VERDE · ENVIAR";ws.headerFooter.oddFooter="&LPágina &P de &N&R&RACIEMSA";return{bytes:new Uint8Array(await wb.xlsx.writeBuffer()),...op}}
function loadedPernocteStops(data:any[]){
  const out=new Map<string,any[]>();
  for(const x of data||[]){
    const p=x.payload||{},ent=text(x.entrega_sap||p.entrega);
    if(!ent)continue;
    (out.get(ent)||out.set(ent,[]).get(ent)!).push({...p,tipo_parada:x.tipo,evento_origen_id:x.evento_origen_id});
  }
  return out;
}
function stopInLoadedLeg(stops:any[],p:any){
  const salida=parseDate(p["SALIDA DE CARACOTO"]),llegada=parseDate(p["INGRESO A SMCV"]);
  if(!salida)return null;
  const c:any[]=[];
  for(const s of stops||[]){
    const ini=parseDate(s.inicio),fin=parseDate(s.fin);
    if(!ini||ini<salida)continue;
    if(llegada&&ini>llegada)continue;
    if(llegada&&fin&&fin>llegada)continue;
    if(fin&&fin<salida)continue;
    c.push([Number(s.duracion_min||0),ini.getTime(),s]);
  }
  // Para ciclos en curso de más de una noche interesa el descanso más reciente
  // ya completado, no necesariamente el de mayor duración.
  c.sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  return c[0]?.[2]||null;
}
function expectedStop(v:any){
  const d=parseDate(v);if(!d)return"SIN SALIDA";
  const min=d.getUTCHours()*60+d.getUTCMinutes();
  if(min<=900)return"AREQUIPA";
  if(min<=1020)return"YURA";
  if(min<1080)return"PATAHUASI";
  if(min<=1200)return"SANTA LUCIA";
  if(min<1320)return"JULIACA / CARACOTO";
  return"NO DEBIO CARGAR";
}
function stopName(s:any){
  if(!s)return"SIN REGISTRO";
  const m=text(s.motivo),g=text(s.geocerca);
  if(m){
    if(m.includes(" - ")){const tail=text(m.split(" - ").at(-1));if(tail)return tail}
    return m;
  }
  return g||"SIN REGISTRO";
}
function routeRank(v:any){
  const n=norm(v);
  if(!n||n==="SIN REGISTRO"||n.includes("FUERA DE GEOCERCA"))return null;
  if(n.includes("CERRO VERDE")||n.includes("SMCV")||n.includes("SAN JOSE"))return 6;
  if(n.includes("AREQUIPA")||n.includes("RACIEMSA"))return 5;
  if(n.includes("YURA"))return 4;
  if(n.includes("PATAHUASI"))return 3;
  if(n.includes("IMATA"))return 2;
  if(n.includes("SANTA LUCIA"))return 1;
  if(n.includes("JULIACA")||n.includes("CARACOTO")||n.includes("CALCESUR"))return 0;
  return null;
}
function compliance(expected:string,actual:string,p:any){
  const e=norm(expected),a=norm(actual);
  if(!e||e==="SIN SALIDA")return"PENDIENTE VALIDACION";
  if(!a||a==="SIN REGISTRO"||a.includes("FUERA DE GEOCERCA"))return"PENDIENTE VALIDACION";

  // Regla operativa validada 21/09/2026:
  // YURA solo acepta PLANTA YURA.
  if(e==="YURA")return a==="PLANTA YURA"?"SI":"PENDIENTE VALIDACION";

  // AREQUIPA acepta exactamente AREQUIPA, RACIEMSA o PLANTA YURA.
  if(e==="AREQUIPA")return["AREQUIPA","RACIEMSA","PLANTA YURA"].includes(a)?"SI":"PENDIENTE VALIDACION";

  // Para los demás límites, solo una coincidencia exacta se valida automáticamente.
  if(e===a)return"SI";

  // Ningún otro caso se marca NO de forma automática.
  return"PENDIENTE VALIDACION";
}
async function pernocteDataset(db:any){
  try{
    const[h,d,s,v,m]=await Promise.all([
      trackingRows(db,"HISTORICO"),
      trackingRows(db,"DIARIO"),
      allPages((from:number,to:number)=>db.from("cerro_verde_eventos_paradas").select("evento_origen_id,tipo,entrega_sap,payload").eq("tipo","PERNOCTE").order("evento_origen_id").range(from,to)),
      allPages((from:number,to:number)=>db.from("cerro_verde_pernoctes_validacion").select("evento_origen_id,entrega_sap,placa,codigo_tracto,limite_permitido,zona_detectada,propuesta_motor,cumple_final,observacion,validado_por,validado_en,snapshot").range(from,to)),
      allPages((from:number,to:number)=>db.from("cerro_verde_maestro_equipos").select("codigo_sap").range(from,to))
    ]);
    const validTractos=new Set((m||[]).map((x:any)=>norm(x.codigo_sap)).filter((x:string)=>x.startsWith("20-R")));
    const validations=new Map((v||[]).map((x:any)=>[String(x.evento_origen_id),x]));
    const by=new Map<string,any>();
    for(const r of [...h,...d])by.set(text(r.orden_carga),r.payload||{});
    const stops=loadedPernocteStops(s||[]),rows:any[]=[];
    for(const[ent,p]of by.entries()){
      const fechaDt=parseDate(p["FECHA DE CARGA"]);if(!fechaDt||fechaDt<PERNOCTE_INTERNAL_FROM)continue;
      const st=stopInLoadedLeg(stops.get(ent)||[],p);
      const tracto=text(p["CODIGO TRACTO"])||text(st?.codigo_tracto);
      if(!tracto||!validTractos.has(norm(tracto)))continue;
      const eventId=st?.evento_origen_id??null,saved=eventId!==null?validations.get(String(eventId)):null;
      const motorExpected=expectedStop(p["SALIDA DE CARACOTO"]),motorActual=stopName(st),motorProposal=compliance(motorExpected,motorActual,p);
      const eventStart=parseDate(st?.inicio),eventEnd=parseDate(st?.fin),validationAnchor=eventEnd||eventStart,requiresManual=!!st&&!!validationAnchor&&validationAnchor>=PERNOCTE_VALIDATION_FROM;
      const autoValid=motorProposal==="SI";
      const pending=requiresManual&&!saved&&!autoValid;
      const expected=saved?.limite_permitido||motorExpected;
      const actual=saved?.zona_detectada||motorActual;
      const proposal=saved?.propuesta_motor||motorProposal;
      const legacyFinal=proposal==="PENDIENTE VALIDACION"?"EVIDENCIA INSUFICIENTE":proposal;
      const final=saved?.cumple_final||(autoValid?"SI":pending?"PENDIENTE VALIDACION":legacyFinal);
      let obs=text(p.OBSERVACION),desc=text(st?.motivo);
      if(desc&&norm(desc)!==norm(actual))obs=[obs,desc].filter(Boolean).join(" / ");
      if(norm(expected)==="NO DEBIO CARGAR")obs=[obs,"SALIDA DESDE 22:00: FUERA DE VENTANA; DESDE ESTA HORA NO CARGA"].filter(Boolean).join(" / ");
      if(saved?.observacion)obs=[obs,text(saved.observacion)].filter(Boolean).join(" / ");
      rows.push({conductor:text(p.CONDUCTOR)||text(st?.conductor),tracto,fecha:p["FECHA DE CARGA"],fechaDt,salida:p["SALIDA DE CARACOTO"],llegada:p["INGRESO A SMCV"],expected,actual,cum:final,proposal,placa:text(p["PLACA TRACTO"]||p.PLACA)||text(st?.placa),ent,inicio:st?.inicio||"",fin:st?.fin||"",obs,event_id:eventId,pending,validado_en:saved?.validado_en||null,validado_por:saved?.validado_por||null});
    }
    rows.sort((a,b)=>(a.fechaDt?.getTime()||0)-(b.fechaDt?.getTime()||0)||a.ent.localeCompare(b.ent));
    return rows;
  }catch(e){throw Error(`PARADAS / PERNOCTES: ${errorText(e)}`)}
}
function pernocteRowsForMode(all:any[],mode:string){
  const cutoff=mode==="enviable"?PERNOCTE_ENVIABLE_FROM:PERNOCTE_INTERNAL_FROM;
  return all.filter((r:any)=>r.fechaDt&&r.fechaDt>=cutoff);
}

function pernocteDateKey(v:any){
  const d=parseDate(v);if(!d)return"";
  const z=(n:number)=>String(n).padStart(2,"0");
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth()+1)}-${z(d.getUTCDate())}`;
}
function pernocteDbTs(v:any){
  const d=parseDate(v);if(!d)return null;
  const z=(n:number)=>String(n).padStart(2,"0");
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth()+1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
}
function pernocteCycleKey(placa:any,salida:any){
  const d=parseDate(salida),p=norm(String(placa||"")).replace(/[^A-Z0-9]/g,"");
  if(!p||!d)return"";
  return p+"|"+d.toISOString().slice(0,19);
}
function pernoctePreviousDateKey(v:any){
  const d=parseDate(v);if(!d)return"";
  d.setUTCDate(d.getUTCDate()-1);
  return pernocteDateKey(d);
}
async function pernocteMasterRows(db:any){
  return allPages((from:number,to:number)=>db.from(PERNOCTE_MASTER_TABLE)
    .select("id,numero,conductor,codigo_tracto,fecha_carga,salida_caracoto,llegada_smcv,llegada_texto,destino_esperado,pernocto_en,cumplimiento,placa,inicio_pernocte,fin_pernocte,entrega_sap,evento_origen_id,fuente,clave_registro,bloqueado,creado_en,actualizado_en")
    .order("id").range(from,to));
}
async function syncPernocteMaster(db:any){
  const [all,master0]=await Promise.all([pernocteDataset(db),pernocteMasterRows(db)]);
  const today=localDatePE(),masterByKey=new Map<string,any>(),masterByEnt=new Map<string,any>();
  for(const m of master0){
    const k=pernocteCycleKey(m.placa,m.salida_caracoto);
    if(k)masterByKey.set(k,m);
    if(text(m.entrega_sap))masterByEnt.set(text(m.entrega_sap),m);
  }

  let nextNumero=Math.max(0,...master0.map((x:any)=>Number(x.numero)||0));
  const nuevos:any[]=[],pendientes:any[]=[],enProceso:any[]=[];
  const nowIso=()=>new Date().toISOString();

  const enviableFromKey="2026-09-09";
  for(const r of all){
    const salidaDt=parseDate(r.salida),salidaDate=pernocteDateKey(r.salida);
    if(!salidaDt||!salidaDate)continue;

    const key=pernocteCycleKey(r.placa,r.salida),ent=text(r.ent);
    const existing=(ent&&masterByEnt.get(ent))||(key&&masterByKey.get(key))||null;
    const llegadaDateEarly=pernocteDateKey(r.llegada);
    const mismoDiaEarly=!!llegadaDateEarly&&llegadaDateEarly===salidaDate;

    // Mismo día desde 09/09: SIN PERNOCTE + SI → entra al ENVIABLE (aunque sea anterior al corte operativo 21/09).
    if(salidaDate<PERNOCTE_NEW_FROM_DATE){
      if(!(mismoDiaEarly&&salidaDate>=enviableFromKey))continue;
      if(existing)continue;
      nextNumero++;
      const row={
        numero:nextNumero,conductor:r.conductor||"",codigo_tracto:r.tracto||"",
        fecha_carga:pernocteDateKey(r.fecha)||null,
        salida_caracoto:pernocteDbTs(r.salida),llegada_smcv:pernocteDbTs(r.llegada),llegada_texto:null,
        destino_esperado:"AREQUIPA",pernocto_en:"SIN PERNOCTE",cumplimiento:"SI",placa:r.placa||"",
        inicio_pernocte:null,fin_pernocte:null,entrega_sap:ent||null,evento_origen_id:null,
        fuente:"OPERATIVO_MISMO_DIA",clave_registro:"CICLO|"+(ent||key),bloqueado:true,actualizado_en:nowIso()
      };
      nuevos.push(row);if(key)masterByKey.set(key,row);if(ent)masterByEnt.set(ent,row);
      continue;
    }

    // Una salida del día actual todavía no ha atravesado una noche completa.
    if(salidaDate>=today){
      if(!existing)enProceso.push({...r,tipo_pendiente:"EN_PROCESO"});
      continue;
    }

    const llegadaDate=llegadaDateEarly;
    const mismoDia=mismoDiaEarly;
    const tienePernocte=!!(r.event_id&&parseDate(r.inicio)&&parseDate(r.fin));
    const decision=norm(r.cum);
    const eventStartDate=pernocteDateKey(r.inicio);
    const eventEndDate=pernocteDateKey(r.fin);
    const viajeAbierto=!parseDate(r.llegada);

    // Noche exigible:
    // - salida de hoy: EN PROCESO, todavía no exige pernocte;
    // - viaje abierto: exige la última noche completa, ayer -> hoy;
    // - viaje concluido con cambio de fecha: exige la última noche previa a la llegada.
    // Un pernocte de una noche anterior no satisface una noche posterior.
    const nocheFin=viajeAbierto?today:(!mismoDia&&llegadaDate&&llegadaDate>salidaDate?llegadaDate:"");
    const nocheInicio=nocheFin?pernoctePreviousDateKey(nocheFin):"";
    const pernocteNocheExigible=!!(nocheFin&&tienePernocte&&eventStartDate===nocheInicio&&eventEndDate===nocheFin);
    const faltaNocheActual=!!nocheFin&&!pernocteNocheExigible;

    if(existing){
      if(text(existing.fuente)==="CHECKPOINT_21_09_2026")continue;

      // Mismo día: forzar SIN PERNOCTE + SI en maestro (regla operativa ENVIABLE).
      if(mismoDia){
        const patch:any={actualizado_en:nowIso()};
        let changed=false;
        if(norm(existing.cumplimiento)!=="SI"||norm(existing.pernocto_en)!=="SIN PERNOCTE"){
          patch.pernocto_en="SIN PERNOCTE";
          patch.cumplimiento="SI";
          patch.destino_esperado=text(existing.destino_esperado)||"AREQUIPA";
          patch.inicio_pernocte=null;
          patch.fin_pernocte=null;
          patch.fuente="OPERATIVO_MISMO_DIA";
          changed=true;
        }
        const llegada=pernocteDbTs(r.llegada);
        if(llegada&&!existing.llegada_smcv){patch.llegada_smcv=llegada;patch.bloqueado=true;changed=true;}
        if(changed){
          const{error}=await db.from(PERNOCTE_MASTER_TABLE).update(patch).eq("id",existing.id);
          if(error)throw error;
          Object.assign(existing,patch);
        }
        continue;
      }

      // Resolución provisional por pérdida de información GPS.
      // No vuelve a bloquear hasta que el operador pulse REABRIR VALIDACIÓN.
      if(
        text(existing.fuente)==="OPERATIVO_SIN_REPORTE_GPS"
        &&
        norm(existing.cumplimiento)==="SIN REPORTE GPS"
      ){
        const llegada=pernocteDbTs(r.llegada);

        if(llegada&&!existing.llegada_smcv){
          const patch={
            llegada_smcv:llegada,
            bloqueado:true,
            actualizado_en:nowIso()
          };

          const{error}=await db
            .from(PERNOCTE_MASTER_TABLE)
            .update(patch)
            .eq("id",existing.id);

          if(error)throw error;

          Object.assign(existing,patch);
        }

        continue;
      }

      // Validación manual pendiente (tiene evento, aún sin SI/NO).
      if(tienePernocte&&(r.pending||!["SI","NO"].includes(decision))){
        pendientes.push({...r,pending:true,tipo_pendiente:"VALIDACION_MANUAL"});
        continue;
      }

      const patch:any={actualizado_en:nowIso()};
      let changed=false;
      const eventId=Number(r.event_id)||null;

      // Con SI/NO (o auto), congelar maestro aunque el evento ya estuviera asociado.
      // Antes solo actualizaba si cambiaba evento_origen_id → REABIERTO quedaba colgado.
      if(tienePernocte&&["SI","NO"].includes(decision)){
        if(
          eventId!==Number(existing.evento_origen_id||0)
          || norm(existing.cumplimiento)!==decision
          || text(existing.fuente)==="OPERATIVO_REABIERTO"
          || text(existing.fuente)==="OPERATIVO_SIN_REPORTE_GPS"
          || !existing.inicio_pernocte
        ){
          patch.destino_esperado=r.expected||"";
          patch.pernocto_en=r.actual||"";
          patch.cumplimiento=decision;
          patch.inicio_pernocte=pernocteDbTs(r.inicio);
          patch.fin_pernocte=pernocteDbTs(r.fin);
          patch.evento_origen_id=eventId;
          patch.fuente="OPERATIVO_DIARIO";
          changed=true;
        }
      }

      // Otra noche aún no cubierta: no bloquea la validación ya hecha; va a "sin registro".
      if(faltaNocheActual&&!["SI","NO"].includes(decision)){
        pendientes.push({...r,pending:true,tipo_pendiente:"FALTA_PERNOCTE",proposal:"FALTA PERNOCTE",cum:"FALTA PERNOCTE"});
        continue;
      }
      if(faltaNocheActual&&["SI","NO"].includes(decision)){
        // Ya validó un pernocte; si falta otra noche, el maestro queda con la validación
        // y el faltante se gestiona por pernoctes_sin_registro (no en cola SI/NO).
      }

      // La llegada completa el ciclo, pero no invalida el pernocte ya validado.
      const llegada=pernocteDbTs(r.llegada);
      if(llegada&&!existing.llegada_smcv){
        patch.llegada_smcv=llegada;
        patch.bloqueado=true;
        changed=true;
      }else if(!llegada&&existing.bloqueado!==false){
        patch.bloqueado=false;
        changed=true;
      }

      if(changed){
        const{error}=await db.from(PERNOCTE_MASTER_TABLE).update(patch).eq("id",existing.id);
        if(error)throw error;
        Object.assign(existing,patch);
      }
      continue;
    }

    // Si terminó el mismo día, no hubo noche que evaluar.
    if(mismoDia){
      nextNumero++;
      const row={
        numero:nextNumero,conductor:r.conductor||"",codigo_tracto:r.tracto||"",
        fecha_carga:pernocteDateKey(r.fecha)||null,
        salida_caracoto:pernocteDbTs(r.salida),llegada_smcv:pernocteDbTs(r.llegada),llegada_texto:null,
        destino_esperado:"AREQUIPA",pernocto_en:"SIN PERNOCTE",cumplimiento:"SI",placa:r.placa||"",
        inicio_pernocte:null,fin_pernocte:null,entrega_sap:ent||null,evento_origen_id:null,
        fuente:"OPERATIVO_MISMO_DIA",clave_registro:"CICLO|"+(ent||key),bloqueado:true,actualizado_en:nowIso()
      };
      nuevos.push(row);if(key)masterByKey.set(key,row);if(ent)masterByEnt.set(ent,row);
      continue;
    }

    if(faltaNocheActual||!tienePernocte){
      pendientes.push({...r,pending:true,tipo_pendiente:"FALTA_PERNOCTE",proposal:"FALTA PERNOCTE",cum:"FALTA PERNOCTE"});
      continue;
    }

    if(r.pending||!["SI","NO"].includes(decision)){
      pendientes.push({...r,pending:true,tipo_pendiente:"VALIDACION_MANUAL"});
      continue;
    }

    nextNumero++;
    const row={
      numero:nextNumero,conductor:r.conductor||"",codigo_tracto:r.tracto||"",
      fecha_carga:pernocteDateKey(r.fecha)||null,
      salida_caracoto:pernocteDbTs(r.salida),llegada_smcv:pernocteDbTs(r.llegada),llegada_texto:null,
      destino_esperado:r.expected||"",pernocto_en:r.actual||"",cumplimiento:decision,placa:r.placa||"",
      inicio_pernocte:pernocteDbTs(r.inicio),fin_pernocte:pernocteDbTs(r.fin),entrega_sap:ent||null,
      evento_origen_id:Number(r.event_id)||null,fuente:"OPERATIVO_DIARIO",
      clave_registro:"CICLO|"+(ent||key),bloqueado:!!parseDate(r.llegada),actualizado_en:nowIso()
    };
    nuevos.push(row);if(key)masterByKey.set(key,row);if(ent)masterByEnt.set(ent,row);
  }

  if(nuevos.length){
    const{error}=await db.from(PERNOCTE_MASTER_TABLE).insert(nuevos);
    if(error&&error.code!=="23505")throw error;
  }
  const master=await pernocteMasterRows(db);
  return{master,pendientes,en_proceso:enProceso,nuevos_agregados:nuevos.length};
}
async function pernocteMasterBook(db:any){
  const state=await syncPernocteMaster(db);
  // Solo bloquean SI/NO pendientes (con evento). FALTA_PERNOCTE se gestiona en "Sin registro"
  // y no impide exportar el maestro ya congelado desde 09/09/2026.
  const bloqueanValidacion=(state.pendientes||[]).filter((r:any)=>
    text(r.tipo_pendiente)!=="FALTA_PERNOCTE"
    && !["SI","NO"].includes(norm(r.cum))
    && !!(r.event_id||r.evento_origen_id)
  );
  if(bloqueanValidacion.length){
    throw Error(`Hay ${bloqueanValidacion.length} pernocte(s) pendientes de validación SI/NO. Valídelos en la pestaña Validación antes de generar el ENVIABLE.`);
  }
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet("Resumen",{views:[{state:"frozen",ySplit:1,showGridLines:false}]});
  ws.addRow(PER_HEADERS_ENVIABLE);const header=ws.getRow(1);header.height=36;header.eachCell((c:any)=>{c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.dark}`}};c.font={bold:true,color:{argb:`FF${COLORS.white}`},size:11};c.alignment={horizontal:"center",vertical:"middle",wrapText:true}});
  for(const r of state.master){
    const llegada=text(r.llegada_texto)||(r.llegada_smcv?excelDate(r.llegada_smcv):"");
    const row=ws.addRow([r.numero,r.conductor,r.codigo_tracto,r.fecha_carga?excelDate(r.fecha_carga,true):"",r.salida_caracoto?excelDate(r.salida_caracoto):"",llegada,r.destino_esperado,r.pernocto_en,r.cumplimiento,r.placa,r.inicio_pernocte?excelDate(r.inicio_pernocte):"",r.fin_pernocte?excelDate(r.fin_pernocte):""]);
    row.height=28;row.eachCell((c:any)=>{c.alignment={horizontal:"center",vertical:"middle",wrapText:true};c.font={color:{argb:`FF${COLORS.black}`},size:11}});
    if(row.getCell(4).value instanceof Date)row.getCell(4).numFmt="dd/mm/yyyy";
    for(const i of[5,6,11,12])if(row.getCell(i).value instanceof Date)row.getCell(i).numFmt="dd/mm/yyyy hh:mm:ss";
    const cc=row.getCell(9),vv=norm(cc.value);if(vv==="SI")cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.green}`}};else if(vv==="NO")cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.red}`}};else cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.yellow}`}};
  }
  [5,32,18,12,19,22,20,20,15,15,19,19].forEach((w,i)=>ws.getColumn(i+1).width=w);
  ws.autoFilter={from:"A1",to:`L${Math.max(2,ws.rowCount)}`};
  ws.pageSetup={orientation:"landscape",fitToWidth:1,fitToPage:true,margins:{left:.2,right:.2,top:.4,bottom:.4,header:.2,footer:.2}};
  return{bytes:new Uint8Array(await wb.xlsx.writeBuffer()),count:state.master.length,en_proceso:state.en_proceso.length};
}

async function pernocteBook(db:any,mode="revision"){
  if(mode==="enviable")return pernocteMasterBook(db);
  const all=await pernocteDataset(db),rows=pernocteRowsForMode(all,mode);
  if(mode==="enviable"){
    const pending=rows.filter((r:any)=>r.pending);
    if(pending.length)throw Error(`Hay ${pending.length} pernocte(s) nuevo(s) pendientes de validación. Valídelos antes de generar el ENVIABLE.`);
  }
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet("Resumen",{views:[{state:"frozen",ySplit:1,showGridLines:false}]});
  ws.addRow(PER_HEADERS);const header=ws.getRow(1);header.height=36;header.eachCell((c:any)=>{c.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.dark}`}};c.font={bold:true,color:{argb:`FF${COLORS.white}`},size:11};c.alignment={horizontal:"center",vertical:"middle",wrapText:true}});
  let n=0;
  for(const r of rows){
    const row=ws.addRow([++n,r.conductor,r.tracto,excelDate(r.fecha,true),excelDate(r.salida),excelDate(r.llegada),r.expected,r.actual,r.cum,r.placa,r.ent,r.inicio?excelDate(r.inicio):"",r.fin?excelDate(r.fin):"",r.obs]);
    row.height=28;row.eachCell((c:any,i:number)=>{c.alignment={horizontal:i===14?"left":"center",vertical:"middle",wrapText:true};c.font={color:{argb:`FF${[7,8,9,14].includes(i)?COLORS.black:COLORS.greenText}`},size:11}});
    for(const i of[4])if(row.getCell(i).value instanceof Date)row.getCell(i).numFmt="dd/mm/yyyy";
    for(const i of[5,6,12,13])if(row.getCell(i).value instanceof Date)row.getCell(i).numFmt="dd/mm/yyyy hh:mm:ss";
    const cc=row.getCell(9),vv=norm(cc.value);if(vv==="SI")cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.green}`}};else if(vv==="NO")cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.red}`}};else cc.fill={type:"pattern",pattern:"solid",fgColor:{argb:`FF${COLORS.yellow}`}};
  }
  [5,32,18,12,19,19,24,20,18,15,17,19,19,42].forEach((w,i)=>ws.getColumn(i+1).width=w);ws.autoFilter={from:"A1",to:`N${Math.max(2,ws.rowCount)}`};ws.pageSetup={orientation:"landscape",fitToWidth:1,fitToPage:true,margins:{left:.2,right:.2,top:.4,bottom:.4,header:.2,footer:.2}};
  return{bytes:new Uint8Array(await wb.xlsx.writeBuffer()),count:rows.length};
}
async function rawBook(origin:string,data:any[]){const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(origin);ws.addRow(RAW_HEADERS);for(const r of data){const p=r.payload||{};ws.addRow(RAW_HEADERS.map(h=>p[h]??""))}ws.views=[{state:"frozen",ySplit:1}];ws.autoFilter={from:"A1",to:{row:1,column:RAW_HEADERS.length}};ws.getRow(1).eachCell((c:any)=>{c.font={bold:true,color:{argb:"FFFFFFFF"}};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1F4E78"}};c.alignment={vertical:"middle",horizontal:"center",wrapText:true}});ws.columns.forEach((c:any)=>c.width=18);return new Uint8Array(await wb.xlsx.writeBuffer())}
async function sendXlsx(req:Request,db:any,user:any,bytes:Uint8Array,name:string,service:string){await db.from("app_egress_log").insert({itinerario:IT,servicio:service,bytes:bytes.byteLength,usuario:user.email});return new Response(bytes,{headers:{...cors(req),"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":`attachment; filename="${name}"`}})}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return responseJson(req,{ok:true});
  if(req.method!=="POST")return responseJson(req,{error:"Método no permitido"},405);
  try{
    const{db,user}=await secure(req),b=await req.json(),action=text(b.action);
    if(action==="paradas_estado"){
      const [all,state]=await Promise.all([
        pernocteDataset(db),
        syncPernocteMaster(db)
      ]);

      const revision=
        pernocteRowsForMode(
          all,
          "revision"
        );

      // Cola SI/NO: solo VALIDACION_MANUAL (con evento). FALTA_PERNOCTE va a "Sin registro".
      const pending=[
        ...state.pendientes
      ]
        .filter(
          (r:any)=>
            text(r.tipo_pendiente)!=="FALTA_PERNOCTE"
            &&
            !!(r.event_id||r.evento_origen_id)
            &&
            (r.pending!==false)
            &&
            !["SI","NO"].includes(norm(r.cum))
        )
        .sort(
          (a:any,b:any)=>
            (
              parseDate(b.inicio)?.getTime()
              ||
              parseDate(b.salida)?.getTime()
              ||
              0
            )
            -
            (
              parseDate(a.inicio)?.getTime()
              ||
              parseDate(a.salida)?.getTime()
              ||
              0
            )
        );

      const sinGps=[
        ...state.master
      ]
        .filter(
          (r:any)=>
            norm(r.cumplimiento)
              ===
              "SIN REPORTE GPS"
            &&
            text(r.fuente)
              ===
              "OPERATIVO_SIN_REPORTE_GPS"
        )
        .sort(
          (a:any,b:any)=>
            new Date(
              b.actualizado_en||0
            ).getTime()
            -
            new Date(
              a.actualizado_en||0
            ).getTime()
        );

      return responseJson(
        req,
        {
          pernoctes_revision:
            revision.length,

          pernoctes_enviable:
            state.master.length,

          pernoctes_pendientes:
            pending.length,

          pernoctes_en_proceso:
            state.en_proceso.length,

          pernoctes_enviable_desde:
            "CHECKPOINT 21/09/2026",

          pendientes:
            pending.map(
              (r:any)=>({
                tipo_pendiente:
                  r.tipo_pendiente
                  ||
                  "VALIDACION_MANUAL",

                evento_origen_id:
                  r.event_id||null,

                entrega_sap:
                  r.ent,

                placa:
                  r.placa,

                codigo_tracto:
                  r.tracto,

                conductor:
                  r.conductor,

                fecha_carga:
                  r.fecha,

                salida_caracoto:
                  r.salida,

                llegada_smcv:
                  r.llegada,

                inicio:
                  r.inicio,

                fin:
                  r.fin,

                limite_permitido:
                  r.expected,

                zona_detectada:
                  r.actual,

                propuesta_motor:
                  r.proposal,

                observacion:
                  r.obs
              })
            ),

          sin_reporte_gps:
            sinGps.map(
              (r:any)=>({
                id:r.id,
                numero:r.numero,
                conductor:r.conductor,
                codigo_tracto:r.codigo_tracto,
                placa:r.placa,
                entrega_sap:r.entrega_sap,
                salida_caracoto:r.salida_caracoto,
                llegada_smcv:r.llegada_smcv,
                limite_permitido:r.destino_esperado,
                pernocto_en:r.pernocto_en,
                cumplimiento:r.cumplimiento,
                actualizado_en:r.actualizado_en
              })
            )
        }
      );
    }
    if(action==="pernoctes_sin_registro"){
      // Regla limpia (post-punto-base):
      // - Con SALIDA DE CARACOTO, el pernocte es EXIGIBLE desde las 06:30 del día siguiente (Lima),
      //   aunque aún no exista INGRESO A SMCV (sigue en tránsito pero ya debió pernoctar).
      // - Antes de ese umbral: no listar (aún en tránsito; no se afirma "sin pernocte").
      // - Llegada SMCV es opcional en listado; se puede editar al registrar.
      const all=await pernocteDataset(db);
      const nowMs=peNowUtcMs();
      const faltantes:any[]=[];
      for(const r of all){
        const salidaDt=parseDate(r.salida);
        if(!salidaDt)continue;
        const salidaDate=pernocteDateKey(r.salida);
        if(!salidaDate)continue;
        const umbral=pernocteExigibleDesde(r.salida);
        if(umbral==null||nowMs<umbral)continue; // aún no evaluable
        const llegadaDate=pernocteDateKey(r.llegada);
        // Mismo día salida+llegada: no requiere pernocte (nunca listar)
        if(llegadaDate&&llegadaDate===salidaDate)continue;
        const tienePernocte=!!(r.event_id&&parseDate(r.inicio)&&parseDate(r.fin));
        if(tienePernocte)continue;
        // Ventana GPS: 20:00 día salida → 08:00 día llegada (si hay) o 08:00 día siguiente a salida
        const [ys,ms,ds]=salidaDate.split("-");
        const z=(n:string)=>String(n).padStart(2,"0");
        const desdeGps=`${z(ds)}/${z(ms)}/${ys} 20:00:00`;
        let hastaGps:string;
        if(llegadaDate){
          const [yl,ml,dl]=llegadaDate.split("-");
          hastaGps=`${z(dl)}/${z(ml)}/${yl} 08:00:00`;
        }else{
          // día siguiente a salida 08:00
          const next=new Date(Date.UTC(+ys,+ms-1,+ds+1,8,0,0));
          hastaGps=`${z(String(next.getUTCDate()))}/${z(String(next.getUTCMonth()+1))}/${next.getUTCFullYear()} 08:00:00`;
        }
        const umbralFmt=(()=>{
          const u=new Date(umbral!);
          const zz=(n:number)=>String(n).padStart(2,"0");
          return `${zz(u.getUTCDate())}/${zz(u.getUTCMonth()+1)}/${u.getUTCFullYear()} 06:30:00`;
        })();
        faltantes.push({
          entrega_sap:r.ent,
          placa:r.placa,
          codigo_tracto:r.tracto,
          conductor:r.conductor,
          fecha_carga:fmtLocal(r.fecha)||text(r.fecha),
          salida_caracoto:fmtLocal(r.salida)||text(r.salida),
          llegada_smcv:r.llegada?(fmtLocal(r.llegada)||text(r.llegada)):"",
          llegada_smcv_editable:true,
          sin_llegada_smcv:!r.llegada,
          salida_fecha:salidaDate,
          llegada_fecha:llegadaDate||"",
          exigible_desde:umbralFmt,
          tiene_pernocte_registrado:false,
          tiene_pernocte_validado:!!r.validado_en,
          ventana_gps_desde:desdeGps,
          ventana_gps_hasta:hastaGps,
          motivo:r.llegada?"CAMBIO_DE_DIA_SIN_PERNOCTE_REGISTRADO":"EXIGIBLE_SIN_LLEGADA_SMCV",
        });
      }
      faltantes.sort((a,b)=>(parseDate(b.salida_caracoto)?.getTime()||0)-(parseDate(a.salida_caracoto)?.getTime()||0));
      return responseJson(req,{
        ok:true,
        total:faltantes.length,
        regla:"Exigible desde 06:30 del día siguiente a SALIDA DE CARACOTO (Lima). Mismo día salida+llegada SMCV = no requiere pernocte. Sin llegada aún sí puede listar tras el umbral",
        ventana:"20:00 día salida → 08:00 día llegada (o día siguiente si aún no hay llegada)",
        items:faltantes,
      });
    }
    if(action==="pernocte_registrar"){
      // Registrar pernocte faltante sobre una entrega (DIARIO o HISTÓRICO).
      const entrega=text(b.entrega_sap);
      if(!entrega)throw Error("Falta entrega SAP");
      const c=b.parada||{};
      const tipo=text(c.tipo||"PERNOCTE").toUpperCase()||"PERNOCTE";
      if(tipo!=="PERNOCTE")throw Error("Solo se registran PERNOCTE desde este módulo");
      const ini=parseDate(c.inicio),fin=parseDate(c.fin);
      if(!ini||!fin||fin<=ini)throw Error("Rango de pernocte inválido");
      const min=Number(c.duracion_min||((fin.getTime()-ini.getTime())/60000));
      if(!(min>240))throw Error("El pernocte debe ser mayor a 4 horas");
      const dayIni=ini.toISOString().slice(0,10),dayFin=fin.toISOString().slice(0,10);
      if(dayIni===dayFin)throw Error("El pernocte debe cambiar de fecha");
      // Buscar despacho en DIARIO o HISTÓRICO
      let row:any=null;
      for(const origen of ["DIARIO","HISTORICO"]){
        const{data,error}=await db.from("seguimiento_staging")
          .select("id,orden_carga,payload,origen")
          .eq("itinerario",IT).eq("origen",origen).eq("orden_carga",entrega).maybeSingle();
        if(error)throw error;
        if(data){row=data;break;}
      }
      if(!row)throw Error(`No se encontró la entrega ${entrega} en DIARIO/HISTÓRICO`);
      // Llegada SMCV editable: evita conflicto al cerrar sin haber registrado ingreso
      const llegadaIn=text(b.llegada_smcv);
      if(llegadaIn){
        const llegadaFmt=fmtLocal(llegadaIn)||llegadaIn;
        const payload0={...(row.payload||{})};
        payload0["INGRESO A SMCV"]=llegadaFmt;
        const{error:ue}=await db.from("seguimiento_staging")
          .update({payload:payload0})
          .eq("id",row.id);
        if(ue)throw ue;
        row.payload=payload0;
      }
      const isoLocal=(v:any)=>{
        // Canónico interno: yyyy-mm-dd hh:mm:ss (acepta dd/mm y yyyy-mm)
        const d=parseDate(v);
        if(!d)return text(v);
        const z=(n:number)=>String(n).padStart(2,"0");
        return `${d.getUTCFullYear()}-${z(d.getUTCMonth()+1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
      };
      const inicioIso=isoLocal(c.inicio),finIso=isoLocal(c.fin);
      const{data:existing,error:ee}=await db.from("cerro_verde_eventos_paradas")
        .select("evento_origen_id,payload").eq("tipo","PERNOCTE").eq("entrega_sap",entrega).limit(200);
      if(ee)throw ee;
      const dup=(existing||[]).find((x:any)=>text(x.payload?.inicio)===inicioIso&&text(x.payload?.fin)===finIso);
      if(dup)return responseJson(req,{ok:true,ya_registrado:true,id:dup.evento_origen_id,payload:dup.payload});
      const eid=Date.now()*1000+crypto.getRandomValues(new Uint32Array(1))[0]%1000;
      const p=row.payload||{};
      const geocerca=text(c.geocerca)||"FUERA DE GEOCERCA";
      const payload={
        id:eid,
        tipo_parada:"PERNOCTE",
        motivo:text(c.descripcion)||`DESCANSO / PERNOCTE - ${geocerca}`,
        entrega,
        placa:text(p["PLACA TRACTO"]||p.PLACA||b.placa),
        licencia:text(p.LICENCIA),
        conductor:text(p.CONDUCTOR||b.conductor),
        codigo_tracto:text(p["CODIGO TRACTO"]||b.codigo_tracto),
        placa_completa:text(p.PLACA||p["PLACA TRACTO"]||b.placa),
        codigo_carreta:text(p["CODIGO CARRETA"]),
        fecha_carga:text(p["FECHA DE CARGA"]||b.fecha_carga),
        inicio:inicioIso,
        fin:finIso,
        duracion_min:Math.round(min*10)/10,
        lat:Number(c.lat)||null,
        lng:Number(c.lng)||null,
        geocerca,
        fuente:"PARADAS_SIN_REGISTRO",
      };
      const{error:ie}=await db.from("cerro_verde_eventos_paradas").insert({
        evento_origen_id:eid,tipo:"PERNOCTE",entrega_sap:entrega,payload,actualizado_en:new Date().toISOString()
      });
      if(ie)throw ie;
      return responseJson(req,{ok:true,id:eid,payload,origen_despacho:row.origen,llegada_smcv_actualizada:!!text(b.llegada_smcv)});
    }
    if(action==="actualizar_llegada_smcv"){
      const entrega=text(b.entrega_sap);
      const llegadaIn=text(b.llegada_smcv);
      if(!entrega)throw Error("Falta entrega SAP");
      if(!llegadaIn)throw Error("Indique la llegada a SMCV");
      const llegadaFmt=fmtLocal(llegadaIn)||llegadaIn;
      if(!parseDate(llegadaFmt))throw Error("Fecha de llegada a SMCV inválida");
      let row:any=null;
      for(const origen of ["DIARIO","HISTORICO"]){
        const{data,error}=await db.from("seguimiento_staging")
          .select("id,orden_carga,payload,origen")
          .eq("itinerario",IT).eq("origen",origen).eq("orden_carga",entrega).maybeSingle();
        if(error)throw error;
        if(data){row=data;break;}
      }
      if(!row)throw Error(`No se encontró la entrega ${entrega}`);
      const payload0={...(row.payload||{})};
      const prev=text(payload0["INGRESO A SMCV"]);
      payload0["INGRESO A SMCV"]=llegadaFmt;
      const{error:ue}=await db.from("seguimiento_staging").update({payload:payload0}).eq("id",row.id);
      if(ue)throw ue;
      return responseJson(req,{ok:true,entrega_sap:entrega,origen:row.origen,llegada_smcv:llegadaFmt,anterior:prev||null});
    }

    if(action==="convoy_datos"){
      const[masters,convoy]=await Promise.all([convoyMasters(db),convoyRows(db)]);
      return responseJson(req,{convoy,tractos:masters.tractos,carretas:masters.carretas,conductores:masters.conductores,fecha_operativa:localDatePE()});
    }
    if(action==="convoy_guardar"){
      const filas=Array.isArray(b.filas)?b.filas.slice(0,10):[],masters=await convoyMasters(db),findEquipment=equipmentLookup(masters.equipment),driversByName=new Map(masters.drivers.map((x:any)=>[norm(x.conductor),x])),driversByLicense=new Map(masters.drivers.map((x:any)=>[norm(x.licencia),x])),fecha=localDatePE(),now=new Date().toISOString(),payload:any[]=[];let occupied=0;
      const asTs=(v:any,pos:number,label:string)=>{const s=text(v);if(!s)return null;const d=parseDate(s);if(!d)throw Error(`Posición ${pos}: ${label} no tiene fecha/hora válida`);return d.toISOString()};
      for(let pos=1;pos<=10;pos++){
        const src=filas.find((x:any)=>Number(x?.posicion)===pos)||filas[pos-1]||{},tractRaw=text(src.codigo_tracto||src.placa_tracto),trailerRaw=text(src.codigo_carreta||src.placa_carreta),driverRaw=text(src.conductor||src.licencia),hasContent=!!(tractRaw||trailerRaw||driverRaw||text(src.hito_1)||text(src.hito_2)||text(src.hito_3)||text(src.hito_4)||text(src.estado)||text(src.monitoreo)||text(src.observacion));
        if(hasContent&&!tractRaw)throw Error(`Posición ${pos}: seleccione un tracto del Maestro`);
        const tract=tractRaw?findEquipment(tractRaw):null;if(tractRaw&&(!tract||!/^20-R-/i.test(tract.codigo_sap)))throw Error(`Posición ${pos}: tracto no válido en Maestro`);
        const trailer=trailerRaw?findEquipment(trailerRaw):null;if(trailerRaw&&(!trailer||!/^20-(T|P)-/i.test(trailer.codigo_sap)))throw Error(`Posición ${pos}: carreta no válida en Maestro`);
        const driver:any=driverRaw?(driversByName.get(norm(driverRaw))||driversByLicense.get(norm(driverRaw))):null;if(driverRaw&&!driver)throw Error(`Posición ${pos}: conductor no válido en Maestro`);
        if(tract)occupied++;
        payload.push({posicion:pos,conductor:driver?text(driver.conductor):null,licencia:driver?text(driver.licencia):null,codigo_tracto:tract?text(tract.codigo_sap):null,placa_tracto:tract?tract.placa:null,codigo_carreta:trailer?text(trailer.codigo_sap):null,placa_carreta:trailer?trailer.placa:null,hito_1:asTs(src.hito_1,pos,"HITO 1"),hito_2:asTs(src.hito_2,pos,"HITO 2"),hito_3:asTs(src.hito_3,pos,"HITO 3"),hito_4:asTs(src.hito_4,pos,"HITO 4"),estado:text(src.estado)||null,monitoreo:text(src.monitoreo)||null,observacion:text(src.observacion)||null,fecha_operativa:fecha,actualizado_en:now});
      }
      const{error}=await db.from("cerro_verde_convoy_diario").upsert(payload,{onConflict:"posicion"});if(error)throw error;
      return responseJson(req,{ok:true,ocupadas:occupied,mensaje:`Convoy guardado: ${occupied}/10 posiciones para ${fecha}.`});
    }
    if(action==="estado"){
      const[op,control,per,allPernoctes]=await Promise.all([
        operational(db),
        db.from("cemento_reporte_control").select("estado,total_placas,revisadas,completado_en").eq("itinerario",IT).maybeSingle(),
        trackingRows(db,"DIARIO"),
        pernocteDataset(db)
      ]);
      if(control.error)throw control.error;
      const enabled=control.data?.estado==="COMPLETO"&&control.data?.total_placas===control.data?.revisadas&&Number(control.data?.total_placas)===op.rows.length;
      const revision=pernocteRowsForMode(allPernoctes,"revision"),masterState=await syncPernocteMaster(db);
      return responseJson(req,{habilitado:enabled,mensaje:enabled?"Seguimiento completo y población operativa validada":`Seguimiento pendiente: ${control.data?.revisadas||0}/${op.rows.length} placas revisadas`,diario:per.length,unidades_reporte:op.rows.length,cal_vacio:op.vacio.length,cal_cargado:op.cargado.length,pernoctes_revision:revision.length,pernoctes_enviable:masterState.master.length,pernoctes_pendientes:masterState.pendientes.length,pernoctes_en_proceso:masterState.en_proceso.length,pernoctes_enviable_desde:"CHECKPOINT 21/09/2026",...control.data});
    }
    if(action==="pernoctes_pendientes"){
      const state=await syncPernocteMaster(db),rows=[...state.pendientes].sort((a:any,b:any)=>(parseDate(b.inicio)?.getTime()||parseDate(b.salida)?.getTime()||0)-(parseDate(a.inicio)?.getTime()||parseDate(a.salida)?.getTime()||0));
      return responseJson(req,{pendientes:rows.map((r:any)=>({tipo_pendiente:r.tipo_pendiente||"VALIDACION_MANUAL",evento_origen_id:r.event_id||null,entrega_sap:r.ent,placa:r.placa,codigo_tracto:r.tracto,conductor:r.conductor,fecha_carga:r.fecha,salida_caracoto:r.salida,llegada_smcv:r.llegada,inicio:r.inicio,fin:r.fin,limite_permitido:r.expected,zona_detectada:r.actual,propuesta_motor:r.proposal,observacion:r.obs})),en_proceso:state.en_proceso.length});
    }
    if(action==="validar_pernoctes_lote"){
      const items=
        Array.isArray(b.validaciones)
          ?b.validaciones.slice(0,200)
          :[];

      if(!items.length)
        throw Error(
          "No hay validaciones seleccionadas"
        );

      const all=
        await pernocteDataset(db);

      const byEvent=
        new Map(
          all
            .filter(
              (r:any)=>
                r.event_id!==null
                &&
                r.event_id!==undefined
            )
            .map(
              (r:any)=>[
                Number(r.event_id),
                r
              ]
            )
        );

      const byEnt=
        new Map<string,any>();

      for(const r of all){
        const ent=text(r.ent);

        if(ent)
          byEnt.set(ent,r);
      }

      const normalIds=[
        ...new Set(
          items
            .filter(
              (x:any)=>
                norm(x?.cumple_final)
                !==
                "SIN REPORTE GPS"
            )
            .map(
              (x:any)=>
                Number(
                  x?.evento_origen_id
                )
            )
            .filter(
              (x:number)=>
                Number.isFinite(x)
                &&
                x>0
            )
        )
      ];

      const already=
        new Set<number>();

      if(normalIds.length){
        const{
          data:existing,
          error:ee
        }=
          await db
            .from(
              "cerro_verde_pernoctes_validacion"
            )
            .select(
              "evento_origen_id"
            )
            .in(
              "evento_origen_id",
              normalIds
            );

        if(ee)throw ee;

        for(const x of existing||[])
          already.add(
            Number(x.evento_origen_id)
          );
      }

      const master0=
        await pernocteMasterRows(db);

      const masterByEnt=
        new Map<string,any>();

      const masterByKey=
        new Map<string,any>();

      for(const m of master0){
        const ent=
          text(m.entrega_sap);

        const key=
          pernocteCycleKey(
            m.placa,
            m.salida_caracoto
          );

        if(ent)
          masterByEnt.set(ent,m);

        if(key)
          masterByKey.set(key,m);
      }

      let nextNumero=
        Math.max(
          0,
          ...master0.map(
            (x:any)=>
              Number(x.numero)||0
          )
        );

      const payloads:any[]=[];
      const masterInserts:any[]=[];
      const masterUpdates:any[]=[];

      let automaticas=0;
      let manuales=0;
      let sinReporteGps=0;

      for(const item of items){

        const requested=
          norm(item?.cumple_final);

        const eventId=
          Number(item?.evento_origen_id);

        const hasEvent=
          Number.isFinite(eventId)
          &&
          eventId>0;

        let row=
          hasEvent
            ?byEvent.get(eventId)
            :null;

        if(
          !row
          &&
          text(item?.entrega_sap)
        ){
          row=
            byEnt.get(
              text(item.entrega_sap)
            );
        }

        // SIN REPORTE GPS
        if(
          requested
          ===
          "SIN REPORTE GPS"
        ){
          if(!row)
            throw Error(
              `No se pudo identificar el ciclo SIN REPORTE GPS para la entrega ${text(item?.entrega_sap)||"—"}`
            );

          const ent=
            text(row.ent);

          const key=
            pernocteCycleKey(
              row.placa,
              row.salida
            );

          const existingMaster=
            (
              ent
              &&
              masterByEnt.get(ent)
            )
            ||
            (
              key
              &&
              masterByKey.get(key)
            )
            ||
            null;

          const patch:any={
            conductor:
              row.conductor||"",

            codigo_tracto:
              row.tracto||"",

            fecha_carga:
              pernocteDateKey(row.fecha)
              ||
              null,

            salida_caracoto:
              pernocteDbTs(row.salida),

            llegada_smcv:
              pernocteDbTs(row.llegada),

            llegada_texto:
              null,

            destino_esperado:
              row.expected||"",

            pernocto_en:
              text(row.actual)
              ||
              "SIN REGISTRO",

            cumplimiento:
              "SIN REPORTE GPS",

            placa:
              row.placa||"",

            inicio_pernocte:
              null,

            fin_pernocte:
              null,

            entrega_sap:
              ent||null,

            // Se deja NULL a propósito.
            // Al reabrir, una evidencia GPS real podrá reemplazarlo.
            evento_origen_id:
              null,

            fuente:
              "OPERATIVO_SIN_REPORTE_GPS",

            clave_registro:
              "CICLO|"
              +
              (
                ent
                ||
                key
              ),

            bloqueado:
              !!parseDate(row.llegada),

            actualizado_en:
              new Date().toISOString()
          };

          if(existingMaster){

            if(
              text(existingMaster.fuente)
              ===
              "CHECKPOINT_21_09_2026"
            ){
              throw Error(
                `La entrega ${ent||"—"} pertenece al checkpoint histórico y no será modificada automáticamente`
              );
            }

            masterUpdates.push({
              id:existingMaster.id,
              patch
            });

          }else{

            nextNumero++;

            masterInserts.push({
              numero:nextNumero,
              ...patch
            });
          }

          sinReporteGps++;
          continue;
        }

        // SI / NO siguen utilizando la validación actual
        if(!hasEvent)
          throw Error(
            `El caso ${text(item?.entrega_sap)||"—"} no tiene evidencia GPS para seleccionar SI o NO. Use SIN REPORTE GPS.`
          );

        if(already.has(eventId))
          continue;

        row=byEvent.get(eventId);

        if(!row)
          throw Error(
            `El pernocte ${eventId} ya no pertenece al universo operativo de CERRO VERDE`
          );

        const zonaOriginal=
          text(row.actual);

        const zonaCorregida=
          text(item?.zona_detectada)
          ||
          zonaOriginal;

        const auto=
          compliance(
            row.expected,
            zonaCorregida,
            {}
          )
          ===
          "SI";

        const decision=
          auto
            ?"SI"
            :requested;

        if(
          !["SI","NO"].includes(decision)
        ){
          throw Error(
            `Falta seleccionar SI o NO para el pernocte ${eventId}`
          );
        }

        const obs=
          text(
            item?.observacion
          ).slice(
            0,
            1200
          );

        if(auto)
          automaticas++;
        else
          manuales++;

        payloads.push({
          evento_origen_id:eventId,
          entrega_sap:row.ent,
          placa:row.placa,
          codigo_tracto:row.tracto,
          limite_permitido:row.expected,
          zona_detectada:zonaCorregida,
          propuesta_motor:
            auto
              ?"SI"
              :row.proposal,
          cumple_final:decision,
          observacion:obs,
          validado_por:user.email,
          snapshot:{
            fecha_carga:row.fecha,
            salida_caracoto:row.salida,
            llegada_smcv:row.llegada,
            inicio:row.inicio,
            fin:row.fin,
            conductor:row.conductor,
            zona_detectada_original:
              zonaOriginal,
            zona_detectada_corregida:
              zonaCorregida
          }
        });
      }

      if(payloads.length){
        const{
          error:ie
        }=
          await db
            .from(
              "cerro_verde_pernoctes_validacion"
            )
            .insert(payloads);

        if(ie)throw ie;

        // Actualizar maestro de inmediato (no depender solo de sync).
        for(const pl of payloads){
          const ent=text(pl.entrega_sap);
          if(!ent)continue;
          const{data:masters,error:me}=await db
            .from(PERNOCTE_MASTER_TABLE)
            .select("id")
            .eq("entrega_sap",ent)
            .limit(5);
          if(me)throw me;
          const snap=pl.snapshot||{};
          const patch={
            cumplimiento:text(pl.cumple_final),
            pernocto_en:text(pl.zona_detectada)||"",
            destino_esperado:text(pl.limite_permitido)||"",
            evento_origen_id:Number(pl.evento_origen_id)||null,
            inicio_pernocte:pernocteDbTs(snap.inicio),
            fin_pernocte:pernocteDbTs(snap.fin),
            fuente:"OPERATIVO_DIARIO",
            actualizado_en:new Date().toISOString(),
          };
          for(const m of masters||[]){
            const{error:ue}=await db.from(PERNOCTE_MASTER_TABLE).update(patch).eq("id",m.id);
            if(ue)throw ue;
          }
        }
      }

      if(masterInserts.length){
        const{
          error:mi
        }=
          await db
            .from(
              PERNOCTE_MASTER_TABLE
            )
            .insert(masterInserts);

        if(mi)throw mi;
      }

      for(const u of masterUpdates){
        const{
          error:mu
        }=
          await db
            .from(
              PERNOCTE_MASTER_TABLE
            )
            .update(u.patch)
            .eq("id",u.id);

        if(mu)throw mu;
      }

      await syncPernocteMaster(db);

      return responseJson(
        req,
        {
          ok:true,

          guardadas:
            payloads.length
            +
            masterInserts.length
            +
            masterUpdates.length,

          automaticas,
          manuales,

          sin_reporte_gps:
            sinReporteGps,

          ya_validadas:
            already.size
        }
      );
    }

    if(action==="reabrir_pernocte_sin_gps"){
      const id=
        Number(b.id);

      if(
        !Number.isFinite(id)
        ||
        id<=0
      ){
        throw Error(
          "Caso SIN REPORTE GPS inválido"
        );
      }

      const{
        data:row,
        error:re
      }=
        await db
          .from(
            PERNOCTE_MASTER_TABLE
          )
          .select(
            "id,cumplimiento,fuente,entrega_sap,placa,salida_caracoto"
          )
          .eq("id",id)
          .maybeSingle();

      if(re)throw re;

      if(!row)
        throw Error(
          "El caso ya no existe"
        );

      if(
        norm(row.cumplimiento)
        !==
        "SIN REPORTE GPS"
      ){
        throw Error(
          "Este caso ya no está marcado SIN REPORTE GPS"
        );
      }

      if(
        text(row.fuente)
        !==
        "OPERATIVO_SIN_REPORTE_GPS"
      ){
        throw Error(
          "Este registro no corresponde a una validación provisional reabrible"
        );
      }

      const{
        error:ue
      }=
        await db
          .from(
            PERNOCTE_MASTER_TABLE
          )
          .update({
            cumplimiento:
              "REABIERTO",

            fuente:
              "OPERATIVO_REABIERTO",

            actualizado_en:
              new Date().toISOString()
          })
          .eq("id",id);

      if(ue)throw ue;

      const state=
        await syncPernocteMaster(db);

      return responseJson(
        req,
        {
          ok:true,
          id,
          pendientes:
            state.pendientes.length
        }
      );
    }


    if(action==="validar_pernocte"){
      const eventId=Number(b.evento_origen_id),decision=norm(b.cumple_final),obs=text(b.observacion).slice(0,1200);
      if(!Number.isFinite(eventId)||eventId<=0)throw Error("Pernocte inválido");
      if(!["SI","NO"].includes(decision))throw Error("La validación final debe ser SI o NO");
      const{data:old,error:oe}=await db.from("cerro_verde_pernoctes_validacion").select("evento_origen_id,cumple_final,validado_en").eq("evento_origen_id",eventId).maybeSingle();if(oe)throw oe;
      if(old)return responseJson(req,{ok:true,ya_validado:true,...old});
      const all=await pernocteDataset(db),row=all.find((x:any)=>Number(x.event_id)===eventId);
      if(!row)throw Error("El pernocte ya no pertenece al universo operativo de CERRO VERDE");
      if(!row.pending)throw Error("Este pernocte no requiere una nueva validación");
      const payload={evento_origen_id:eventId,entrega_sap:row.ent,placa:row.placa,codigo_tracto:row.tracto,limite_permitido:row.expected,zona_detectada:row.actual,propuesta_motor:row.proposal,cumple_final:decision,observacion:obs,validado_por:user.email,snapshot:{fecha_carga:row.fecha,salida_caracoto:row.salida,llegada_smcv:row.llegada,inicio:row.inicio,fin:row.fin,conductor:row.conductor}};
      const{error:ie}=await db.from("cerro_verde_pernoctes_validacion").insert(payload);if(ie)throw ie;
      await syncPernocteMaster(db);
      return responseJson(req,{ok:true,cumple_final:decision,evento_origen_id:eventId});
    }
    if(action==="excel"){
      const op=await operational(db),{data:ctl,error:ce}=await db.from("cemento_reporte_control").select("estado,total_placas,revisadas").eq("itinerario",IT).maybeSingle();if(ce)throw ce;
      if(!(ctl?.estado==="COMPLETO"&&Number(ctl.total_placas)===op.rows.length&&Number(ctl.revisadas)===op.rows.length))throw Error(`Seguimiento pendiente: ${ctl?.revisadas||0}/${op.rows.length} placas revisadas`);
      const r=await operationalBook(db);return sendXlsx(req,db,user,r.bytes,"REPORTE_DIARIO_CERRO_VERDE.xlsx","REPORTE_XLSX");
    }
    if(action==="pernoctes_revision"){
      const r=await pernocteBook(db,"revision");return sendXlsx(req,db,user,r.bytes,"REPORTE_INTERNO_PERNOCTES_CERRO_VERDE.xlsx","PERNOCTES_INTERNO_XLSX");
    }
    if(action==="pernoctes_enviable"){
      const r=await pernocteBook(db,"enviable");return sendXlsx(req,db,user,r.bytes,"ENVIABLE_PERNOCTES_CERRO_VERDE_DESDE_09_09_2026.xlsx","PERNOCTES_ENVIABLE_XLSX");
    }
    if(action==="archivo"){
      const origin=b.origen==="HISTORICO"?"HISTORICO":"DIARIO",data=await trackingRows(db,origin),bytes=await rawBook(origin,data);return sendXlsx(req,db,user,bytes,`SEGUIMIENTO_${origin}_CERRO_VERDE.xlsx`,`ARCHIVO_${origin}`);
    }
    return responseJson(req,{error:"Acción no encontrada"},404);
  }catch(e){console.error(e);return responseJson(req,{error:errorText(e)},400)}
});
