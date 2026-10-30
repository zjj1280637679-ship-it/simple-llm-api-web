/** 设置视图只投影显式配置和当前卡位置；导航关系与字段效果由外部提供。
 * 无 DOM 写入、存储或网络；转义所有用户字段，分层展开只影响可见性。
 */
import {esc} from './view-markup.js';
import {MODALITIES,supportedModalities} from './attachments.js';
import {REASONING_FAMILIES,reasoningFamilyFor} from './reasoning.js';
export function createSettingsViews({get,currentPage,activeCardId,menuState,reasoningAnchor,providers,providerIdentity,protocolLabel,apiTrustText}) {
function apiCard(m) {
  const page=currentPage(),subMenu=menuState(),reasoningAnchorId=reasoningAnchor();
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.api;
  const menu = subMenu.endsWith(`:${m.id}`) ? subMenu.split(':')[0] : '';
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
<button type="button" data-action="pull-models" data-id="${m.id}" aria-expanded="${menu === 'models'}" class="uniform-btn" ${x.protocol === 'ark' ? 'disabled title="普通 Ark API 未核实模型列表接口，请填写官方模型 ID"' : ''}>${x.protocol === 'ark' ? '手填模型' : '拉取模型'}</button>${menu === 'models' ? `<div class="inline-list" data-floating-menu="pull-models" data-menu-card="${m.id}">${m.models?.length ? m.models.map(model => `<button class="inline-item" data-action="choose-model" data-id="${m.id}" data-model="${esc(model.id)}">${esc(model.id)}</button>`).join('') : '<span class="inline-item">上游未返回可用模型</span>'}</div>` : ''}</div>
</div>
</div>
    <div class="field-reading" id="models-status${m.id}" role="status">${esc(m.modelListStatus || '')}</div>
    <div class="api-security"><span id="api-trust${m.id}">${old?'未保留历史密钥':apiTrustText(x)}</span>${x.protocol==='ark'?'<div>普通 API · 非 Agent Plan</div>':''}</div>
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
  const field = (label, key, placeholder) => `<div class="formfield">
<label for="${key}${m.id}">${label}</label>
<input class="block-input" type="number" id="${key}${m.id}" data-card="${m.id}" data-key="${key}" placeholder="${placeholder}" value="${esc(x[key])}" step="any">
</div>`;
  return `<div class="card-type">模型设置</div><div class="subgrid model-sections">${page === 'chat' ? `<details data-setting-section="output"><summary>输出限制</summary>${field('输出预算 Token', 'output', 'API 默认')}</details><details data-setting-section="sampling"><summary>采样参数</summary>${field('温度', 'temperature', 'API 默认')}${field('Top P', 'topP', 'API 默认')}</details><details data-setting-section="more"><summary>更多参数</summary><details data-setting-section="reasoning"><summary>思考模板</summary><div class="formfield">
<label for="reasoning-model${m.id}">自定义思考模板</label>
<button type="button" id="reasoning-model${m.id}" class="block-value reasoning-model-trigger" data-action="reasoning-toggle" data-id="${m.id}" aria-haspopup="menu" aria-expanded="${subMenu==='reasoning' && reasoningAnchorId===m.id}">${esc(REASONING_FAMILIES.find(f=>f.id===(old ? x.reasoningFamily : x.reasoningFamily || reasoningFamilyFor(d.api,x.reasoningMode || x.reasoning?.template)))?.label || '选择模板')}</button>
</div>
<div class="formfield">
<label for="context${m.id}">上下文</label>
<output id="context${m.id}" class="block-value">当前对话上下文</output>
</div></details>${inputSettingsMarkup(m,d,x)}</details>` : `<div class="formfield">
<label for="count${m.id}">生成数量</label>
<output id="count${m.id}" class="block-value">1</output>
</div>
<div class="formfield">
<label for="format${m.id}">输出格式</label>
<output id="format${m.id}" class="block-value">上游原始格式</output>
</div>`}</div><div class="model-note">${page === 'chat' ? `输入模态控制可添加的附件，不代表当前模型具备相应能力；以供应商响应为准。附件仅在点击发送时提交到 API。图片生成仍通过独立图片工作台。${d.api.protocol === 'ark' ? ' Token 预算使用 max_completion_tokens，含思考与回答。' : d.api.protocol === 'anthropic' ? ' 输出预算使用 max_tokens，未填时为 4096；当前仅文本附件，不提供工具调用。' : ''}` : '文本生成图片；比例和分辨率在输入框右下方选择。'}</div><button class="chip" data-action="open-settings-card" data-id="${m.id}" data-kind="api">返回设置</button>
`;
}
return {api:apiCard,connection:connectionCard,model:modelCard};
}
