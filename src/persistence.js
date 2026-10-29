/** Local workspace snapshots only. Never receives logs, request headers or credentials. */
export const SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const apiKeys = ['protocol','url','model','supplier'];
const modelKeys = ['output','temperature','topP','inputs','reasoning','reasoningFamily','reasoningMode','reasoningBudget'];
const messageKeys = ['id','type','kind','text','prompt','aspectRatio','imageSize','fromTool','attachments','images','incomplete','metrics'];
const forbidden = /^(apiKey|api_key|authorization|trustedTarget|controller|diagnostics|__proto__|constructor|prototype)$/i;
function clean(value, secrets = []) {
  if (typeof value === 'string') { for (const secret of secrets) if (secret) value = value.split(secret).join('[密钥已移除]'); return value; }
  if (value === null || ['number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(v => clean(v,secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k,v]) => !forbidden.test(k) && v !== undefined && typeof v !== 'function').map(([k,v]) => [k,clean(v,secrets)]));
  return null;
}
function safeApi(api) {
  const out = pick(api,apiKeys);
  try { const u = new URL(out.url); if (u.username || u.password || u.search || u.hash || u.protocol !== 'https:') out.url = ''; } catch { out.url = ''; }
  return out;
}
export function snapshotWorkspace({data,page,nextId,views={},secrets:archivedSecrets=[]}) {
  const secrets = [...archivedSecrets,...Object.values(data).map(d=>d.api?.key)].filter(Boolean);
  const workspaces = {}, metrics = {};
  for (const name of ['chat','image']) {
    const d = data[name];
    workspaces[name] = {
      api:safeApi(d.api),model:pick(d.model,modelKeys),draft:d.draft,attachments:d.attachments,
      pendingTextId:d.pendingTextId,aspectRatio:d.aspectRatio,imageSize:d.imageSize,
      interrupted:Boolean(d.busy),history:d.history,
      messages:d.messages.map(m=>{
        const out=pick(m,messageKeys);
        delete out.metrics;
        if(m.streaming)out.incomplete=true;
        if(m.type==='card'){out.values=m.kind==='api'?safeApi(m.values):pick(m.values,modelKeys);}
        if(m.images)out.images=m.images.map(im=>pick(im,['data','mimeType','extension','failed']));
        return out;
      })
    };
    metrics[name]={lastUsage:d.lastUsage,lastMetrics:d.lastMetrics,messages:Object.fromEntries(d.messages.filter(m=>m.metrics).map(m=>[m.id,m.metrics]))};
  }
  const result=clean({schema:SCHEMA_VERSION,page,nextId,views,workspaces,metrics},secrets);
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>MAX_SNAPSHOT_BYTES)throw Object.assign(new Error('Snapshot too large'),{code:'SIZE_LIMIT'});
  return result;
}
function invalid() { throw Object.assign(new Error('Invalid snapshot'),{code:'SCHEMA'}); }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = v => Number.isSafeInteger(v) && v > 0;
function filesValid(files) {
  return Array.isArray(files) && files.every(f=>object(f)&&typeof f.id==='string'&&typeof f.name==='string'&&typeof f.mimeType==='string'&&['text','image','pdf','audio','video'].includes(f.kind)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=5*1024*1024&&typeof f.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)&&(f.kind!=='text'||typeof f.text==='string'));
}
export function migrateSnapshot(value) {
  if(!object(value)||value.schema!==SCHEMA_VERSION||!object(value.workspaces)||!object(value.metrics)||!id(value.nextId))invalid();
  const ids=new Set();
  for(const name of ['chat','image']) {
    const d=value.workspaces[name];
    if(!object(d)||!object(d.api)||!object(d.model)||!Array.isArray(d.messages)||!Array.isArray(d.history)||typeof d.draft!=='string'||!filesValid(d.attachments))invalid();
    if(d.model.inputs!==undefined&&(!Array.isArray(d.model.inputs)||!d.model.inputs.every(v=>typeof v==='string')))invalid();
    if(!d.history.every(m=>object(m)&&typeof m.role==='string'&&(!m.attachments||filesValid(m.attachments))))invalid();
    for(const m of d.messages){
      if(!object(m)||!id(m.id)||ids.has(m.id)||!['card','user','imageResult','chatResult','status','error'].includes(m.type))invalid();ids.add(m.id);
      if(m.type==='card'&&(!['api','model'].includes(m.kind)||!object(m.values)))invalid();
      if(m.type==='card'&&m.kind==='model'&&m.values.inputs!==undefined&&(!Array.isArray(m.values.inputs)||!m.values.inputs.every(v=>typeof v==='string')))invalid();
      if(m.attachments!==undefined&&!filesValid(m.attachments))invalid();
      if(m.images!==undefined&&m.type!=='imageResult')invalid();
      if(m.type==='imageResult'&&(!Array.isArray(m.images)||!m.images.every(im=>object(im)&&typeof im.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(im.data)&&/^image\/(png|jpeg|webp)$/.test(im.mimeType)&&['png','jpg','webp'].includes(im.extension))))invalid();
      if(m.text!==undefined&&typeof m.text!=='string')invalid();
    }
  }
  if(value.views!==undefined&&(!object(value.views)||!Object.values(value.views).every(v=>object(v)&&Number.isFinite(v.top)&&v.top>=0&&typeof v.bottom==='boolean')))invalid();
  return clean(value);
}
export function restoreWorkspace(snapshot,makePage) {
  const s=migrateSnapshot(snapshot),data={};let maximum=Object.values(s.workspaces).reduce((max,d)=>d.messages.reduce((n,m)=>Math.max(n,m.id),max),0);
  for(const name of ['chat','image']) {
    const saved=s.workspaces[name],d=makePage(name),metrics=s.metrics[name]||{};
    Object.assign(d,pick(saved,['draft','attachments','pendingTextId','aspectRatio','imageSize','history']));
    d.api={...d.api,...safeApi(saved.api),key:'',trustedTarget:''};d.model={...d.model,...pick(saved.model,modelKeys)};
    d.messages=saved.messages.map(m=>{
      const out=pick(m,messageKeys);maximum=Math.max(maximum,Number(out.id)||0);
      if(m.type==='card')Object.assign(out,{values:m.kind==='api'?{...safeApi(m.values),key:'',trustedTarget:''}:pick(m.values,modelKeys),showKey:false,models:[]});
      if(m.images)out.images=m.images.map(im=>({...im,url:im.data && /^image\/(png|jpeg|webp)$/.test(im.mimeType)?`data:${im.mimeType};base64,${im.data}`:'',failed:!im.data||im.failed}));
      if(metrics.messages?.[m.id])out.metrics=metrics.messages[m.id];
      return out;
    });
    d.lastUsage=metrics.lastUsage??null;d.lastMetrics=metrics.lastMetrics??null;
    if(saved.interrupted)d.messages.push({id:++maximum,type:'status',text:'刷新前的请求已中断；不会自动重发。未完成回复不加入上下文。'});
    data[name]=d;
  }
  return {data,page:['chat','image','logs'].includes(s.page)?s.page:'chat',nextId:Math.max(maximum+1,Number(s.nextId)||1),views:s.views||{}};
}

export function createLocalStore({indexedDB=globalThis.indexedDB,onStatus=()=>{},name='llm-workbench-local-v1',debounceMs=250}={}) {
  let db,ready=false,revision=0,timer,pending,blocked=false,queue=Promise.resolve();
  const status=(state)=>onStatus(state);
  const fail=e=>{status(e?.code==='CONFLICT'?'conflict':e?.code==='SIZE_LIMIT'?'size-limit':'error');};
  const load=async()=>{
    try {
      if(!indexedDB)throw new Error('Unavailable');
      db=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{blocked=true;reject(new Error('Storage timeout'));},5000);
        const r=indexedDB.open(name,1);
        r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('snapshots'))r.result.createObjectStore('snapshots');};
        r.onsuccess=()=>{clearTimeout(timer);if(blocked){r.result.close();return;}resolve(r.result);};
        r.onerror=()=>{clearTimeout(timer);reject(r.error);};
        r.onblocked=()=>{clearTimeout(timer);blocked=true;reject(Object.assign(new Error('Blocked'),{code:'BLOCKED'}));};
      });
      if(blocked){db.close();return null;}
      db.onversionchange=()=>{db.close();blocked=true;status('blocked');};
      const record=await new Promise((resolve,reject)=>{const t=db.transaction('snapshots','readonly');const r=t.objectStore('snapshots').get('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      revision=record?.revision||0;
      const result=record?migrateSnapshot(record.value):null;
      ready=true;status(record?'restored':'ready');return result;
    }catch(e){blocked=true;status(e?.code==='SCHEMA'?'schema':e?.code==='BLOCKED'?'blocked':'unavailable');return null;}
  };
  const write=async value=>{
    if(!ready||blocked||!db)return false;
    try {
      await new Promise((resolve,reject)=>{
        let t;try{t=db.transaction('snapshots','readwrite',{durability:'strict'});}catch{t=db.transaction('snapshots','readwrite');}
        const store=t.objectStore('snapshots'),r=store.get('workspace');let conflict=false;
        r.onsuccess=()=>{if((r.result?.revision||0)!==revision){conflict=true;t.abort();return;}store.put({revision:revision+1,value},'workspace');};
        t.oncomplete=()=>{revision++;resolve();};t.onabort=()=>reject(conflict?Object.assign(new Error('Conflict'),{code:'CONFLICT'}):t.error);t.onerror=()=>{};
      });status('saved');return true;
    }catch(e){if(e?.code==='CONFLICT')blocked=true;fail(e);return false;}
  };
  const flush=()=>{clearTimeout(timer);if(!pending)return queue;const value=pending;pending=null;queue=queue.then(()=>write(value));return queue;};
  return {load,flush,
    schedule(value,{immediate=false}={}){if(!ready||blocked)return;pending=value;clearTimeout(timer);status('saving');if(immediate)return flush();timer=setTimeout(flush,debounceMs);},
    reportError:fail,
    close(){clearTimeout(timer);db?.close();blocked=true;},
    get ready(){return ready;}
  };
}
