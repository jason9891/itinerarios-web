import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";

const PROJECT="itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://5000-cs-a2a47bf9-3b6a-4a54-b115-36fc3cb753b5.cs-us-east1-vpcf.cloudshell.dev",
  "https://jason9891.github.io"
]);
const JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const MAP:any={
  salida_planta:"FECHA DE SALIDA PLANTA YURA/CARACOTO",
  llegada_destino:"FECHA LLEGADA A DESTINO",
  inicio_retorno:"FECHA INICIO DE RETORNO",
  fin_de_ciclo:"FECHA FIN DE RETORNO AQP/YURA/CRCT",
  carga_retorno:"CARGA DE RETORNO",
  observaciones:"OBSERVACIONES",
  ubicacion:"UBICACIÓN",
  estado_fisico:"ESTADO"
};

function reply(req:Request,b:any,s=200){
  const o=req.headers.get("origin")||"";
  const h:Record<string,string>={
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store","vary":"Origin",
    "access-control-allow-headers":"authorization, content-type",
    "access-control-allow-methods":"POST, OPTIONS"
  };
  if(ORIGINS.has(o))h["access-control-allow-origin"]=o;
  return new Response(JSON.stringify(b),{status:s,headers:h});
}
async function secure(req:Request){
  const o=req.headers.get("origin")||"";
  if(!ORIGINS.has(o))throw Error("Origen no autorizado");
  const h=req.headers.get("authorization")||"";
  if(!h.startsWith("Bearer "))throw Error("Falta iniciar sesión");
  const{payload}=await jwtVerify(h.slice(7),JWKS,{algorithms:["RS256"],issuer:`https://securetoken.google.com/${PROJECT}`,audience:PROJECT});
  const uid=String(payload.sub||"");
  if(!uid)throw Error("Identidad Firebase no válida");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:u,error}=await db.from("app_usuarios").select("id,email,rol,itinerarios,activo,firebase_uid").eq("firebase_uid",uid).maybeSingle();
  if(error)throw error;
  if(!u||!u.activo||!["ADMIN","EDITOR"].includes(u.rol)||!u.itinerarios?.includes("CEMENTO"))throw Error("Se requiere acceso operativo a CEMENTO");
  return{db,email:String(u.email||"").toLowerCase()};
}
const norm=(v:any)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const tractoNorm=(v:any)=>norm(v).replace(/^20R(?=\d)/,"R");
const plate=(p:any)=>String(p?.["Placa Tracto"]||p?.TRACTO||"");
async function dailySignature(rows:any[]){
  const raw=rows.map(x=>`${x.id}|${x.orden_carga}|${JSON.stringify(x.payload||{})}`).join("\n");
  const bytes=new TextEncoder().encode(raw),hash=await crypto.subtle.digest("SHA-256",bytes);
  return[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function plateSet(rows:any[]){
  return new Set<string>((rows||[]).map((x:any)=>norm(plate(x.payload))).filter(Boolean));
}
function reviewedPlateSet(rows:any[],reviewRows:any[]){
  const ids=new Set<number>((reviewRows||[]).map((x:any)=>Number(x.seguimiento_id)));
  return new Set<string>((rows||[]).filter((x:any)=>ids.has(Number(x.id))).map((x:any)=>norm(plate(x.payload))).filter(Boolean));
}
async function restoreReviewedMarkers(db:any,email:string,rows:any[],reviewed:Set<string>){
  // HOTFIX 3: marcar REVISADA sin borrar cambios ni CERRAR ya preparados.
  const selected=(rows||[]).filter((r:any)=>reviewed.has(norm(plate(r.payload))));
  if(!selected.length)return;
  const ids=selected.map((r:any)=>Number(r.id));
  const{data:existing,error:ee}=await db.from("seguimiento_sesion_web")
    .select("seguimiento_id,cambios,accion,revisada")
    .eq("itinerario","CEMENTO")
    .eq("usuario",email)
    .in("seguimiento_id",ids);
  if(ee)throw ee;
  const em=new Map<number,any>((existing||[]).map((x:any)=>[Number(x.seguimiento_id),x]));
  const payload=selected.map((r:any)=>{
    const e=em.get(Number(r.id));
    return{
      itinerario:"CEMENTO",usuario:email,seguimiento_id:r.id,orden_carga:r.orden_carga,
      cambios:e?.cambios||{},accion:e?.accion||"GUARDAR",revisada:true,
      actualizado_en:new Date().toISOString()
    };
  });
  const{error}=await db.from("seguimiento_sesion_web").upsert(payload,{onConflict:"itinerario,usuario,seguimiento_id"});
  if(error)throw error;
}
function historicalDateStamp(p:any){
  const vals=[
    p?.["Fecha de Orden"],
    p?.["Fecha Carga Real"],
    p?.["FECHA FIN DE RETORNO AQP/YURA/CRCT"],
    p?.["FECHA LLEGADA A DESTINO"],
    p?.["FECHA DE SALIDA PLANTA YURA/CARACOTO"]
  ];
  for(const raw of vals){
    const v=String(raw||"").trim();
    if(!v||v==="-")continue;
    const m=v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){
      const t=Date.UTC(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));
      if(Number.isFinite(t))return t;
    }
    const t=Date.parse(v);
    if(Number.isFinite(t))return t;
  }
  return 0;
}

async function saveCut(db:any,email:string,estado:"PARCIAL"|"COMPLETO",before:any[],reviewed:Set<string>,result:any,restore:boolean){
  const totalBefore=plateSet(before).size;
  const reviewedList=[...reviewed].sort();
  const{data:after,error:ae}=await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","DIARIO").order("id");
  if(ae)throw ae;
  const firma=await dailySignature(after||[]),now=new Date().toISOString();
  if(restore)await restoreReviewedMarkers(db,email,after||[],reviewed);
  const control={
    itinerario:"CEMENTO",usuario:email,estado,total_placas:totalBefore,revisadas:reviewed.size,
    placas_revisadas:reviewedList,firma_diario:firma,completado_en:now
  };
  const{error:rce}=await db.from("cemento_reporte_control").upsert(control,{onConflict:"itinerario"});
  if(rce)throw rce;
  const{error:cutError}=await db.from("cemento_seguimiento_cortes").insert({
    itinerario:"CEMENTO",usuario:email,estado,total_placas:totalBefore,revisadas:reviewed.size,
    placas_revisadas:reviewedList,firma_diario:firma,
    guardadas:Number(result?.guardadas||0),cerradas:Number(result?.cerradas||0),guardado_en:now
  });
  if(cutError)throw cutError;
  return{...result,estado,total_placas:totalBefore,revisadas:reviewed.size,placas_revisadas:reviewedList,guardado_en:now,diario_actual:(after||[]).length};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return reply(req,{ok:true});
  if(req.method!=="POST")return reply(req,{error:"Método no permitido"},405);
  try{
    const{db,email}=await secure(req),b=await req.json(),action=String(b.action||"");
    const isPreview=req.headers.get("origin")==="https://5000-cs-a2a47bf9-3b6a-4a54-b115-36fc3cb753b5.cs-us-east1-vpcf.cloudshell.dev";
    if(isPreview&&!["lista","detalle","cerradas_por_tracto","guardar","marcar_revisada","desmarcar_revisada","guardar_cerrada"].includes(action)){
      return reply(req,{error:"MODO REVISION · SOLO LECTURA. Los guardados y cierres están deshabilitados en la vista previa."},403);
    }

    if(action==="lista"){
      const[{data:rows,error},{data:drafts,error:de}]=await Promise.all([
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","DIARIO").order("id"),
        db.from("seguimiento_sesion_web").select("seguimiento_id,accion,revisada,cambios").eq("itinerario","CEMENTO").eq("usuario",email)
      ]);
      if(error)throw error;if(de)throw de;
      const dm:Map<number,any>=new Map((drafts||[]).map((x:any)=>[x.seguimiento_id,x])),groups:Map<string,any>=new Map();
      for(const r of rows||[]){
        const p=r.payload||{},key=norm(plate(p));if(!key)continue;
        if(!groups.has(key))groups.set(key,{placa:plate(p),tracto:p.TRACTO||"",conductor:p.CONDUCTOR||"",ocs:0,pendientes:0,revisada:false});
        const g=groups.get(key),d=dm.get(r.id);g.ocs++;
        if(d&&(d.accion==="CERRAR"||Object.keys(d.cambios||{}).length))g.pendientes++;
        if(d?.revisada)g.revisada=true;
      }
      const borradores=(drafts||[]).filter((d:any)=>d.accion==="CERRAR"||Object.keys(d.cambios||{}).length).length;
      return reply(req,{placas:[...groups.values()],total_ocs:rows?.length||0,borradores,revisadas:[...groups.values()].filter((x:any)=>x.revisada).length});
    }

    if(action==="detalle"){
      const key=norm(b.placa),[{data:daily,error},{data:hist,error:he},{data:drafts,error:de}]=await Promise.all([
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","DIARIO").order("id"),
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","HISTORICO").order("id",{ascending:false}).limit(1000),
        db.from("seguimiento_sesion_web").select("seguimiento_id,cambios,accion,revisada").eq("itinerario","CEMENTO").eq("usuario",email)
      ]);
      if(error)throw error;if(he)throw he;if(de)throw de;
      const dm:Map<number,any>=new Map((drafts||[]).map((x:any)=>[x.seguimiento_id,x]));
      const ocs=(daily||[]).filter((x:any)=>norm(plate(x.payload))===key).map((x:any)=>{
        const d=dm.get(x.id),original={...(x.payload||{})},p={...original,...(d?.cambios||{})};
        return{id:x.id,orden_carga:x.orden_carga,payload:p,original_payload:original,borrador:d||null};
      });
      if(!ocs.length)return reply(req,{error:"Unidad sin OCs abiertas"},404);
      const last=(hist||[]).find((x:any)=>norm(plate(x.payload))===key);
      return reply(req,{placa:plate(ocs[0].payload),tracto:ocs[0].payload.TRACTO||"",conductor:ocs[0].payload.CONDUCTOR||"",ocs,ultima_oc_cerrada:last?{orden_carga:last.orden_carga,ruta:last.payload?.Ruta||""}:null,revisada:ocs.some((x:any)=>x.borrador?.revisada===true)});
    }

    if(action==="cerradas_por_tracto"){
      const key=tractoNorm(b.tracto);
      if(!key)throw Error("Ingrese un tracto válido");
      const all:any[]=[];
      const pageSize=1000;
      for(let from=0;;from+=pageSize){
        const{data,error}=await db.from("seguimiento_staging")
          .select("id,orden_carga,payload")
          .eq("itinerario","CEMENTO")
          .eq("origen","HISTORICO")
          .order("id",{ascending:false})
          .range(from,from+pageSize-1);
        if(error)throw error;
        const batch=data||[];
        all.push(...batch);
        if(batch.length<pageSize)break;
      }
      const rows=all
        .filter((x:any)=>tractoNorm(x.payload?.TRACTO||"")===key)
        .sort((a:any,b:any)=>{
          const d=historicalDateStamp(b.payload||{})-historicalDateStamp(a.payload||{});
          return d||Number(b.id)-Number(a.id);
        });
      return reply(req,{
        tracto:b.tracto,
        total:rows.length,
        ocs:rows.map((x:any)=>({
          id:x.id,
          orden_carga:x.orden_carga,
          payload:x.payload||{},
          original_payload:x.payload||{},
          historico:true,
          fecha_referencia:
            x.payload?.["Fecha de Orden"]||
            x.payload?.["Fecha Carga Real"]||
            x.payload?.["FECHA FIN DE RETORNO AQP/YURA/CRCT"]||
            ""
        }))
      });
    }

    if(action==="guardar_cerrada"){
      const id=Number(b.id);
      if(!Number.isInteger(id))throw Error("ID histórico inválido");

      const{data:row,error:re}=await db.from("seguimiento_staging")
        .select("id,orden_carga,origen,payload")
        .eq("id",id)
        .eq("itinerario","CEMENTO")
        .eq("origen","HISTORICO")
        .maybeSingle();

      if(re)throw re;
      if(!row)throw Error("OC histórica no encontrada");

      if(String(row.payload?.["ESTADO OC"]||"").trim().toUpperCase()!=="CERRADA"){
        throw Error("La OC seleccionada no está cerrada");
      }

      const changes:any={};

      for(const[k,col]of Object.entries(MAP) as [string,string][]){
        if(!Object.hasOwn(b.datos||{},k))continue;

        const raw=b.datos[k];
        const value=raw===null?null:String(raw).trim();
        const before=row.payload?.[col]??null;

        if(String(before??"")!==String(value??"")){
          changes[col]=value;
        }
      }

      if(!Object.keys(changes).length){
        return reply(req,{
          ok:true,
          accion:"SIN CAMBIOS",
          cambios:0,
          historico:true,
          cerrada:true
        });
      }

      const next={...(row.payload||{}),...changes};

      // Editar datos históricos nunca reabre la OC.
      next["ESTADO OC"]=row.payload?.["ESTADO OC"]||"CERRADA";

      const{error:ue}=await db.from("seguimiento_staging")
        .update({payload:next})
        .eq("id",id)
        .eq("itinerario","CEMENTO")
        .eq("origen","HISTORICO");

      if(ue)throw ue;

      const audit=Object.entries(changes).map(([campo,valorNuevo])=>({
        itinerario:"CEMENTO",
        seguimiento_id:id,
        orden_carga:row.orden_carga,
        accion:"EDITAR_HISTORICO",
        campo,
        valor_anterior:String(row.payload?.[campo]??""),
        valor_nuevo:String(valorNuevo??""),
        usuario:email,
        creado_en:new Date().toISOString()
      }));

      if(audit.length){
        const{error:ae}=await db.from("seguimiento_auditoria").insert(audit);
        if(ae)throw ae;
      }

      return reply(req,{
        ok:true,
        accion:"HISTORICO ACTUALIZADO",
        cambios:Object.keys(changes).length,
        historico:true,
        cerrada:true
      });
    }

    if(action==="marcar_revisada"){
      const key=norm(b.placa);if(!key)throw Error("Placa inválida");
      const{data:daily,error:re}=await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","DIARIO");if(re)throw re;
      const rows=(daily||[]).filter((x:any)=>norm(plate(x.payload))===key);if(!rows.length)throw Error("Unidad sin OCs abiertas");
      const ids=rows.map((x:any)=>x.id),{data:existing,error:ee}=await db.from("seguimiento_sesion_web").select("seguimiento_id,cambios,accion").eq("itinerario","CEMENTO").eq("usuario",email).in("seguimiento_id",ids);if(ee)throw ee;
      const em:Map<number,any>=new Map((existing||[]).map((x:any)=>[x.seguimiento_id,x]));
      const payload=rows.map((r:any)=>{const e=em.get(r.id);return{itinerario:"CEMENTO",usuario:email,seguimiento_id:r.id,orden_carga:r.orden_carga,cambios:e?.cambios||{},accion:e?.accion||"GUARDAR",revisada:true,actualizado_en:new Date().toISOString()}});
      const{error}=await db.from("seguimiento_sesion_web").upsert(payload,{onConflict:"itinerario,usuario,seguimiento_id"});if(error)throw error;
      return reply(req,{ok:true,revisada:true,placa:b.placa,ocs:rows.length});
    }

    if(action==="desmarcar_revisada"){
      const key=norm(b.placa);if(!key)throw Error("Placa inválida");
      const{data:daily,error:re}=await db.from("seguimiento_staging").select("id,orden_carga,payload").eq("itinerario","CEMENTO").eq("origen","DIARIO");if(re)throw re;
      const rows=(daily||[]).filter((x:any)=>norm(plate(x.payload))===key);
      if(!rows.length)return reply(req,{ok:true,revisada:false,placa:b.placa,ocs:0});
      const ids=rows.map((x:any)=>x.id);
      const{data:existing,error:ee}=await db.from("seguimiento_sesion_web").select("seguimiento_id,cambios,accion").eq("itinerario","CEMENTO").eq("usuario",email).in("seguimiento_id",ids);if(ee)throw ee;
      const em:Map<number,any>=new Map((existing||[]).map((x:any)=>[x.seguimiento_id,x]));
      const payload=rows.map((r:any)=>{const e=em.get(r.id);return{itinerario:"CEMENTO",usuario:email,seguimiento_id:r.id,orden_carga:r.orden_carga,cambios:e?.cambios||{},accion:e?.accion||"GUARDAR",revisada:false,actualizado_en:new Date().toISOString()}});
      const{error}=await db.from("seguimiento_sesion_web").upsert(payload,{onConflict:"itinerario,usuario,seguimiento_id"});if(error)throw error;
      return reply(req,{ok:true,revisada:false,placa:b.placa,ocs:rows.length});
    }

    if(action==="guardar"||action==="cerrar"){
      const id=Number(b.id);if(!Number.isInteger(id))throw Error("ID inválido");
      const[{data:row,error:re},{data:current,error:ce}]=await Promise.all([
        db.from("seguimiento_staging").select("id,orden_carga,payload").eq("id",id).eq("itinerario","CEMENTO").eq("origen","DIARIO").maybeSingle(),
        db.from("seguimiento_sesion_web").select("revisada").eq("itinerario","CEMENTO").eq("usuario",email).eq("seguimiento_id",id).maybeSingle()
      ]);
      if(re)throw re;if(ce)throw ce;if(!row)throw Error("OC no encontrada en Diario");
      const changes:any={};
      for(const[k,col]of Object.entries(MAP) as [string,string][]){
        if(!Object.hasOwn(b.datos||{},k))continue;
        const raw=b.datos[k];
        if(raw===null){if(Object.hasOwn(row.payload||{},col))changes[col]=null;continue;}
        const value=String(raw).trim();if(!value)continue;
        if(String(row.payload?.[col]??"").trim()!==value)changes[col]=value;
      }
      const{error}=await db.from("seguimiento_sesion_web").upsert({itinerario:"CEMENTO",usuario:email,seguimiento_id:id,orden_carga:row.orden_carga,cambios:changes,accion:action==="cerrar"?"CERRAR":"GUARDAR",revisada:current?.revisada===true,actualizado_en:new Date().toISOString()},{onConflict:"itinerario,usuario,seguimiento_id"});
      if(error)throw error;
      return reply(req,{ok:true,accion:action==="cerrar"?"CIERRE PREPARADO":"CAMBIOS PREPARADOS",cambios:Object.keys(changes).length});
    }

    if(action==="guardar_parcial"||action==="consolidar"){
      // HOTFIX CEMENTO V3: sincronizar la lista de revisadas de la UI antes
      // de validar/consolidar. Evita 68/68 en pantalla y 67/68 en temporal.
      const{data:before,error:be}=await db.from("seguimiento_staging")
        .select("id,orden_carga,payload")
        .eq("itinerario","CEMENTO")
        .eq("origen","DIARIO")
        .order("id");
      if(be)throw be;

      const serverPlates=plateSet(before||[]);
      if(!serverPlates.size)throw Error("No existen placas con OC abierta para consolidar");

      const clientReviewed=new Set<string>(
        (Array.isArray(b.revisadas)?b.revisadas:[])
          .map((x:any)=>norm(x))
          .filter((x:string)=>x&&serverPlates.has(x))
      );

      if(clientReviewed.size){
        await restoreReviewedMarkers(db,email,before||[],clientReviewed);
      }

      const{data:reviewRows,error:rr}=await db.from("seguimiento_sesion_web")
        .select("seguimiento_id")
        .eq("itinerario","CEMENTO")
        .eq("usuario",email)
        .eq("revisada",true);
      if(rr)throw rr;

      const reviewed=reviewedPlateSet(before||[],reviewRows||[]);
      if(action==="consolidar"&&(reviewed.size!==serverPlates.size||[...serverPlates].some(x=>!reviewed.has(x)))){
        const faltantes=[...serverPlates].filter(x=>!reviewed.has(x)).sort();
        throw Error(
          `Seguimiento incompleto: ${reviewed.size}/${serverPlates.size} placas revisadas`+
          (faltantes.length?`. Pendientes: ${faltantes.join(", ")}`:"")
        );
      }

      const{data,error}=await db.rpc("cemento_consolidar_seguimiento",{p_usuario:email});if(error)throw error;
      const estado=action==="consolidar"?"COMPLETO":"PARCIAL";
      const cut=await saveCut(db,email,estado,before||[],reviewed,data||{},action==="guardar_parcial");
      return reply(req,{ok:true,...cut,seguimiento_completo:estado==="COMPLETO"});
    }

    return reply(req,{error:"Acción no encontrada"},404);
  }catch(e){
    console.error(e);
    return reply(req,{error:e instanceof Error?e.message:String((e as any)?.message||"Error")},400);
  }
});
