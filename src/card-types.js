/** 开发态课题：哪些数据构成可保存的卡片快照？
 * 状态边界：JSON 深度/节点继承 native-json 预算；图表最多64行、日志最多100项；密钥排除。
 * 扩展：新类型定义捕获、校验与字段；未来类型数据可读而不猜测动作。
 * 契约：docs/contracts/card-types.json；局部宿主不替代完整 F/C/H/Q。
 */
import {copyNativeJSON} from './native-json.js';
import {reasoningFamilyFor} from './reasoning.js';

/** Versioned data codecs shared by rendering, history capture and persistence.
 * Values are data, never executable handlers. New types supply their own codec;
 * unknown future versions survive as escaped, non-executable records.
 */
const pick = (value, keys) => Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,copyNativeJSON(value[key])]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const apiFields = ['protocol','url','model','supplier'];
const modelFields = ['output','temperature','topP','inputs','reasoning','reasoningFamily','reasoningMode','reasoningBudget'];
export const CARD_TYPES = Object.freeze({
  api:{version:1, title:'设置', fields:['url','key','model'], capture:value=>pick(value,apiFields), initial:workspace=>workspace.api},
  connection:{version:1,title:'连接细节',fields:['url','protocol'],capture:value=>pick(value,apiFields),initial:workspace=>workspace.api},
  model:{version:1, title:'模型设置', fields:['output','temperature','topP'], capture:value=>pick(value,modelFields), initial:workspace=>({...workspace.model,reasoningFamily:workspace.model.reasoningFamily||reasoningFamilyFor(workspace.api,workspace.model.reasoningMode||workspace.model.reasoning?.template)})},
  chart:{version:1, title:'用量图表', fields:[], capture:value=>pick(value,['title','rows','note']), initial:()=>({title:'末次请求用量',rows:[],note:'尚无可用的用量观察。'})},
  logs:{version:1, title:'日志快照', fields:[], capture:value=>pick(value,['title','entries','note']), initial:()=>({title:'日志快照',entries:[],note:'尚无通讯记录。'})},
  confirmation:{version:1, title:'调用确认', fields:[], capture:value=>pick(value,['title','text']), initial:()=>({title:'调用确认',text:''})}
});
export function cardType(card) {
  const definition = Object.hasOwn(CARD_TYPES,card?.kind) ? CARD_TYPES[card.kind] : undefined;
  return definition?.version === (card?.version ?? 1) ? definition : undefined;
}
export function captureCard(card, workspace) {
  const definition=cardType(card);
  if (!definition) return copyNativeJSON(card.values);
  // Settings capture current configuration before the next history item is appended.
  return definition.capture(['api','connection','model'].includes(card.kind) && workspace ? definition.initial(workspace) : card.values);
}
export function persistCard(card, workspace) {
  const values=captureCard(card,workspace);
  if(['api','connection'].includes(card.kind)) {
    delete values.key; delete values.trustedTarget;
    try {const url=new URL(values.url); if(url.username||url.password||url.search||url.hash||url.protocol!=='https:')values.url='';} catch {values.url='';}
  }
  return {id:card.id,type:'card',kind:card.kind,version:card.version ?? 1,values};
}
export function validCard(card) {
  if(typeof card.kind!=='string'||!card.kind||card.kind.length>80||!Number.isSafeInteger(card.version??1)||(card.version??1)<1||!object(card.values))return false;
  if(card.kind==='model'&&card.values.inputs!==undefined&&(!Array.isArray(card.values.inputs)||!card.values.inputs.every(value=>typeof value==='string')))return false;
  if(cardType(card) && card.kind==='chart') {
    const rows=card.values.rows;
    if(!Array.isArray(rows)||rows.length>64||!rows.every(row=>object(row)&&typeof row.label==='string'&&(row.value===null||(Number.isFinite(row.value)&&row.value>=0))))return false;
  }
  if(cardType(card)?.title && card.kind==='logs' && (!Array.isArray(card.values.entries)||card.values.entries.length>100))return false;
  if(cardType(card)?.title && card.kind==='confirmation' && typeof card.values.text!=='string')return false;
  return true;
}
