import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";

// Cemento V3 (local-first): baja los OCs CERRADAS (HISTORICO) de VARIOS tractos con UNA sola lectura
// de la tabla, en vez de una lectura completa por tracto. Solo lectura. Función aparte a propósito:
// no toca cemento-seguimiento.
const PROJECT="itinerarios-2fa6f";
const ORIGINS = new Set([
  "https://itinerarios-2fa6f.web.app",
  "https://itinerarios-2fa6f.firebaseapp.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://jason9891.github.io"
]);
const JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

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
  return{db};
}
const norm=(v:any)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const tractoNorm=(v:any)=>norm(v).replace(/^20R(?=\d)/,"R");
function historicalDateStamp(p:any){
  const vals=[p?.["Fecha de Orden"],p?.["Fecha Carga Real"],p?.["FECHA FIN DE RETORNO AQP/YURA/CRCT"],p?.["FECHA LLEGADA A DESTINO"],p?.["FECHA DE SALIDA PLANTA YURA/CARACOTO"]];
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

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return reply(req,{ok:true});
  if(req.method!=="POST")return reply(req,{error:"Método no permitido"},405);
  try{
    const{db}=await secure(req),b=await req.json();
    const wanted=new Set<string>((Array.isArray(b.tractos)?b.tractos:[]).map((x:any)=>tractoNorm(x)).filter((x:string)=>!!x));
    if(!wanted.size)throw Error("Indique al menos un tracto");
    if(wanted.size>300)throw Error("Demasiados tractos en una sola consulta");
    const limite=Math.min(Math.max(Number(b.limite_por_tracto)||300,1),1000);
    const por:Record<string,any[]>={};
    for(const k of wanted)por[k]=[];
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
      for(const x of batch){
        const k=tractoNorm(x.payload?.TRACTO||"");
        if(wanted.has(k))por[k].push(x);
      }
      if(batch.length<pageSize)break;
    }
    let total=0;
    for(const k of Object.keys(por)){
      por[k]=por[k]
        .sort((a:any,c:any)=>{const d=historicalDateStamp(c.payload||{})-historicalDateStamp(a.payload||{});return d||Number(c.id)-Number(a.id);})
        .slice(0,limite)
        .map((x:any)=>({
          id:x.id,orden_carga:x.orden_carga,payload:x.payload||{},original_payload:x.payload||{},historico:true,
          fecha_referencia:x.payload?.["Fecha de Orden"]||x.payload?.["Fecha Carga Real"]||x.payload?.["FECHA FIN DE RETORNO AQP/YURA/CRCT"]||""
        }));
      total+=por[k].length;
    }
    return reply(req,{ok:true,tractos:wanted.size,total,por_tracto:por});
  }catch(e){
    console.error(e);
    return reply(req,{error:e instanceof Error?e.message:String((e as any)?.message||"Error")},400);
  }
});
