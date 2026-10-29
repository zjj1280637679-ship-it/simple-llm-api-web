import { icon } from './icons.js';
import { AppError, DEFAULT_TEXT_MODEL, IMAGE_MODEL, aspectRatios, imageSizes, imagePixels, canonicalEndpoint, listModels, dispatchCommand } from './core.js';
import { runConversation } from './agent.js';

const app = document.getElementById('app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providers = [
  { name: 'Google Gemini', protocol: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  { name: 'OpenAI', protocol: 'openai', url: 'https://api.openai.com/v1' },
  { name: '自定义 · Gemini', protocol: 'gemini', url: '' },
  { name: '自定义 · OpenAI 兼容', protocol: 'openai', url: '' }
];
const makePage = type => ({
  api: { protocol: 'gemini', url: providers[0].url, key: '', model: type === 'image' ? IMAGE_MODEL : DEFAULT_TEXT_MODEL, supplier: 'Google Gemini', trustedTarget: '' },
  model: { output: '', temperature: '', topP: '' }, draft: '', pendingTextId: null,
  aspectRatio: '1:1', imageSize: '1K', messages: [], history: [], busy: false,
  controller: null, lastUsage: null, elapsed: null
});
const data = { chat: makePage('chat'), image: makePage('image') };
let page = 'chat', plusOpen = false, sizeOpen = false, subMenu = '', nextId = 1;
const get = () => data[page];
const activeCardId = d => d.messages.findLast(m => m.type === 'card')?.id;
const getCard = id => get().messages.find(m => m.id === id && m.type === 'card');
const matrixSupported = d => d.api.protocol === 'gemini' && d.api.model.trim().replace(/^models\//, '') === IMAGE_MODEL;
const isConfigured = d => Boolean(d.api.key.trim() && d.api.model.trim() && trusted(d.api));
function trusted(config) { try { return config.trustedTarget === canonicalEndpoint(config.url); } catch { return false; } }
function sameEndpoint(left, right) {
  try { return canonicalEndpoint(left) === canonicalEndpoint(right); } catch { return left === right; }
}
function apiStatusMarkup(d) { return `<span class="dot ${isConfigured(d) ? 'ready' : ''}"></span>${isConfigured(d) ? 'API 已配置 · 仅内存' : 'API 未配置'}`; }
function apiTrustText(config) { return trusted(config) ? '已确认目标 · 密钥仅在内存' : '调用前需确认目标 · 密钥仅在内存'; }
function refreshApiStatus(d, cardId) {
  // Update only status nodes: never replace an input while the user is typing.
  const badge = app.querySelector('.top-right');
  if (badge) badge.innerHTML = apiStatusMarkup(d);
  const trustLabel = app.querySelector(`#api-trust${cardId}`);
  if (trustLabel) trustLabel.textContent = apiTrustText(d.api);
}
function closeMenus() { plusOpen = sizeOpen = false; subMenu = ''; }
function addCard(kind) {
  const d = get();
  const previous = d.messages.find(m => m.id === activeCardId(d));
  if (previous) previous.values = previous.kind === 'api' ? { ...d.api, key: '' } : { ...d.model };
  // Historical cards never retain an API-key snapshot.
  const values = kind === 'api' ? { ...d.api, key: '' } : { ...d.model };
  d.messages.push({ id: nextId++, type: 'card', kind, values, showKey: false, models: [] });
  closeMenus(); render(true);
}
function status(d, text, type = 'status') { d.messages.push({ id: nextId++, type, text }); if (get() === d) render(true); }
function errorText(error) {
  if (error instanceof AppError) return error.message;
  if (error?.name === 'AbortError' || error?.code === 'ABORTED') return '已取消。不会自动重试。';
  // Do not display raw upstream responses, stack traces, or arbitrary Error messages.
  const codes = {
    UNTRUSTED_ENDPOINT: '请先确认 API 目标地址。', INVALID_ENDPOINT: 'API 地址无效：请使用不含查询参数、账号或密码的公共 HTTPS 基础地址。',
    MISSING_KEY: '请填写 API Key。', MISSING_MODEL: '请填写模型 ID。',
    UNSUPPORTED_PROTOCOL: '此协议尚不支持。请选择 Gemini 原生或 OpenAI 兼容。',
    UNSUPPORTED_IMAGE_MODEL: '图片生成目前仅支持 Gemini 原生 Nano Banana 2.1。',
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
function apiCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.api;
  const menu = subMenu.endsWith(`:${m.id}`) ? subMenu.split(':')[0] : '';
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}
    <div class="formfield"><label for="url${m.id}">API 地址</label><div class="fieldrow"><input id="url${m.id}" data-card="${m.id}" data-key="url" placeholder="https://generativelanguage.googleapis.com/v1beta" value="${esc(x.url)}" autocomplete="off" spellcheck="false"><div class="sub-menu"><button type="button" data-action="supplier" data-id="${m.id}" class="uniform-btn">${esc(x.supplier)}</button>${menu === 'supplier' ? `<div class="inline-list">${providers.map((p, i) => `<button class="inline-item" data-action="choose-supplier" data-id="${m.id}" data-index="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div></div></div>
    <div class="formfield"><label for="protocol${m.id}">协议</label><select class="native-select" id="protocol${m.id}" data-card="${m.id}" data-key="protocol"><option value="gemini" ${x.protocol === 'gemini' ? 'selected' : ''}>Gemini 原生 · generateContent</option><option value="openai" ${x.protocol === 'openai' ? 'selected' : ''}>OpenAI 兼容 · Chat Completions</option></select></div>
    <div class="formfield"><label for="key${m.id}">API Key</label><div class="fieldrow"><input id="key${m.id}" data-card="${m.id}" data-key="key" type="${!old && m.showKey ? 'text' : 'password'}" placeholder="${old ? '未保留历史密钥' : '仅保留在本页内存，刷新即清除'}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(old ? '' : x.key)}"><button type="button" data-action="toggle-key" data-id="${m.id}" class="uniform-btn">${m.showKey ? '隐藏' : '显示'}</button></div></div>
    <div class="formfield"><label for="model${m.id}">模型 ID</label><div class="fieldrow"><input id="model${m.id}" data-card="${m.id}" data-key="model" placeholder="输入模型 ID" value="${esc(x.model)}" spellcheck="false"><div class="sub-menu"><button type="button" data-action="pull-models" data-id="${m.id}" class="uniform-btn">拉取模型</button>${menu === 'models' ? `<div class="inline-list">${m.models.length ? m.models.map(model => `<button class="inline-item" data-action="choose-model" data-id="${m.id}" data-model="${esc(model.id)}">${esc(model.id)}</button>`).join('') : '<span class="inline-item">上游未返回可用模型</span>'}</div>` : ''}</div></div></div>
    <div class="api-security">${!old && d.pendingTextId ? '<div>填写并确认后，再次发送即可继续。</div>' : ''}<span id="api-trust${m.id}">${old ? '密钥不写入历史记录' : apiTrustText(x)}</span>${!old ? '<div class="security-actions"><button type="button" class="chip" data-action="trust-target">确认目标地址</button><button type="button" class="chip" data-action="clear-key">清除密钥</button></div>' : ''}</div>
  </div></fieldset></div>`;
}
function modelCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.model;
  const field = (label, key, placeholder) => `<div class="formfield"><label for="${key}${m.id}">${label}</label><input class="block-input" type="number" id="${key}${m.id}" data-card="${m.id}" data-key="${key}" placeholder="${placeholder}" value="${esc(x[key])}" step="any"></div>`;
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}<div class="card-type">模型设置</div><div class="subgrid">${page === 'chat' ? `${field('最大输出 Token', 'output', 'API 默认')}${field('温度', 'temperature', 'API 默认')}${field('Top P', 'topP', 'API 默认')}<div class="formfield"><label>上下文</label><input class="block-input" value="本页内存中的对话" disabled></div>` : '<div class="formfield"><label>生成数量</label><input class="block-input" value="1" disabled></div><div class="formfield"><label>输出格式</label><input class="block-input" value="上游原始格式" disabled></div>'}</div><div class="model-note">${page === 'chat' ? '文本输入；图片请求可由 Agent 调用图片工作台。每次工具生成前须确认。' : '文本生成图片；比例和分辨率在输入框右下方选择。'}</div></div></fieldset></div>`;
}
function imageMarkup(m) {
  return `<div class="message"><div class="assistant-message"><div class="assistant-label">${m.fromTool ? '图片工作台 · Agent 调用' : '图片结果'}</div>${m.images.map((im, i) => `<div class="img-result">${im.failed ? '<div class="mock-status" role="alert">返回的图片文件无法在浏览器中解码。请检查下载文件；不会自动重新生成。</div>' : `<img class="generated-image" data-image-message="${m.id}" data-image-index="${i}" src="${esc(im.url)}" alt="${esc(m.prompt)}" loading="lazy">`}<div class="sample-caption"><span>${esc(m.aspectRatio)} · ${esc(m.imageSize)}</span><a href="${esc(im.url)}" download="image-${m.id}-${i + 1}.${im.extension}">下载</a></div></div>`).join('')}${m.text ? `<div class="assistant-note">${esc(m.text)}</div>` : ''}</div></div>`;
}
function messageMarkup(m) {
  if (m.type === 'card') return `<div class="message">${m.kind === 'api' ? apiCard(m) : modelCard(m)}</div>`;
  if (m.type === 'user') return `<div class="message user"><div class="bubble">${esc(m.text)}</div></div>`;
  if (m.type === 'imageResult') return imageMarkup(m);
  if (m.type === 'chatResult') return `<div class="message"><div class="assistant-message"><div class="assistant-label">模型回复</div><div class="assistant-note reply-text">${esc(m.text)}</div></div></div>`;
  return `<div class="message"><div class="mock-status" role="${m.type === 'error' ? 'alert' : 'status'}">${esc(m.text)}</div></div>`;
}
function plusMarkup() { return `<div class="menu-wrap"><button class="circle" aria-label="展开工具菜单" aria-expanded="${plusOpen}" data-action="plus" ${get().busy ? 'disabled' : ''}>${icon('plus', 22)}</button>${plusOpen ? `<div class="plus-menu"><button data-action="new-card" data-kind="api">${icon('key')} API 设置</button><button data-action="new-card" data-kind="model">${icon('settings')} 模型设置</button></div>` : ''}</div>`; }
function sizeMarkup() {
  const d = get(), supported = matrixSupported(d);
  return `<div class="menu-wrap"><button class="size-btn" type="button" data-action="size-toggle" aria-expanded="${sizeOpen}" aria-label="选择长宽比与分辨率" ${d.busy ? 'disabled' : ''}>${supported ? `${esc(d.aspectRatio)} · ${esc(d.imageSize)}` : '图片参数'} ${icon('chev', 14)}</button>${sizeOpen ? `<div class="size-menu" id="image-options"><div class="menu-heading">长宽比与分辨率</div><div class="matrix-model">Nano Banana 2.1</div>${supported ? `<div class="matrix-scroll"><table class="option-matrix" aria-label="Nano Banana 2.1 图片长宽比与分辨率"><colgroup><col class="matrix-ratio-col"><col><col><col></colgroup><thead><tr><th scope="col">长宽比</th>${imageSizes.map(s => `<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${aspectRatios.map(x => `<tr><th scope="row"><span class="size-name">${x.ratio}</span></th>${imageSizes.map(s => { const selected = d.aspectRatio === x.ratio && d.imageSize === s; return `<td><button type="button" class="matrix-choice ${selected ? 'sel' : ''}" data-action="set-image-options" data-ratio="${x.ratio}" data-image-size="${s}" aria-label="长宽比 ${x.ratio}，${s}，${imagePixels(x.ratio, s)}" aria-pressed="${selected}"><span class="matrix-mark" aria-hidden="true">${selected ? '✓' : ''}</span><span class="matrix-pixels">${imagePixels(x.ratio, s)}</span></button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="matrix-notice">图片生成目前仅支持 Gemini 原生 Nano Banana 2.1。请在 API 设置中选择对应协议和模型。</div>'}</div>` : ''}</div>`;
}
function usageValue(d) {
  const u = d.lastUsage;
  return u?.totalTokens ?? '—';
}
function render(scrollEnd = false) {
  const d = get(), scrollTop = app.querySelector('#thread')?.scrollTop || 0;
  app.innerHTML = `<main class="main"><header class="top"><span class="mobile-logo">极简 LLM</span><div class="tabs" role="tablist" aria-label="页面导航"><button role="tab" aria-selected="${page === 'chat'}" class="tab ${page === 'chat' ? 'active' : ''}" data-action="tab" data-tab="chat">对话</button><button role="tab" aria-selected="${page === 'image'}" class="tab ${page === 'image' ? 'active' : ''}" data-action="tab" data-tab="image">图片生成</button></div><div class="top-right" aria-live="polite">${apiStatusMarkup(d)}</div></header><section class="thread" id="thread" aria-label="${page === 'chat' ? '对话' : '图片'}历史"><div class="thread-inner"><div class="date">今天</div>${d.messages.map(messageMarkup).join('')}${d.busy ? '<div class="message"><div class="mock-status" role="status">正在请求 API…</div></div>' : ''}</div></section><footer class="composer-area"><div class="compose"><textarea id="draft" placeholder="${page === 'image' ? '描述你想生成的图片…' : '输入消息…'}" aria-label="${page === 'image' ? '图片提示词' : '聊天消息'}" ${d.busy ? 'disabled' : ''}>${esc(d.draft)}</textarea><div class="compose-actions"><div class="left-actions">${plusMarkup()}</div><div class="right-actions">${page === 'image' ? sizeMarkup() : ''}${d.busy ? '<button class="send" data-action="cancel" aria-label="取消请求" title="取消请求">■</button>' : `<button class="send" data-action="send" aria-label="${page === 'image' ? '生成图片' : '发送消息'}" title="${page === 'image' ? '生成图片' : '发送消息'}">${icon('up')}</button>`}</div></div></div><div class="compose-metrics"><span>${esc(d.api.model || '未选择模型')}</span><span>末次请求 Token <strong>${esc(usageValue(d))}</strong></span><span>耗时 <strong>${d.elapsed === null ? '—' : `${d.elapsed.toFixed(1)}s`}</strong></span></div></footer></main>`;
  const thread = app.querySelector('#thread'); thread.scrollTop = scrollEnd ? thread.scrollHeight : scrollTop;
}
function trustTarget(d) {
  let target;
  try { target = canonicalEndpoint(d.api.url); } catch (e) { status(d, errorText(e), 'error'); return false; }
  if (trusted(d.api)) return true;
  if (!window.confirm(`确认 API 目标地址\n\n${target}\n协议：${d.api.protocol === 'gemini' ? 'Gemini 原生' : 'OpenAI 兼容'}\n\n此后本页的密钥、输入内容及当前对话上下文会直接发送到该地址。仅信任你了解的官方服务或自建代理。地址更改后需要重新确认。`)) return false;
  d.api.trustedTarget = target; return true;
}
function approveImage(invocation) {
  return window.confirm(`生成图片将消耗 API 额度\n\n目标：${invocation.target}\n模型：${invocation.model}\n长宽比：${invocation.args.aspectRatio || '1:1'} · 分辨率：${invocation.args.imageSize || '1K'}\n提示词：${invocation.args.prompt}\n\n确认调用图片工作台？`);
}
function appendImages(d, result, args, fromTool = false) {
  const images = (result.images || []).map(im => {
    const mime = im.mimeType;
    const extension = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[mime];
    if (!extension) throw new Error('Unsupported image MIME');
    const decoded = atob(im.data), bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), extension };
  });
  d.messages.push({ id: nextId++, type: 'imageResult', images, text: result.text || '', prompt: args.prompt, aspectRatio: args.aspectRatio || '1:1', imageSize: args.imageSize || '1K', fromTool });
  if (get() === d) render(true);
}
async function pullModels(card) {
  const d = get(); if (d.busy) return;
  if (!d.api.key.trim()) { status(d, '请先填写 API Key；模型列表会从所选地址实际获取。', 'error'); return; }
  if (!trustTarget(d)) { render(); return; }
  d.busy = true; d.controller = new AbortController(); render();
  try {
    card.models = await listModels({ config: { ...d.api }, signal: d.controller.signal });
    if (get() === d) subMenu = `models:${card.id}`;
  } catch (e) { status(d, errorText(e), 'error'); }
  finally { d.busy = false; d.controller = null; if (get() === d) render(true); }
}
async function send() {
  const d = get(), requestPage = page, text = d.draft.trim();
  if (d.busy || !text) return;
  closeMenus();
  const pending = d.messages.find(m => m.id === d.pendingTextId);
  if (!pending || pending.text !== text) { const m = { id: nextId++, type: 'user', text }; d.messages.push(m); d.pendingTextId = m.id; }
  if (!isConfigured(d)) { addCard('api'); return; }
  if (requestPage === 'image' && !matrixSupported(d)) { status(d, '图片生成目前仅支持 Gemini 原生 Nano Banana 2.1。', 'error'); return; }
  const config = { ...d.api }, args = { prompt: text, aspectRatio: d.aspectRatio, imageSize: d.imageSize };
  if (requestPage === 'image' && !approveImage({ target: canonicalEndpoint(config.url), model: config.model, args })) { render(true); return; }
  d.busy = true; d.controller = new AbortController(); d.draft = ''; d.lastUsage = null; d.elapsed = null;
  const started = performance.now(); let checkpointed = false;
  render(true);
  try {
    if (requestPage === 'image') {
      const result = await dispatchCommand({ command: 'image.generate', args }, { imageConfig: config, signal: d.controller.signal, confirmed: true });
      appendImages(d, result, args); d.lastUsage = result.usage;
    } else {
      const result = await runConversation({
        config, imageConfig: { ...data.image.api }, messages: [...d.history, { role: 'user', content: text }], settings: { ...d.model }, signal: d.controller.signal,
        confirmTool: async invocation => approveImage(invocation),
        onHistory: history => { d.history = history; checkpointed = true; },
        onToolResult: ({ result, invocation }) => appendImages(d, result, invocation.args, true)
      });
      d.history = result.history;
      if (result.text) d.messages.push({ id: nextId++, type: 'chatResult', text: result.text });
      d.lastUsage = result.usage;
    }
    d.pendingTextId = null;
  } catch (e) {
    status(d, errorText(e), 'error');
    if (!checkpointed) d.draft = text;
    else { d.pendingTextId = null; status(d, '已保留本轮工具上下文。你可以继续对话；已完成的图片不会自动重做。'); }
  } finally { d.busy = false; d.controller = null; d.elapsed = (performance.now() - started) / 1000; if (get() === d) render(true); }
}
app.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action, d = get(), card = getCard(Number(el.dataset.id));
  if (d.busy && !['tab', 'cancel'].includes(action)) return;
  switch (action) {
    case 'tab': page = el.dataset.tab; closeMenus(); render(); break;
    case 'plus': plusOpen = !plusOpen; sizeOpen = false; subMenu = ''; render(); break;
    case 'new-card': addCard(el.dataset.kind); break;
    case 'size-toggle': sizeOpen = !sizeOpen; plusOpen = false; subMenu = ''; render(); break;
    case 'set-image-options': if (matrixSupported(d) && aspectRatios.some(x => x.ratio === el.dataset.ratio) && imageSizes.includes(el.dataset.imageSize)) { const scroll = app.querySelector('.matrix-scroll')?.scrollTop || 0; d.aspectRatio = el.dataset.ratio; d.imageSize = el.dataset.imageSize; render(); app.querySelector('.matrix-scroll').scrollTop = scroll; } break;
    case 'supplier': subMenu = subMenu === `supplier:${card.id}` ? '' : `supplier:${card.id}`; render(); break;
    case 'choose-supplier': {
      const p = providers[Number(el.dataset.index)];
      const sameProviderTarget = d.api.protocol === p.protocol && (sameEndpoint(d.api.url, p.url) || (!p.url && d.api.supplier === p.name));
      if (!sameProviderTarget) {
        if (d.api.protocol !== p.protocol) d.history = [];
        d.api = { ...d.api, protocol: p.protocol, url: p.url, key: '', supplier: p.name, model: p.protocol === 'gemini' ? (page === 'image' ? IMAGE_MODEL : DEFAULT_TEXT_MODEL) : '', trustedTarget: '' };
        card.models = [];
      } else d.api.supplier = p.name;
      subMenu = ''; render(); break;
    }
    case 'toggle-key': card.showKey = !card.showKey; render(); break;
    case 'trust-target': trustTarget(d); render(); break;
    case 'clear-key': d.api.key = ''; d.api.trustedTarget = ''; status(d, '本页密钥已清除。'); render(); break;
    case 'pull-models': await pullModels(card); break;
    case 'choose-model': d.api.model = el.dataset.model; subMenu = ''; render(); break;
    case 'send': await send(); break;
    case 'cancel': d.controller?.abort(); break;
  }
});
function updateField(e) {
  const t = e.target, d = get();
  if (t.id === 'draft') { d.draft = t.value; return; }
  const id = Number(t.dataset.card), key = t.dataset.key, card = getCard(id);
  if (!card || id !== activeCardId(d) || !key || d.busy) return;
  if (card.kind === 'api') {
    const changed = d.api[key] !== t.value;
    d.api[key] = t.value;
    if (changed && ['url','protocol'].includes(key)) {
      d.api.trustedTarget = ''; d.api.key = ''; card.models = [];
      const keyInput = app.querySelector(`#key${id}`); if (keyInput) keyInput.value = '';
      if (key === 'protocol') { d.history = []; d.api.model = ''; }
    }
    // No API-key snapshots anywhere in the message list.
    if (key !== 'key') card.values[key] = t.value;
    refreshApiStatus(d, id);
  } else { d.model[key] = t.value; card.values[key] = t.value; }
}
app.addEventListener('error', e => {
  const image = e.target;
  if (!(image instanceof HTMLImageElement) || !image.dataset.imageMessage) return;
  for (const d of Object.values(data)) {
    const message = d.messages.find(m => m.id === Number(image.dataset.imageMessage));
    if (message?.images?.[Number(image.dataset.imageIndex)]) {
      message.images[Number(image.dataset.imageIndex)].failed = true;
      if (get() === d) render();
      break;
    }
  }
}, true);
app.addEventListener('input', updateField);
app.addEventListener('change', e => { updateField(e); if (e.target.tagName === 'SELECT') render(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (plusOpen || sizeOpen || subMenu)) { e.preventDefault(); closeMenus(); render(); }
  if (e.target.id === 'draft' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
render();
