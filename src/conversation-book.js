/** 开发态课题：会话身份如何拥有工作区，而不依赖当前显示页？
 * 状态：有界会话表、一个活动 ID；请求/卡片/视图由各自模块管理。
 * 条件：makeData 每次返回独立工作区；时间、ID 可注入；此模块不访问 DOM/存储。
 */
export const MAX_CONVERSATIONS = 200;
export function conversationTitle(entry) {
  return entry.title || Object.values(entry.data).flatMap(d=>d.messages)
    .filter(m=>m.type==='user').sort((a,b)=>a.id-b.id)[0]?.text?.trim().slice(0,60) || Object.values(entry.data).find(d=>d.draft?.trim())?.draft.trim().slice(0,60) || '新会话';
}
// Identity is a local reference, never an authorization token; HTTP development hosts may lack randomUUID.
let fallbackSequence=0;
export const conversationId=(crypto=globalThis.crypto)=>crypto?.randomUUID?.()||`c${Date.now().toString(36)}_${(++fallbackSequence).toString(36)}_${Math.random().toString(36).slice(2)}`;
export function createConversationBook({makeData,now=()=>new Date().toISOString(),id=conversationId}) {
  let entries=[],activeId;
  const current=()=>entries.find(entry=>entry.id===activeId);
  function create() {
    if(entries.length>=MAX_CONVERSATIONS)throw Object.assign(new Error('Conversation limit'),{code:'CONVERSATION_LIMIT'});
    const time=now(),entry={id:id(),page:'chat',title:'',createdAt:time,updatedAt:time,data:makeData(current()?.data)};
    if(!entry.id||entries.some(e=>e.id===entry.id))throw new Error('Duplicate conversation identity');
    entries.push(entry);activeId=entry.id;return entry;
  }
  create();
  return {
    current,create,get entries(){return [...entries];},get activeId(){return activeId;},
    owner:workspace=>entries.find(entry=>Object.values(entry.data).includes(workspace)),
    touch(workspace){const entry=this.owner(workspace);if(entry)entry.updatedAt=now();},
    select(value){const entry=entries.find(e=>e.id===value);if(!entry)return null;activeId=value;return entry;},
    rename(value,title){const entry=entries.find(e=>e.id===value);if(!entry||typeof title!=='string')return false;entry.title=title.trim().slice(0,120);entry.updatedAt=now();return true;},
    remove(value){const entry=entries.find(e=>e.id===value);if(!entry||Object.values(entry.data).some(d=>d.busy||d.attachmentReading))return null;
      entries=entries.filter(e=>e!==entry);if(activeId===value){activeId=entries[0]?.id;if(!activeId)create();}return entry;},
    restore(saved){entries=saved.entries;activeId=saved.activeId;},
    list(query=''){const needle=query.trim().toLocaleLowerCase();return entries.filter(entry=>!needle||[conversationTitle(entry),...Object.values(entry.data).flatMap(d=>[d.draft,...d.messages.map(m=>m.text||m.prompt||'')])].some(text=>text.toLocaleLowerCase().includes(needle))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  };
}
