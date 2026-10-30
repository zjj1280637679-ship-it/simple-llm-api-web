/** 开发态课题：各工作区如何组合请求、交付、保存和页面生命周期？
 * 状态/边界：每会话2工作区、3页；卡片活跃性由末项推导；DOM/协议/存档未全部有限化。
 * 扩展：新增服务通过显式 services 注入，先定义观察/回执与资源归属。
 * 契约：docs/contracts/workbench.json；局部宿主不替代完整 F/C/H/Q。
 */
import {createConversationBook} from './conversation-book.js';
import {snapshotConversations,restoreConversations,migrateConversations,replayConversationJournal} from './conversation-archive.js';
import {createSettingsViews} from './settings-markup.js';
import {historyMarkup} from './history-markup.js';
import {liveCard,isLiveCard} from './interaction-cards.js';
import {captureCard} from './card-types.js';
import {cardShell,unknownCardMarkup} from './card-markup.js';
import {createWorkbenchCards} from './workbench-cards.js';
import {createCardConfirmations} from './card-confirmations.js';
import {imageWorkspaceReceipt} from './image-evidence.js';
import {requestOutcome} from './request-outcome.js';
import { createImageDelivery } from './image-delivery.js';
import { esc, tabsMarkup, reasoningContentMarkup } from './view-markup.js';
import { createStreamPainter } from './stream-painter.js';
import { createWorkspaceStorage } from './workspace-storage.js';
import { copyDiagnosticReport } from './clipboard-report.js';
import { createScope } from './lifecycle.js';
import { createCanvasGeometry } from './canvas-geometry.js';
import { createViewPosition } from './view-position.js';
import { createRequestLifecycle } from './request-lifecycle.js';
import { createLocalStore, snapshotWorkspace, snapshotJournal, MAX_SNAPSHOT_BYTES } from './persistence.js';
import { getReasoningTemplates, getRecommendedReasoningTemplate, reasoningBody, REASONING_FAMILIES, reasoningFamilyFor, resolveReasoningFamily } from './reasoning.js';
import { MODALITIES, supportedModalities, prepareFiles, validateAttachments } from './attachments.js';
import { replyMetricsMarkup, replyMetricsSnapshot } from './usage.js';
import { icon } from './icons.js';
import { AppError, DEFAULT_TEXT_MODEL, IMAGE_MODEL, ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_TEXT_MODEL, getImageCapabilities, normalizeImageOptions, canonicalEndpoint, listModels as defaultListModels, dispatchCommand as defaultDispatchCommand, subscribeCredentialUse } from './core.js';
import { runConversation as defaultRunConversation } from './agent.js';
import { getNetworkLogs, clearNetworkLogs, exportNetworkLogs, subscribeNetworkLogs, renderNetworkLogs as defaultRenderNetworkLogs, sanitizeLogValue, setLogSecrets, updateActiveLogSecrets } from './logs.js';
import { createPageSession } from './session.js';
import { registerPageSessionTools } from './session-webmcp.js';

/** Composition root. The host supplies DOM/storage/transport; callers await ready and dispose once. */
export function createWorkbench({document=globalThis.document,window=globalThis.window,services={},clock=globalThis}={}) {
const scope=createScope();
const {setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame}=clock;
const getComputedStyle=window.getComputedStyle?.bind(window) || globalThis.getComputedStyle;
const ResizeObserver=window.ResizeObserver || globalThis.ResizeObserver;
const navigator=window.navigator || globalThis.navigator;
const {runConversation=defaultRunConversation,listModels=defaultListModels,dispatchCommand=defaultDispatchCommand,renderNetworkLogs=defaultRenderNetworkLogs,createStore=createLocalStore,registerTools=registerPageSessionTools,decodeImage}=services;
const imageDelivery=createImageDelivery({decode:decodeImage});
scope.own(()=>imageDelivery.dispose());
const listen=scope.listen;
const app = document.getElementById('app');
if(!app)throw new Error('Workbench host requires #app');
const geometry = createCanvasGeometry({app,document,window,getComputedStyle,ResizeObserver,closeMenus});
const {recordScrollDiagnostic,freezeScrollReport,exportScrollReport,resizeSettingField,resizeDraft,syncFloatingNavigation,positionFloatingMenu,mountFloatingMenu,dismissFloatingMenu,focusFloatingMenu} = geometry;
scope.own(()=>geometry.dispose());
const providers = [
  { name: 'Google Gemini', protocol: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  { name: 'OpenAI', protocol: 'openai', url: 'https://api.openai.com/v1' },
  { name: '自定义 · Gemini 格式', protocol: 'gemini', url: '', custom: true, aliases: ['自定义 · Gemini'] },
  { name: '自定义 · OpenAI 格式', protocol: 'openai', url: '', custom: true, aliases: ['自定义 · OpenAI 兼容'] },
  { name: '火山方舟 · 普通 API', protocol: 'ark', url: ARK_ENDPOINT },
  { name: 'DeepSeek', protocol: 'openai', url: 'https://api.deepseek.com' },
  { name: '智谱 AI · 普通 API', protocol: 'openai', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '自定义 · Anthropic 格式', protocol: 'anthropic', url: '', custom: true }
];
const makePage = type => ({
  api: { protocol: 'gemini', url: providers[0].url, key: '', model: type === 'image' ? IMAGE_MODEL : DEFAULT_TEXT_MODEL, supplier: 'Google Gemini', trustedTarget: '' },
  model: { output: '', temperature: '', topP: '', inputs: ['text','image','pdf','audio','video'] }, draft: '', attachments: [], attachmentReading: false, attachmentError: '', pendingTextId: null,
  aspectRatio: '1:1', imageSize: '1K', messages: [], history: [], busy: false,
  controller: null, lastUsage: null, lastMetrics: null
});
const book=createConversationBook({makeData:previous=>Object.fromEntries(['chat','image'].map(name=>{
  const d=makePage(name);
  if(previous){d.api={...previous[name].api,trustedTarget:''};d.model=structuredClone(previous[name].model);d.aspectRatio=previous[name].aspectRatio;d.imageSize=previous[name].imageSize;}
  return [name,d];
}))});
// Public active-workspace facade; entries retain their own workspace identities.
const data={...book.current().data};
const allWorkspaces=()=>book.entries.flatMap(entry=>Object.values(entry.data));
let historyQuery='',historyNotice='',historyLogs=false;

let storageState='loading',localRestored=false;
const localSecrets=new Set();
scope.own(subscribeCredentialUse(key=>localSecrets.add(key)));
const storageLabels={loading:'正在读取本机存档',ready:'本机自动保存已启用',restored:'已恢复本机存档；API Key 请重新填写',saving:'正在保存…',saved:'已保存到本机；API Key 不保存',error:'本机保存失败；当前改动尚未保存，请导出备份后重试', 'size-limit':'本机存档超过 48 MiB；当前改动尚未保存，请备份',conflict:'另一标签页已更新存档；本页暂停保存，请先导出备份',blocked:'存储版本已变化或被占用；请备份后刷新',schema:'本机存档版本不支持或损坏；已停止覆盖',unavailable:'本机存储不可用；仅内存运行，刷新会丢失，请导出备份','credential-collision':'已用密钥与原生上下文或配置内容重合；为避免泄露或破坏签名，本次未保存','saved-journal-error':'完整存档已提交；即时草稿保护不可用，后续改动请等提交后刷新','journal-error':'即时草稿保护失败或超过 128 KiB；请等待完整存档提交后再刷新，或导出备份'};
let journalStorage=null;try{journalStorage=window.localStorage;}catch{}
const localStore=createStore({journalStorage,decodeSnapshot:migrateConversations,applyJournal:replayConversationJournal,name:`llm-workbench-local-v1:${(window.location?.pathname || '/').replace(/index\.html$/,'')}`,onStatus:setStorageStatus});

let page = 'chat', plusOpen = false, sizeOpen = false, subMenu = '', nextId = 1;
let reasoningAnchorId = null;
const get = () => data[page];
function syncLogSecrets() { updateActiveLogSecrets(allWorkspaces().map(d => d.api.key)); }
function archiveWorkspaceKey(d) { if (d) setLogSecrets([d.api.key]); }
const activeCardId = d => liveCard(d?.messages)?.id;
const getCard = id => get()?.messages.find(m => m.id === id && m.type === 'card');
const settingsViews=createSettingsViews({get,currentPage:()=>page,activeCardId,menuState:()=>subMenu,reasoningAnchor:()=>reasoningAnchorId,providers,providerIdentity,protocolLabel,apiTrustText});
const cardRegistry=createWorkbenchCards({
  apiMarkup:settingsViews.api,connectionMarkup:settingsViews.connection,modelMarkup:settingsViews.model,settingsAction:performCardAction,
  navigate:({workspace,card,args})=>{syncCurrentApiFields(workspace);addCard(args.kind,undefined,workspace);return {ok:true};},
  field:({workspace,card,args})=>applyCardField(workspace,card,{value:args.value,dataset:{key:args.key}}),
  usage:usageCardValues,logs:logCardValues,render,
  confirmationAvailable:id=>confirmations.available(get(),id),
  settle:(workspace,id,approved)=>confirmations.settle(workspace,id,approved)
});
const confirmations=createCardConfirmations({append:(d,values)=>addCard('confirmation',values,d),record:(d,approved)=>status(d,approved?'已确认本次调用。':'已取消本次调用。')});
scope.own(()=>confirmations.dispose());
function dispatchCardAction(input,d=get()) {
  return defaultDispatchCommand({command:'card.action',args:input},{cardRuntime:{execute:args=>cardRegistry.execute(args,{workspace:d,isActive:()=>!scope.disposed})}});
}
function usageCardValues(d) {
  const usage=d.lastUsage;
  return {title:'末次请求用量',rows:[['输入',usage?.inputTokens],['输出',usage?.outputTokens],['总量',usage?.totalTokens]].map(([label,value])=>({label,value:Number.isFinite(value)&&value>=0?value:null})),note:'仅展示上游用量观察；未知不记作零。不是多轮任务累计或账单。'};
}
function logCardValues() {
  syncLogSecrets();return {title:'通讯日志快照',entries:getNetworkLogs(),note:'截取当前内存日志，随历史保存；不自动刷新。来源标签不是实网证明，内容可能含私人对话。'};
}

const matrixSupported = d => Boolean(getImageCapabilities(d.api));
function selectedPixels(d, ratio, size) { return getImageCapabilities(d.api)?.ratios.find(item => item.ratio === ratio)?.pixelsBySize[size]?.join('×') || ''; }
function clearIncompatibleReasoning(d) {
  if (!d) return;
  d.reasoningIssue='';
  if(d.model.reasoningFamily){try{resolveReasoningFamily(d.api,d.model.reasoningFamily);}catch{delete d.model.reasoningFamily;delete d.model.reasoningMode;delete d.model.reasoningBudget;delete d.model.reasoning;}}
  const available=getReasoningTemplates(d.api);
  if(d.model.reasoningMode && !available.some(t=>t.id===d.model.reasoningMode)){delete d.model.reasoningMode;delete d.model.reasoningBudget;}
  if (!d.model.reasoning) return;
  try { reasoningBody(d.api, d.model.reasoning, d.model); }
  catch { delete d.model.reasoning; }
}
function selectedReasoningFamily(d) { return d.model.reasoningFamily || reasoningFamilyFor(d.api,d.model.reasoningMode || d.model.reasoning?.template); }
function selectedReasoningMode(d) {
  const family=selectedReasoningFamily(d);if(!family)return null;
  try{return resolveReasoningFamily(d.api,family).template;}catch{return null;}
}
function reasoningQuickMarkup(d) {
  const mode=selectedReasoningMode(d), current=d.model.reasoning;
  const values=mode?.values || [...new Set([...(mode?.specialValues||[]),...(d.model.reasoningBudget!==undefined?[d.model.reasoningBudget]:[])].map(String))].map(value=>({value,label:value==='-1'?'动态':value==='0'?'关闭':String(value)}));
  return `<section class="reasoning-menu reasoning-quick" data-floating-menu="reasoning-toggle" role="menu" aria-label="思考强度">
<button type="button" role="menuitemradio" aria-checked="${!current}" data-action="reasoning-quick" data-value="">不指定</button>${values.map(v=>`<button type="button" role="menuitemradio" aria-checked="${current?.template===mode.id && String(current.value)===String(v.value)}" data-action="reasoning-quick" data-template="${esc(mode.id)}" data-value="${esc(v.value)}">${esc(v.label||v.value)}</button>`).join('')}${mode?.kind==='number'?`<div class="reasoning-budget-row">
<input type="number" id="reasoning-quick-budget" aria-label="思考预算 Token" placeholder="Token" min="${mode.min}" max="${mode.max}" step="1" value="${esc(d.model.reasoningBudget??'')}">
<button type="button" data-action="reasoning-budget-apply">确定</button>
</div>`:''}</section>`;
}
function reasoningCurrentLabel(d) {
  const current=d.model.reasoning;if(!current)return '不指定';
  const mode=selectedReasoningMode(d);
  if(mode?.kind==='number'){if(mode.specialValues?.includes(Number(current.value)) && Number(current.value)===-1)return '动态';if(Number(current.value)===0)return '关闭';return `${current.value} Token`;}
  return mode?.values?.find(v=>String(v.value)===String(current.value))?.label || String(current.value);
}
function reasoningMarkup() {
  const d=get(), open=subMenu==='reasoning', current=d.model.reasoning, label=reasoningCurrentLabel(d);
  const picker=open ? reasoningAnchorId===null ? reasoningQuickMarkup(d) : `<section class="reasoning-menu reasoning-family-list" data-floating-menu="reasoning-toggle" data-menu-card="${reasoningAnchorId}" role="menu" aria-label="思考模板">${REASONING_FAMILIES.map(f=>`<button type="button" role="menuitemradio" aria-checked="${selectedReasoningFamily(d)===f.id}" data-action="reasoning-family" data-id="${reasoningAnchorId}" data-family="${f.id}">${f.label}</button>`).join('')}</section>` : '';
  return `<div class="reasoning-control">
<button type="button" class="reasoning-trigger" data-action="reasoning-toggle" aria-label="思考强度：${esc(label)}" aria-haspopup="menu" aria-expanded="${open&&reasoningAnchorId===null}" ${d.busy?'disabled':''}>${esc(label)}</button>${picker}</div>`;
}
function resetImageOptions(d, force = false) {
  const cap = getImageCapabilities(d.api); if (!cap) return;
  if (force || !cap.ratios.some(item => item.ratio === d.aspectRatio)) d.aspectRatio = cap.defaultRatio;
  if (force || !cap.sizes.includes(d.imageSize)) d.imageSize = cap.defaultSize;
}
function providerIdentity(api) {
  const official=providers.find(p=>!p.custom && p.protocol===api.protocol && sameEndpoint(api.url,p.url));
  if(official)return official;
  return providers.find(p=>p.custom && p.protocol===api.protocol) || {name:'自定义 · '+protocolLabel(api.protocol),protocol:api.protocol,custom:true};
}
function defaultModel(protocol, workspace) { return protocol === 'gemini' ? (workspace === 'image' ? IMAGE_MODEL : DEFAULT_TEXT_MODEL) : protocol === 'ark' ? (workspace === 'image' ? ARK_FLASH_MODEL : ARK_TEXT_MODEL) : ''; }
const isConfigured = d => { try { canonicalEndpoint(d.api.url); return Boolean(d.api.key.trim() && d.api.model.trim()); } catch { return false; } };
function trusted(config) { try { return config.trustedTarget === canonicalEndpoint(config.url); } catch { return false; } }
function sameEndpoint(left, right) {
  try { return canonicalEndpoint(left) === canonicalEndpoint(right); } catch { return left === right; }
}
function apiTrustText(config) { return config.key.trim() ? '发送或拉取时使用上方配置 · 密钥仅在内存' : '请填写密钥 · 密钥仅在内存'; }
function refreshApiStatus(d, cardId) {
  const reasoningButton=app.querySelector('[data-action="reasoning-toggle"]:not([data-id])');
  if(reasoningButton){const label=reasoningCurrentLabel(d);reasoningButton.textContent=label;reasoningButton.setAttribute('aria-label',`思考强度：${label}`);}

  // Update only status nodes: never replace an input while the user is typing.
  const trustLabel = app.querySelector(`#api-trust${cardId}`);
  if (trustLabel) trustLabel.textContent = apiTrustText(d.api);
  const providerButton=app.querySelector(`[data-action="supplier"][data-id="${cardId}"]`);
  if(providerButton)providerButton.textContent=providerIdentity(d.api).name;
  if (page === 'image') {
    const imageControl = app.querySelector('[data-image-control]');
    if (imageControl) imageControl.outerHTML = sizeMarkup();
  }
}
function closeMenus() { plusOpen = sizeOpen = false; subMenu = ''; }
function appendMessage(d,message) {
  const previous=liveCard(d.messages);
  if(previous)previous.values=captureCard(previous,d);
  confirmations.interrupt(d);
  d.messages.push(message);book.touch(d);
  return message;
}
function addCard(kind,values,d=get()) {
  if(!d)return;
  const card=cardRegistry.create(kind,nextId++,d,values);
  if(kind==='api')Object.assign(card,{showKey:false,models:[]});
  appendMessage(d,card);
  closeMenus(); if(get()===d)render(true);
  return card;
}
function status(d,text,type='status',scrollEnd=true) {appendMessage(d,{id:nextId++,type,text});if(get()===d)render(scrollEnd);}
function errorText(error) {
  if (error?.code === 'ATTACHMENT') return error.safeMessage;
  if (error instanceof AppError) return error.message;
  if (error?.name === 'AbortError' || error?.code === 'ABORTED') return '已取消。不会自动重试。';
  // Do not display raw upstream responses, stack traces, or arbitrary Error messages.
  const codes = {
    UNTRUSTED_ENDPOINT: '请先确认 API 目标地址。', INVALID_ENDPOINT: 'API 地址无效：请使用不含查询参数、账号或密码的公共 HTTPS 基础地址。',
    MISSING_KEY: '请填写 API Key。', MISSING_MODEL: '请填写模型 ID。',
    UNSUPPORTED_PROTOCOL: '此协议尚不支持。请选择 Gemini、OpenAI 兼容或火山方舟普通 API。',
    UNSUPPORTED_IMAGE_MODEL: '当前模板未配置此图片模型的参数，可选择已支持的 Gemini 或火山方舟模型。',
    IMAGE_CONFIG_REQUIRED: '请先在图片生成页配置并确认 API，然后继续对话。',
    INVALID_TOOL_ARGUMENTS: '图片工具参数无效；不会执行代码或更改目标地址。',
    CONFIRMATION_REQUIRED: '图片调用尚未获得确认，未发送图片请求。',
    TOOL_NOT_CONFIRMED: '已取消图片调用。', TOOL_LIMIT: '本轮图片工具调用已达上限，请开始下一轮。',
    NETWORK_ERROR: '网络请求失败。请检查网络、API 地址和上游 CORS 设置；不会自动重试。',
    HTTP_ERROR: 'API 请求失败。请检查密钥权限、模型、额度及参数；不会自动重试。'
  };
  if (codes[error?.code]) return codes[error.code];
  if (Number.isInteger(error?.status)) return `API 返回 HTTP ${error.status}。请检查密钥权限、模型、额度及参数；不会自动重试。`;
  return '请求未完成。请检查 API 配置、模型支持、网络与 CORS；不会自动重试。';
}
function protocolLabel(protocol) { return ({gemini:'Gemini 原生 · generateContent',openai:'OpenAI 兼容 · Chat Completions',ark:'火山方舟 · 普通 API',anthropic:'Anthropic · Messages'})[protocol] || protocol; }
function imageMarkup(m) {
  return `<div class="message">
<div class="assistant-message">
<div class="assistant-label">${m.fromTool ? '图片工作台 · Agent 调用' : '图片结果'}</div>${m.images.map((im, i) => `<div class="img-result">${im.failed ? '<div class="mock-status" role="alert">返回的图片文件无法在浏览器中解码。请检查下载文件；不会自动重新生成。</div>' : `<img class="generated-image" data-image-message="${m.id}" data-image-index="${i}" src="${esc(im.url)}" alt="${esc(m.prompt)}" loading="lazy">`}<div class="sample-caption">
<span>${esc(m.aspectRatio)} · ${esc(m.imageSize)}${im.width ? ` · 实际 ${esc(im.width)}×${esc(im.height)}` : ''}${im.checks?.dimensions==='mismatch'?' · 与预设尺寸不同':''}</span>
<a href="${esc(im.url)}" download="image-${m.id}-${i + 1}.${im.extension}">下载</a>
</div>
</div>`).join('')}${m.text ? `<div class="assistant-note">${esc(m.text)}</div>` : ''}${m.metrics ? `<div class="reply-metrics">${replyMetricsMarkup(m.metrics)}</div>` : ''}</div>
</div>`;
}
function messageMarkup(m) {
  if (m.type === 'card') {
    const d=get(),definition=cardRegistry.definitionFor(m),live=isLiveCard(d.messages,m.id);
    const body=definition ? definition.render(m) : unknownCardMarkup(m);
    return cardShell(m,body,{live,disabled:!definition || (d.busy&&m.kind!=='confirmation')});
  }
  if (m.type === 'user') return `<div class="message user">
<div class="bubble">${esc(m.text)}${attachmentsMarkup(m.attachments)}</div>
</div>`;
  if (m.type === 'imageResult') return imageMarkup(m);
  if (m.type === 'chatResult') return `<div class="message" data-stream-message="${m.id}">
<div class="assistant-message">
<div class="assistant-label">${m.incomplete ? '未完成 · 未加入上下文' : m.streaming ? '正在回复…' : '模型回复'}</div>${reasoningContentMarkup(m)}<div class="assistant-note reply-text">${esc(m.text)}</div>${m.metrics ? `<div class="reply-metrics">${replyMetricsMarkup(m.metrics)}</div>` : ''}</div>
</div>`;
  return `<div class="message">
<div class="mock-status" role="${m.type === 'error' ? 'alert' : 'status'}">${esc(m.text)}</div>
</div>`;
}
function attachmentsMarkup(files = [], editable = false) {
  return files.length ? `<div class="attachments">${files.map(a=>`<div class="attachment">${a.kind==='image' ? `<img src="data:${esc(a.mimeType)};base64,${esc(a.base64)}" alt="${esc(a.name)}">` : ''}<span>${esc(a.name)} · ${(a.size/1024).toFixed(1)} KiB</span>${editable ? `<button type="button" data-action="remove-attachment" data-id="${esc(a.id)}" aria-label="移除 ${esc(a.name)}">×</button>` : ''}</div>`).join('')}</div>` : '';
}
function selectAttachments(kind) {
 const d=get(); if(page!=='chat' || d.busy || d.attachmentReading) return;
 const picker=document.createElement('input'); picker.type='file'; picker.multiple=true;
 const formats={text:'.txt,.md,.csv,.json,.log,.xml,.html,.css,.js,.ts,.py,.yaml,.yml',image:'.png,.jpg,.jpeg,.webp',pdf:'.pdf',audio:'.mp3,.wav,.ogg,.flac',video:'.mp4,.webm,.mov'};
 const enabled=supportedModalities(d.api.protocol).filter(k=>d.model.inputs.includes(k) && (kind!=='image'||k==='image'));
 picker.accept=enabled.map(k=>formats[k]).join(',');
 if(!enabled.length) {d.attachmentError='请先在模型设置启用图片输入。';render();return;}
 picker.addEventListener('change',async()=>{
  if(!picker.files?.length) return;
  d.attachmentReading=true; closeMenus(); if(get()===d)render();
  try { d.attachments=await prepareFiles(picker.files,d.attachments,d.api.protocol,d.model.inputs); d.attachmentError=''; }
  catch(error) { d.attachmentError=errorText(error); }
  finally {d.attachmentReading=false;saveLocal(true);if(get()===d)render();}
 },{once:true});
 picker.click();
}
function plusMarkup() { return `<div class="menu-wrap">
<button class="circle" aria-label="展开工具菜单" aria-expanded="${plusOpen}" data-action="plus" ${get().busy?'disabled':''}>${icon('plus',22)}</button>${plusOpen?`<div class="plus-menu"><button data-action="new-card" data-kind="api">${icon('settings')} 设置</button>${page==='chat'?'<button data-action="attach" data-kind="image">添加图片</button><button data-action="attach" data-kind="file">添加文件</button>':''}</div>`:''}</div>`; }
function sizeMarkup() {
  const d = get(), cap = getImageCapabilities(d.api);
  return `<div class="menu-wrap" data-image-control>
<button class="size-btn" type="button" data-action="size-toggle" aria-expanded="${sizeOpen}" aria-label="选择长宽比与分辨率" ${d.busy ? 'disabled' : ''}>${cap ? `${esc(d.aspectRatio)} · ${esc(d.imageSize)}` : '图片参数'} ${icon('chev', 14)}</button>${sizeOpen ? `<div class="size-menu" id="image-options">
<div class="menu-heading">长宽比与分辨率</div>
<div class="matrix-model">${esc(cap?.label || '未配置图片参数的模型')}</div>${cap ? `<div class="matrix-scroll">
<table class="option-matrix" aria-label="${esc(cap.label)} 图片长宽比与分辨率">
<colgroup>
<col class="matrix-ratio-col">${cap.sizes.map(() => '<col>').join('')}</colgroup>
<thead>
<tr>
<th scope="col">长宽比</th>${cap.sizes.map(size => `<th scope="col">${size}</th>`).join('')}</tr>
</thead>
<tbody>${cap.ratios.map(item => `<tr>
<th scope="row">
<span class="size-name">${item.ratio}</span>
</th>${cap.sizes.map(size => { const selected = d.aspectRatio === item.ratio && d.imageSize === size; return `<td>
<button type="button" class="matrix-choice ${selected ? 'sel' : ''}" data-action="set-image-options" data-ratio="${item.ratio}" data-image-size="${size}" aria-label="长宽比 ${item.ratio}，${size}，${selectedPixels(d, item.ratio, size)}" aria-pressed="${selected}">
<span class="matrix-mark" aria-hidden="true">${selected ? '✓' : ''}</span>
<span class="matrix-pixels">${selectedPixels(d, item.ratio, size)}</span>
</button>
</td>`; }).join('')}</tr>`).join('')}</tbody>
</table>
</div>${cap.presetNotes ? `<div class="matrix-notice">${esc(cap.presetNotes)}</div>` : ''}` : '<div class="matrix-notice">当前模板未配置此模型的图片参数。可选择 Nano Banana 2.1 或已支持的 Seedream 5.0 Flash / Pro。</div>'}</div>` : ''}</div>`;
}
function renderLogsPage() {
  syncLogSecrets();
  app.innerHTML = `<main class="main">
<header class="top">${tabsMarkup(page)}</header>
<section class="thread">
<div class="thread-inner">
${historyMarkup({entries:book.list(historyQuery),activeId:book.activeId,query:historyQuery,notice:historyNotice})}
<details class="history-log-panel" ${historyLogs?'open':'hidden'}><summary>通讯记录与诊断</summary>
<div class="log-actions">
<button class="chip" data-action="export-logs">导出通讯记录</button>
<button class="chip" data-action="clear-logs">清空通讯记录</button>
<button class="chip" data-action="history-log-card">插入日志快照</button><button class="chip" data-action="history-usage">用量图表</button>
</div>
<details class="scroll-diagnostics">
<summary>滚动诊断（不含对话与密钥）</summary>
<p>发生回弹后打开这里，复制或导出进入历史页前的记录。仅保存最近 80 条位置和事件，不会自动上传。</p>
<button class="chip" data-action="copy-scroll-diagnostics">复制滚动诊断</button>
<button class="chip" data-action="export-scroll-diagnostics">导出滚动诊断</button>
<span id="scroll-diagnostic-status" role="status">
</span>
<textarea id="scroll-diagnostic-text" aria-label="滚动诊断 JSON" readonly rows="5">${esc(exportScrollReport())}</textarea>
</details>
<div id="network-logs">
</div></details>
</div>
</section>
</main>`;
  renderNetworkLogs(app.querySelector('#network-logs'));
  recordScrollDiagnostic('render-dom-replaced');
  mountFloatingMenu();
  syncFloatingNavigation();
}

const view = createViewPosition({app,document,getPage:()=>page==='logs'?'logs':`${book.activeId}:${page}`,recordScrollDiagnostic,requestAnimationFrame});
const {viewPositions,captureControlFocus,restoreControlFocus,rememberViewPosition,restoreViewPosition}=view;
scope.own(()=>view.dispose());
const storage=createWorkspaceStorage({store:localStore,clock,
  capture:()=>captureArchive(),
  captureJournal:()=>({...snapshotJournal({data,page,secrets:[...localSecrets]}),conversationId:book.activeId}),
  getPage:()=>page,beforeCapture:rememberViewPosition,onStatus:setStorageStatus,
  restore(saved){
    installArchive(saved);
    localRestored=allWorkspaces().some(d=>d.messages.length||d.draft);
    if(['ready','restored','saved'].includes(storageState))setStorageStatus('restored');
  }
});
const saveLocal=storage.save;
scope.own(()=>storage.dispose());
function captureArchive(){return snapshotConversations({book,page,nextId,views:Object.fromEntries(viewPositions),secrets:[...localSecrets]});}
function installArchive(saved){
  const restored=restoreConversations(saved,makePage);book.restore(restored);Object.assign(data,book.current().data);
  page=restored.page;nextId=restored.nextId;viewPositions.clear();for(const [key,value] of Object.entries(restored.views))viewPositions.set(key,value);
}
async function selectConversation(id){
  await saveLocal(true);rememberViewPosition();const entry=book.select(id);if(!entry)return false;
  Object.assign(data,entry.data);page=entry.page||'chat';closeMenus();render();await saveLocal(true);return true;
}
function downloadJSON(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function historyAction(action,id){
  historyNotice='';
  if(action==='conversation-new'){
    try{await saveLocal(true);rememberViewPosition();const entry=book.create();Object.assign(data,entry.data);page='chat';closeMenus();render();await saveLocal(true);}
    catch{historyNotice='当前会话数量已达上限。请先导出并删除不再需要的会话。';render();}return;
  }
  if(action==='conversation-open'){await selectConversation(id);return;}
  const entry=book.entries.find(e=>e.id===id);
  if(action==='conversation-rename'&&entry){const title=window.prompt('会话名称',entry.title);if(title!==null){book.rename(id,title);render();await saveLocal(true);}return;}
  if(action==='conversation-export'&&entry){
    try{const archive=captureArchive();archive.entries=archive.entries.filter(e=>e.id===id);archive.activeId=id;archive.page=entry.page||'chat';archive.views={};downloadJSON(archive,'llm-conversation.json');}
    catch{historyNotice='导出失败，请检查存储提示。';render();}return;
  }
  if(action==='conversation-delete'&&entry){
    if(Object.values(entry.data).some(d=>d.busy||d.attachmentReading)){historyNotice='会话仍在处理请求或附件，请结束后再删除。';render();return;}
    if(!window.confirm('删除这个会话及其附件？需要保留时请先导出。'))return;
    for(const d of Object.values(entry.data)){archiveWorkspaceKey(d);confirmations.interrupt(d);for(const m of d.messages)for(const image of m.images||[])imageDelivery.release(image.url);}
    book.remove(id);Object.assign(data,book.current().data);for(const key of viewPositions.keys())if(key.startsWith(id+':'))viewPositions.delete(key);
    approvedSessionRequest=null;render();await saveLocal(true);return;
  }
  if(action==='history-logs'){historyLogs=true;render();app.querySelector('.history-log-panel')?.scrollIntoView?.({block:'start'});return;}
  if(['history-log-card','history-usage'].includes(action)){page=book.current().page||'chat';const d=get();if(d.busy)return;addCard(action==='history-usage'?'chart':'logs',action==='history-usage'?usageCardValues(d):logCardValues(),d);return;}
  if(action==='history-storage')openStoragePanel();
}
function render(scrollEnd = false) {
  if(scope.disposed)return;
  saveLocal(false,true);
  recordScrollDiagnostic(scrollEnd ? 'render-send-end' : 'render-start');
  rememberViewPosition();
  const expanded=[...(app.querySelectorAll?.('details[data-setting-section][open]')||[])].map(el=>({card:el.closest?.('[data-interaction-card]')?.dataset.interactionCard,section:el.dataset.settingSection}));
  const focusIdentity = captureControlFocus();
  if (page === 'logs') { renderLogsPage(); restoreViewPosition(scrollEnd); restoreControlFocus(focusIdentity); return; }
  const d = get();
  app.innerHTML = `<main class="main">
<header class="top">${tabsMarkup(page)}</header>
<section class="thread" id="thread" aria-label="${page === 'chat' ? '对话' : '图片'}历史">
<div class="thread-inner">${d.messages.map(messageMarkup).join('')}${d.busy ? '<div class="message">'+loadingMarkup(d)+'</div>' : ''}</div>
</section>
<footer class="composer-area">${d.reasoningIssue?`<div class="reasoning-error" role="alert">${esc(d.reasoningIssue)}</div>`:''}${page === 'chat' ? `<div class="attachment-draft">${attachmentsMarkup(d.attachments,true)}${d.attachmentReading ? '<span role="status">正在读取附件…</span>' : ''}${d.attachmentError ? `<span role="alert">${esc(d.attachmentError)}</span>` : ''}</div>` : ''}<div class="compose">
<textarea id="draft" rows="1" placeholder="${page === 'image' ? '描述你想生成的图片…' : ''}" aria-label="${page === 'image' ? '图片提示词' : '聊天消息'}" ${d.busy ? 'disabled' : ''}>${esc(d.draft)}</textarea>
<div class="compose-actions">
<div class="left-actions">${plusMarkup()}</div>
<div class="right-actions">${page === 'image' ? sizeMarkup() : reasoningMarkup()}${d.busy ? '<button class="send" data-action="cancel" aria-label="取消请求" title="取消请求">■</button>' : `<button class="send" data-action="send" aria-label="${page === 'image' ? '生成图片' : '发送消息'}" title="${page === 'image' ? '生成图片' : '发送消息'}">${icon('up')}</button>`}</div>
</div>
</div>
<div class="compose-metrics">${replyMetricsMarkup(d.lastMetrics)}</div>
</footer>
</main>`;
  for(const item of expanded){const target=app.querySelector(`[data-interaction-card="${item.card}"] details[data-setting-section="${item.section}"]`);if(target)target.open=true;}
  recordScrollDiagnostic('render-dom-replaced');
  mountFloatingMenu();
  syncFloatingNavigation();
  positionFloatingMenu();
  restoreViewPosition(scrollEnd);
  restoreControlFocus(focusIdentity);
  if(d.busy)paintLoading(d);
}
// Update only the active reply node: do not rebuild composer or displace readers.
const paintStream=createStreamPainter({app,get,saveLocal,recordScrollDiagnostic,render,messageMarkup,isDisposed:()=>scope.disposed});
const loading = createRequestLifecycle({app,get,esc,clock});
const {loadingMarkup,paintLoading,requestPhase,beginLoading,requestError}=loading;
scope.own(()=>loading.dispose());
function applyCurrentTarget(d, report = text => status(d, text, 'error')) {
  try { d.api.trustedTarget = canonicalEndpoint(d.api.url); return true; }
  catch (e) { d.api.trustedTarget = ''; report(errorText(e)); return false; }
}
function syncCurrentApiFields(d) {
  const card = getCard(activeCardId(d));
  if (!card || !['api','connection'].includes(card.kind)) return;
  const values = Object.fromEntries(['url','key','model'].map(key => [key, app.querySelector(`#${key}${card.id}`)?.value]));
  // Autofill may skip input events: snapshot first, but never carry an unchanged old key to a changed target.
  if (values.url !== undefined && values.url !== d.api.url && values.key === d.api.key) values.key = '';
  for (const key of ['url','key','model']) if (values[key] !== undefined && values[key] !== d.api[key]) {
    updateField({target:{value:values[key],dataset:{card:String(card.id),key}}});
  }
  const keyField = app.querySelector(`#key${card.id}`);
  if (keyField && keyField.value !== d.api.key) keyField.value = d.api.key;
}
function configuredImageSnapshot(workspace) {
  const config = { ...(book.owner(workspace)?.data.image||data.image).api };
  try { config.trustedTarget = config.key.trim() ? canonicalEndpoint(config.url) : ''; }
  catch { config.trustedTarget = ''; }
  return config;
}
function askConfirmation(d,text,title='调用确认') {
  if(services.confirm)return services.confirm(text);
  const pending=confirmations.request(d,{title,text});
  if(get()===d)render(true);
  return pending;
}
function approveImage(invocation,d) {
  return askConfirmation(d,`生成图片将消耗 API 额度\n\n目标：${invocation.target}\n模型：${invocation.model}\n长宽比：${invocation.args.aspectRatio || '1:1'} · 分辨率：${invocation.args.imageSize || '1K'}\n提示词：${invocation.args.prompt}\n\n确认调用图片工作台？`,'图片调用确认');
}
async function appendImages(d, result, args, fromTool = false) {
  let expectedPixels;
  try { expectedPixels=normalizeImageOptions({protocol:result.protocol || (fromTool?book.owner(d)?.data.image.api.protocol:d.api.protocol),model:result.model},args).pixels; } catch {}
  const images=await imageDelivery.prepare(result.images || [],expectedPixels);
  if(scope.disposed)return;
  appendMessage(d,{ id: nextId++, type: 'imageResult', images, text: result.text || '', prompt: args.prompt, aspectRatio: args.aspectRatio || '1:1', imageSize: args.imageSize || '1K', metrics:replyMetricsSnapshot(result.usage), fromTool });
  saveLocal(true);
  if (get() === d) render();
  return imageWorkspaceReceipt(images);
}

function modelListStatus(d, card, text) {
  card.modelListStatus = text;
  if (get() === d) render();
}
async function pullModels(card,commit) {
  const d = get(); if (d.busy) return;
  syncCurrentApiFields(d);
  closeMenus();
  syncLogSecrets();
  if (d.api.protocol === 'ark') { modelListStatus(d, card, '普通 Ark API 暂无已核实的模型列表接口，请填写官方模型 ID。'); return; }
  if (!d.api.key.trim()) { modelListStatus(d, card, '请先填写 API Key；尚未发送模型列表请求。'); return; }
  card.modelListStatus = '';
  if (!applyCurrentTarget(d, text => { card.modelListStatus = text; })) { modelListStatus(d, card, card.modelListStatus || '地址无效，未发送模型列表请求。'); return; }
  d.busy = true; d.controller = new AbortController(); const stopLoading=beginLoading(d); render();
  try {
    const models = await listModels({ config: { ...d.api }, signal: d.controller.signal, onPhase:phase=>requestPhase(d,phase) });
    commit(()=>{card.models=models;if(get()===d)subMenu=`models:${card.id}`;});
  } catch (e) { commit(()=>{card.modelListStatus=errorText(requestError(d,e));}); }
  finally { stopLoading(); d.busy = false; d.controller = null; if (get() === d) { render(); if (subMenu === `models:${card.id}`) focusFloatingMenu(); } }
}
async function send() {
  const d = get(); if (!d) return { status: 'not-sent', reason: 'select-workspace' };
  syncCurrentApiFields(d);
  syncLogSecrets();
  const requestPage = page, text = d.draft.trim(), imageConfig=configuredImageSnapshot(d);
  if (d.busy || confirmations.has(d) || d.attachmentReading || (!text && !d.attachments.length)) return { status: 'not-sent', reason: d.busy || confirmations.has(d) ? 'busy' : 'empty' };
  closeMenus();
  const attachments = [...d.attachments];
  try { validateAttachments(attachments,d.api.protocol,d.model.inputs); } catch(e) { d.attachmentError=errorText(e); render(); return {status:'not-sent',reason:'attachments'}; }
  const pending = d.messages.find(m => m.id === d.pendingTextId);
  if (!pending || pending.text !== text || JSON.stringify(pending.attachments?.map(a=>a.id)) !== JSON.stringify(attachments.map(a=>a.id))) { const m = { id: nextId++, type: 'user', text, attachments }; appendMessage(d,m); d.pendingTextId = m.id; }
  saveLocal(true);
  if (!isConfigured(d)) { addCard('api'); return { status: 'needs-configuration' }; }
  if (!applyCurrentTarget(d)) return {status:'not-sent',reason:'invalid-target'};
  if (requestPage === 'image' && !matrixSupported(d)) { status(d, '当前模板未配置此图片模型的参数，可选择 Nano Banana 2.1 或 Seedream 5.0 Flash / Pro。', 'error'); return { status: 'not-sent', reason: 'unsupported-model' }; }
  const config = { ...d.api }, args = { prompt: text, aspectRatio: d.aspectRatio, imageSize: d.imageSize };
  if (requestPage === 'image') {
    const before=sessionRequestSnapshot();
    if(!await approveImage({target:canonicalEndpoint(config.url),model:config.model,args},d)) {render(true);return {status:'declined'};}
    if(scope.disposed || JSON.stringify(before)!==JSON.stringify(sessionRequestSnapshot()))return {status:'not-sent',reason:'changed-after-confirmation'};
  }
  d.busy = true; d.controller = new AbortController(); d.draft = ''; d.attachments = []; d.attachmentError = ''; d.lastUsage = null; d.lastMetrics = null;
  const stopLoading=beginLoading(d);
  let checkpointed = false;
  let outcome;
  const streamedReplies = new Map();
  const streamingReply = round => {
    let reply = streamedReplies.get(round);
    if (!reply) {
      reply = {id:nextId++,type:'chatResult',text:'',reasoningText:'',reasoningOpen:true,streaming:true};
      streamedReplies.set(round,reply); appendMessage(d,reply);
    }
    return reply;
  };
  render(true);
  if(storage.hydrated)await saveLocal(true);
  try {
    if (requestPage === 'image') {
      const result = await dispatchCommand({ command: 'image.generate', args }, { imageConfig: config, signal: d.controller.signal, confirmed: true, onPhase:phase=>requestPhase(d,phase) });
      const receipt=await appendImages(d,result,args);
      outcome=requestOutcome({kind:'image',receipt});
      d.lastUsage = result.usage; d.lastMetrics = replyMetricsSnapshot(result.usage);
    } else {
      const result = await runConversation({
        config, imageConfig, messages: [...d.history, { role: 'user', content: text, attachments }], settings: { ...d.model }, signal: d.controller.signal,
        onPhase:phase=>requestPhase(d,phase),
        onDelta: (delta, {round}) => {
          if (!delta) return;
          const reply = streamingReply(round);
          reply.text += delta; paintStream(d,reply);
        },
        onReasoningDelta: (delta, {round}) => {
          if (!delta) return;
          const reply = streamingReply(round);
          reply.reasoningText += delta; paintStream(d,reply);
        },
        onResponse: (response, {round}) => {
          const reply = streamedReplies.get(round);
          if (reply) { reply.streaming = false; reply.metrics = response.metrics; paintStream(d,reply); }
        },
        confirmTool: async invocation => approveImage(invocation,d),
        onHistory: history => { d.history = history; checkpointed = true; saveLocal(true); },
        onToolResult: ({ result, invocation }) => appendImages(d, result, invocation.args, true)
      });
      outcome=requestOutcome({kind:'text',completion:result.completion});
      d.history = result.history;
      if (result.text && !streamedReplies.size) appendMessage(d,{ id: nextId++, type: 'chatResult', text: result.text, metrics: result.metrics });
      d.lastUsage = result.usage; d.lastMetrics = result.metrics;
    }
    d.pendingTextId = null;
    // Compatibility status describes control flow; outcome carries separate predicates.
    return { status:'completed',messageCount:d.messages.length,outcome };
  } catch (e) {
    e=requestError(d,e);
    for (const reply of streamedReplies.values()) {
      if (reply.streaming) { reply.streaming = false; reply.incomplete = true; paintStream(d,reply); }
    }
    status(d, errorText(e), e?.code === 'CANCELLED' ? 'status' : 'error', false);
    if (!checkpointed) { d.draft = text; d.attachments = attachments; }
    else { d.pendingTextId = null; status(d, '已保留本轮工具上下文。你可以继续对话；已完成的图片不会自动重做。', 'status', false); }
    return { status: e?.code === 'CANCELLED' ? 'cancelled' : 'failed', code: e instanceof AppError ? e.code : 'REQUEST_FAILED' };
  } finally { stopLoading(); d.busy = false; d.controller = null; await saveLocal(true); if (get() === d) render(); }
}
// Native details retain focus/selection and open state during streamed text updates.
listen(app, 'toggle', e => {
  const details = e.target;
  if (!details.matches?.('details[data-reasoning-message]')) return;
  const message = get()?.messages.find(m => String(m.id) === details.dataset.reasoningMessage);
  if (message) { message.reasoningOpen = details.open; saveLocal(); }
}, true);
listen(app, 'click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if(el.dataset.action.startsWith('conversation-')||el.dataset.action.startsWith('history-')){await historyAction(el.dataset.action,el.dataset.conversation);return;}
  if (el.dataset.action === 'local-storage') { openStoragePanel(); return; }
  const action = el.dataset.action, d = get(), card = getCard(Number(el.dataset.id));
  const cardAction=cardRegistry.actionFor(card,action);
  if(el.dataset.id && cardAction) {
    const args=Object.fromEntries(cardAction.keys.filter(key=>el.dataset[key]!==undefined).map(key=>[key,el.dataset[key]]));
    await dispatchCardAction({id:Number(el.dataset.id),action,args},d);return;
  }
  if ((d?.busy || d?.attachmentReading) && !['tab', 'cancel'].includes(action)) return;
  switch (action) {
    case 'tab': if(el.dataset.tab === 'logs')freezeScrollReport(); page = el.dataset.tab;if(page!=='logs')book.current().page=page; closeMenus(); render(); break;
    case 'reasoning-toggle': {
      if(el.dataset.id)break;
      const anchorId=el.dataset.id?Number(el.dataset.id):null;
      const open=subMenu!=='reasoning' || reasoningAnchorId!==anchorId;closeMenus();reasoningAnchorId=anchorId;
      if(open)subMenu='reasoning';
      render();if(open)focusFloatingMenu();break;
    }
    case 'reasoning-budget-apply': {
      const mode=selectedReasoningMode(d), field=app.querySelector('#reasoning-quick-budget');
      if(mode?.kind!=='number' || !field)break;
      try{
        if(!field.value.trim())throw new AppError('REASONING_SETTINGS','请输入思考预算，或选择不指定。');
        const selection={template:mode.id,value:field.value};reasoningBody(d.api,selection,d.model);
        d.model.reasoning=selection;d.model.reasoningBudget=field.value;d.reasoningIssue='';
        closeMenus();render();app.querySelector('[data-action="reasoning-toggle"]:not([data-id])')?.focus({preventScroll:true});
      }catch(error){d.reasoningIssue=error.message;render();}break;
    }
    case 'reasoning-quick': {
      const mode=selectedReasoningMode(d);
      if(el.dataset.value==='')delete d.model.reasoning;
      else if(mode && mode.id===el.dataset.template){
        const selection={template:mode.id,value:el.dataset.value};
        try {reasoningBody(d.api,selection,d.model);d.model.reasoning=selection;}catch(error){d.reasoningIssue=error.message;render();break;}
      }
      d.reasoningIssue='';closeMenus();render();app.querySelector('[data-action="reasoning-toggle"]:not([data-id])')?.focus({preventScroll:true});break;
    }
    case 'plus': plusOpen = !plusOpen; sizeOpen = false; subMenu = ''; render(); if (plusOpen) focusFloatingMenu(); break;
    case 'attach': selectAttachments(el.dataset.kind); break;
    case 'clear-chat': confirmations.interrupt(d);for(const message of d.messages)for(const image of message.images || [])imageDelivery.release(image.url);d.messages=[];d.history=[];d.attachments=[];d.draft='';d.pendingTextId=null;d.attachmentError='';d.lastUsage=null;d.lastMetrics=null;await saveLocal(true,true,[page]);render();break;
    case 'clear-attachments': d.attachments=[]; d.attachmentError=''; render(); break;
    case 'remove-attachment': d.attachments=d.attachments.filter(a=>a.id!==el.dataset.id); d.attachmentError=''; render(); break;
    case 'new-card': if(cardRegistry.kinds.includes(el.dataset.kind)){syncCurrentApiFields(d);addCard(el.dataset.kind,el.dataset.kind==='chart'?usageCardValues(d):el.dataset.kind==='logs'?logCardValues():undefined);} break;
    case 'size-toggle': sizeOpen = !sizeOpen; plusOpen = false; subMenu = ''; render(); if (sizeOpen) focusFloatingMenu(); break;
    case 'set-image-options': if (matrixSupported(d) && getImageCapabilities(d.api).ratios.some(x => x.ratio === el.dataset.ratio) && getImageCapabilities(d.api).sizes.includes(el.dataset.imageSize)) { const scroll = app.querySelector('.matrix-scroll')?.scrollTop || 0; d.aspectRatio = el.dataset.ratio; d.imageSize = el.dataset.imageSize; render(); recordScrollDiagnostic('matrix-write',scroll); app.querySelector('.matrix-scroll').scrollTop = scroll; } break;
    case 'send': await send(); break;
    case 'cancel': confirmations.interrupt(d);d.controller?.abort(); break;
    case 'copy-scroll-diagnostics': {
      await copyDiagnosticReport({app,getPage:()=>page,clipboard:navigator.clipboard,text:exportScrollReport()});
      break;
    }
    case 'export-scroll-diagnostics': {
      const url=URL.createObjectURL(new Blob([exportScrollReport()],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='scroll-diagnostic.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);break;
    }
    case 'clear-logs': clearNetworkLogs(); break;
    case 'export-logs': {
      const url = URL.createObjectURL(new Blob([exportNetworkLogs()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'llm-network-logs.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); break;
    }
  }
});
async function performCardAction(action,{card,workspace:d,args,commit}) {
  const el={dataset:{...args,id:String(card.id)}};
  switch(action) {
    case 'reasoning-toggle': {

      const anchorId=el.dataset.id?Number(el.dataset.id):null;
      const open=subMenu!=='reasoning' || reasoningAnchorId!==anchorId;closeMenus();reasoningAnchorId=anchorId;
      if(open)subMenu='reasoning';
      render();if(open)focusFloatingMenu();break;
    }
    case 'reasoning-family': {
      reasoningAnchorId=card.id;
      try{
        const resolved=resolveReasoningFamily(d.api,el.dataset.family);
        const changed=d.model.reasoningFamily!==resolved.family.id || d.model.reasoningMode!==resolved.template?.id;
        d.model.reasoningFamily=resolved.family.id;
        if(resolved.template)d.model.reasoningMode=resolved.template.id;else delete d.model.reasoningMode;
        if(changed){delete d.model.reasoning;delete d.model.reasoningBudget;}
        d.reasoningIssue=resolved.template?'':'该模型尚未确定此模板的参数结构；未发送思考参数。';
        closeMenus();render();app.querySelector(`[data-action="reasoning-toggle"][data-id="${reasoningAnchorId}"]`)?.focus({preventScroll:true});
      }catch(error){d.reasoningIssue=error.message;render();}
      break;
    }
    case 'toggle-input': { const kind=el.dataset.modality; if(kind==='text' || !supportedModalities(d.api.protocol).includes(kind)) break; d.model.inputs=d.model.inputs.includes(kind)?d.model.inputs.filter(k=>k!==kind):[...d.model.inputs,kind]; render(); break; }
    case 'supplier': plusOpen = sizeOpen = false; subMenu = subMenu === `supplier:${card.id}` ? '' : `supplier:${card.id}`; render(); if (subMenu) focusFloatingMenu(); break;
    case 'choose-supplier': {
      const p = providers[Number(el.dataset.index)];if(!p)break;
      const sameProviderTarget = d.api.protocol === p.protocol && (sameEndpoint(d.api.url, p.url) || (p.custom && (d.api.supplier === p.name || p.aliases?.includes(d.api.supplier))));
      if (!sameProviderTarget) {
        archiveWorkspaceKey(d);
        if (d.api.protocol !== p.protocol) { d.history = []; d.model.inputs = [...new Set(['text', ...d.model.inputs.filter(kind=>supportedModalities(p.protocol).includes(kind))])]; }
        d.api = { ...d.api, protocol: p.protocol, url: p.url, key: '', supplier: p.name, model: p.custom ? '' : defaultModel(p.protocol, page), trustedTarget: '' };
        card.models = []; syncLogSecrets();
        if (page === 'image') resetImageOptions(d, true);
      } else d.api.supplier = p.name;
      clearIncompatibleReasoning(d);card.modelListStatus = ''; subMenu = ''; render(); break;
    }
    case 'toggle-key': card.showKey = !card.showKey; render(); break;
    case 'pull-models': await pullModels(card,commit); break;
    case 'choose-model': d.api.model = el.dataset.model; clearIncompatibleReasoning(d); if (page === 'image') resetImageOptions(d); subMenu = ''; render(); break;


  }
  return {ok:true};
}
function updateField(e) {
  const t = e.target, d = get();
  resizeSettingField(t);
  if(t.id==='history-query'){if(e.isComposing)return;historyQuery=t.value;render();const field=app.querySelector('#history-query');field?.focus?.();return;}
  if(!d)return;
  if (t.id === 'draft') { d.draft = t.value; resizeDraft(t);book.touch(d); saveLocal(false,true); return; }
  const id = Number(t.dataset.card), key = t.dataset.key, card = getCard(id);
  if (!card || id !== activeCardId(d) || !key || d.busy) return;
  void dispatchCardAction({id,action:'field.change',args:{key,value:t.value}},d);
}
function applyCardField(d,card,t) {
  const id=card.id,key=t.dataset.key;
  if (['api','connection'].includes(card.kind)) {
    if(key==='protocol'&&!['gemini','openai','ark','anthropic'].includes(t.value))return {ok:false,reason:'invalid-protocol'};
    const changed = d.api[key] !== t.value;
    if (changed && key === 'key') { archiveWorkspaceKey(d); d.api.trustedTarget = ''; }
    d.api[key] = t.value;
    if(key==='key'&&t.value){localRestored=false;setStorageStatus(storageState);}
    if (changed) {
      card.modelListStatus = '';
      const modelStatus = app.querySelector(`#models-status${id}`);
      if (modelStatus) modelStatus.textContent = '';
    }
    if (changed && ['url','protocol'].includes(key)) {
      archiveWorkspaceKey(d);
      d.api.trustedTarget = ''; d.api.key = ''; card.models = [];
      const keyInput = app.querySelector(`#key${id}`); if (keyInput) keyInput.value = '';
      if (key === 'protocol') { d.history = []; d.api.model = ''; }
      d.api.supplier=providerIdentity(d.api).name;card.values.supplier=d.api.supplier;
    }
    // No API-key snapshots anywhere in the message list.
    if (key !== 'key') card.values[key] = t.value;
    if(changed && ['url','protocol','model'].includes(key))clearIncompatibleReasoning(d);
    syncLogSecrets();
    if (page === 'image') resetImageOptions(d);
    refreshApiStatus(d, id);
  } else { d.model[key] = t.value; card.values[key] = t.value; }
  book.touch(d);saveLocal(false,true);
}
listen(app, 'error', e => {
  const image = e.target;
  if (image?.tagName !== 'IMG' || !image.dataset.imageMessage) return;
  for (const d of Object.values(data)) {
    const message = d.messages.find(m => m.id === Number(image.dataset.imageMessage));
    if (message?.images?.[Number(image.dataset.imageIndex)]) {
      message.images[Number(image.dataset.imageIndex)].failed = true;
      message.images[Number(image.dataset.imageIndex)].checks={...message.images[Number(image.dataset.imageIndex)].checks,decoded:'failed'};
      if (get() === d) render();
      break;
    }
  }
}, true);
listen(app, 'load', e => {
  const image=e.target;
  if(image?.tagName!=='IMG'||!image.dataset.imageMessage)return;
  for(const d of Object.values(data)){
    const message=d.messages.find(m=>m.id===Number(image.dataset.imageMessage));
    const stored=message?.images?.[Number(image.dataset.imageIndex)];
    if(!stored)continue;
    stored.width=image.naturalWidth;stored.height=image.naturalHeight;
    stored.checks={...stored.checks,decoded:'passed'};
    saveLocal();break;
  }
},true);
listen(app, 'input', updateField);
listen(app, 'change', e => { updateField(e); if (e.target.dataset?.key === 'key') archiveWorkspaceKey(get()); if (e.target.tagName === 'SELECT') render(); });
listen(document, 'keydown', e => {
  if(['reasoning-quick','reasoning-family'].includes(e.target.dataset?.action) && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const choices=[...app.querySelectorAll('[data-floating-menu="reasoning-toggle"] [role="menuitemradio"]')];
    const index=choices.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?choices.length-1:(index+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
    choices[next]?.focus({preventScroll:true});choices[next]?.scrollIntoView({block:'nearest'});
  }
  if (e.target.dataset?.action === 'supplier' && ['ArrowDown','ArrowUp'].includes(e.key)) {
    if(!isLiveCard(get()?.messages,Number(e.target.dataset.id)))return;
    e.preventDefault();if(subMenu!==`supplier:${e.target.dataset.id}`)void dispatchCardAction({id:Number(e.target.dataset.id),action:'supplier',args:{}});
    (app.querySelector('[data-floating-menu] [aria-selected="true"]') || app.querySelector('[data-floating-menu] button'))?.focus({preventScroll:true});
  } else if (e.target.dataset?.action === 'choose-supplier' && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
    e.preventDefault(); const choices = [...app.querySelectorAll('[data-floating-menu="supplier"] [role="option"]')];
    const index = choices.indexOf(e.target), next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus({preventScroll:true}); recordScrollDiagnostic('menu-reveal'); choices[next]?.scrollIntoView({block:'nearest'});
  }
  if (e.key === 'Escape' && (plusOpen || sizeOpen)) { e.preventDefault(); dismissFloatingMenu(true); }
  else if (e.key === 'Escape' && subMenu) { e.preventDefault(); dismissFloatingMenu(true); }
  if (e.target.id === 'draft' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
scope.own(subscribeNetworkLogs(() => {
  if (page === 'logs') renderNetworkLogs(app.querySelector('#network-logs'));
}));
function publicSessionState() {
  syncLogSecrets();
  return sanitizeLogValue({
    page,conversationId:book.activeId,
    workspaces: Object.fromEntries(Object.entries(data).map(([name, d]) => [name, {
      protocol: d.api.protocol, endpoint: d.api.url, model: d.api.model,
      configured: isConfigured(d), busy: d.busy, draft: d.draft,
      aspectRatio: d.aspectRatio, imageSize: d.imageSize, messageCount: d.messages.length
    }])),
    logCount: getNetworkLogs().length
  });
}
let approvedSessionRequest = null;
function sessionRequestSnapshot() {
  const d = get();
  return d ? { conversationId:book.activeId,page, draft: d.draft, attachments: d.attachments.map(a=>a.id), api: { ...d.api }, settings: { ...d.model, ...(d.model.reasoning ? {reasoning:{...d.model.reasoning}} : {}) }, aspectRatio: d.aspectRatio, imageSize: d.imageSize } : null;
}
const pageSession = createPageSession({
  isActive:()=>!scope.disposed && storage.hydrated,
  state: publicSessionState,
  logs: () => { syncLogSecrets(); return getNetworkLogs(); },
  navigate: ({ page: destination }) => { if(destination === 'logs')freezeScrollReport(); page = destination;if(page!=='logs')book.current().page=page; closeMenus(); render(); return publicSessionState(); },
  draft: ({ text }) => { const d = get(); if (!d || d.busy) throw new Error('No editable workspace'); d.draft = text; render(); return { updated: true }; },
  settings: args => {
    const d = get(); if (!d || d.busy) throw new Error('No editable workspace');
    const api = { ...d.api, ...(args.model === undefined ? {} : { model: args.model.trim() }) };
    let options;
    if (args.aspectRatio !== undefined || args.imageSize !== undefined) {
      if (page !== 'image') throw new Error('Image settings require the image workspace');
      options = normalizeImageOptions(api, { aspectRatio: args.aspectRatio ?? d.aspectRatio, imageSize: args.imageSize ?? d.imageSize });
    }
    appendMessage(d,{id:nextId++,type:'status',text:'页面工具更新了模型设置。'});
    d.api = api;
    clearIncompatibleReasoning(d);
    for (const key of ['output', 'temperature', 'topP']) if (args[key] !== undefined) d.model[key] = args[key];
    if (options) { d.aspectRatio = options.aspectRatio; d.imageSize = options.imageSize; }
    if (page === 'image') resetImageOptions(d);
    render(); return publicSessionState();
  },
  confirmSend: async () => {
    const d = get(); if (!d || d.busy || d.attachmentReading || (!d.draft.trim() && !d.attachments.length) || approvedSessionRequest || confirmations.has(d)) return false;
    syncCurrentApiFields(d);
    syncLogSecrets();
    const snapshot = sessionRequestSnapshot();
    // Occupy the request slot while waiting, so cancel can clear it before the
    // promise resumes. The dispatcher still requires an affirmative reply.
    approvedSessionRequest = snapshot;
    const approved = await askConfirmation(d,`允许已连接的页面控制工具发送当前${page === 'image' ? '图片生成' : '对话及附件'}请求？\n\n目标：${sanitizeLogValue(d.api.url)}\n模型：${sanitizeLogValue(d.api.model)}\n提示词：${sanitizeLogValue(d.draft)}\n附件：${d.attachments.length ? d.attachments.map(a=>`${sanitizeLogValue(a.name)} (${(a.size/1024).toFixed(1)} KiB)`).join('、') : '无'}\n此操作可能消耗 API 额度。图片生成的独立确认仍然适用。`);
    if(get()===d)syncCurrentApiFields(d);
    if (!approved && approvedSessionRequest === snapshot) approvedSessionRequest = null;
    return approved;
  },
  send: () => {
    const approved = approvedSessionRequest; approvedSessionRequest = null;
    const current = get(); if (current) syncCurrentApiFields(current);
    // Confirmation yields a microtask in the command dispatcher. Recheck the
    // exact page/prompt/config/settings snapshot so a racing command cannot
    // replace what the user just approved. The snapshot is never logged.
    if (!approved || JSON.stringify(approved) !== JSON.stringify(sessionRequestSnapshot())) return { status: 'not-sent', reason: 'changed-after-confirmation' };
    return send();
  },
  cancel: () => {
    const pendingApproval = Boolean(approvedSessionRequest); approvedSessionRequest = null;
    const d = get(); if (!d && !pendingApproval) throw new Error('Select workspace');
    const waiting=d?confirmations.interrupt(d):false;d?.controller?.abort(); return { requested: pendingApproval || waiting || Boolean(d?.controller) };
  }
});
const ready=(async()=>{
  await initializeLocal();
  if(scope.disposed)return;
  window.llmWorkbench = pageSession;
  const registration=await registerTools(pageSession,document.modelContext ?? navigator?.modelContext);
  scope.own(()=>registration?.dispose?.());
  if(!scope.disposed)render();
})();


// Hydration completes before controls or page-session tools become available.
function initializeLocal() {
  app.innerHTML='<p role="status" class="local-loading">正在恢复本机数据…</p>';
  return storage.initialize();
}
function setStorageStatus(state) {
  if(scope.disposed)return;
  storageState=state;
  const warning=['credential-collision','saved-journal-error','journal-error','error','size-limit','conflict','blocked','schema','unavailable'].includes(state);
  const show=warning||localRestored;
  let notice=document.getElementById('local-save-notice');
  if(show&&!notice){notice=document.createElement('button');notice.id='local-save-notice';notice.className='local-save-notice';notice.setAttribute('role','status');notice.onclick=openStoragePanel;document.body.append(notice);}
  if(notice){notice.hidden=!show;notice.textContent=warning?storageLabels[state]:'已恢复本机内容；API Key 请重新填写（点击查看）';}
  const status=document.getElementById('local-storage-status');if(status)status.textContent=storageLabels[state]||state;
}
function openStoragePanel() {
  localRestored=false;setStorageStatus(storageState);
  document.getElementById('local-storage-panel')?.remove();
  const dialog=document.createElement('dialog');dialog.id='local-storage-panel';dialog.className='local-storage-panel';
  let bytes=null;try{bytes=new TextEncoder().encode(JSON.stringify(captureArchive())).byteLength;}catch{}
  dialog.innerHTML=`<h2>本机保存与备份</h2><p>${book.entries.length} 个会话 · ${bytes===null?'大小暂不可用':(bytes/1024/1024).toFixed(2)+' MiB'} / 48 MiB</p>
<p id="local-storage-status">${esc(storageLabels[storageState])}</p>
<p>自动保留本机的所有会话、对话、草稿、附件、模型设置和独立指标。草稿与安全设置有 128 KiB 同步保护；大历史/附件仍须等待完整存档提交。API Key 与目标确认不保存；刷新后请重新填写密钥。自动通讯日志不保存；主动插入的日志卡随历史保存。含账号、密码、查询参数或片段的 API 地址不保存。</p>
<p>仅限当前浏览器与网站地址。无痕模式、清理浏览器或系统回收空间可能删除数据；这不是永久备份。单份快照上限 48 MiB，超限或配额不足时保留上一份成功存档，不会悄悄删除附件。</p>
<p>多标签页版本冲突后不会覆盖另一页；先导出全部会话，再刷新读取最新存档。</p>
<div class="local-storage-actions">
<button data-local="export">导出全部会话</button>
<button data-local="import">导入备份</button>
<button data-local="retry">重试保存</button>
<button data-local="close">关闭</button>
</div>
<p id="local-backup-status" role="status">
</p>`;
  dialog.addEventListener('click',async event=>{
    const action=event.target.dataset.local;if(!action)return;
    const result=dialog.querySelector('#local-backup-status');
    if(action==='close'){dialog.close();dialog.remove();return;}
    if(action==='retry'){await saveLocal(true);return;}
    if(action==='export')try{
      const value=captureArchive();
      const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='llm-workbench-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);result.textContent='已发起下载。备份包含对话与附件，请妥善保管。';
    }catch{result.textContent='快照过大或无法导出。请先下载重要图片并复制重要文字。';}
    if(action==='import'){
      const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
      picker.onchange=async()=>{try{
        const file=picker.files?.[0];if(!file)return;if(file.size>MAX_SNAPSHOT_BYTES)throw new Error();
        const imported=migrateConversations(JSON.parse(await file.text()));
        if(allWorkspaces().some(d=>d.busy||d.attachmentReading)){result.textContent='请先结束当前请求。';return;}
        if(!window.confirm('用备份替换所有本机会话和设置？建议先导出全部内容。'))return;
        for(const d of allWorkspaces()){archiveWorkspaceKey(d);confirmations.interrupt(d);for(const m of d.messages)for(const image of m.images || [])imageDelivery.release(image.url);}
        approvedSessionRequest=null;
        installArchive(imported);
        render();await saveLocal(true);result.textContent='已恢复到本页。是否成功写入本机，请看上方保存状态。';
      }catch{result.textContent='备份格式不支持、损坏或超过 48 MiB；未恢复。';}};picker.click();
    }
  });
  document.body.append(dialog);dialog.showModal();
}

listen(app, 'scroll',()=>{if(storage.hydrated)saveLocal();},{passive:true});
listen(document, 'visibilitychange',()=>{if(document.visibilityState==='hidden')saveLocal(true);});
listen(window, 'pagehide',()=>saveLocal(true));

scope.own(()=>{localSecrets.clear();if(window.llmWorkbench===pageSession)delete window.llmWorkbench;});
return {ready,session:pageSession,dispose:()=>scope.dispose(),data,addCard,render,isConfigured,matrixSupported,dispatchCardAction,
  conversations:book,archiveSnapshot:captureArchive,selectConversation,
  persisted:()=>snapshotWorkspace({data,page,nextId,secrets:[...localSecrets]}),setPage:value=>{page=value;}};
}
