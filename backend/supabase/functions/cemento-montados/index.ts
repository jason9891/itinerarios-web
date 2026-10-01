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

function reply(req:Request,b:any,s=200){
  const o=req.headers.get("origin")||"";
  const h:Record<string,string>={
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "vary":"Origin",
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
  const{payload}=await jwtVerify(h.slice(7),JWKS,{
    algorithms:["RS256"],
    issuer:`https://securetoken.google.com/${PROJECT}`,
    audience:PROJECT
  });
  const uid=String(payload.sub||"");
  if(!uid)throw Error("Identidad Firebase no válida");

  const db=createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false,autoRefreshToken:false}}
  );

  const{data:u,error}=await db.from("app_usuarios")
    .select("email,rol,itinerarios,activo")
    .eq("firebase_uid",uid)
    .maybeSingle();

  if(error)throw error;
  if(!u||!u.activo||!["ADMIN","EDITOR"].includes(u.rol)||!u.itinerarios?.includes("CEMENTO")){
    throw Error("Se requiere acceso operativo a CEMENTO");
  }
  return{db,email:String(u.email||"").toLowerCase()};
}

const strip=(v:any)=>String(v??"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"");

function rutaNorm(v:any){
  return strip(v).toUpperCase()
    .replace(/\u00a0/g," ")
    .replace(/\s+/g," ")
    .replace(/\s*-\s*/g," - ")
    .replace(/\s*\/\s*/g,"/")
    .trim();
}

function tracto(v:any){
  const m=strip(v).toUpperCase().match(/(?:20\s*-\s*)?R\s*-?\s*(\d+)/);
  if(!m)return "";
  return `20-R-${Number(m[1])}`;
}

function acople(v:any){
  const m=strip(v).toUpperCase().match(/(?:20\s*-\s*)?P\s*-?\s*(\d+)/);
  if(!m)return "";
  return `20-P-${Number(m[1])}`;
}

function fechaIso(v:any){
  const s=String(v??"").trim();
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m){
    const dd=String(Number(m[1])).padStart(2,"0");
    const mm=String(Number(m[2])).padStart(2,"0");
    return `${m[3]}-${mm}-${dd}`;
  }
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function fechaTexto(iso:string){
  const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:iso;
}

function cleanNullable(v:any){
  const s=String(v??"").replace(/\u00a0/g," ").trim();
  if(!s||s==="0"||s===".")return null;
  return s;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return reply(req,{ok:true});
  if(req.method!=="POST")return reply(req,{error:"Método no permitido"},405);

  try{
    const{db,email}=await secure(req);
    const b=await req.json();
    const action=String(b.action||"");

    if(action==="guardar"){
      const rows=Array.isArray(b.rows)?b.rows:[];
      if(!rows.length)throw Error("No hay filas de Montados para guardar");
      if(rows.length>1000)throw Error("Máximo 1000 filas por guardado");

      const prepared:any[]=[];
      const invalid:any[]=[];

      rows.forEach((r:any,i:number)=>{
        const fecha=fechaIso(r.fecha);
        const ruta=String(r.ruta||"").replace(/\u00a0/g," ").trim();
        const rn=rutaNorm(ruta);
        const tl=tracto(r?.largo?.tracto||r.tracto_largo);
        const tc=tracto(r?.corto?.tracto||r.tracto_corto);
        const al=acople(r?.largo?.acople||r.acople_largo);
        const ac=acople(r?.corto?.acople||r.acople_corto);

        if(!fecha||!ruta||!rn||!tl||!tc){
          invalid.push({fila:i+1,fecha:r.fecha||"",ruta:r.ruta||"",tracto_largo:r?.largo?.tracto||"",tracto_corto:r?.corto?.tracto||""});
          return;
        }

        prepared.push({
          itinerario:"CEMENTO",
          fecha,
          ruta,
          ruta_norm:rn,
          tracto_largo:tl,
          acople_largo:al||null,
          tracto_corto:tc,
          acople_corto:ac||null,
          oc_largo:cleanNullable(r.ocLargo??r.oc_largo),
          oc_corto:cleanNullable(r.ocCorto??r.oc_corto),
          guia:cleanNullable(r.guia),
          usuario:email,
          actualizado_en:new Date().toISOString()
        });
      });

      if(!prepared.length){
        return reply(req,{ok:false,guardadas:0,invalidas:invalid.length,detalle_invalidas:invalid},400);
      }

      const{data,error}=await db.from("cemento_montados")
        .upsert(prepared,{
          onConflict:"itinerario,fecha,ruta_norm,tracto_largo,tracto_corto",
          ignoreDuplicates:false
        })
        .select("id");

      if(error)throw error;

      return reply(req,{
        ok:true,
        recibidas:rows.length,
        guardadas:data?.length||0,
        invalidas:invalid.length,
        detalle_invalidas:invalid
      });
    }

    if(action==="listar"){
      const desde=fechaIso(b.desde);
      const hasta=fechaIso(b.hasta);
      if(!desde||!hasta)throw Error("Rango DESDE/HASTA inválido");
      if(desde>hasta)throw Error("DESDE no puede ser posterior a HASTA");

      let q=db.from("cemento_montados")
        .select("id,fecha,ruta,tracto_largo,acople_largo,tracto_corto,acople_corto,oc_largo,oc_corto,guia")
        .eq("itinerario","CEMENTO")
        .gte("fecha",desde)
        .lte("fecha",hasta)
        .order("fecha",{ascending:true})
        .order("id",{ascending:true});

      const p=tracto(b.tracto);
      if(p)q=q.or(`tracto_largo.eq.${p},tracto_corto.eq.${p}`);

      const{data,error}=await q;
      if(error)throw error;

      return reply(req,{
        ok:true,
        desde,
        hasta,
        total:data?.length||0,
        rows:(data||[]).map((x:any)=>({
          ...x,
          fecha_texto:fechaTexto(x.fecha),
          tipo:p?(x.tracto_largo===p?"TRANSPORTA":"MONTADO"):null,
          relacionado:p?(x.tracto_largo===p?x.tracto_corto:x.tracto_largo):null
        }))
      });
    }

    return reply(req,{error:"Acción no encontrada"},404);
  }catch(e){
    console.error(e);
    return reply(req,{error:e instanceof Error?e.message:String(e)},400);
  }
});