function reviewStatus(cycles){const unresolvedPrevious=cycles.slice(0,-1).filter(x=>!x.prepared);return{eligible:unresolvedPrevious.length===0,unresolved_previous:unresolvedPrevious,all_closed:cycles.length>0&&cycles.every(x=>x.prepared)}}
const t=(name,fn)=>{try{fn();console.log('OK',name)}catch(e){console.error('FAIL',name,e.message);process.exitCode=1}}
t('un solo despacho abierto puede marcar placa revisada',()=>{if(!reviewStatus([{prepared:false}]).eligible)throw Error('debía estar habilitada')});
t('dos despachos: anterior abierto bloquea revisada',()=>{if(reviewStatus([{prepared:false},{prepared:false}]).eligible)throw Error('debía bloquear')});
t('dos despachos: anterior cerrado y actual abierto habilita revisada',()=>{if(!reviewStatus([{prepared:true},{prepared:false}]).eligible)throw Error('debía habilitar')});
t('todos cerrados permite auto-revisada',()=>{if(!reviewStatus([{prepared:true},{prepared:true}]).all_closed)throw Error('debía estar completa')});
