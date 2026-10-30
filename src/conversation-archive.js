/** 会话集合编解码。复用原工作区快照以保留协议原文、卡片和密钥排除规则。
 * 集合身份和即时草稿身份必须相同；不将缺失会话的草稿猜测应用到当前会话。
 * 单份集合仍受 48 MiB 预算约束，旧 schema 1/2 升级为一个会话。
 */
import {snapshotWorkspace,restoreWorkspace,migrateSnapshot,replayJournal,MAX_SNAPSHOT_BYTES} from './persistence.js';
import {MAX_CONVERSATIONS} from './conversation-book.js';
const invalid=()=>{throw Object.assign(new Error('Invalid conversation archive'),{code:'SCHEMA'});};
const size=value=>{if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_SNAPSHOT_BYTES)throw Object.assign(new Error('Archive too large'),{code:'SIZE_LIMIT'});return value;};
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
// Validate and migrate data before any live workspace is replaced.
export function migrateConversations(value) {
  size(value);
  if(value?.collectionSchema===undefined){const snapshot=migrateSnapshot(value);value={collectionSchema:1,activeId:'legacy',page:snapshot.page,nextId:snapshot.nextId,views:Object.fromEntries(Object.entries(snapshot.views||{}).map(([k,v])=>[k==='logs'?k:`legacy:${k}`,v])),entries:[{id:'legacy',title:'',createdAt:'1970-01-01T00:00:00.000Z',updatedAt:'1970-01-01T00:00:00.000Z',snapshot}]};}
  if(value?.collectionSchema!==1||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>MAX_CONVERSATIONS||!Number.isSafeInteger(value.nextId)||value.nextId<1)invalid();
  const ids=new Set();
  const entries=value.entries.map(entry=>{
    if(!identifier(entry.id)||ids.has(entry.id)||typeof entry.title!=='string'||entry.title.length>120||!timestamp(entry.createdAt)||!timestamp(entry.updatedAt))invalid();
    ids.add(entry.id);return {id:entry.id,title:entry.title,createdAt:entry.createdAt,updatedAt:entry.updatedAt,snapshot:migrateSnapshot(entry.snapshot)};
  });
  if(!ids.has(value.activeId))invalid();
  const views=value.views||{};
  if(!views||Array.isArray(views)||typeof views!=='object'||!Object.entries(views).every(([key,v])=>(key==='logs'||entries.some(e=>['chat','image'].some(p=>key===`${e.id}:${p}`)))&&v&&Number.isFinite(v.top)&&v.top>=0&&typeof v.bottom==='boolean'))invalid();
  return {collectionSchema:1,activeId:value.activeId,page:['chat','image','logs'].includes(value.page)?value.page:'chat',nextId:value.nextId,views:structuredClone(views),entries};
}
// Capture every owner separately; only serializable projections enter the archive.
export function snapshotConversations({book,page,nextId,views={},secrets=[]}) {
  const redact=text=>secrets.filter(Boolean).reduce((out,key)=>out.split(key).join('[密钥已移除]'),text);
  return size({collectionSchema:1,activeId:book.activeId,page,nextId,views,entries:book.entries.map(entry=>({
    id:entry.id,title:redact(entry.title).slice(0,120),createdAt:entry.createdAt,updatedAt:entry.updatedAt,
    snapshot:snapshotWorkspace({data:entry.data,page:entry.page||'chat',nextId,secrets})
  }))});
}
// Rehydrate resource-free workspaces, then choose a fresh next message identity.
export function restoreConversations(value,makePage) {
  const saved=migrateConversations(value);let nextId=saved.nextId;
  const entries=saved.entries.map(entry=>{const restored=restoreWorkspace(entry.snapshot,makePage);nextId=Math.max(nextId,restored.nextId);const {snapshot,...metadata}=entry;return {...metadata,page:restored.page==='image'?'image':'chat',data:restored.data};});
  return {...saved,entries,nextId};
}
// Revision admission remains in replayJournal; this adapter resolves ownership first.
export function replayConversationJournal(value,journal,record) {
  if(!journal?.patch)return {status:'none',value};
  const archive=migrateConversations(value);
  const target=journal.patch.conversationId??(archive.entries.length===1&&archive.entries[0].id==='legacy'?'legacy':null);
  const entry=archive.entries.find(e=>e.id===target);if(!entry)invalid();
  const result=replayJournal(entry.snapshot,journal,record);
  if(result.status!=='replayed')return {status:result.status,value};
  entry.snapshot=result.value;archive.activeId=entry.id;archive.page=result.value.page;
  return {status:'replayed',value:migrateConversations(archive)};
}
