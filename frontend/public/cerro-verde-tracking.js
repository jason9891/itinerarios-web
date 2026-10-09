const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const META="cv_precarga_activa_v5",TIMEOUT=120000,ANALYSIS_VERSION="CV_DESKTOP_RULES_20260913_1";
let mapsPromise,mapConfig=null;
const bg={running:false,stop:false,controller:null,units:[],meta:null,ctx:null,health:null,promise:null,lastError:null};
// Un único mapa por permanencia en SEGUIMIENTO. Cambiar de placa solo reemplaza overlays.
const mapRuntime={map:null,host:null,layers:[],inspection:[],stopMarkers:new Map(),info:null,routeInfo:null,loadCount:0};
function hideMapStatus(){document.getElementById("cv-map-status")?.remove()}
function showMapStatus(host,message){
  if(!host)return;
  let box=document.getElementById("cv-map-status");
  if(!box){
    box=document.createElement("div");
    box.id="cv-map-status";
    box.style.cssText="position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:5;display:block;max-width:72%;padding:7px 12px;box-sizing:border-box;background:rgba(15,23,42,.82);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;box-shadow:0 2px 8px rgba(15,23,42,.22);font:700 11px/1.3 Segoe UI,Arial,sans-serif;white-space:pre-line;text-align:center;pointer-events:none";
    host.parentElement?.append(box);
  }
  box.textContent=String(message||"");
}
function clearMapLayers(){
  for(const layer of mapRuntime.layers.splice(0)){try{layer.setMap?.(null)}catch{}}
  for(const marker of mapRuntime.inspection.splice(0)){try{marker.setMap?.(null)}catch{}}
  mapRuntime.stopMarkers?.clear?.();
  try{mapRuntime.info?.close()}catch{}
  try{mapRuntime.routeInfo?.close()}catch{}
  const hours=document.getElementById("hours");
  if(hours){hours.classList.remove("active");hours.textContent="VER HORAS"}
}
function addMapLayer(layer){mapRuntime.layers.push(layer);return layer}
function ensurePersistentMap(host,center,zoom){
  const options={center,zoom,mapTypeControl:true,streetViewControl:false,fullscreenControl:false,clickableIcons:false,gestureHandling:"greedy"};
  if(!mapRuntime.map||mapRuntime.host!==host){
    mapRuntime.host=host;
    mapRuntime.map=new google.maps.Map(host,options);
    mapRuntime.loadCount+=1;
    window.__CV_MAP_LOADS=mapRuntime.loadCount;
    console.info(`[CERRO VERDE] Google Map creado ${mapRuntime.loadCount} vez/veces en esta sesión de página.`);
  }else{
    mapRuntime.map.setOptions(options);
    mapRuntime.map.setCenter(center);
    mapRuntime.map.setZoom(zoom);
  }
  return mapRuntime.map;
}
function resetMapVisual(message){
  clearMapLayers();
  const host=document.getElementById("cv-map");
  if(host)showMapStatus(host,message);
}

function dialog(title,message,{confirm=false,okText="ACEPTAR",danger=false}={}){return new Promise(resolve=>{document.getElementById("cv-dialog-layer")?.remove();const layer=document.createElement("div");layer.id="cv-dialog-layer";layer.className="cv-dialog-layer";layer.innerHTML=`<div class="cv-dialog"><h3>${String(title||"")}</h3><p>${String(message||"")}</p><div class="cv-dialog-actions">${confirm?'<button data-cancel class="cv-dialog-cancel">CANCELAR</button>':""}<button data-ok class="${danger?'cv-dialog-danger':'cv-dialog-ok'}">${okText}</button></div></div>`;document.body.append(layer);const close=value=>{layer.remove();resolve(value)};layer.querySelector("[data-ok]").onclick=()=>close(true);const cancel=layer.querySelector("[data-cancel]");if(cancel)cancel.onclick=()=>close(false);layer.onclick=e=>{if(e.target===layer&&confirm)close(false)}})}
const notice=(title,message)=>dialog(title,message,{okText:"ACEPTAR"});
const ask=(title,message,okText="CONTINUAR",danger=false)=>dialog(title,message,{confirm:true,okText,danger});
function nowPE(){return new Intl.DateTimeFormat("en-GB",{timeZone:"America/Lima",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()).replace(",","")}
function serverToPE(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return"";return new Intl.DateTimeFormat("en-GB",{timeZone:"America/Lima",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d).replace(",","")}
function peToInput(value){const m=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`:""}
function inputToPE(value){const m=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);if(!m)throw Error("Seleccione una fecha y hora válidas");return`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]||"00"}`}
function parseAny(v){if(v instanceof Date)return v.getTime();const s=String(v||"").trim();if(!s)return NaN;let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);if(m)return Date.UTC(+m[3],+m[2]-1,+m[1],+m[4],+m[5],+(m[6]||0));m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);if(m)return Date.UTC(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));const d=Date.parse(s);return Number.isFinite(d)?d:NaN}
function displayTs(value){const s=String(value??"").trim();if(!s)return"";let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);if(m){const d=String(m[1]).padStart(2,"0"),mo=String(m[2]).padStart(2,"0"),y=m[3];return m[4]?`${d}/${mo}/${y} ${String(m[4]).padStart(2,"0")}:${m[5]}:${m[6]||"00"}`:`${d}/${mo}/${y}`}m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);if(m)return m[4]?`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]||"00"}`:`${m[3]}/${m[2]}/${m[1]}`;if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)){const d=new Date(s);if(!Number.isNaN(d.getTime()))return serverToPE(s)}return s}
function formatDur(min){const n=Number(min||0);if(n>=60){const h=Math.floor(n/60),m=Math.round(n%60);return`${h} h ${String(m).padStart(2,"0")} min`}return`${n.toFixed(1)} min`}
function meta(){for(const key of[META,"cv_precarga_activa_v4"]){try{const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(value)return value}}catch{}}return null}
function save(m){bg.meta=m;localStorage.setItem(META,JSON.stringify(m));renderProgress()}
function stateOf(g){const p=(g?.puntos_gps||[]).filter(x=>Number.isFinite(+x.lat)&&Number.isFinite(+x.lng));if(p.length<2)return"SIN MOVIMIENTO";const a=p[0],rad=Math.PI/180,dist=x=>{const d1=(+x.lat-a.lat)*rad,d2=(+x.lng-a.lng)*rad,q=Math.sin(d1/2)**2+Math.cos(a.lat*rad)*Math.cos(+x.lat*rad)*Math.sin(d2/2)**2;return 12742000*Math.asin(Math.sqrt(q))};return p.some(x=>dist(x)>=100)?"COMPLETO":"SIN MOVIMIENTO"}
function counts(){const m=bg.meta||meta()||{},values=Object.values(m.resultados||{}),done=values.filter(x=>["COMPLETO","SIN MOVIMIENTO"].includes(x.estado)).length,retry=values.filter(x=>["REINTENTO","SEGUNDO INTENTO"].includes(x.estado)).length,errors=values.filter(x=>x.estado==="ERROR FINAL").length,total=bg.units.length||m.total||0,pending=Math.max(0,total-done-errors);return{done,retry,errors,pending,total,current:m.actual||"",complete:!!m.completo}}
function label(){const c=counts();return bg.running?`PRECARGA ${c.done}/${c.total}${c.retry?` · ${c.retry} REINTENTO`:""}${c.current?` · ${c.current}`:""}`:c.total?`PRECARGA ${c.done}/${c.total}${c.errors?` · ${c.errors} ERROR`:""}`:"PRECARGA PENDIENTE"}
function renderProgress(){
  const c=counts();
  for(const id of["cv-preload-global","cv-home-preload"]){
    const n=document.getElementById(id); if(n)n.textContent=label();
  }
  const done=document.getElementById("cv-p-done"),pending=document.getElementById("cv-p-pending"),retry=document.getElementById("cv-p-retry"),err=document.getElementById("cv-p-errors"),total=document.getElementById("cv-p-total"),
        bar=document.getElementById("cv-p-bar"),health=document.getElementById("cv-p-health"),range=document.getElementById("cv-run-range");
  if(done)done.textContent=c.done;
  if(pending)pending.textContent=c.pending;
  if(retry)retry.textContent=c.retry;
  if(err)err.textContent=c.errors;
  if(total)total.textContent=c.total;
  if(bar)bar.style.width=`${c.total?Math.round(100*(c.done+c.errors)/c.total):0}%`;
  const m=bg.meta||meta();
  if(range)range.textContent=m?.desde&&m?.hasta?`Rango: ${m.desde} → ${m.hasta}`:`Nuevo rango desde ${localStorage.getItem("cv_corte")||"DEFINIR EN INICIO"}`;
  if(health){
    if(bg.health?.ok){health.className="preload-health ok";health.textContent=`CLOCATOR CONECTADO · ${bg.health.cartografia?.geocercas_operativas||0} geocercas · ${bg.health.cartografia?.fuente||"CARTOGRAFÍA"}`}
    else if(bg.health?.error){health.className="preload-health error";health.textContent=`CLOCATOR NO DISPONIBLE · ${bg.health.error}`}
    else{health.className="preload-health";health.textContent="CLocator pendiente de verificación."}
  }
  const start=document.getElementById("cv-p-start"),stop=document.getElementById("cv-p-stop"),reset=document.getElementById("cv-p-reset");
  if(start){
    start.disabled=start.dataset.locked==="1"||bg.running;
    start.textContent=bg.running?"PRECARGANDO…":c.complete?"NUEVA PRECARGA":c.done?"REANUDAR":"INICIAR PRECARGA";
  }
  if(stop)stop.disabled=!bg.running;
  if(reset)reset.disabled=reset.dataset.locked==="1"||bg.running;
  for(let i=0;i<bg.units.length;i++){
    const u=bg.units[i],r=(bg.meta?.resultados||m?.resultados||{})[norm(u.placa)],
          cell=document.getElementById(`cv-s-${i}`),msg=document.getElementById(`cv-msg-${i}`),pts=document.getElementById(`cv-pts-${i}`);
    if(cell){
      cell.textContent=r?.estado||"PENDIENTE";
      cell.className=`preload-state ${r?.estado==="ERROR FINAL"?"error":["COMPLETO","SIN MOVIMIENTO"].includes(r?.estado)?"ok":r?.estado==="PROCESANDO"?"running":""}`;
      cell.title=r?.mensaje||"";
    }
    if(msg)msg.textContent=r?.mensaje||"";
    if(pts)pts.textContent=r?String(r.puntos??"—"):"—";
  }
}
async function persistent(){try{await navigator.storage?.persist?.()}catch{}}
async function units(c){const d=await c.get("seguimiento");return[...new Map((d.registros||[]).filter(x=>x.placa||x.tracto).map(x=>[norm(x.placa||x.tracto),{placa:x.placa||x.tracto,tracto:x.tracto||x.placa}])).values()]}
async function run(c,list,{fresh=false}={}){if(bg.running)return;await persistent();bg.units=list;bg.running=true;bg.stop=false;bg.health=null;renderProgress();try{const h=await c.post(c.END.gps,{action:"health"});bg.health={...h,ok:true};renderProgress()}catch(e){const msg=String(e?.message||e);bg.health={ok:false,error:msg};bg.running=false;renderProgress();throw Error(`No se inició la precarga: ${msg}`)}let m=!fresh&&meta();if(!m||m.completo||fresh){const from=localStorage.getItem("cv_corte")||"";if(!/^\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{2}:\d{2}:\d{2}$/.test(from)){bg.running=false;renderProgress();throw Error("Defina primero la fecha y hora del último seguimiento en INICIO")}const previous=await c.all("gps"),lastKnown={};for(const g of previous){const p=g?.ultimo||g?.puntos_gps?.at(-1);if(p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng))lastKnown[norm(g.placa)]=p}m={id:crypto.randomUUID(),desde:from.replace(",",""),hasta:nowPE(),total:list.length,intentos:{},resultados:{},ultimos:lastKnown,completo:false};await c.clear("gps")}m.intentos||={};m.resultados||={};m.ultimos||={};m.total=list.length;save(m);const first=[],retry=[];for(const u of list){const k=norm(u.placa),cached=await c.one("gps",u.placa);if(cached?.ok||(cached?.puntos_gps||[]).length){m.resultados[k]={estado:stateOf(cached),puntos:cached.puntos??cached.puntos_gps?.length??0,mensaje:cached.analisis_version===ANALYSIS_VERSION?"Análisis actualizado":"GPS listo · análisis se actualizará al abrir"};continue}const n=+m.intentos[k]||0;if(n===0)first.push(u);else if(n===1)retry.push(u);else m.resultados[k]={estado:"ERROR FINAL",mensaje:"Revisar manualmente"}}save(m);const process=async(queue,second)=>{for(const u of queue){if(bg.stop)break;const k=norm(u.placa);m.actual=u.placa;m.resultados[k]={estado:second?"SEGUNDO INTENTO":"PROCESANDO",mensaje:second?"Reintentando consulta CLocator":"Consultando CLocator"};save(m);const controller=new AbortController();bg.controller=controller;const timer=setTimeout(()=>controller.abort(),TIMEOUT);try{const x=await c.post(c.END.gps,{placa:u.placa,tracto:u.tracto,desde:m.desde,hasta:m.hasta,include_map:false},false,controller.signal);clearTimeout(timer);const current=x?.ultimo||x?.puntos_gps?.at(-1);if(current)m.ultimos[k]=current;if(!(x?.puntos_gps||[]).length&&m.ultimos[k]){x.ultimo=m.ultimos[k];x.puntos_gps=[m.ultimos[k]];x.sin_movimiento=true}await c.put("gps",u.placa,{...x,run:m.id});m.intentos[k]=(+m.intentos[k]||0)+1;m.resultados[k]={estado:stateOf(x),puntos:x.puntos??x.puntos_gps?.length??0,mensaje:`Análisis: ${x?.cartografia?.fuente||"OPERATIVO"}`}}catch(e){clearTimeout(timer);if(bg.stop){m.resultados[k]={estado:"PENDIENTE",mensaje:"Detenido por el operador"};break}m.intentos[k]=(+m.intentos[k]||0)+1;const msg=controller.signal.aborted?"Tiempo de respuesta agotado":String(e.message||e);if(!second&&m.intentos[k]===1){m.resultados[k]={estado:"REINTENTO",mensaje:msg};retry.push(u)}else m.resultados[k]={estado:"ERROR FINAL",mensaje:msg}}finally{bg.controller=null;save(m)}}};await process(first,false);if(!bg.stop)await process([...new Map(retry.map(u=>[norm(u.placa),u])).values()],true);bg.running=false;m.actual="";m.completo=!bg.stop&&list.every(u=>["COMPLETO","SIN MOVIMIENTO","ERROR FINAL"].includes(m.resultados[norm(u.placa)]?.estado));save(m)}
async function maps(key){if(window.google?.maps)return;if(!key)throw Error("Falta GOOGLE_MAPS_API_KEY");window.gm_authFailure=()=>{const host=document.getElementById("cv-map");showMapStatus(host,"Google Maps rechazó la carga del mapa.\nRevise cuota, facturación o restricción HTTP de la API key en la consola del navegador.")};mapsPromise||=new Promise((ok,no)=>{const s=document.createElement("script");s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;s.onload=ok;s.onerror=()=>no(Error("No se pudo cargar Google Maps"));document.head.append(s)});return mapsPromise}
async function config(c){return mapConfig||=await c.post(c.END.gps,{action:"map_config"})}
async function ensureAnalysis(g,c,key){if(!g||g.analisis_version===ANALYSIS_VERSION||!(g.puntos_gps||[]).length)return g;const r=await c.post(c.END.gps,{action:"reanalyze",puntos_gps:g.puntos_gps});const updated={...g,ok:true,analisis:r.analisis,cartografia:r.cartografia,analisis_version:r.analisis_version};await c.put("gps",key,updated);return updated}

function markerIcon(color,scale=11,stroke="#fff",strokeWeight=3){return{path:google.maps.SymbolPath.CIRCLE,scale,fillColor:color,fillOpacity:1,strokeColor:stroke,strokeWeight}}
async function draw(g,c,$,onStop){
  const source=(g?.puntos_gps||[]).filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lng));
  const last=g?.ultimo||source.at(-1);
  if(!source.length&&last&&Number.isFinite(+last.lat)&&Number.isFinite(+last.lng))source.push(last);
  const host=$("cv-map");
  hideMapStatus();
  clearMapLayers();
  if(!source.length){showMapStatus(host,"SIN RECORRIDO DISPONIBLE");return;}

  const cfg=await config(c);
  await maps(cfg.google_maps_api_key);

  const pts=source.map((p,index)=>({
    lat:+p.lat,
    lng:+p.lng,
    fecha:p.fecha||p.fecha_hora||"",
    index
  }));
  const single=pts.length<2;
  const map=ensurePersistentMap(host,pts[0],single?16:8);
  const bounds=new google.maps.LatLngBounds();
  pts.forEach(p=>bounds.extend(p));
  const info=mapRuntime.info||=new google.maps.InfoWindow();

  if(!single){
    const arrow={path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:3.5,strokeColor:"#7c3aed",strokeWeight:2,fillColor:"#7c3aed",fillOpacity:1};
    addMapLayer(new google.maps.Polyline({map,path:pts,strokeColor:"#2563eb",strokeOpacity:.95,strokeWeight:5,icons:[{icon:arrow,offset:"40px",repeat:"110px"},{icon:arrow,offset:"100%"}]}));
    const last3=pts.slice(-3),redArrow={path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:4,strokeColor:"#dc2626",strokeWeight:2,fillColor:"#dc2626",fillOpacity:1};
    addMapLayer(new google.maps.Polyline({map,path:last3,geodesic:true,strokeColor:"#dc2626",strokeOpacity:1,strokeWeight:7,zIndex:400,icons:[{icon:redArrow,offset:"100%"}]}));
    [
      {p:pts[0],text:"I",color:"#16a34a",title:`INICIO · ${pts[0].fecha||"-"}`},
      {p:pts.at(-1),text:"F",color:"#2563eb",title:`FIN · ${pts.at(-1).fecha||"-"}`}
    ].forEach(x=>addMapLayer(new google.maps.Marker({map,position:x.p,title:x.title,label:{text:x.text,color:"#fff",fontSize:"11px",fontWeight:"700"},icon:markerIcon(x.color,11),zIndex:220})));
    map.fitBounds(bounds,{top:45,right:45,bottom:45,left:45});
  }else{
    addMapLayer(new google.maps.Marker({map,position:pts[0],label:{text:"U",color:"#fff",fontSize:"11px",fontWeight:"700"},title:`ÚLTIMA POSICIÓN · ${last?.fecha||source[0]?.fecha||""}`,icon:markerIcon("#111827",11),zIndex:450}));
  }

  const stopMarkers=new Map();
  mapRuntime.stopMarkers=stopMarkers;
  for(const p of g?.analisis?.paradas_candidatas||[]){
    const pos={lat:+p.lat,lng:+p.lng};
    if(!Number.isFinite(pos.lat)||!Number.isFinite(pos.lng))continue;
    const isP=String(p.tipo).toUpperCase()==="PERNOCTE";
    const m=addMapLayer(new google.maps.Marker({map,position:pos,title:isP?"POSIBLE PERNOCTE":"POSIBLE PAUSA ACTIVA",label:{text:"P",color:isP?"#fff":"#713f12",fontSize:"11px",fontWeight:"800"},icon:markerIcon(isP?"#dc2626":"#facc15",11),zIndex:isP?520:510}));
    m.addListener("click",()=>{
      info.setContent(`<div style="font-family:Segoe UI,Arial;font-size:12px"><b>${isP?"POSIBLE PERNOCTE":"POSIBLE PAUSA ACTIVA"}</b><br>Inicio: ${c.esc(p.inicio)}<br>Fin: ${c.esc(p.fin)}<br>Duración: ${c.esc(formatDur(p.duracion_min))}<br>Zona: ${c.esc(p.geocerca||"FUERA DE GEOCERCA")}</div>`);
      info.open({map,anchor:m});
      map.panTo(pos);
      if((map.getZoom()||0)<16)map.setZoom(16);
      onStop?.(p.id);
    });
    stopMarkers.set(p.id,m);
  }

  // VER HORAS replica el comportamiento del seguimiento de escritorio:
  // puntos pequeños y clicables, sin escribir la hora encima del mapa.
  // Cuando hay varias pasadas por el mismo punto, se agrupan por cercanía
  // y separación temporal para evitar información montada una sobre otra.
  let inspectionMarkers=mapRuntime.inspection;
  let routeInfoWindow=mapRuntime.routeInfo;

  const distanceMeters=(a,b)=>{
    const R=6371000,rad=Math.PI/180;
    const dLat=(+b.lat-+a.lat)*rad,dLon=(+b.lng-+a.lng)*rad;
    const lat1=+a.lat*rad,lat2=+b.lat*rad;
    const q=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
  };

  const groupNearbyPasses=clickPosition=>{
    const near=pts.map(p=>({...p,distance:distanceMeters(clickPosition,p)}))
      .filter(p=>p.distance<=22&&p.fecha)
      .sort((a,b)=>a.index-b.index);
    if(!near.length)return[];
    const groups=[];
    let current=[];
    for(const p of near){
      if(!current.length){current.push(p);continue;}
      const prev=current[current.length-1];
      const t1=parseAny(prev.fecha),t2=parseAny(p.fecha);
      const newPass=Number.isFinite(t1)&&Number.isFinite(t2)
        ? Math.abs(t2-t1)/60000>10
        : p.index-prev.index>20;
      if(newPass){groups.push(current);current=[p]}else current.push(p);
    }
    if(current.length)groups.push(current);
    return groups.map(group=>({
      closest:group.reduce((best,item)=>!best||item.distance<best.distance?item:best,null),
      first:group[0],
      last:group[group.length-1]
    }));
  };

  const showRouteTime=clickPosition=>{
    if(!pts.length)return;
    map.panTo(clickPosition);
    if(!Number.isFinite(map.getZoom())||map.getZoom()<16)map.setZoom(16);
    const passes=groupNearbyPasses(clickPosition);
    if(!passes.length)return;
    const rows=passes.map((pass,index)=>{
      const value=c.esc(pass.closest.fecha||"");
      const range=pass.first.fecha!==pass.last.fecha
        ? `<div style="color:#64748B;font-size:10px;margin-top:4px">PASADA ${index+1} · ${c.esc(pass.first.fecha)} → ${c.esc(pass.last.fecha)}</div>`
        : passes.length>1?`<div style="color:#64748B;font-size:10px;margin-top:4px">PASADA ${index+1}</div>`:"";
      return `<div style="${index?"border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;":""}"><button type="button" data-copy-time="${value}" style="border:0;background:#EEF4FF;color:#174589;font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:800;padding:7px 10px;border-radius:6px;cursor:pointer;width:100%;text-align:left">${value}</button>${range}</div>`;
    }).join("");
    const wrap=document.createElement("div");
    wrap.style.cssText="font-family:Segoe UI,Arial,sans-serif;min-width:220px;max-width:300px;padding:0 1px 2px 1px";
    wrap.innerHTML=`<div style="font-size:12px;font-weight:800;color:#173A68;margin-bottom:6px">FECHA / HORA</div>${rows}<div style="color:#94A3B8;font-size:9px;margin-top:8px">Haz clic sobre una fecha para copiarla.</div>`;
    wrap.querySelectorAll("[data-copy-time]").forEach(btn=>btn.addEventListener("click",async()=>{
      const value=btn.getAttribute("data-copy-time")||"";
      try{await navigator.clipboard.writeText(value);const old=btn.textContent;btn.textContent=`COPIADO · ${value}`;setTimeout(()=>{if(btn.isConnected)btn.textContent=old},900)}catch{}
    }));
    routeInfoWindow||=new google.maps.InfoWindow();
    mapRuntime.routeInfo=routeInfoWindow;
    routeInfoWindow.setContent(wrap);
    routeInfoWindow.setPosition(clickPosition);
    routeInfoWindow.open({map});
  };

  const clearHours=()=>{
    mapRuntime.inspection.forEach(m=>m.setMap(null));
    mapRuntime.inspection=[];
    inspectionMarkers=mapRuntime.inspection;
    routeInfoWindow?.close();
  };

  const createHourPoints=()=>{
    clearHours();
    if(!pts.length)return;
    let step=1;
    if(pts.length>2500)step=3;
    else if(pts.length>1200)step=2;
    for(let i=0;i<pts.length;i+=step){
      const p=pts[i];
      const m=new google.maps.Marker({
        map,
        position:{lat:p.lat,lng:p.lng},
        title:p.fecha||"",
        optimized:true,
        icon:{path:google.maps.SymbolPath.CIRCLE,scale:2.8,fillColor:"#fff",fillOpacity:.75,strokeColor:"#174589",strokeOpacity:.85,strokeWeight:1},
        zIndex:70
      });
      m.addListener("click",()=>showRouteTime({lat:p.lat,lng:p.lng}));
      mapRuntime.inspection.push(m);
      inspectionMarkers=mapRuntime.inspection;
    }
  };

  $("hours").onclick=()=>{
    const on=$("hours").classList.toggle("active");
    $("hours").textContent=on?"OCULTAR HORAS":"VER HORAS";
    if(on)createHourPoints();else clearHours();
  };

  return{map,stopMarkers};
}

function eventsFor(a,role,event){return(a?.eventos_geocerca||[]).filter(x=>x.rol===role&&(!event||x.evento===event)).sort((x,y)=>parseAny(x.fecha)-parseAny(y.fecha))}
function visitsFor(a,role){return(a?.visitas_confirmadas||[]).filter(x=>x.rol===role).sort((x,y)=>parseAny(x.ingreso)-parseAny(y.ingreso))}
function currentTs(p,col){const v=p?.[col];return Number.isFinite(parseAny(v))?parseAny(v):null}
function pickClosest(rows,target,maxHours=18){if(!rows.length)return null;if(!Number.isFinite(target))return rows[0];let best=null;for(const r of rows){const d=Math.abs(parseAny(r.fecha)-target);if(d<=maxHours*3600000&&(!best||d<best.d))best={r,d}}return best?.r||null}
function cycleSuggestions(payload,analysis){const p=payload||{},out={};const existing={H:currentTs(p,"SALIDA DE BASE RACIEMSA"),I:currentTs(p,"LLEGADA A CARACOTO"),IC:currentTs(p,"INGRESO A CARGUIO"),SC:currentTs(p,"SALIDA DE CARGUIO"),J:currentTs(p,"SALIDA DE CARACOTO"),K:currentTs(p,"LLEGADA A BASE RACIEMSA"),L:currentTs(p,"SALIDA DE BASE RACIEMSA CARGADO"),M:currentTs(p,"INGRESO A SMCV"),N:currentTs(p,"SALIDA DE SMCV"),O:currentTs(p,"LLEGADA A BASE RACIEMSA VACIO")};const carIn=(analysis?.eventos_geocerca||[]).filter(x=>x.rol==="CARACOTO"&&["INGRESO","INICIO_DENTRO"].includes(x.evento)).sort((x,y)=>parseAny(x.fecha)-parseAny(y.fecha)),carOut=eventsFor(analysis,"CARACOTO","SALIDA"),smIn=eventsFor(analysis,"SMCV","INGRESO"),smOut=eventsFor(analysis,"SMCV","SALIDA"),rac=visitsFor(analysis,"RACIEMSA"),carg=visitsFor(analysis,"CARGUIO");const sap=currentTs(p,"TIMESTAMP SALIDA SAP")??currentTs(p,"TIMESTAMP INGRESO SAP")??currentTs(p,"FECHA DE CARGA");let J=existing.J;if(!J){let row=null;if(existing.I)row=carOut.find(x=>parseAny(x.fecha)>existing.I);else row=pickClosest(carOut,sap,18);if(row){J=parseAny(row.fecha);out.salida_caracoto=row.fecha}}let I=existing.I;if(!I){const rows=carIn.filter(x=>!J||parseAny(x.fecha)<J);const lower=Number.isFinite(sap)?sap-36*3600000:-Infinity;const row=[...rows].reverse().find(x=>parseAny(x.fecha)>=lower);if(row){I=parseAny(row.fecha);out.llegada_caracoto=row.fecha}}const hLimit=I||J;if(!existing.H&&hLimit){const rows=rac.filter(v=>v.salida&&parseAny(v.salida)<=hLimit&&parseAny(v.ingreso)>=hLimit-24*3600000);const v=rows.at(-1);if(v)out.salida_base=v.salida}if(I&&J){const v=carg.filter(x=>parseAny(x.ingreso)>=I&&parseAny(x.ingreso)<=J&&x.salida&&parseAny(x.salida)<=J).sort((a,b)=>b.permanencia_minutos-a.permanencia_minutos)[0];if(v){if(!existing.IC)out.ingreso_carguio=v.ingreso;if(!existing.SC&&v.salida)out.salida_carguio=v.salida}}let M=existing.M;if(!M&&J){const lower=Math.max(J,existing.K||-Infinity,existing.L||-Infinity),row=smIn.find(x=>parseAny(x.fecha)>lower&&(!existing.N||parseAny(x.fecha)<existing.N)&&(!existing.O||parseAny(x.fecha)<existing.O));if(row){M=parseAny(row.fecha);out.ingreso_smcv=row.fecha}}let N=existing.N;if(!N&&M){const row=smOut.find(x=>parseAny(x.fecha)>M&&(!existing.O||parseAny(x.fecha)<existing.O));if(row){N=parseAny(row.fecha);out.salida_smcv=row.fecha}}if(J){const limitM=M||Infinity,v=rac.find(x=>parseAny(x.ingreso)>J&&parseAny(x.ingreso)<limitM&&(!x.salida||parseAny(x.salida)<=limitM));if(v){if(!existing.K)out.llegada_base=v.ingreso;if(!existing.L&&v.salida)out.salida_base_cargado=v.salida}}if(!existing.O&&(N||M)){const lower=N||M,v=rac.find(x=>parseAny(x.ingreso)>lower);if(v)out.llegada_base_vacio=v.ingreso}return out}
function stopKey(p){const ini=parseAny(p?.inicio),fin=parseAny(p?.fin);return`${String(p?.tipo||p?.tipo_parada||"").toUpperCase()}|${Number.isFinite(ini)?ini:String(p?.inicio||"")}|${Number.isFinite(fin)?fin:String(p?.fin||"")}`}
function candidateOc(candidate,ocs){if(!ocs?.length)return null;const t=parseAny(candidate.inicio);let best=ocs[0],bestTs=-Infinity;for(const o of ocs){const p=o.payload||{},anchor=currentTs(p,"TIMESTAMP INGRESO SAP")??currentTs(p,"FECHA DE CARGA");if(Number.isFinite(anchor)&&anchor<=t&&anchor>bestTs){best=o;bestTs=anchor}}return best}

function homeV3(c){return async()=>{
  const d=await c.get("resumen"),serverRange=serverToPE(d.rango_gps_desde),range=serverRange||localStorage.getItem("cv_corte")||"",m=meta(),cc=counts();
  if(serverRange)localStorage.setItem("cv_corte",serverRange);
  c.$("content").innerHTML=`
    <section class="cv-home-head">
      <div><p class="eyebrow">CERRO VERDE · OPERACIÓN REAL</p><h1>Seguimiento y control operativo</h1></div>
      <p class="cv-last-update">Última actualización: <b>${c.esc(serverToPE(d.ultima_actividad)||range||"—")}</b></p>
    </section>
    <section class="cv-home-grid">
      <article class="panel cv-kpi"><small>GRUPO SMCV ACTIVO</small><h2>${d.unidades}</h2><p>${d.cal_vacio} CAL VACÍO · ${d.cal_cargado} CAL CARGADO</p></article>
      <article class="panel cv-kpi"><small>ENTREGAS ABIERTAS</small><h2>${d.ocs_abiertas}</h2><p>Despachos DIARIO vigentes.</p></article>
      <article class="panel cv-kpi"><small>PRECARGA</small><h2 id="cv-home-preload">${label()}</h2><p>${cc.done}/${cc.total||d.unidades} unidades procesadas.</p></article>
      <article class="panel cv-kpi"><small>ESTADO</small><h2>${m?.completo?"COMPLETA":"OPERATIVO"}</h2><p>${m?.desde&&m?.hasta?`${c.esc(m.desde)} → ${c.esc(m.hasta)}`:"Sin ejecución completa."}</p></article>
    </section>
    <section class="panel cutoff-panel cv-cutoff">
      <div><h2>Fecha y hora del último seguimiento confirmado</h2><p class="muted">Inicio exacto de la siguiente descarga CLocator.</p></div>
      <div class="cutoff-editor"><input id="cut" type="datetime-local" step="1" value="${c.esc(peToInput(range))}"><button id="save-cut">GUARDAR FECHA</button></div>
      <p id="cut-msg" class="muted">Rango vigente: ${c.esc(range||"—")}</p>
    </section>`;
  const button=c.$("save-cut");
  button.onclick=async()=>{
    const previous=localStorage.getItem("cv_corte")||range,value=inputToPE(c.$("cut").value);
    button.disabled=true;button.textContent="GUARDANDO…";c.$("cut-msg").textContent="Registrando y verificando el corte…";
    try{
      await c.post(c.END.sap,{action:"actualizar_corte",fecha_local:value});
      const verified=await c.get("resumen"),confirmed=serverToPE(verified.rango_gps_desde);
      if(!confirmed)throw Error("El servidor no devolvió la fecha confirmada");
      localStorage.setItem("cv_corte",confirmed);c.$("cut").value=peToInput(confirmed);
      c.$("cut-msg").innerHTML=`<b>FECHA GUARDADA:</b> ${c.esc(confirmed)} · Precarga y Seguimiento usarán este corte.`;
    }catch(e){
      localStorage.setItem("cv_corte",previous);
      c.$("cut-msg").innerHTML=`<span class="cut-error">NO SE GUARDÓ:</span> ${c.esc(e.message||e)}`;
    }finally{button.disabled=false;button.textContent="GUARDAR FECHA"}
  };
  renderProgress();
}}
function preload(c){return async()=>{
  const listStatus=await c.post(c.END.track,{action:"lista"}),baseReady=listStatus.schema_ready!==false;
  bg.units=(baseReady?(listStatus.placas||[]).map(x=>({placa:x.placa,tracto:x.tracto})):await units(c));bg.meta=meta();
  c.$("content").innerHTML=`
    <section class="cv-page-head"><div><p class="eyebrow">CERRO VERDE · PRECARGA</p><h1>Precargar rutas</h1><p>Continúa en segundo plano al navegar. Máximo dos intentos por unidad.</p></div><b id="cv-preload-global" class="preload-top-state">${label()}</b></section>
    ${baseReady?"":`<section class="notice preload-base-warning"><b>BASE WEB PENDIENTE DE RECONCILIACIÓN.</b> La lista actual todavía corresponde a la base anterior. No reinicie ni continúe la precarga hasta aplicar la migración CERRO VERDE; así evitamos volver a descargar unidades incorrectas.</section>`}
    <section class="panel preload-control">
      <div class="panel-title preload-title">
        <div><h2>Control de precarga</h2><p id="cv-run-range" class="muted">Preparando rango…</p></div>
        <div class="preload-actions">
          <button id="cv-p-start" class="preload-primary">INICIAR PRECARGA</button>
          <button id="cv-p-stop" class="preload-secondary" disabled>DETENER</button>
          <button id="cv-p-reset" class="preload-danger">REINICIAR PRECARGA</button>
        </div>
      </div>
      <div id="cv-p-health" class="preload-health">CLocator pendiente de verificación.</div>
      <div class="preload-summary">
        <span><small>PROCESADAS</small><b id="cv-p-done">0</b></span>
        <span><small>PENDIENTES</small><b id="cv-p-pending">${bg.units.length}</b></span>
        <span><small>REINTENTOS</small><b id="cv-p-retry">0</b></span>
        <span><small>ERRORES FINALES</small><b id="cv-p-errors">0</b></span>
        <span><small>UNIDADES</small><b id="cv-p-total">${bg.units.length}</b></span>
      </div>
      <div class="preload-bar"><i id="cv-p-bar"></i></div>
    </section>
    <section class="panel preload-units-panel">
      <div class="panel-title"><div><h2>Unidades de la ejecución</h2><p class="muted">Misma lectura compacta usada en CEMENTO: una fila clara por unidad.</p></div></div>
      <div class="preload-table-wrap">
        <table class="preload-table">
          <thead><tr><th>#</th><th>TRACTO</th><th>PLACA</th><th>PUNTOS</th><th>ESTADO</th><th>DETALLE</th></tr></thead>
          <tbody>${bg.units.map((u,i)=>`<tr><td>${i+1}</td><td><b>${c.esc(u.tracto)}</b></td><td>${c.esc(u.placa)}</td><td id="cv-pts-${i}">—</td><td><span id="cv-s-${i}" class="preload-state">PENDIENTE</span></td><td id="cv-msg-${i}" class="preload-message"></td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>`;
  const start=c.$("cv-p-start"),stop=c.$("cv-p-stop"),reset=c.$("cv-p-reset");
  if(!baseReady){start.dataset.locked="1";reset.dataset.locked="1";start.disabled=true;reset.disabled=true}
  start.onclick=()=>{if(!baseReady){void notice("BASE PENDIENTE","Aplique primero la migración CERRO VERDE; la precarga actual aún contiene la población anterior.");return}launchPreload(c,bg.units,{fresh:!!meta()?.completo}).catch(e=>void notice("PRECARGA CERRO VERDE",e.message||String(e)))};
  stop.onclick=()=>{bg.stop=true;bg.controller?.abort()};
  reset.onclick=async()=>{if(!baseReady)return notice("BASE PENDIENTE","Aplique primero la migración CERRO VERDE antes de reiniciar la precarga.");
    if(!await ask("REINICIAR PRECARGA",`Se iniciará una ejecución nueva desde la FECHA DE ÚLTIMO SEGUIMIENTO guardada hasta la hora actual.

No se borra SAP, DIARIO, HISTÓRICO, revisiones ni paradas validadas. La caché GPS anterior se usa sólo para conservar la última posición si una unidad no reporta movimiento.`,"REINICIAR",true))return;
    try{
      if(bg.running){bg.stop=true;bg.controller?.abort();for(let i=0;i<40&&bg.running;i++)await new Promise(r=>setTimeout(r,100))}
      localStorage.removeItem(META);localStorage.removeItem("cv_precarga_activa_v4");bg.meta=null;bg.stop=false;
      await launchPreload(c,bg.units,{fresh:true});
    }catch(e){await notice("NO SE PUDO REINICIAR",e.message||String(e))}
  };
  renderProgress();
}}

function launchPreload(c,list,options={}){
  if(bg.promise)return bg.promise;
  bg.lastError=null;
  const task=run(c,list,options);
  bg.promise=task;
  task.catch(e=>{bg.lastError=e;console.error("[CERRO VERDE] Precarga en segundo plano:",e)}).finally(()=>{if(bg.promise===task)bg.promise=null;renderProgress()});
  return task;
}

function analysisWindow(analysis,oc){
  if(!analysis)return analysis;
  const lo=parseAny(oc?.ventana_desde),hi=parseAny(oc?.ventana_hasta);
  const inRange=v=>{const t=parseAny(v);return Number.isFinite(t)&&(!Number.isFinite(lo)||t>=lo)&&(!Number.isFinite(hi)||t<hi)};
  const overlaps=(a,b)=>{const x=parseAny(a),y=parseAny(b);if(!Number.isFinite(x)&&!Number.isFinite(y))return false;return(!Number.isFinite(hi)||!Number.isFinite(x)||x<hi)&&(!Number.isFinite(lo)||!Number.isFinite(y)||y>=lo)};
  return{
    ...analysis,
    eventos_geocerca:(analysis.eventos_geocerca||[]).filter(x=>inRange(x.fecha)),
    visitas_confirmadas:(analysis.visitas_confirmadas||[]).filter(x=>overlaps(x.ingreso,x.salida||x.ingreso)),
    paradas_candidatas:(analysis.paradas_candidatas||[]).filter(x=>overlaps(x.inicio,x.fin||x.inicio)),
  };
}
function cycleOwner(candidate,ocs){
  if(!ocs?.length)return null;
  const t=parseAny(candidate?.inicio);
  for(const o of ocs){const lo=parseAny(o.ventana_desde),hi=parseAny(o.ventana_hasta);if(Number.isFinite(t)&&(!Number.isFinite(lo)||t>=lo)&&(!Number.isFinite(hi)||t<hi))return o}
  return candidateOc(candidate,ocs);
}
const ESTADO_OPTIONS=["","ESTACIONADO CARGADO","ESTACIONADO VACIO","TRANSITO CARGADO","TRANSITO VACIO","PROCESO DE DESCARGUIO"];
function estadoSelect(c,value){const current=String(value||"").trim(),opts=[...ESTADO_OPTIONS];if(current&&!opts.includes(current))opts.push(current);return `<select data-field="estado">${opts.map(v=>`<option value="${c.esc(v)}" ${v===current?"selected":""}>${c.esc(v||"SELECCIONE ESTADO")}</option>`).join("")}</select>`}

const CYCLE_FIELDS=[
  ["salida_base","SALIDA RACIEMSA","SALIDA DE BASE RACIEMSA"],
  ["llegada_caracoto","LLEGADA CARACOTO","LLEGADA A CARACOTO"],
  ["salida_caracoto","SALIDA CARACOTO","SALIDA DE CARACOTO"],
  ["llegada_base","LLEGADA RACIEMSA","LLEGADA A BASE RACIEMSA"],
  ["salida_base_cargado","SALIDA RACIEMSA CARGADO","SALIDA DE BASE RACIEMSA CARGADO"],
  ["ingreso_smcv","INGRESO SMCV","INGRESO A SMCV"],
  ["salida_smcv","SALIDA SMCV","SALIDA DE SMCV"],
  ["llegada_base_vacio","LLEGADA RACIEMSA VACÍO","LLEGADA A BASE RACIEMSA VACIO"],
];
function cycleCard(c,o,analysis,index,total,schemaReady=true){
  const p=o.payload||{},a=analysisWindow(analysis,o),s=cycleSuggestions(p,a),older=!!o.tiene_despacho_posterior;
  const status=o.preparado_cierre?'<span class="cycle-badge closed">CIERRE PREPARADO</span>':older?'<span class="cycle-badge warning">DESPACHO POSTERIOR DETECTADO</span>':'<span class="cycle-badge current">ACTUAL</span>';
  const warning=o.requiere_cierre_por_despacho_posterior?`<div class="cycle-warning"><b>RESOLVER ESTE CICLO.</b> Existe el despacho ${c.esc(o.siguiente_entrega||"")} posterior. El ciclo anterior no puede quedar abierto; no se inventarán hitos GPS faltantes.</div>`:"";
  const rows=CYCLE_FIELDS.map(([key,label,col])=>{const rawVal=p[col]||"",rawGps=s[key]||"",val=displayTs(rawVal),gps=displayTs(rawGps);return`<label class="hour-row"><b>${c.esc(label)}</b><input data-field="${key}" value="${c.esc(val)}" placeholder="dd/mm/aaaa hh:mm:ss"><small title="Sugerencia GPS">${gps?c.esc(gps):"SIN SUGERENCIA"}</small><button type="button" data-use="${key}" ${gps?"":"disabled"}>USAR</button></label>`}).join("");
  return`<article class="cycle-card ${o.preparado_cierre?"cycle-prepared":""}" data-id="${o.id}" data-index="${index}">
    <header class="cycle-head"><div><small>DESPACHO ${index+1} DE ${total}</small><h3>ENTREGA ${c.esc(o.orden_carga)}</h3><p>FECHA DE CARGA: <b>${c.esc(displayTs(p["FECHA DE CARGA"]||"—"))}</b></p></div>${status}</header>
    ${warning}
    <div class="hours-grid">${rows}</div>
    <button type="button" class="use-all" data-use-all>USAR TODAS LAS SUGERENCIAS GPS</button>
    <div class="state-grid compact-state"><label>ESTADO${estadoSelect(c,p.ESTADO||"")}</label><label>MONITOREO<input data-field="monitoreo" value="${c.esc(p.MONITOREO||"")}"></label><label>OBSERVACIÓN<textarea data-field="observacion">${c.esc(p.OBSERVACION||"")}</textarea></label></div>
    <div class="cv-actions"><button type="button" data-save>GUARDAR AVANCE</button><button type="button" data-close ${o.preparado_cierre||!schemaReady?"disabled":""}>${o.preparado_cierre?"CIERRE PREPARADO":!schemaReady?"BASE PENDIENTE":"CERRAR OC"}</button></div>
  </article>`;
}
function paradasV3(c){return async()=>{
  const s=await c.post(
    c.END.report,
    {action:"paradas_estado"}
  );

  const pending=s.pendientes||[];
  const revisables=s.sin_reporte_gps||[];
  const drafts=new Map();

  const normZone=v=>String(v||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toUpperCase()
    .replace(/\s+/g," ")
    .trim();

  const autoValid=(expected,actual)=>{
    const e=normZone(expected);
    const a=normZone(actual);

    if(!e||!a)return false;

    if(e==="YURA")
      return a==="PLANTA YURA";

    if(e==="AREQUIPA")
      return [
        "AREQUIPA",
        "RACIEMSA",
        "PLANTA YURA"
      ].includes(a);

    return e===a;
  };

  const draftKey=x=>{
    const eventId=Number(x?.evento_origen_id);

    if(Number.isFinite(eventId)&&eventId>0)
      return `E:${eventId}`;

    return `ENT:${String(x?.entrega_sap||"")}`;
  };

  for(const x of pending){
    const eventId=Number(x.evento_origen_id);

    drafts.set(
      draftKey(x),
      {
        key:draftKey(x),

        evento_origen_id:
          Number.isFinite(eventId)&&eventId>0
            ?eventId
            :null,

        entrega_sap:
          String(x.entrega_sap||""),

        decision:"",
        auto:false,

        zona_original:
          String(x.zona_detectada||""),

        zona:
          String(x.zona_detectada||""),

        limite:
          String(x.limite_permitido||""),

        observacion:
          String(x.observacion||"")
      }
    );
  }

  const card=x=>{
    const key=draftKey(x);

    return `
      <article
        class="pernocte-validation-card batch-validation"
        data-key="${c.esc(key)}"
      >
        <header>
          <div>
            <h3>
              ${c.esc(x.codigo_tracto||"—")}
              ·
              ${c.esc(x.placa||"—")}
            </h3>

            <small>
              ENTREGA ${c.esc(x.entrega_sap||"—")}
              ·
              ${c.esc(x.conductor||"—")}
            </small>
          </div>

          <span class="pernocte-proposal pendiente">
            REVISIÓN MANUAL
          </span>
        </header>

        <div class="pernocte-data">

          <div>
            <b>SALIDA CARACOTO</b>
            <span>
              ${c.esc(x.salida_caracoto||"—")}
            </span>
          </div>

          <div>
            <b>LÍMITE PERMITIDO</b>
            <span>
              ${c.esc(x.limite_permitido||"—")}
            </span>
          </div>

          <div class="editable-zone">
            <b>PERNOCTÓ EN</b>

            <input
              type="text"
              data-zone
              value="${c.esc(x.zona_detectada||"")}"
              spellcheck="false"
            >

            <small data-zone-state>
              EDITABLE · CORRIJA SOLO SI HAY ERROR DE DIGITACIÓN
            </small>
          </div>

          <div>
            <b>PERNOCTE</b>
            <span>
              ${c.esc(x.inicio||"—")}
              →
              ${c.esc(x.fin||"—")}
            </span>
          </div>

        </div>

        <textarea
          data-obs
          placeholder="Observación opcional de la validación"
        >${c.esc(x.observacion||"")}</textarea>

        <div class="pernocte-decision batch-decision">

          <button
            type="button"
            class="yes"
            data-decision="SI"
          >
            SI
          </button>

          <button
            type="button"
            class="no"
            data-decision="NO"
          >
            NO
          </button>

          <button
            type="button"
            data-decision="SIN REPORTE GPS"
            style="
              background:#475569;
              color:white;
              border-color:#475569;
            "
          >
            SIN REPORTE GPS
          </button>

          <span data-decision-state>
            SIN SELECCIONAR
          </span>

        </div>
      </article>
    `;
  };

  const revisableCard=x=>`
    <article
      class="pernocte-validation-card"
      data-sin-gps-id="${c.esc(x.id)}"
    >
      <header>
        <div>
          <h3>
            ${c.esc(x.codigo_tracto||"—")}
            ·
            ${c.esc(x.placa||"—")}
          </h3>

          <small>
            ENTREGA ${c.esc(x.entrega_sap||"—")}
            ·
            ${c.esc(x.conductor||"—")}
          </small>
        </div>

        <span
          class="pernocte-proposal pendiente"
          style="
            background:#e2e8f0;
            color:#334155;
          "
        >
          SIN REPORTE GPS
        </span>
      </header>

      <div class="pernocte-data">

        <div>
          <b>SALIDA CARACOTO</b>
          <span>
            ${c.esc(x.salida_caracoto||"—")}
          </span>
        </div>

        <div>
          <b>LÍMITE PERMITIDO</b>
          <span>
            ${c.esc(x.limite_permitido||"—")}
          </span>
        </div>

        <div>
          <b>PERNOCTÓ EN</b>
          <span>
            ${c.esc(x.pernocto_en||"SIN REGISTRO")}
          </span>
        </div>

        <div>
          <b>ESTADO</b>
          <span>
            SIN REPORTE GPS
          </span>
        </div>

      </div>

      <div class="pernocte-decision">

        <button
          type="button"
          data-reopen
          style="
            background:#334155;
            color:white;
            border-color:#334155;
          "
        >
          REABRIR VALIDACIÓN
        </button>

        <span>
          REVISABLE
        </span>

      </div>
    </article>
  `;

  c.$("content").innerHTML=`
    <p class="eyebrow">
      CERRO VERDE · PARADAS
    </p>

    <h1>
      Pernoctes y pausas activas
    </h1>

    <p>
      Los casos que cumplen las reglas automáticas ya no requieren revisión.
      Aquí aparecen únicamente las excepciones.
    </p>

    <section class="notice">
      <b>VALIDACIÓN MANUAL:</b>
      seleccione SI, NO o SIN REPORTE GPS.
      Los casos SIN REPORTE GPS dejan de bloquear el ENVIABLE,
      pero permanecen disponibles para reabrirlos posteriormente.
    </section>

    <section class="pernocte-toolbar">

      <article class="panel">
        <small>VALIDACIÓN PENDIENTE</small>
        <h1>${pending.length}</h1>
        <p>Casos que requieren revisión manual.</p>
      </article>

      <article class="panel">
        <small>REVISIÓN INTERNA</small>
        <h1>${s.pernoctes_revision||0}</h1>

        <p>
          Información operativa interna desde 01/09/2026.
        </p>

        <button id="pernoctes-revision">
          DESCARGAR INTERNO
        </button>
      </article>

      <article class="panel">
        <small>ENVIABLE CLIENTE</small>

        <h1>
          ${s.pernoctes_enviable||0}
        </h1>

        <p class="report-cutoff">
          Desde 09/09/2026 · sólo unidades con código R válido.
        </p>

        <button
          id="pernoctes-enviable"
          ${pending.length?"disabled":""}
        >
          DESCARGAR ENVIABLE
        </button>
      </article>

    </section>

    ${
      pending.length
        ?`
          <div class="pending-warning">
            <b>
              ${pending.length}
              pernocte(s) requieren revisión.
            </b>
            Los válidos por regla automática ya fueron excluidos.
          </div>
        `
        :`
          <div class="pending-ok">
            <b>Sin pernoctes pendientes.</b>
            El ENVIABLE puede generarse.
          </div>
        `
    }

    <section class="panel">

      <div class="panel-title">
        <div>
          <h2>PERNOCTES POR VALIDAR</h2>

          <p class="muted">
            Seleccione todos los casos y guarde una sola vez.
          </p>
        </div>
      </div>

      <div class="pernocte-pending-list">
        ${
          pending.length
            ?pending.map(card).join("")
            :`
              <div class="pernocte-empty">
                No hay pernoctes nuevos pendientes de validación.
              </div>
            `
        }
      </div>

    </section>

    ${
      pending.length
        ?`
          <section class="pernocte-batch-bar">

            <div>
              <small>SELECCIONADOS</small>

              <b id="batch-validation-count">
                0/${pending.length}
              </b>
            </div>

            <button
              id="validate-selected"
              disabled
            >
              GUARDAR VALIDACIONES
            </button>

          </section>
        `
        :""
    }

    <section
      class="panel"
      style="margin-top:16px"
    >

      <div class="panel-title">
        <div>
          <h2>SIN REPORTE GPS / REVISABLES</h2>

          <p class="muted">
            Estos casos no bloquean el ENVIABLE.
            Permanecen visibles para poder reabrirlos
            cuando exista nueva información GPS.
          </p>
        </div>

        <strong>
          ${revisables.length}
        </strong>
      </div>

      <div class="pernocte-pending-list">
        ${
          revisables.length
            ?revisables.map(revisableCard).join("")
            :`
              <div class="pernocte-empty">
                No hay casos SIN REPORTE GPS.
              </div>
            `
        }
      </div>

    </section>
  `;

  const download=async(action,fallback)=>{
    const x=await c.post(
      c.END.report,
      {action},
      true
    );

    const a=document.createElement("a");

    a.href=URL.createObjectURL(x.blob);
    a.download=x.name||fallback;

    document.body.append(a);
    a.click();
    a.remove();

    setTimeout(
      ()=>URL.revokeObjectURL(a.href),
      1000
    );
  };

  c.$("pernoctes-revision").onclick=async()=>{
    const b=c.$("pernoctes-revision");
    const old=b.textContent;

    b.disabled=true;
    b.textContent="GENERANDO…";

    try{
      await download(
        "pernoctes_revision",
        "REPORTE_INTERNO_PERNOCTES_CERRO_VERDE.xlsx"
      );
    }catch(e){
      await notice(
        "NO SE PUDO GENERAR",
        e.message||String(e)
      );
    }finally{
      if(b.isConnected){
        b.disabled=false;
        b.textContent=old;
      }
    }
  };

  const enviable=c.$("pernoctes-enviable");

  if(enviable&&!enviable.disabled){
    enviable.onclick=async()=>{
      const old=enviable.textContent;

      enviable.disabled=true;
      enviable.textContent="GENERANDO…";

      try{
        await download(
          "pernoctes_enviable",
          "ENVIABLE_PERNOCTES_CERRO_VERDE_DESDE_09_09_2026.xlsx"
        );
      }catch(e){
        await notice(
          "NO SE PUDO GENERAR",
          e.message||String(e)
        );
      }finally{
        if(enviable.isConnected){
          enviable.disabled=false;
          enviable.textContent=old;
        }
      }
    };
  }

  const refreshCard=card=>{
    const key=String(card.dataset.key||"");
    const d=drafts.get(key);

    if(!d)return;

    card
      .querySelectorAll("[data-decision]")
      .forEach(btn=>{
        btn.classList.toggle(
          "selected",
          btn.dataset.decision===d.decision
        );
      });

    const state=
      card.querySelector("[data-decision-state]");

    if(state){
      if(d.auto){
        state.textContent=
          "SI · VALIDADO POR REGLA";

        state.className="auto";

      }else if(d.decision==="SI"){
        state.textContent="SI SELECCIONADO";
        state.className="yes";

      }else if(d.decision==="NO"){
        state.textContent="NO SELECCIONADO";
        state.className="no";

      }else if(d.decision==="SIN REPORTE GPS"){
        state.textContent=
          "SIN REPORTE GPS SELECCIONADO";

        state.className="";

      }else{
        state.textContent="SIN SELECCIONAR";
        state.className="";
      }
    }

    const zoneState=
      card.querySelector("[data-zone-state]");

    if(zoneState){
      const changed=
        normZone(d.zona)
        !==
        normZone(d.zona_original);

      if(changed&&d.auto){
        zoneState.textContent=
          "CORREGIDO · COINCIDE CON REGLA AUTOMÁTICA";

        zoneState.className="ok";

      }else if(changed){
        zoneState.textContent=
          "CORREGIDO · REQUIERE DECISIÓN MANUAL";

        zoneState.className="changed";

      }else{
        zoneState.textContent=
          "EDITABLE · CORRIJA SOLO SI HAY ERROR DE DIGITACIÓN";

        zoneState.className="";
      }
    }

    card.classList.toggle(
      "decision-ready",
      !!d.decision
    );
  };

  const refreshCount=()=>{
    const selected=[
      ...drafts.values()
    ].filter(
      d=>d.decision
    ).length;

    const count=
      c.$("batch-validation-count");

    const saveBtn=
      c.$("validate-selected");

    if(count){
      count.textContent=
        `${selected}/${pending.length}`;
    }

    if(saveBtn){
      saveBtn.disabled=!selected;

      saveBtn.textContent=
        selected
          ?`GUARDAR VALIDACIONES (${selected})`
          :"GUARDAR VALIDACIONES";
    }
  };

  document
    .querySelectorAll(
      ".pernocte-validation-card[data-key]"
    )
    .forEach(card=>{

      const key=
        String(card.dataset.key||"");

      const d=
        drafts.get(key);

      if(!d)return;

      const zone=
        card.querySelector("[data-zone]");

      const obs=
        card.querySelector("[data-obs]");

      zone.oninput=()=>{
        d.zona=zone.value.trim();

        const valid=
          autoValid(
            d.limite,
            d.zona
          );

        if(valid){
          d.decision="SI";
          d.auto=true;

        }else if(d.auto){
          d.decision="";
          d.auto=false;
        }

        refreshCard(card);
        refreshCount();
      };

      obs.oninput=()=>{
        d.observacion=obs.value;
      };

      card
        .querySelectorAll("[data-decision]")
        .forEach(btn=>{

          btn.onclick=()=>{
            d.decision=
              btn.dataset.decision;

            d.auto=false;

            refreshCard(card);
            refreshCount();
          };
        });

      refreshCard(card);
    });

  refreshCount();

  const saveBtn=
    c.$("validate-selected");

  if(saveBtn){
    saveBtn.onclick=async()=>{

      const rows=[
        ...drafts.values()
      ]
        .filter(d=>d.decision)
        .map(d=>({
          evento_origen_id:
            d.evento_origen_id,

          entrega_sap:
            d.entrega_sap,

          cumple_final:
            d.decision,

          observacion:
            d.observacion.trim(),

          zona_detectada:
            d.zona.trim()
        }));

      if(!rows.length)return;

      if(!await ask(
        "GUARDAR VALIDACIONES",
        `Se guardarán ${rows.length} validación(es). Los casos SIN REPORTE GPS dejarán de bloquear el ENVIABLE y permanecerán disponibles para reabrir.`,
        "GUARDAR",
        false
      ))return;

      const old=
        saveBtn.textContent;

      saveBtn.disabled=true;
      saveBtn.textContent="GUARDANDO…";

      try{
        const out=await c.post(
          c.END.report,
          {
            action:"validar_pernoctes_lote",
            validaciones:rows
          }
        );

        await notice(
          "VALIDACIONES GUARDADAS",
          `${out.guardadas||0} registro(s) guardados. `+
          `${out.automaticas||0} por regla automática, `+
          `${out.manuales||0} por decisión manual y `+
          `${out.sin_reporte_gps||0} SIN REPORTE GPS.`
        );

        await c.routes.paradas();

      }catch(e){
        await notice(
          "NO SE PUDO GUARDAR",
          e.message||String(e)
        );

        saveBtn.disabled=false;
        saveBtn.textContent=old;
      }
    };
  }

  document
    .querySelectorAll("[data-reopen]")
    .forEach(btn=>{

      btn.onclick=async()=>{

        const card=
          btn.closest("[data-sin-gps-id]");

        const id=
          Number(card?.dataset.sinGpsId);

        if(!await ask(
          "REABRIR VALIDACIÓN",
          "El caso volverá a evaluarse con la información GPS disponible. Si todavía no existe evidencia suficiente volverá a quedar pendiente.",
          "REABRIR",
          false
        ))return;

        btn.disabled=true;

        try{
          await c.post(
            c.END.report,
            {
              action:
                "reabrir_pernocte_sin_gps",

              id
            }
          );

          await c.routes.paradas();

        }catch(e){
          await notice(
            "NO SE PUDO REABRIR",
            e.message||String(e)
          );

          btn.disabled=false;
        }
      };
    });
}}



function reportV3(c){return async()=>{
  const [s,d]=await Promise.all([c.post(c.END.report,{action:"estado"}),c.post(c.END.report,{action:"convoy_datos"})]),rows=d.convoy||[],tractos=d.tractos||[],carretas=d.carretas||[],conductores=d.conductores||[];
  const byTract=new Map,byPlate=new Map,byTrailer=new Map,byTrailerPlate=new Map,byDriver=new Map,byLicense=new Map;
  for(const m of tractos){byTract.set(norm(m.codigo_sap),m);byPlate.set(norm(m.placa),m)}
  for(const m of carretas){byTrailer.set(norm(m.codigo_sap),m);byTrailerPlate.set(norm(m.placa),m)}
  for(const m of conductores){byDriver.set(String(m.conductor||"").trim().toUpperCase(),m);byLicense.set(norm(m.licencia),m)}
  const findTract=v=>byTract.get(norm(v))||byPlate.get(norm(v)),findTrailer=v=>byTrailer.get(norm(v))||byTrailerPlate.get(norm(v)),findDriver=v=>byDriver.get(String(v||"").trim().toUpperCase())||byLicense.get(norm(v));
  const timeInput=v=>{if(!v)return"";const x=new Date(v);if(Number.isNaN(x.getTime()))return"";const z=n=>String(n).padStart(2,"0");return`${x.getUTCFullYear()}-${z(x.getUTCMonth()+1)}-${z(x.getUTCDate())}T${z(x.getUTCHours())}:${z(x.getUTCMinutes())}`};
  const rowHtml=(i,r)=>`<tr data-convoy-row="${i+1}"><td style="text-align:center;font-weight:900">${i+1}</td><td><input data-cv="conductor" list="cv-report-conductores" value="${c.esc(r.conductor||"")}" placeholder="conductor o licencia"></td><td><input data-cv="tracto" list="cv-report-tractos" value="${c.esc(r.codigo_tracto||"")}" placeholder="código o placa"></td><td><input data-cv="carreta" list="cv-report-carretas" value="${c.esc(r.codigo_carreta||"")}" placeholder="código o placa"></td>${[1,2,3,4].map(n=>`<td><input type="datetime-local" data-cv="hito_${n}" value="${c.esc(timeInput(r[`hito_${n}`]))}"></td>`).join("")}<td><input data-cv="estado" value="${c.esc(r.estado||"")}"></td><td><input data-cv="monitoreo" value="${c.esc(r.monitoreo||"")}"></td><td><input data-cv="observacion" value="${c.esc(r.observacion||"")}"></td></tr>`;
  c.$("content").innerHTML=`<p class="eyebrow">CERRO VERDE · REPORTE OPERATIVO</p><h1>Crear reporte</h1><p>El reporte se construye desde el GRUPO_SMCV activo. El CONVOY es información exclusiva del ENVIABLE y no interviene en SEGUIMIENTO.</p><section class="notice ${s.habilitado?"report-ready":"report-blocked"}"><b>${s.habilitado?"LISTO PARA DESCARGAR":"BLOQUEADO"}</b> · ${c.esc(s.mensaje||"")}</section><section class="cv-home-grid report-summary"><article class="panel"><small>UNIDADES</small><h2>${s.unidades_reporte}</h2><p>Una fila por placa activa.</p></article><article class="panel"><small>CAL VACÍO</small><h2>${s.cal_vacio}</h2></article><article class="panel"><small>CAL CARGADO</small><h2>${s.cal_cargado}</h2><p>PROCESO DE DESCARGUIO siempre se clasifica aquí.</p></article><article class="panel"><small>CONVOY</small><h2>${rows.filter(x=>x.codigo_tracto).length}/10</h2><p>Registro manual exclusivo del enviable.</p></article></section><section class="panel"><div class="panel-title"><div><h2>CONVOY / UNIDADES SIN DESPACHO</h2><p class="muted">Conductor, tracto y carreta sólo pueden seleccionarse desde los Maestros. Las 10 posiciones no modifican DIARIO/HISTÓRICO.</p></div><button id="cv-convoy-save">GUARDAR CONVOY</button></div><datalist id="cv-report-tractos">${tractos.map(m=>`<option value="${c.esc(m.codigo_sap)}">${c.esc(m.placa)}</option>`).join("")}</datalist><datalist id="cv-report-carretas">${carretas.map(m=>`<option value="${c.esc(m.codigo_sap)}">${c.esc(m.placa)}</option>`).join("")}</datalist><datalist id="cv-report-conductores">${conductores.map(m=>`<option value="${c.esc(m.conductor)}">${c.esc(m.licencia)}</option>`).join("")}</datalist><div style="overflow:auto;margin-top:10px"><table style="width:100%;min-width:1580px;border-collapse:separate;border-spacing:5px"><thead><tr><th>#</th><th>CONDUCTOR</th><th>TRACTO</th><th>CARRETA</th><th>HITO 1</th><th>HITO 2</th><th>HITO 3</th><th>HITO 4</th><th>ESTADO</th><th>MONITOREO</th><th>OBSERVACIÓN</th></tr></thead><tbody>${Array.from({length:10},(_,i)=>rowHtml(i,rows.find(x=>Number(x.posicion)===i+1)||{})).join("")}</tbody></table></div><p id="cv-convoy-msg" class="muted"></p></section><section class="panel"><div class="panel-title"><div><h2>REPORTE DIARIO CERRO VERDE</h2><p class="muted">Orden del ENVIABLE: CAL VACÍO → CONVOY (10 posiciones) → CAL CARGADO.</p></div><button id="cv-report-download" ${s.habilitado?"":"disabled"}>DESCARGAR EXCEL</button></div></section>`;
  document.querySelectorAll("[data-convoy-row]").forEach(tr=>{
    const ti=tr.querySelector('[data-cv="tracto"]'),ci=tr.querySelector('[data-cv="carreta"]'),di=tr.querySelector('[data-cv="conductor"]');
    ti.onchange=()=>{const m=findTract(ti.value);if(m)ti.value=m.codigo_sap};
    ci.onchange=()=>{if(!ci.value.trim())return;const m=findTrailer(ci.value);if(m)ci.value=m.codigo_sap};
    di.onchange=()=>{if(!di.value.trim())return;const m=findDriver(di.value);if(m)di.value=m.conductor};
  });
  c.$("cv-convoy-save").onclick=async()=>{const b=c.$("cv-convoy-save"),msg=c.$("cv-convoy-msg"),filas=[];for(const tr of document.querySelectorAll("[data-convoy-row]")){const q=k=>tr.querySelector(`[data-cv="${k}"]`),tract=findTract(q("tracto").value),driver=findDriver(q("conductor").value),trailer=q("carreta").value.trim()?findTrailer(q("carreta").value):null,pos=Number(tr.dataset.convoyRow);if(q("tracto").value.trim()&&!tract)return notice("CONVOY",`Posición ${pos}: el tracto no existe en Maestro.`);if(q("conductor").value.trim()&&!driver)return notice("CONVOY",`Posición ${pos}: el conductor no existe en Maestro.`);if(q("carreta").value.trim()&&!trailer)return notice("CONVOY",`Posición ${pos}: la carreta no existe en Maestro.`);filas.push({posicion:pos,codigo_tracto:tract?.codigo_sap||"",conductor:driver?.conductor||"",codigo_carreta:trailer?.codigo_sap||"",hito_1:q("hito_1").value,hito_2:q("hito_2").value,hito_3:q("hito_3").value,hito_4:q("hito_4").value,estado:q("estado").value.trim(),monitoreo:q("monitoreo").value.trim(),observacion:q("observacion").value.trim()})}b.disabled=true;msg.textContent="Guardando…";try{const out=await c.post(c.END.report,{action:"convoy_guardar",filas});msg.textContent=out.mensaje||"Convoy guardado."}catch(e){msg.textContent=e.message||String(e)}finally{b.disabled=false}};
  const b=c.$("cv-report-download");if(b&&!b.disabled)b.onclick=async()=>{b.disabled=true;b.textContent="GENERANDO…";try{const x=await c.post(c.END.report,{action:"excel"},true),a=document.createElement("a");a.href=URL.createObjectURL(x.blob);a.download=x.name||"REPORTE_DIARIO_CERRO_VERDE.xlsx";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){await notice("NO SE PUDO GENERAR",e.message||String(e))}finally{if(b.isConnected){b.disabled=false;b.textContent="DESCARGAR EXCEL"}}};
}}

function tracking(c){return async()=>{
  // CHECKPOINT 15/09 + correcciones acumuladas exclusivamente de SEGUIMIENTO.
  if(!localStorage.getItem("cv_prueba_integral_02_review_reset")){localStorage.removeItem("cv_revisadas");localStorage.setItem("cv_prueba_integral_02_review_reset","1")}
  let listResponse=await c.post(c.END.track,{action:"lista"});
  let schemaReady=listResponse.schema_ready!==false,unitList=listResponse.placas||[],reviewed=new Set(unitList.filter(x=>x.revisada).map(x=>x.placa)),idx=Math.min(Math.max(0,+localStorage.getItem("cv_indice")||0),Math.max(0,unitList.length-1)),selectedStopId=null,visiblePlate="",renderedPlate="";
  const refreshList=async(preferPlate="")=>{const old=preferPlate||unitList[idx]?.placa||"";listResponse=await c.post(c.END.track,{action:"lista"});schemaReady=listResponse.schema_ready!==false;unitList=listResponse.placas||[];reviewed=new Set(unitList.filter(x=>x.revisada).map(x=>x.placa));let ni=old?unitList.findIndex(x=>norm(x.placa)===norm(old)):-1;if(ni<0)ni=Math.min(idx,Math.max(0,unitList.length-1));idx=Math.max(0,ni);localStorage.setItem("cv_indice",String(idx))};
  const nextIndex=(from=idx)=>{if(!unitList.length)return 0;for(let step=1;step<=unitList.length;step++){const j=(from+step)%unitList.length;if(!unitList[j].revisada)return j}return(from+1)%unitList.length};
  const autoReviewNoMovement=async()=>{if(!schemaReady)return 0;let changed=0;for(const u of unitList){if(u.revisada||Number(u.despachos_abiertos??u.ocs??0)>0||Number(u.pendientes_anteriores||0)>0)continue;const g=await c.one("gps",u.placa);if(!g||stateOf(g)!=="SIN MOVIMIENTO")continue;try{await c.post(c.END.track,{action:"marcar_revisada",placa:u.placa,origen:"AUTO_SIN_MOVIMIENTO_SIN_DESPACHO"});changed++}catch(e){console.warn("[CERRO VERDE] autorevisión omitida",u.placa,e?.message||e)}}if(changed){await refreshList(unitList[idx]?.placa||"");if(unitList[idx]?.revisada)idx=nextIndex(idx)}return changed};
  const uiDrafts=new Map(),stopDrafts=new Map();
  const captureUi=plate=>{const key=norm(plate);if(!key)return;const state=uiDrafts.get(key)||{cycles:{},range:{},closedOpen:false};const from=c.$("from"),to=c.$("to");if(from)state.range.from=from.value;if(to)state.range.to=to.value;document.querySelectorAll(".cycle-card[data-id]").forEach(card=>{const id=String(card.dataset.id||"");if(!id)return;const values={};card.querySelectorAll("[data-field]").forEach(input=>{values[input.dataset.field]=input.value});state.cycles[id]=values});const closed=c.$("closed-list");if(closed)state.closedOpen=!closed.hidden;const desc=c.$("stop-desc");if(desc&&selectedStopId!=null)stopDrafts.set(`${key}:${selectedStopId}`,desc.value);uiDrafts.set(key,state)};
  const restoreUi=plate=>{const key=norm(plate),state=uiDrafts.get(key);if(!state)return;const from=c.$("from"),to=c.$("to");if(from&&state.range?.from)from.value=state.range.from;if(to&&state.range?.to)to.value=state.range.to;for(const [id,values] of Object.entries(state.cycles||{})){const card=document.querySelector(`.cycle-card[data-id="${id}"]`);if(!card)continue;for(const [field,value] of Object.entries(values||{})){const input=card.querySelector(`[data-field="${field}"]`);if(input)input.value=value}}const closed=c.$("closed-list");if(closed&&state.closedOpen){closed.hidden=false;const b=c.$("closed-toggle");if(b)b.textContent=`${closed.querySelectorAll(".closed-cycle-row").length} CERRADO${closed.querySelectorAll(".closed-cycle-row").length===1?"":"S"} · OCULTAR CERRADOS`}};
  const focusStop=stop=>{const map=mapRuntime.map,lat=+stop?.lat,lng=+stop?.lng;if(!map||!Number.isFinite(lat)||!Number.isFinite(lng))return;const pos={lat,lng};map.panTo(pos);if((map.getZoom?.()||0)<17)map.setZoom(17);try{mapRuntime.stopMarkers?.get(stop.id)?.setAnimation?.(google.maps.Animation.BOUNCE);setTimeout(()=>{try{mapRuntime.stopMarkers?.get(stop.id)?.setAnimation?.(null)}catch{}},650)}catch{}};
  c.$("content").innerHTML=`<div class="tracking-shell">${schemaReady?"":`<div class="tracking-schema-warning"><b>BASE WEB PENDIENTE DE RECONCILIACIÓN.</b> La vista puede abrirse, pero cierre/revisión/consolidación quedan bloqueados hasta aplicar la migración CERRO VERDE.</div>`}<header class="tracking-top"><b>CERRO VERDE · SEGUIMIENTO POR PLACA</b><span id="cv-preload-global" class="preload-top-state">${label()}</span><span id="pos">PLACA 0/0</span><span id="count">REVISADAS: 0/0</span><span id="oc-count">DESPACHOS: 0</span><button id="pause">PAUSAR Y VOLVER</button><button id="finish" ${schemaReady?"":"disabled"}>TERMINAR SEGUIMIENTO</button></header><div id="tracking-body"><section class="tracking-left"><div id="plate-nav"></div><div class="range-row"><input id="from" placeholder="DESDE"><input id="to" placeholder="HASTA"><button id="refresh">ACTUALIZAR PLACA</button></div><div class="map-wrap"><div id="cv-map">Seleccione una unidad.</div><button id="hours">VER HORAS</button></div><footer><span>AZUL: RECORRIDO</span><span>ROJO: ÚLTIMOS PUNTOS</span><span>P: PARADA</span><strong>GPS PROPONE · OPERADOR CONFIRMA</strong></footer></section><main class="tracking-center" id="cycle"></main><aside class="tracking-right" id="stops"></aside></div></div>`;
  const render=async({forceMap=false}={})=>{
    captureUi(renderedPlate);
    if(!unitList.length){resetMapVisual("SIN RECORRIDO DISPONIBLE");c.$("pos").textContent="PLACA 0/0";c.$("count").textContent="REVISADAS: 0/0";c.$("oc-count").textContent="DESPACHOS: 0";c.$("plate-nav").innerHTML='<div class="empty-cycle">No hay unidades activas en GRUPO_SMCV.</div>';c.$("cycle").innerHTML='<article class="empty-cycle"><h3>SIN UNIDADES PENDIENTES</h3></article>';c.$("stops").innerHTML="";return}
    idx=Math.min(idx,unitList.length-1);localStorage.setItem("cv_indice",String(idx));const u=unitList[idx],prev=unitList[(idx-1+unitList.length)%unitList.length],next=unitList[(idx+1)%unitList.length];const plateChanged=visiblePlate!==norm(u.placa);if(plateChanged){visiblePlate=norm(u.placa);resetMapVisual("Cargando recorrido…")}
    const x=await c.post(c.END.track,{action:"detalle",placa:u.placa}),openOcs=(x.ocs||[]).filter(o=>!o.preparado_cierre),closedOcs=(x.ocs||[]).filter(o=>o.preparado_cierre);u.revisada=!!x.revisada;u.ocs=openOcs.length;u.despachos_abiertos=openOcs.length;if(u.revisada)reviewed.add(u.placa);else reviewed.delete(u.placa);
    c.$("pos").textContent=`PLACA ${idx+1}/${unitList.length}`;c.$("count").textContent=`REVISADAS: ${reviewed.size}/${unitList.length}`;c.$("oc-count").textContent=`DESPACHOS: ${openOcs.length}`;
    const card=(v,kind)=>`<${kind==="current"?"b":"span"} class="plate-card ${kind} ${v?.revisada?"reviewed":""}"><small>${c.esc(v?.tracto||"—")}</small><strong>${c.esc(v?.placa||"—")}</strong>${Number(v?.despachos_abiertos??v?.ocs??0)>1?`<em>${Number(v?.despachos_abiertos??v?.ocs)} DESPACHOS</em>`:""}</${kind==="current"?"b":"span"}>`;
    c.$("plate-nav").innerHTML=`<div class="plate-nav"><button id="prev" title="Placa anterior">‹</button>${card(prev,"prev")}${card(u,"current")}${card(next,"next")}<button id="next" title="Placa siguiente">›</button></div>`;
    c.$("prev").onclick=()=>{idx=(idx-1+unitList.length)%unitList.length;selectedStopId=null;render()};c.$("next").onclick=()=>{idx=(idx+1)%unitList.length;selectedStopId=null;render()};
    let g=await c.one("gps",u.placa);if(g)g=await ensureAnalysis(g,c,u.placa);const analysis=g?.analisis||{},ignoredKey=`cv_ignored_${norm(u.placa)}`,ignored=new Set(JSON.parse(localStorage.getItem(ignoredKey)||"[]"));const candidates=(analysis.paradas_candidatas||[]).filter(v=>!ignored.has(v.id)&&!ignored.has(stopKey(v))).map((v,i)=>({...v,id:v.id||stopKey(v)||`S${i}`}));
    const lastValid=x.ultima_validada||null,hasOlderPending=(x.revision?.unresolved_previous||[]).length>0,openForOther=openOcs.length;
    if(!x.revisada&&!hasOlderPending&&openOcs.length===0&&g&&stateOf(g)==="SIN MOVIMIENTO"&&schemaReady){try{await c.post(c.END.track,{action:"marcar_revisada",placa:u.placa,origen:"AUTO_SIN_MOVIMIENTO_SIN_DESPACHO"});await refreshList(u.placa);idx=nextIndex(idx);selectedStopId=null;return render()}catch(e){console.warn("[CERRO VERDE] autorevisión no aplicada",e?.message||e)}}
    c.$("from").value=g?.desde||meta()?.desde||localStorage.getItem("cv_corte")||"";c.$("to").value=g?.hasta||meta()?.hasta||nowPE();
    const reviewLabel=x.revisada?"SIGUIENTE PLACA":hasOlderPending?`RESOLVER ${x.revision.unresolved_previous.length} DESPACHO(S) ANTERIOR(ES)`:"REVISADA Y SIGUIENTE";
    const closedHtml=closedOcs.length?`<section class="closed-cycles"><button id="closed-toggle" type="button">${closedOcs.length} CERRADO${closedOcs.length===1?"":"S"} · OCULTAR CERRADOS</button><div id="closed-list">${closedOcs.map(o=>`<article class="closed-cycle-row" data-closed-id="${o.id}"><div><b>ENTREGA ${c.esc(o.orden_carga)}</b><span>${c.esc(displayTs(o.payload?.["FECHA DE CARGA"]||"—"))}</span><em>CIERRE PREPARADO</em></div><button type="button" class="reopen-closed" data-reopen-id="${o.id}" data-reopen-entrega="${c.esc(o.orden_carga)}">REABRIR</button></article>`).join("")}</div></section>`:"";
    c.$("cycle").innerHTML=`<section class="unit-head ${x.revisada?"unit-reviewed":""}"><div class="unit-head-main"><h1>${c.esc(x.tracto)} · ${c.esc(x.placa)}</h1><div class="unit-meta"><span><b>CONDUCTOR</b>${c.esc(x.conductor||"—")}</span><span><b>CARRETA</b>${c.esc(x.carreta||"—")}</span><span><b>DESPACHOS ABIERTOS</b>${openOcs.length}</span><span><b>SECCIÓN</b>${c.esc(x.seccion||"—")}</span></div></div><div class="unit-actions"><button id="review" ${(!schemaReady||(hasOlderPending&&!x.revisada))?"disabled":""}>${reviewLabel}</button><button id="other-operation" class="remove-report" ${schemaReady?"":"disabled"}>RETIRAR DEL REPORTE</button></div></section>${openOcs.length?`<section class="nested-cycles"><div class="nested-title"><h2>DESPACHOS PENDIENTES</h2><p>Se revisan juntos y en orden cronológico. Una OC cerrada sale inmediatamente de esta lista.</p></div>${openOcs.map((o,i)=>cycleCard(c,o,analysis,i,openOcs.length,schemaReady)).join("")}</section>`:`<article class="empty-cycle"><h3>SIN DESPACHO ABIERTO</h3><p>La unidad permanece activa en GRUPO_SMCV. Revise su GPS; no se inventará ningún ciclo.</p></article>`}${closedHtml}<article id="candidate-editor" class="candidate-editor"><h3>VALIDACIÓN DE PARADA SELECCIONADA</h3><p>Seleccione una P roja o amarilla en el mapa o en la lista lateral.</p></article>`;
    if(closedOcs.length){c.$("closed-toggle").onclick=()=>{const box=c.$("closed-list"),b=c.$("closed-toggle"),show=box.hidden;box.hidden=!show;b.textContent=`${closedOcs.length} CERRADO${closedOcs.length===1?"":"S"} · ${show?"OCULTAR CERRADOS":"VER CERRADOS"}`};c.$("closed-list")?.querySelectorAll("[data-reopen-id]").forEach(btn=>{btn.onclick=async()=>{const id=Number(btn.dataset.reopenId);const ent=btn.dataset.reopenEntrega||"";if(!id)return;if(!await ask("REABRIR DESPACHO",`Se anulará el cierre preparado de la entrega ${ent} para poder editarlo en seguimiento.`,"REABRIR",false))return;btn.disabled=true;btn.textContent="…";try{await c.post(c.END.track,{action:"reabrir_despacho",id});await notice("REABIERTO",`Entrega ${ent}: cierre preparado anulado. Ya puede editar el despacho.`);await render()}catch(e){btn.disabled=false;btn.textContent="REABRIR";await notice("NO SE PUDO REABRIR",e.message||String(e))}}})}
    c.$("stops").innerHTML=`<h3>PARADAS CANDIDATAS</h3><b>${c.esc(u.placa)}</b><p>${candidates.length} candidato(s)</p><section class="validated"><h4>✓ ÚLTIMA PARADA VALIDADA · SOLO LECTURA</h4>${lastValid?`<article><b>✓ ${String(lastValid.tipo_parada||lastValid.tipo).toUpperCase()==="PAUSA_ACTIVA"?"PAUSA ACTIVA VALIDADA":"PERNOCTE VALIDADO"}</b><p>${c.esc(lastValid.inicio)} → ${c.esc(lastValid.fin)}</p><strong>${c.esc(lastValid.geocerca||"FUERA DE GEOCERCA")}</strong></article>`:"Sin paradas validadas para esta unidad."}</section><section class="candidate-list">${candidates.map(v=>`<button class="candidate ${v.tipo==="PERNOCTE"?"red":"yellow"}" data-stop="${c.esc(v.id)}"><b>${v.tipo==="PERNOCTE"?"POSIBLE PERNOCTE":"POSIBLE PAUSA ACTIVA"}</b><span>${c.esc(v.inicio)} → ${c.esc(v.fin)}</span><strong>${c.esc(formatDur(v.duracion_min))} · ${c.esc(v.geocerca||"FUERA DE GEOCERCA")}</strong></button>`).join("")||'<p class="no-candidates">Sin candidatos nuevos.</p>'}</section>`;
    const selectStop=id=>{const priorDesc=c.$("stop-desc");if(priorDesc&&selectedStopId!=null)stopDrafts.set(`${norm(u.placa)}:${selectedStopId}`,priorDesc.value);selectedStopId=id;const stop=candidates.find(v=>String(v.id)===String(id)),box=c.$("candidate-editor");document.querySelectorAll("[data-stop]").forEach(b=>b.classList.toggle("selected",String(b.dataset.stop)===String(id)));if(!stop||!box)return;focusStop(stop);const owner=cycleOwner(stop,openOcs),draftKey=`${norm(u.placa)}:${stop.id}`;box.innerHTML=`<h3>${stop.tipo==="PERNOCTE"?"POSIBLE PERNOCTE":"POSIBLE PAUSA ACTIVA"}</h3><div class="stop-detail"><b>INICIO</b><span>${c.esc(stop.inicio)}</span><b>FIN</b><span>${c.esc(stop.fin)}</span><b>DURACIÓN</b><span>${c.esc(formatDur(stop.duracion_min))}</span><b>ZONA</b><span>${c.esc(stop.geocerca||"FUERA DE GEOCERCA")}</span><b>DESPACHO</b><span>${c.esc(owner?.orden_carga||"SIN DESPACHO ABIERTO")}</span></div><input id="stop-desc" placeholder="Descripción opcional" value="${c.esc(stopDrafts.get(draftKey)||"")}"><div class="stop-actions"><button id="validate-stop" ${owner?"":"disabled"}>VALIDAR</button><button id="ignore-stop">IGNORAR</button></div>${owner?"":'<p class="stop-warning">Sin despacho abierto relacionado: el candidato se conserva solo para revisión visual.</p>'}`;const desc=c.$("stop-desc");if(desc)desc.oninput=()=>stopDrafts.set(draftKey,desc.value);if(owner)c.$("validate-stop").onclick=async()=>{const b=c.$("validate-stop");b.disabled=true;try{await c.post(c.END.track,{action:"parada_validar",id:owner.id,parada:{...stop,descripcion:c.$("stop-desc").value}});ignored.add(stop.id);localStorage.setItem(ignoredKey,JSON.stringify([...ignored]));stopDrafts.delete(draftKey);try{mapRuntime.stopMarkers?.get(stop.id)?.setMap?.(null);mapRuntime.stopMarkers?.delete(stop.id)}catch{}selectedStopId=null;await render()}catch(e){await notice("NO SE PUDO VALIDAR",e.message||String(e));b.disabled=false}};c.$("ignore-stop").onclick=()=>{ignored.add(stop.id);localStorage.setItem(ignoredKey,JSON.stringify([...ignored]));stopDrafts.delete(draftKey);try{mapRuntime.stopMarkers?.get(stop.id)?.setMap?.(null);mapRuntime.stopMarkers?.delete(stop.id)}catch{}selectedStopId=null;render()}};
    document.querySelectorAll("[data-stop]").forEach(b=>b.onclick=()=>selectStop(b.dataset.stop));
    renderedPlate=norm(u.placa);restoreUi(u.placa);
    document.querySelectorAll(".cycle-card").forEach(cardEl=>{const oid=+cardEl.dataset.id,o=openOcs.find(z=>z.id===oid),windowAnalysis=analysisWindow(analysis,o),sug=cycleSuggestions(o?.payload||{},windowAnalysis);cardEl.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>{const v=sug[b.dataset.use];if(v)cardEl.querySelector(`[data-field="${b.dataset.use}"]`).value=v});cardEl.querySelector("[data-use-all]").onclick=()=>cardEl.querySelectorAll("[data-use]:not(:disabled)").forEach(b=>b.click());const collect=()=>{const datos={};cardEl.querySelectorAll("[data-field]").forEach(i=>{const v=i.value.trim();if(v)datos[i.dataset.field]=v});return datos};cardEl.querySelector("[data-save]").onclick=async()=>{try{await c.post(c.END.track,{action:"guardar",id:oid,datos:collect()});await notice("AVANCE GUARDADO","Los cambios quedaron guardados en la sesión.");await render()}catch(e){await notice("NO SE PUDO GUARDAR",e.message||String(e))}};const close=cardEl.querySelector("[data-close]");if(close&&!close.disabled)close.onclick=async()=>{const older=!!o.tiene_despacho_posterior,msg=older?`Existe el despacho posterior ${o.siguiente_entrega}. Este ciclo debe dejar de estar abierto. Se guardarán únicamente los hitos realmente observados; no se inventará ninguna fecha GPS.`:"El ciclo quedará preparado para cierre y se consolidará al terminar el seguimiento.";if(!await ask("CERRAR OC",msg,"CERRAR OC",true))return;try{const r=await c.post(c.END.track,{action:"cerrar",id:oid,datos:collect(),motivo_cierre:older?"NUEVO_DESPACHO_POSTERIOR":"CIERRE_MANUAL_WEB"});if(r.placa_revisada){await refreshList(u.placa);idx=nextIndex(idx);selectedStopId=null;await render();await notice("PLACA COMPLETA","Todos los despachos de la placa quedaron preparados. La unidad fue marcada REVISADA.")}else{await refreshList(u.placa);selectedStopId=null;await render()}}catch(e){await notice("NO SE PUDO CERRAR",e.message||String(e))}}});
    const review=c.$("review");review.onclick=async()=>{if(!schemaReady)return notice("BASE PENDIENTE","Aplique primero la migración CERRO VERDE para habilitar REVISADA y cierres.");if(x.revisada){idx=nextIndex(idx);selectedStopId=null;return render()}try{await c.post(c.END.track,{action:"marcar_revisada",placa:u.placa});await refreshList(u.placa);reviewed.add(u.placa);idx=nextIndex(idx);selectedStopId=null;await render()}catch(e){await notice("PLACA AÚN PENDIENTE",e.message||String(e))}};
    c.$("other-operation").onclick=async()=>{if(!schemaReady)return notice("BASE PENDIENTE","Aplique primero la migración CERRO VERDE para retirar unidades del reporte.");const extra=openForOther?` Además se prepararán para cierre administrativo ${openForOther} despacho(s) abierto(s), conservando únicamente la información ya registrada y sin inventar hitos GPS.`:"";if(!await ask("RETIRAR DEL REPORTE",`La unidad ${u.tracto} · ${u.placa} dejará de pertenecer al GRUPO_SMCV activo.${extra} El histórico no se borrará y una futura carga SAP válida podrá reincorporarla.`,"CAMBIO DE OPERACIÓN",true))return;try{const out=await c.post(c.END.track,{action:"otra_operacion",placa:u.placa,motivo:"CAMBIO_DE_OPERACION"});await refreshList("");idx=Math.min(idx,Math.max(0,unitList.length-1));selectedStopId=null;await notice("UNIDAD RETIRADA",`La unidad salió del reporte por CAMBIO DE OPERACIÓN. ${out.cierres_preparados||0} despacho(s) quedaron preparados para cierre administrativo. El histórico permanece intacto.`);await render()}catch(e){await notice("NO SE PUDO RETIRAR",e.message||String(e))}};
    c.$("refresh").onclick=async()=>{const b=c.$("refresh"),old=b.textContent;b.disabled=true;b.textContent="ACTUALIZANDO…";try{const fresh=await c.post(c.END.gps,{placa:u.placa,tracto:u.tracto,desde:c.$("from").value,hasta:c.$("to").value||nowPE(),include_map:false});await c.put("gps",u.placa,{...fresh,run:"manual"});await render({forceMap:true})}catch(e){await notice("ACTUALIZAR RECORRIDO",e.message||String(e))}finally{if(b.isConnected){b.disabled=false;b.textContent=old}}};
    if(plateChanged||forceMap){if(g)draw(g,c,c.$,selectStop).catch(e=>resetMapVisual(`No se pudo mostrar el mapa.\n${e.message||String(e)}`));else resetMapVisual("SIN RECORRIDO DISPONIBLE")}if(selectedStopId&&candidates.some(v=>String(v.id)===String(selectedStopId)))selectStop(selectedStopId);
  };
  await autoReviewNoMovement();
  c.$("finish").onclick=async()=>{if(!schemaReady)return notice("BASE PENDIENTE","Aplique primero la migración CERRO VERDE para consolidar el seguimiento.");if(!await ask("TERMINAR SEGUIMIENTO",`Se consolidará la sesión únicamente si las ${unitList.length} placas activas están revisadas.`,"TERMINAR",false))return;try{const r=await c.post(c.END.track,{action:"consolidar"});localStorage.removeItem("cv_revisadas");await notice("SEGUIMIENTO COMPLETO",`${r.revisadas}/${r.total_placas} placas consolidadas. Puede ir al reporte o volver a itinerarios.`);const top=document.querySelector(".tracking-top");if(top){const fin=c.$("finish");if(fin){fin.textContent="IR A REPORTE";fin.onclick=()=>c.go("reporte")}let back=c.$("back-itinerarios");if(!back){back=document.createElement("button");back.id="back-itinerarios";back.type="button";back.textContent="VOLVER A ITINERARIOS";top.appendChild(back)}back.onclick=()=>{document.body.classList.remove("tracking-active");location.href="index.html"};const pause=c.$("pause");if(pause){pause.textContent="VOLVER A ITINERARIOS";pause.onclick=()=>{document.body.classList.remove("tracking-active");location.href="index.html"}}}}catch(e){await notice("NO SE PUDO TERMINAR",e.message||String(e))}};
  c.$("pause").onclick=(ev)=>{
    try{ev?.preventDefault?.()}catch(_){}
    document.body.classList.remove("tracking-active");
    c.go("home");
  };
  await render();renderProgress();
}}
function groupV3(c){return async()=>{
  c.$("content").innerHTML=`<p class="eyebrow">CERRO VERDE · PADRÓN OPERATIVO</p><h1>Grupo SMCV</h1><p>Altas manuales sólo para retornos sin nueva carga. Las bajas por cambio de operación se realizan desde SEGUIMIENTO.</p><section class="notice"><b>REGLA:</b> una carga SAP válida reincorpora automáticamente. Este buscador no inventa ciclos y sólo ofrece placas históricas sin despacho DIARIO abierto.</section><section class="cv-grid group-summary"><article class="panel"><small>GRUPO ACTIVO</small><h2 id="group-total">—</h2><p id="group-sections">Consultando…</p></article><article class="panel"><small>USO</small><p>Busque por código R, placa o conductor y confirme si la unidad retornó a Cerro Verde sin una nueva carga SAP.</p></article></section><section class="panel group-manager"><div class="group-search"><input id="group-q" placeholder="Ej. 20-R-866 · placa · conductor"><button id="group-find">BUSCAR</button></div><div id="group-results" class="group-results"><p class="muted">Ingrese al menos 2 caracteres.</p></div></section>`;
  const refresh=async()=>{try{const d=await c.get("resumen");c.$("group-total").textContent=d.unidades??"—";c.$("group-sections").textContent=`${d.cal_vacio??0} CAL VACÍO · ${d.cal_cargado??0} CAL CARGADO`}catch{}};await refresh();
  const run=async()=>{const q=c.$("group-q").value.trim(),box=c.$("group-results");if(q.length<2){box.innerHTML='<p class="muted">Ingrese al menos 2 caracteres.</p>';return}box.innerHTML='<p class="muted">Buscando histórico fuera del grupo…</p>';try{const r=await c.post(c.END.track,{action:"grupo_buscar",q});const rows=r.resultados||[];box.innerHTML=rows.length?rows.map(x=>`<article class="group-result" data-id="${x.id}"><div><b>${c.esc(x.tracto||"—")} · ${c.esc(x.placa||"—")}</b><span>${c.esc(x.conductor||"—")}</span><small>Última entrega ${c.esc(x.orden_carga||"—")} · ${c.esc(x.fecha_carga||"—")} · ${c.esc(x.estado||"—")} · ${c.esc(x.monitoreo||"—")}</small></div><div class="group-add-actions"><button data-add="CAL VACIO">AGREGAR CAL VACÍO</button><button data-add="CAL CARGADO">AGREGAR CAL CARGADO</button></div></article>`).join(""):'<p class="muted">No hay candidatos históricos fuera del grupo para esa búsqueda.</p>';box.querySelectorAll("[data-add]").forEach(btn=>btn.onclick=async()=>{const card=btn.closest("[data-id]"),seccion=btn.dataset.add;if(!await ask("AGREGAR AL GRUPO",`La unidad se incorporará como ${seccion}. No se creará un despacho nuevo.`,`AGREGAR`,false))return;btn.disabled=true;try{const out=await c.post(c.END.track,{action:"grupo_agregar",id:+card.dataset.id,seccion});await notice("UNIDAD AGREGADA",`${out.tracto} · ${out.placa} volvió al GRUPO_SMCV como ${out.seccion}. Debe revisarse en Seguimiento.`);await refresh();await run()}catch(e){await notice("NO SE PUDO AGREGAR",e.message||String(e));btn.disabled=false}})}catch(e){box.innerHTML=`<p class="sap-error">${c.esc(e.message||e)}</p>`}};
  c.$("group-find").onclick=run;c.$("group-q").onkeydown=e=>{if(e.key==="Enter")run()};
}}

function sapV3(c){return async()=>{c.$("content").innerHTML=`<p class="eyebrow">CERRO VERDE · OPERACIÓN REAL</p><h1>Actualizar SAP</h1><p>El Excel completo permanece en este navegador; sólo se envían las entregas nuevas al aplicar.</p><section class="notice"><b>FLUJO OPERATIVO:</b> seleccione el Excel SAP, valide el resumen y aplique. Se aceptan .xls y .xlsx.</section><section class="panel sap-upload cv-sap-upload"><div class="panel-title"><div><h2>Archivo SAP actualizado</h2><p class="muted">El archivo anterior del navegador se reemplaza automáticamente.</p></div><label class="file-button cv-file-button">SELECCIONAR EXCEL<input id="cv-sap" type="file" accept=".xls,.xlsx"></label></div><div id="sap-current" class="sap-current">Consultando caché temporal…</div><div class="cv-sap-actions"><button id="validate-sap" class="secondary-action" disabled>VALIDAR ARCHIVO</button><button id="apply-sap" class="primary-action" disabled>APLICAR CAMBIOS</button></div><div id="sap-result"></div></section>`;let current=await c.one("sap","actual"),validated=false;const currentBox=c.$("sap-current"),validate=c.$("validate-sap"),apply=c.$("apply-sap"),result=c.$("sap-result"),show=()=>{currentBox.innerHTML=current?`Temporal actual: <b>${c.esc(current.nombre)}</b> · ${(current.tamano/1024).toFixed(1)} KB · guardado en este navegador.`:"No hay un SAP temporal cargado.";validate.disabled=!current;apply.disabled=!validated};show();c.$("cv-sap").onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(!/\.xlsx?$/i.test(f.name)){result.innerHTML='<p class="sap-error">Seleccione un archivo SAP .xls o .xlsx.</p>';return}current={nombre:f.name,tamano:f.size,contenido:await f.arrayBuffer(),guardado:new Date().toISOString()};await c.put("sap","actual",current);validated=false;result.innerHTML="";show()};const summary=s=>`<h2>Resultado de validación</h2><div class="sap-counts"><span><b>${s.leidas}</b>LEÍDAS</span><span><b>${s.en_alcance}</b>EN ALCANCE</span><span><b>${s.registradas}</b>YA REGISTRADAS</span><span><b>${s.nuevas_sap}</b>NUEVAS SAP</span><span><b>${s.nuevas_diario}</b>NUEVAS DIARIO</span><span><b>${s.descartadas}</b>DESCARTADAS</span></div>${s.descartes?.length?`<details><summary>Ver descartes y motivo</summary><div class="discard-list">${s.descartes.map(x=>`<p><b>${c.esc(x.entrega)}</b> · ${c.esc(x.motivo)}</p>`).join("")}</div></details>`:""}`;validate.onclick=async()=>{validate.disabled=true;validate.textContent="VALIDANDO…";result.innerHTML='<p class="muted">Analizando el archivo SAP…</p>';try{const s=await c.post(c.END.sap,{action:"validar_archivo",nombre_archivo:current.nombre,contenido_base64:c.b64(current.contenido)});validated=!!s.nuevas_sap;result.innerHTML=summary(s);show()}catch(e){validated=false;result.innerHTML=`<p class="sap-error">NO SE PUDO VALIDAR: ${c.esc(e.message||e)}</p>`}finally{validate.textContent="VALIDAR ARCHIVO";validate.disabled=!current;apply.disabled=!validated}};apply.onclick=async()=>{if(!validated||!await ask("APLICAR SAP","Se aplicarán únicamente las entregas nuevas que fueron validadas.","APLICAR CAMBIOS"))return;apply.disabled=true;apply.textContent="APLICANDO…";try{const s=await c.post(c.END.sap,{action:"aplicar_archivo",nombre_archivo:current.nombre,contenido_base64:c.b64(current.contenido)});validated=false;result.innerHTML=summary(s)+`<p class="sap-success"><b>APLICACIÓN COMPLETA:</b> ${s.agregadas_sap||0} SAP · ${s.agregadas_diario||0} ciclos abiertos · ${s.unidades_grupo_actualizadas||0} unidades del grupo actualizadas.</p>`}catch(e){result.innerHTML+=`<p class="sap-error">NO SE PUDO APLICAR: ${c.esc(e.message||e)}</p>`}finally{apply.textContent="APLICAR CAMBIOS";apply.disabled=true}}}}

export { tracking, reportV3 };
export function installTracking(c){bg.ctx=c;c.routes.home=homeV3(c);c.routes.sap=sapV3(c);c.routes.precarga=preload(c);c.routes.seguimiento=tracking(c);c.routes.grupo=groupV3(c);c.routes.paradas=paradasV3(c);c.routes.reporte=reportV3(c);if(c.auth?.currentUser)c.go(location.hash.slice(2)||"home")}
