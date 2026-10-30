import { copyNativeJSON } from './native-json.js';
import {persistCard,validCard} from './card-types.js';
import {isLiveCard} from './interaction-cards.js';

/** Project local snapshots from workspace state. API/card allowlists exclude credentials;
 * submitted secrets are supplied separately for collision checks, never persisted.
 */
export const SCHEMA_VERSION = 2;
export const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const apiKeys = ['protocol','url','model','supplier'];
const modelKeys = ['output','temperature','topP','inputs','reasoning','reasoningFamily','reasoningMode','reasoningBudget'];
const messageKeys = ['id','type','kind','text','prompt','aspectRatio','imageSize','fromTool','attachments','images','incomplete','metrics','reasoningText','reasoningOpen'];
const forbidden = /^(apiKey|api_key|authorization|trustedTarget|controller|diagnostics|__proto__|constructor|prototype)$/i;
function clean(value, secrets = []) {
  if (typeof value === 'string') { for (const secret of secrets) if (secret) value = value.split(secret).join('[密钥已移除]'); return value; }
  if (value === null || ['number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(v => clean(v,secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k,v]) => !forbidden.test(k) && v !== undefined && typeof v !== 'function').map(([k,v]) => [k,clean(v,secrets)]));
  return null;
}
// Envelope filtering and native protocol data have different responsibilities.
// Ordinary business keys inside raw (including "apiKey") are not credential evidence.
function copySnapshot(value) {
  const workspaces = Object.fromEntries(['chat','image'].map(name => {
    const workspace = value.workspaces[name];
    const history = workspace.history.map(message => {
      const {raw, ...envelope} = message;
      const copied = clean(envelope);
      if (raw !== undefined) copied.raw = copyNativeJSON(raw);
      return copied;
    });
    const messages=workspace.messages?.map(message=>{const copied=clean(message);if(message.type==='card')copied.values=copyNativeJSON(message.values);return copied;});
    return [name, {...clean({...workspace, history:[],messages:[]}), history,...(messages?{messages}:{})}];
  }));
  return {...clean({...value, workspaces:{}}), workspaces};
}
function safeApi(api) {
  const out = pick(api,apiKeys);
  try { const u = new URL(out.url); if (u.username || u.password || u.search || u.hash || u.protocol !== 'https:') out.url = ''; } catch { out.url = ''; }
  return out;
}
// Never rewrite signed/native history or binary/configuration values. If a used
// credential really collides with such content, fail visibly rather than save
// either a credential or a corrupted context. Editing prefixes are not secrets.
function protectImmutable(value,secrets) {
  if(typeof value==='string' && secrets.some(secret=>value.includes(secret)))throw Object.assign(new Error('Credential in immutable content'),{code:'CREDENTIAL_COLLISION'});
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    protectImmutable(key,secrets);
    protectImmutable(child,secrets);
  }
}
function protectWorkspace(value,secrets) {
  const {workspaces,...metadata}=value;protectImmutable(metadata,secrets);
  for(const d of Object.values(value.workspaces)){
    protectImmutable({api:d.api,model:d.model,attachments:d.attachments,history:d.history},secrets);
    d.draft=clean(d.draft,secrets);
    for(const message of d.messages||[]){
      const {text,prompt,reasoningText,...immutable}=message;protectImmutable(immutable,secrets);
      for(const field of ['text','prompt','reasoningText'])if(typeof message[field]==='string')message[field]=clean(message[field],secrets);
    }
  }
  return value;
}
export function snapshotWorkspace({data,page,nextId,views={},secrets:archivedSecrets=[]}) {
  const secrets = [...new Set(archivedSecrets)].filter(Boolean).sort((a,b)=>b.length-a.length);
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
        if(m.type==='card')return persistCard(m,isLiveCard(d.messages,m.id)?d:undefined);
        if(m.images)out.images=m.images.map(im=>pick(im,['data','mimeType','extension','failed','width','height','checks']));
        return out;
      })
    };
    metrics[name]={lastUsage:d.lastUsage,lastMetrics:d.lastMetrics,messages:Object.fromEntries(d.messages.filter(m=>m.metrics).map(m=>[m.id,m.metrics]))};
  }
  const result=protectWorkspace(copySnapshot({schema:SCHEMA_VERSION,page,nextId,views,workspaces,metrics}),secrets);
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
  if(!object(value)||![1,SCHEMA_VERSION].includes(value.schema)||!object(value.workspaces)||!object(value.metrics)||!id(value.nextId))invalid();
  const ids=new Set();
  for(const name of ['chat','image']) {
    const d=value.workspaces[name];
    if(!object(d)||!object(d.api)||!object(d.model)||!Array.isArray(d.messages)||!Array.isArray(d.history)||typeof d.draft!=='string'||!filesValid(d.attachments))invalid();
    if(d.model.inputs!==undefined&&(!Array.isArray(d.model.inputs)||!d.model.inputs.every(v=>typeof v==='string')))invalid();
    if(!d.history.every(m=>object(m)&&typeof m.role==='string'&&(!m.attachments||filesValid(m.attachments))))invalid();
    for(const m of d.messages){
      if(!object(m)||!id(m.id)||ids.has(m.id)||!['card','user','imageResult','chatResult','status','error'].includes(m.type))invalid();ids.add(m.id);
      if(m.type==='card'&&!validCard(m))invalid();
      if(m.attachments!==undefined&&!filesValid(m.attachments))invalid();
      if(m.images!==undefined&&m.type!=='imageResult')invalid();
      if(m.type==='imageResult'&&(!Array.isArray(m.images)||!m.images.every(im=>object(im)&&typeof im.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(im.data)&&/^image\/(png|jpeg|webp)$/.test(im.mimeType)&&['png','jpg','webp'].includes(im.extension))))invalid();
      if(m.text!==undefined&&typeof m.text!=='string')invalid();
      if(m.reasoningText!==undefined&&typeof m.reasoningText!=='string')invalid();
      if(m.reasoningOpen!==undefined&&typeof m.reasoningOpen!=='boolean')invalid();
    }
  }
  if(value.views!==undefined&&(!object(value.views)||!Object.values(value.views).every(v=>object(v)&&Number.isFinite(v.top)&&v.top>=0&&typeof v.bottom==='boolean')))invalid();
  return copySnapshot({...value,schema:SCHEMA_VERSION});
}
export function restoreWorkspace(snapshot,makePage) {
  const s=migrateSnapshot(snapshot),data={};let maximum=Object.values(s.workspaces).reduce((max,d)=>d.messages.reduce((n,m)=>Math.max(n,m.id),max),0);
  for(const name of ['chat','image']) {
    const saved=s.workspaces[name],d=makePage(name),metrics=s.metrics[name]||{};
    Object.assign(d,pick(saved,['draft','attachments','pendingTextId','aspectRatio','imageSize','history']));
    d.api={...d.api,...safeApi(saved.api),key:'',trustedTarget:''};d.model={...d.model,...pick(saved.model,modelKeys)};
    d.messages=saved.messages.map(m=>{
      const out=pick(m,messageKeys);maximum=Math.max(maximum,Number(out.id)||0);
      if(m.type==='card')Object.assign(out,persistCard(m),{showKey:false,models:[]});
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

// A bounded synchronous safety journal, never a second history store.
export const MAX_JOURNAL_BYTES=128*1024;
export function snapshotJournal({data,page,secrets:archived=[]}) {
  const secrets=[...new Set(archived)].filter(Boolean).sort((a,b)=>b.length-a.length),workspaces={};
  for(const name of ['chat','image']){
    const d=data[name],pending=d.busy&&d.messages.find(m=>m.id===d.pendingTextId);
    workspaces[name]={draft:pending?.text||d.draft,api:safeApi(d.api),model:pick(d.model,modelKeys),aspectRatio:d.aspectRatio,imageSize:d.imageSize};
  }
  const result=protectWorkspace(clean({page,workspaces}),secrets);
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>MAX_JOURNAL_BYTES)throw Object.assign(new Error('Journal too large'),{code:'JOURNAL'});
  return result;
}
export function replayJournal(snapshot,journal,record={revision:0}) {
  if(!journal?.patch)return {status:'none',value:snapshot};
  if(journal.schema!==1||typeof journal.owner!=='string'||!journal.owner||!Number.isSafeInteger(journal.sequence)||journal.sequence<1||!Number.isSafeInteger(journal.baseRevision)||journal.baseRevision<0)invalid();
  const same=journal.owner===record.owner,applied=Number(record.sequence)||0;
  if(same&&applied>=journal.sequence)return {status:'stale',value:snapshot};
  if(record.revision!==journal.baseRevision&&!(same&&record.revision>=journal.baseRevision&&applied<journal.sequence))return {status:'conflict',value:snapshot};
  if(!snapshot)invalid();
  const value=structuredClone(snapshot);
  for(const name of ['chat','image']){
    const patch=journal.patch.workspaces?.[name],d=value.workspaces[name];
    if(patch!==undefined&&(!object(patch)||typeof patch.draft!=='string'||!object(patch.api)||!object(patch.model)))invalid();
    const clear=journal.cleared?.[name];
    if(clear!==undefined&&(!Number.isSafeInteger(clear)||clear<1||clear>journal.sequence))invalid();
    if(clear&&(!same||clear>applied)){d.messages=[];d.history=[];d.attachments=[];d.draft='';d.pendingTextId=null;d.interrupted=false;value.metrics[name]={lastUsage:null,lastMetrics:null,messages:{}};}
    if(patch===undefined)continue;
    Object.assign(d,pick(patch,['draft','aspectRatio','imageSize']));d.api=safeApi(patch.api);d.model=pick(patch.model,modelKeys);
  }
  if(['chat','image','logs'].includes(journal.patch.page))value.page=journal.patch.page;
  return {status:'replayed',value:migrateSnapshot(value)};
}

export function createLocalStore({indexedDB=globalThis.indexedDB,onStatus=()=>{},name='llm-workbench-local-v1',debounceMs=250,journalStorage=null,eventTarget=globalThis}={}) {
  let db,ready=false,revision=0,timer,pending,blocked=false,queue=Promise.resolve();
  const journalKey=name+':draft-journal';
  const owner=globalThis.crypto?.randomUUID?.()||`tab-${Date.now()}-${Math.random()}`;
  let sequence=0,journalFailure=false,errorGeneration=0;
  const readJournal=()=>{const raw=journalStorage?.getItem(journalKey);return raw?JSON.parse(raw):null;};
  const putJournal=value=>journalStorage.setItem(journalKey,JSON.stringify(value));
  const status=(state)=>onStatus(journalFailure&&state==='saved'?'saved-journal-error':journalFailure&&['saving','restored','ready'].includes(state)?'journal-error':state);
  const fail=e=>{errorGeneration++;status(e?.code==='CREDENTIAL_COLLISION'?'credential-collision':e?.code==='CONFLICT'?'conflict':e?.code==='SIZE_LIMIT'?'size-limit':'error');};
  const journal=(patch,{clear=[]}={})=>{
    if(!ready||blocked)return false;
    try {
      if(!journalStorage)throw new Error('Journal unavailable');
      const previous=readJournal();
      if(previous?.patch&&previous.owner!==owner || previous?.baseRevision>revision&&previous.owner!==owner){blocked=true;status('conflict');return false;}
      const entry={schema:1,owner,sequence:++sequence,baseRevision:revision,patch,cleared:{...(previous?.owner===owner?previous.cleared:{})}};
      for(const name of clear)if(['chat','image'].includes(name))entry.cleared[name]=sequence;
      const encoded=JSON.stringify(entry);if(new TextEncoder().encode(encoded).byteLength>MAX_JOURNAL_BYTES)throw new Error('Journal too large');
      journalStorage.setItem(journalKey,encoded);journalFailure=false;return true;
    }catch{journalFailure=true;status('journal-error');return false;}
  };
  const storageListener=event=>{if(!ready||blocked||event.key!==journalKey||!event.newValue)return;try{const other=JSON.parse(event.newValue);if(other.owner!==owner&&(other.patch||other.baseRevision>revision)){blocked=true;status('conflict');}}catch{journalFailure=true;status('journal-error');}};
  eventTarget?.addEventListener?.('storage',storageListener);
  const load=async(fallback=null)=>{
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
      let result=record?migrateSnapshot(record.value):null;
      ready=true;
      if(journalStorage){
        try{
          const pending=readJournal(),replay=replayJournal(result||fallback,pending,record||{revision:0});
          if(replay.status==='conflict'){blocked=true;status('conflict');return result;}
          if(replay.status==='replayed'){result=replay.value;sequence=0;const patch=pending.patch;putJournal({schema:1,owner,sequence:++sequence,baseRevision:revision,patch,cleared:Object.fromEntries(Object.keys(pending.cleared||{}).filter(k=>record?.owner!==pending.owner||pending.cleared[k]>(record.sequence||0)).map(k=>[k,sequence]))});}
          else if(pending?.patch)putJournal({schema:1,owner:'',baseRevision:revision,sequence:0,patch:null});
        }catch{journalFailure=true;status('journal-error');}
      }
      status(record||result?'restored':'ready');return result;
    }catch(e){blocked=true;status(e?.code==='SCHEMA'?'schema':e?.code==='BLOCKED'?'blocked':'unavailable');return null;}
  };
  const write=async ({value,commitSequence,captureGeneration})=>{
    if(!ready||blocked||!db)return false;
    try {
      await new Promise((resolve,reject)=>{
        let t;try{t=db.transaction('snapshots','readwrite',{durability:'strict'});}catch{t=db.transaction('snapshots','readwrite');}
        const store=t.objectStore('snapshots'),r=store.get('workspace');let conflict=false;
        r.onsuccess=()=>{if((r.result?.revision||0)!==revision){conflict=true;t.abort();return;}store.put({revision:revision+1,owner,sequence:commitSequence,value},'workspace');};
        t.oncomplete=()=>{revision++;resolve();};t.onabort=()=>reject(conflict?Object.assign(new Error('Conflict'),{code:'CONFLICT'}):t.error);t.onerror=()=>{};
      });
      if(journalStorage)try{const current=readJournal();if(current?.owner===owner){if(current.sequence<=commitSequence)putJournal({schema:1,owner:'',baseRevision:revision,sequence:0,patch:null});else putJournal({...current,baseRevision:revision});}}catch{journalFailure=true;}
      if(!blocked&&captureGeneration===errorGeneration)status('saved');return true;
    }catch(e){if(e?.code==='CONFLICT')blocked=true;fail(e);return false;}
  };
  const flush=()=>{clearTimeout(timer);if(!pending)return queue;const value=pending;pending=null;queue=queue.then(()=>write(value));return queue;};
  return {load,flush,journal,
    schedule(value,{immediate=false}={}){if(!ready||blocked)return;pending={value,commitSequence:sequence,captureGeneration:errorGeneration};clearTimeout(timer);status('saving');if(immediate)return flush();timer=setTimeout(flush,debounceMs);},
    reportError:fail,
    close(){clearTimeout(timer);db?.close();blocked=true;eventTarget?.removeEventListener?.('storage',storageListener);},
    get ready(){return ready;}
  };
}
