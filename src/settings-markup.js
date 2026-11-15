/** 设置视图只投影显式配置和当前卡位置；导航关系与字段效果由外部提供。
 * 无 DOM 写入、存储或网络；转义所有用户字段，分层展开只影响可见性。
 */
import {getImageCapabilities} from './image-capabilities.js';
import {imageSettingsMarkup,imageSnapshotRows} from './image-options-markup.js';
import {geminiProfile,partitionGeminiModels} from './gemini-capabilities.js';
import {geminiSettingsMarkup,geminiSnapshotRows} from './gemini-settings-markup.js';
import {esc} from './view-markup.js';
import {MODALITIES,supportedModalities} from './attachments.js';
import {REASONING_FAMILIES,reasoningFamilyFor} from './reasoning.js';
import {identifyProvider} from './provider-identity.js';
const protocolNote=protocol=>protocol==='ark'?'Token 预算使用 max_completion_tokens，含思考与回答。':protocol==='anthropic'?'输出预算使用 max_tokens，未填时为 4096；当前仅文本附件，不提供工具调用。':'';
/** Historical model records have no editable/folded controls and no current-config input.
 * Readability and edit admission are distinct effects; the shell/dispatcher own admission.
 */
export function historicalModelMarkup(card,page) {
  const x=card.values,protocol=x.displayContext?.protocol;
  const known=['gemini','openai','ark','anthropic'].includes(protocol);
  const present=(value,fallback)=>value===undefined||value===null||value===''?fallback:String(value);
  const family=REASONING_FAMILIES.find(f=>f.id===x.reasoningFamily)?.label || (x.reasoningFamily===null?'未指定模板':'未记录模板');
  const rows=page==='chat' ? [
    ...(x.displayContext?.model?[['模型',x.displayContext.model]]:[]),
    ...geminiSnapshotRows(x).map(([label,value])=>[protocol==='gemini'?label:`${label}（Gemini 偏好，未应用）`,value]),['响应方式',x.streamMode==='json'?'完整 JSON（非流式）':x.streamMode==='sse'?'SSE 实时流式':'未记录'],['输出预算 Token',present(x.output,'API 默认')],['温度',present(x.temperature,'API 默认')],['Top P',present(x.topP,'API 默认')],
    ['思考模板',family],['思考强度',x.reasoning?`${present(x.reasoning.template,'未记录模板')} · ${present(x.reasoning.value,'未记录')}`:'未指定'],
    ...(x.reasoningBudget!==undefined?[['模板预算',present(x.reasoningBudget,'未指定')]]:[]),
    ['联网搜索',x.webSearch==='deepseek'?'DeepSeek 官方（启用）':x.webSearch==='off'?'关闭':'未记录'],
    ['输入模态',Array.isArray(x.inputs)?x.inputs.map(kind=>MODALITIES[kind]||kind).join('、')||'未选择':'未记录']
  ] : imageSnapshotRows(x);
  const note=page==='image'?'历史参数按当时记录显示；未记录项不使用当前连接推断。':known?(protocolNote(protocol)+(x.displayContext?.gemini?.sampling==='unsupported'?' 当时模型不使用温度 / Top P / Top K；保存的偏好未应用。':'')+(x.displayContext?.gemini?.thinking==='unsupported'?' 当时模型回执明确不支持思考；相关偏好未应用。':'')):'历史协议未记录；保留已存参数，不按当前连接推断。';
  return `<div class="card-type">模型设置</div><dl class="settings-snapshot">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${note?`<p class="model-note">${esc(note)}</p>`:''}`;
}
export function createSettingsViews({get,currentPage,activeCardId,menuState,reasoningAnchor,getSearchKey=()=>'',providers,providerIdentity,protocolLabel,apiTrustText}) {
function modelListMarkup(m,protocol) {
  if(!m.models?.length)return '<span class="inline-item">上游未返回可用模型</span>';
  const button=model=>`<button class="inline-item" data-action="choose-model" data-id="${m.id}" data-model="${esc(model.id)}">${esc(model.id)}</button>`;
  if(protocol!=='gemini')return m.models.map(button).join('');
  const {usable,other}=partitionGeminiModels(m.models);
  if(currentPage()==='image') {
    const adapted=usable.filter(model=>getImageCapabilities({protocol,model:model.id}));
    const unknown=usable.filter(model=>!getImageCapabilities({protocol,model:model.id}));
    return `<div class="model-note">已适配的图片模型 · 可调用性以上游为准</div>${adapted.map(button).join('')||'<div class="inline-item">本次列表没有已适配图片模型</div>'}${unknown.length?`<details><summary>其他模型（尚未适配图片参数）</summary>${unknown.map(button).join('')}</details>`:''}${other.length?`<details><summary>其他方法模型（${other.length}）</summary>${other.map(model=>`<div class="inline-item">${esc(model.id)}</div>`).join('')}</details>`:''}`;
  }
  return `${usable.map(button).join('')}${other.length?`<details><summary>其他方法模型（${other.length}）</summary><p class="model-note">这些模型未声明 generateContent；当前工作台未接入其方法。</p>${other.map(model=>`<div class="inline-item">${esc(model.id)}</div>`).join('')}</details>`:''}`;
}
function apiCard(m) {
  const page=currentPage(),subMenu=menuState(),reasoningAnchorId=reasoningAnchor();
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.api;
  const menu = subMenu.endsWith(`:${m.id}`) ? subMenu.split(':')[0] : '';
  const identity=identifyProvider(x),qwen=identity.provider==='qwen'&&identity.profileMatched;
  const manualModel=x.protocol==='ark'||qwen;
  return `<div class="card-type">设置</div>
    <div class="formfield"><label>服务商</label><div class="sub-menu">
<button type="button" data-action="supplier" aria-haspopup="listbox" aria-controls="supplier-options${m.id}" title="${esc(protocolLabel(x.protocol))}" data-id="${m.id}" aria-expanded="${menu === 'supplier'}" class="uniform-btn">${esc(providerIdentity(x).name)}</button>${menu === 'supplier' ? `<div id="supplier-options${m.id}" class="inline-list" role="listbox" aria-label="供应商与 API 格式" data-floating-menu="supplier" data-menu-card="${m.id}">${providers.map((p, i) => `<button class="inline-item" role="option" aria-selected="${providerIdentity(x).name === p.name}" data-action="choose-supplier" data-id="${m.id}" data-index="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div><div class="connection-target">${esc(x.url || '请在连接细节中填写地址')}</div></div>
    <div class="formfield">
<label for="key${m.id}">API Key</label>
<div class="fieldrow">
<input id="key${m.id}" data-card="${m.id}" data-key="key" type="${!old && m.showKey ? 'text' : 'password'}" placeholder="" aria-describedby="key-help${m.id}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(old ? '' : x.key)}">
<button type="button" data-action="toggle-key" data-id="${m.id}" class="uniform-btn">${m.showKey ? '隐藏' : '显示'}</button>
</div>
<div class="field-reading" id="key-help${m.id}">${old ? '未保留历史密钥' : '仅保留在本页内存，刷新即清除'}</div>
</div>
    <div class="formfield">
<label for="model${m.id}">模型 ID</label>
<div class="fieldrow">
<textarea class="setting-text" rows="1" wrap="soft" id="model${m.id}" data-card="${m.id}" data-key="model" placeholder="模型 ID" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(x.model)}</textarea>
<div class="sub-menu">
<button type="button" data-action="pull-models" data-id="${m.id}" aria-expanded="${menu === 'models'}" class="uniform-btn" ${manualModel ? `disabled title="${qwen?'百炼模型列表使用原生 /api/v1/models；当前请手填模型 ID':'普通 Ark API 未核实模型列表接口，请填写官方模型 ID'}"` : ''}>${manualModel ? '手填模型' : '拉取模型'}</button>${menu === 'models' ? `<div class="inline-list" data-floating-menu="pull-models" data-menu-card="${m.id}">${modelListMarkup(m,x.protocol)}</div>` : ''}</div>
</div>
</div>
    <div class="field-reading" id="models-status${m.id}" role="status">${esc(m.modelListStatus || '')}</div>
    <div class="api-security"><span id="api-trust${m.id}">${old?'未保留历史密钥':apiTrustText(x)}</span>${x.protocol==='ark'?'<div>普通 API · 非 Agent Plan</div>':''}${qwen?'<div>百炼按量 API · 北京/新加坡密钥按地域匹配；不支持混用 Coding/Token Plan 密钥。模型示例：qwen3.8-flash、qwen3.7-plus（需自行确认可用地域）。</div>':''}</div>
    <div class="settings-links"><button class="chip" data-action="open-settings-card" data-id="${m.id}" data-kind="model">模型设置 ›</button><button class="chip" data-action="open-settings-card" data-id="${m.id}" data-kind="connection">连接细节 ›</button></div>
  `;
}
function connectionCard(m) {
  const d=get(),old=m.id!==activeCardId(d),x=old?m.values:d.api;
  return `<div class="card-type">连接细节</div><div class="formfield"><label for="url${m.id}">API 地址</label><textarea class="setting-text" rows="1" wrap="soft" id="url${m.id}" data-card="${m.id}" data-key="url" autocapitalize="off" spellcheck="false" autocomplete="off">${esc(x.url)}</textarea></div>
<div class="formfield"><label for="protocol${m.id}">协议格式</label><select id="protocol${m.id}" data-card="${m.id}" data-key="protocol">${['gemini','openai','ark','anthropic'].map(protocol=>`<option value="${protocol}" ${x.protocol===protocol?'selected':''}>${esc(protocolLabel(protocol))}</option>`).join('')}</select></div>
<div class="api-security"><span id="api-trust${m.id}">${old?'未保留历史密钥':apiTrustText(x)}</span></div><p class="model-note">修改地址或协议后，请返回设置重新填写密钥。填写不会发送请求；发送和拉取模型时，内容会提交到配置地址。实际支持与 CORS 取决于服务商。</p>
<button class="chip" data-action="open-settings-card" data-id="${m.id}" data-kind="api">返回设置</button>`;
}
function inputSettingsMarkup(m,d,x){return `<details data-setting-section="inputs"><summary>输入模态</summary><div class="fieldgroup">
<div class="chips">${Object.entries(MODALITIES).map(([kind,label]) => `<button type="button" class="chip ${x.inputs?.includes(kind) ? 'sel' : ''}" data-action="toggle-input" data-id="${m.id}" data-modality="${kind}" aria-pressed="${Boolean(x.inputs?.includes(kind))}" ${!supportedModalities(d.api.protocol).includes(kind) || kind === 'text' ? 'disabled' : ''}>${label}</button>`).join('')}</div>
</div></details>`;}
function modelCard(m) {
  const page=currentPage(),subMenu=menuState(),reasoningAnchorId=reasoningAnchor();
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.model;
  if(old)return historicalModelMarkup(m,page);
  const gemini=geminiProfile(d.api);
  const thinkingAvailable=gemini?.thinking!=='unsupported';
  const field = (label, key, placeholder) => `<div class="formfield">
<label for="${key}${m.id}">${label}</label>
<input class="block-input" type="number" id="${key}${m.id}" data-card="${m.id}" data-key="${key}" placeholder="${placeholder}" value="${esc(x[key])}" step="any">
</div>`;
  return `<div class="card-type">模型设置</div><div class="subgrid model-sections">${page === 'chat' ? `<details data-setting-section="output"><summary>输出限制</summary>${field('输出预算 Token', 'output', 'API 默认')}${gemini?.outputTokenLimit?`<p class="model-note">模型列表报告输出上限 ${esc(gemini.outputTokenLimit)} Token；当前配额另由请求结果确认。</p>`:''}</details>${gemini?.sampling==='unsupported'?'<p class="model-note">当前模型不使用温度 / Top P / Top K，已收起这些控制；保存的偏好不会发送。</p>':`<details data-setting-section="sampling"><summary>采样参数</summary>${field('温度', 'temperature', 'API 默认')}${field('Top P', 'topP', 'API 默认')}</details>`}<details data-setting-section="more"><summary>更多参数</summary>${thinkingAvailable?`<details data-setting-section="reasoning"><summary>思考模板</summary><div class="formfield">
<label for="reasoning-model${m.id}">自定义思考模板</label>
<button type="button" id="reasoning-model${m.id}" class="block-value reasoning-model-trigger" data-action="reasoning-toggle" data-id="${m.id}" aria-haspopup="menu" aria-expanded="${subMenu==='reasoning' && reasoningAnchorId===m.id}">${esc(REASONING_FAMILIES.find(f=>f.id===(old ? x.reasoningFamily : x.reasoningFamily || reasoningFamilyFor(d.api,x.reasoningMode || x.reasoning?.template)))?.label || '选择模板')}</button>
</div>
<div class="formfield">
<label for="context${m.id}">上下文</label>
<output id="context${m.id}" class="block-value">当前对话上下文</output>
</div></details>`:''}${geminiSettingsMarkup(m,d.api,x)}<details data-setting-section="stream-mode"><summary>响应方式 / 流式兼容</summary>
<div class="formfield"><label for="streamMode${m.id}">模型回复传输方式</label>
<select id="streamMode${m.id}" class="block-input" data-card="${m.id}" data-key="streamMode">
<option value="sse" ${x.streamMode!=='json'?'selected':''}>实时流式 SSE（默认）</option>
<option value="json" ${x.streamMode==='json'?'selected':''}>完整 JSON · 稳定兼容（非流式）</option>
</select></div>
<p class="model-note">默认实时显示；收到有效完成标记并且 SSE 正常关闭时，即使中转站未发送 [DONE] 也可确认完整结束。若供应商经常提前断流，可选「完整 JSON」避免 SSE 兼容问题；这不会重试已经发出的请求，完整回答返回前也不会逐字显示。真正中断和 length 等未完成标记仍不会误加入上下文。</p></details><details data-setting-section="web-search"><summary>联网搜索 · DeepSeek</summary>
<div class="formfield"><label for="webSearch${m.id}">搜索工具</label>
<select id="webSearch${m.id}" class="block-input" data-card="${m.id}" data-key="webSearch">
<option value="off" ${x.webSearch!=='deepseek'?'selected':''}>关闭（不产生搜索费用）</option>
<option value="deepseek" ${x.webSearch==='deepseek'?'selected':''}>DeepSeek 官方 · 模型自主搜索</option>
</select></div>
<div class="formfield"><label for="searchKey${m.id}">DeepSeek 搜索 API Key（可单独填写）</label>
<input id="searchKey${m.id}" class="block-input" data-card="${m.id}" data-key="searchKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="独立搜索 Key · 仅内存" value="${esc(getSearchKey(d))}"></div>
<p class="model-note">固定调用 https://api.deepseek.com/v1/tools/search。搜索词由当前模型决定，结果返回当前模型；DeepSeek Key 不会发给主模型供应商或存入历史。主模型若是官方 DeepSeek，可留空复用当前对话 Key。每轮最多 4 次工具调用，无自动重试，成功搜索可能按次计费。Anthropic 格式的工具调用目前尚未适配。</p>
</details>${inputSettingsMarkup(m,d,x)}</details>` : imageSettingsMarkup(m,d.api,x,d)}</div><div class="model-note">${page === 'chat' ? `输入模态控制可添加的附件，不代表当前模型具备相应能力；以供应商响应为准。附件仅在点击发送时提交到 API。图片生成仍通过独立图片工作台。${protocolNote(d.api.protocol)}` : '文本生成图片；比例和分辨率在输入框右下方选择。'}</div><button class="chip" data-action="open-settings-card" data-id="${m.id}" data-kind="api">返回设置</button>
`;
}
return {api:apiCard,connection:connectionCard,model:modelCard};
}
