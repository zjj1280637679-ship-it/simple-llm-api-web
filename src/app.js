import { usageMetricsMarkup } from './usage.js';
import { icon } from './icons.js';
import { AppError, DEFAULT_TEXT_MODEL, IMAGE_MODEL, ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_TEXT_MODEL, getImageCapabilities, normalizeImageOptions, canonicalEndpoint, listModels, dispatchCommand } from './core.js';
import { runConversation } from './agent.js';
import { getNetworkLogs, clearNetworkLogs, exportNetworkLogs, subscribeNetworkLogs, renderNetworkLogs, sanitizeLogValue, setLogSecrets, updateActiveLogSecrets } from './logs.js';
import { createPageSession } from './session.js';
import { registerPageSessionTools } from './session-webmcp.js';

const app = document.getElementById('app');
// Measure the real floating groups, including wrapping and font changes.
// If the combined overlays crowd the readable viewport, use normal flow.
let navigationObserver;
// Soft wrapping changes presentation only; never rewrite URL/model values.
let settingsFieldObserver;
function resizeSettingField(field) {
  if (!field?.matches?.('textarea.setting-text')) return;
  field.style.height = 'auto';
  const style = getComputedStyle(field);
  const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  field.style.height = `${Math.ceil(field.scrollHeight + borders)}px`;
}
function syncSettingFields() {
  settingsFieldObserver?.disconnect();
  const fields = [...(app.querySelectorAll?.('textarea.setting-text') || [])];
  fields.forEach(resizeSettingField);
  if (typeof ResizeObserver !== 'function' || !fields.length) return;
  const signatures = new WeakMap();
  settingsFieldObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = entry.target.querySelector('textarea.setting-text');
      if (!target) continue;
      const style = getComputedStyle(target);
      const signature = `${target.clientWidth}:${style.fontSize}:${style.lineHeight}:${style.letterSpacing}`;
      if (signatures.get(target) !== signature) {
        signatures.set(target, signature);
        resizeSettingField(target);
      }
    }
  });
  fields.forEach(field => settingsFieldObserver.observe(field.closest('.formfield')));
}
function resizeDraft(field = app.querySelector('#draft')) {
  if (!field?.matches?.('textarea#draft')) return;
  // Preserve the value, selection and IME composition; only adjust geometry.
  const style = getComputedStyle(field);
  const line = parseFloat(style.lineHeight) || 24;
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const visual = window.visualViewport;
  const viewportHeight = visual && Math.abs((visual.scale || 1) - 1) < 0.01 ? visual.height : window.innerHeight;
  const minimum = Math.max(44, line + padding);
  const maximum = Math.max(minimum, Math.min(240, viewportHeight * 0.3));
  field.style.height = 'auto';
  field.style.height = `${Math.ceil(Math.max(minimum, Math.min(field.scrollHeight, maximum)))}px`;
  field.style.overflowY = field.scrollHeight > maximum ? 'auto' : 'hidden';
}
function protectFloatingFocus(target) {
  if (!target?.getBoundingClientRect) return;
  const nav = app.querySelector('.top'), composer = app.querySelector('.composer-area');
  if (nav?.contains(target) || composer?.contains(target) || target.closest?.('[data-floating-menu]')) return;
  const rect = target.getBoundingClientRect();
  const floor = nav && !app.classList.contains('navigation-in-flow') ? nav.getBoundingClientRect().bottom + 12 : 0;
  const ceiling = composer && !app.classList.contains('composer-in-flow') ? composer.getBoundingClientRect().top - 12 : window.innerHeight;
  if (rect.top < floor) app.scrollBy({ top: rect.top - floor, behavior: 'instant' });
  else if (rect.bottom > ceiling) app.scrollBy({ top: rect.bottom - ceiling, behavior: 'instant' });
}
function syncFloatingNavigation() {
  syncSettingFields();
  navigationObserver?.disconnect();
  const nav = app.querySelector('.top');
  if (!nav) return;
  const composer = app.querySelector('.composer-area');
  const measure = () => {
    resizeDraft();
    const visual = window.visualViewport;
    // Follow the keyboard-sized visual viewport, not pinch-zoom panning.
    const keyboardViewport = visual && Math.abs((visual.scale || 1) - 1) < 0.01;
    const viewportHeight = keyboardViewport ? visual.height : window.innerHeight;
    const bottomInset = keyboardViewport ? Math.max(0, window.innerHeight - visual.height - visual.offsetTop) : 0;
    app.style.setProperty('--keyboard-inset', `${Math.ceil(bottomInset)}px`);
    const navHeight = nav.getBoundingClientRect().height;
    const navInFlow = navHeight > viewportHeight / 3;
    app.classList.toggle('navigation-in-flow', navInFlow);
    const composerHeight = composer?.getBoundingClientRect().height || 0;
    const composerInFlow = composerHeight + (navInFlow ? 0 : navHeight) > viewportHeight * 0.65;
    app.classList.toggle('composer-in-flow', composerInFlow);
    const top = navInFlow ? 0 : Math.ceil(nav.getBoundingClientRect().bottom + 12);
    const bottom = !composer || composerInFlow ? 0 : Math.ceil(window.innerHeight - composer.getBoundingClientRect().top + 12);
    app.style.setProperty('--navigation-clearance', `${top}px`);
    app.style.setProperty('--composer-clearance', `${bottom}px`);
  };
  measure();
  if (typeof ResizeObserver === 'function') {
    navigationObserver = new ResizeObserver(measure);
    navigationObserver.observe(nav);
    if (composer) navigationObserver.observe(composer);
  }
}
window.addEventListener('resize', syncFloatingNavigation);
const refreshVisualViewport = () => { syncFloatingNavigation(); protectFloatingFocus(document.activeElement); };
window.visualViewport?.addEventListener('resize', refreshVisualViewport);
window.visualViewport?.addEventListener('scroll', refreshVisualViewport);
app.addEventListener('focusin', event => protectFloatingFocus(event.target));
// Native Popover supplies the top layer when available; a fixed portal is
// the compatibility path. Both paths are outside the measured composer.
let floatingMenuObserver;
function floatingMenuBounds(anchor, menuHeight, viewport, topLimit = 8) {
  const edge = 8, gap = 8, minTop = Math.max(viewport.top + edge, topLimit);
  const bottom = viewport.top + viewport.height - edge;
  const full = Math.max(1, bottom - minTop);
  const above = Math.min(full, Math.max(0, anchor.top - gap - minTop));
  const below = Math.min(full, Math.max(0, bottom - anchor.bottom - gap));
  const useAbove = above >= below;
  const available = Math.max(above, below);
  const maxHeight = available >= 120 ? available : full;
  const height = Math.min(menuHeight, maxHeight);
  const top = available < 120 ? minTop : useAbove ? anchor.top - gap - height : anchor.bottom + gap;
  return { top: Math.max(minTop, Math.min(top, bottom - height)), maxHeight };
}
function settingsMenuBounds(anchor, menuHeight, viewport, topLimit = 8) {
  const minTop = Math.max(viewport.top + 8, topLimit);
  const bottom = viewport.top + viewport.height - 8;
  const full = Math.max(1, bottom - minTop);
  const below = Math.min(full, Math.max(0, bottom - anchor.bottom - 8));
  const above = Math.min(full, Math.max(0, anchor.top - 8 - minTop));
  const downward = below >= Math.min(120, menuHeight) || below >= above;
  const maxHeight = Math.max(1, downward ? below : above);
  const height = Math.min(menuHeight, maxHeight);
  const top = downward ? anchor.bottom + 8 : anchor.top - 8 - height;
  return { top: Math.max(minTop, Math.min(top, bottom - height)), maxHeight };
}
function floatingMenuTrigger(menu) {
  return app.querySelector(`[data-action="${menu.dataset.floatingMenu}"]${menu.dataset.menuCard ? `[data-id="${menu.dataset.menuCard}"]` : ''}`);
}
function positionFloatingMenu() {
  const menu = app.querySelector('[data-floating-menu]');
  if (!menu) return;
  const anchor = floatingMenuTrigger(menu);
  if (!anchor) return;
  const visual = window.visualViewport;
  const viewport = {left:visual?.offsetLeft || 0,top:visual?.offsetTop || 0,width:visual?.width || window.innerWidth,height:visual?.height || window.innerHeight};
  const nav = app.querySelector('.top');
  const topLimit = nav && !app.classList.contains('navigation-in-flow') ? nav.getBoundingClientRect().bottom + 8 : viewport.top + 8;
  const settings = menu.classList.contains('inline-list');
  const rect = (settings ? anchor.closest('.fieldrow') : anchor).getBoundingClientRect();
  const width = Math.max(1, Math.min(settings ? rect.width : menu.classList.contains('size-menu') ? 360 : 240, viewport.width - 16));
  menu.style.width = `${width}px`;
  const bounds = settings ? settingsMenuBounds(rect, menu.scrollHeight + 2, viewport, topLimit) : floatingMenuBounds(rect, menu.scrollHeight + 2, viewport, topLimit);
  menu.style.maxHeight = `${bounds.maxHeight}px`;
  menu.style.left = `${Math.max(viewport.left + 8, Math.min(rect.left, viewport.left + viewport.width - width - 8))}px`;
  menu.style.top = `${bounds.top}px`;
}
function mountFloatingMenu() {
  floatingMenuObserver?.disconnect();
  const menu = app.querySelector('.plus-menu,.size-menu,.inline-list');
  if (!menu) return;
  if (!menu.dataset.floatingMenu) menu.dataset.floatingMenu = menu.classList.contains('plus-menu') ? 'plus' : 'size-toggle';
  menu.classList.add('floating-menu');
  app.append(menu);
  if (typeof menu.showPopover === 'function') {
    menu.setAttribute('popover', 'manual');
    menu.showPopover();
  }
  positionFloatingMenu();
  if (typeof ResizeObserver === 'function') {
    floatingMenuObserver = new ResizeObserver(positionFloatingMenu);
    floatingMenuObserver.observe(menu);
  }
}
function dismissFloatingMenu(restoreFocus = false) {
  const menu = app.querySelector('[data-floating-menu]');
  if (!menu) return;
  const anchor = floatingMenuTrigger(menu);
  plusOpen = sizeOpen = false; subMenu = '';
  floatingMenuObserver?.disconnect();
  menu.remove();
  anchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) anchor?.focus({preventScroll:true});
}
function focusFloatingMenu() { app.querySelector('[data-floating-menu] button')?.focus({preventScroll:true}); }
app.addEventListener('scroll', positionFloatingMenu, true);
window.addEventListener('resize', positionFloatingMenu);
window.visualViewport?.addEventListener('resize', positionFloatingMenu);
window.visualViewport?.addEventListener('scroll', positionFloatingMenu);
document.addEventListener('pointerdown', event => {
  const menu = app.querySelector('[data-floating-menu]');
  if (!menu || menu.contains(event.target) || event.target.closest?.('[data-action="plus"],[data-action="size-toggle"],[data-action="supplier"],[data-action="pull-models"],[data-action="protocol-menu"]')) return;
  dismissFloatingMenu();
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providers = [
  { name: 'Google Gemini', protocol: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  { name: 'OpenAI', protocol: 'openai', url: 'https://api.openai.com/v1' },
  { name: '自定义 · Gemini', protocol: 'gemini', url: '' },
  { name: '自定义 · OpenAI 兼容', protocol: 'openai', url: '' },
  { name: '火山方舟 · 普通 API', protocol: 'ark', url: ARK_ENDPOINT },
  { name: 'DeepSeek', protocol: 'openai', url: 'https://api.deepseek.com' },
  { name: '智谱 AI · 普通 API', protocol: 'openai', url: 'https://open.bigmodel.cn/api/paas/v4' }
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
function syncLogSecrets() { updateActiveLogSecrets(Object.values(data).map(d => d.api.key)); }
function archiveWorkspaceKey(d) { if (d) setLogSecrets([d.api.key]); }
const activeCardId = d => d.messages.findLast(m => m.type === 'card')?.id;
const getCard = id => get()?.messages.find(m => m.id === id && m.type === 'card');
const matrixSupported = d => Boolean(getImageCapabilities(d.api));
function selectedPixels(d, ratio, size) { return getImageCapabilities(d.api)?.ratios.find(item => item.ratio === ratio)?.pixelsBySize[size]?.join('×') || ''; }
function resetImageOptions(d, force = false) {
  const cap = getImageCapabilities(d.api); if (!cap) return;
  if (force || !cap.ratios.some(item => item.ratio === d.aspectRatio)) d.aspectRatio = cap.defaultRatio;
  if (force || !cap.sizes.includes(d.imageSize)) d.imageSize = cap.defaultSize;
}
function defaultModel(protocol, workspace) { return protocol === 'gemini' ? (workspace === 'image' ? IMAGE_MODEL : DEFAULT_TEXT_MODEL) : protocol === 'ark' ? (workspace === 'image' ? ARK_FLASH_MODEL : ARK_TEXT_MODEL) : ''; }
const isConfigured = d => Boolean(d.api.key.trim() && d.api.model.trim() && trusted(d.api));
function trusted(config) { try { return config.trustedTarget === canonicalEndpoint(config.url); } catch { return false; } }
function sameEndpoint(left, right) {
  try { return canonicalEndpoint(left) === canonicalEndpoint(right); } catch { return left === right; }
}
function apiTrustText(config) { return trusted(config) ? '已确认目标 · 密钥仅在内存' : '调用前需确认目标 · 密钥仅在内存'; }
function refreshApiStatus(d, cardId) {
  // Update only status nodes: never replace an input while the user is typing.
  const trustLabel = app.querySelector(`#api-trust${cardId}`);
  if (trustLabel) trustLabel.textContent = apiTrustText(d.api);
  if (page === 'image') {
    const imageControl = app.querySelector('[data-image-control]');
    if (imageControl) imageControl.outerHTML = sizeMarkup();
  }
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
    UNSUPPORTED_PROTOCOL: '此协议尚不支持。请选择 Gemini、OpenAI 兼容或火山方舟普通 API。',
    UNSUPPORTED_IMAGE_MODEL: '此图片模型的参数尚未支持，请选择已支持的 Gemini 或火山方舟模型。',
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
function protocolLabel(protocol) { return ({gemini:'Gemini 原生 · generateContent',openai:'OpenAI 兼容 · Chat Completions',ark:'火山方舟 · 普通 API'})[protocol] || protocol; }
function apiCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.api;
  const menu = subMenu.endsWith(`:${m.id}`) ? subMenu.split(':')[0] : '';
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}
    <div class="formfield"><label for="url${m.id}">API 地址</label><div class="fieldrow"><textarea class="setting-text" rows="1" wrap="soft" id="url${m.id}" data-card="${m.id}" data-key="url" placeholder="API 地址" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(x.url)}</textarea><div class="sub-menu"><button type="button" data-action="supplier" data-id="${m.id}" aria-expanded="${menu === 'supplier'}" class="uniform-btn">${esc(x.supplier)}</button>${menu === 'supplier' ? `<div class="inline-list" data-floating-menu="supplier" data-menu-card="${m.id}">${providers.map((p, i) => `<button class="inline-item" data-action="choose-supplier" data-id="${m.id}" data-index="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div></div></div>
    <div class="formfield"><label id="protocol-label${m.id}" for="protocol${m.id}">协议</label><div class="fieldrow"><button type="button" class="protocol-trigger" id="protocol${m.id}" data-action="protocol-menu" data-id="${m.id}" aria-haspopup="listbox" aria-expanded="${menu === 'protocol'}" aria-controls="protocol-options${m.id}">${esc(protocolLabel(x.protocol))} ${icon('chev', 14)}</button>${menu === 'protocol' ? `<div class="inline-list" id="protocol-options${m.id}" role="listbox" aria-labelledby="protocol-label${m.id}" data-floating-menu="protocol-menu" data-menu-card="${m.id}">${['gemini','openai','ark'].map(protocol => `<button type="button" role="option" tabindex="-1" aria-selected="${x.protocol === protocol}" class="inline-item" data-action="choose-protocol" data-id="${m.id}" data-protocol="${protocol}">${x.protocol === protocol ? '✓ ' : ''}${esc(protocolLabel(protocol))}</button>`).join('')}</div>` : ''}</div></div>
    <div class="formfield"><label for="key${m.id}">API Key</label><div class="fieldrow"><input id="key${m.id}" data-card="${m.id}" data-key="key" type="${!old && m.showKey ? 'text' : 'password'}" placeholder="" aria-describedby="key-help${m.id}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(old ? '' : x.key)}"><button type="button" data-action="toggle-key" data-id="${m.id}" class="uniform-btn">${m.showKey ? '隐藏' : '显示'}</button></div><div class="field-reading" id="key-help${m.id}">${old ? '未保留历史密钥' : '仅保留在本页内存，刷新即清除'}</div></div>
    <div class="formfield"><label for="model${m.id}">模型 ID</label><div class="fieldrow"><textarea class="setting-text" rows="1" wrap="soft" id="model${m.id}" data-card="${m.id}" data-key="model" placeholder="模型 ID" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(x.model)}</textarea><div class="sub-menu"><button type="button" data-action="pull-models" data-id="${m.id}" aria-expanded="${menu === 'models'}" class="uniform-btn" ${x.protocol === 'ark' ? 'disabled title="普通 Ark API 未核实模型列表接口，请填写官方模型 ID"' : ''}>${x.protocol === 'ark' ? '手填模型' : '拉取模型'}</button>${menu === 'models' ? `<div class="inline-list" data-floating-menu="pull-models" data-menu-card="${m.id}">${m.models.length ? m.models.map(model => `<button class="inline-item" data-action="choose-model" data-id="${m.id}" data-model="${esc(model.id)}">${esc(model.id)}</button>`).join('') : '<span class="inline-item">上游未返回可用模型</span>'}</div>` : ''}</div></div></div>
    <div class="field-reading" id="models-status${m.id}" role="status">${esc(m.modelListStatus || '')}</div>
    <div class="api-security">${!old && d.pendingTextId ? '<div>填写并确认后，再次发送即可继续。</div>' : ''}<span id="api-trust${m.id}">${old ? '密钥不写入历史记录' : apiTrustText(x)}</span>${!old && x.protocol === 'ark' ? '<div>普通 API · 非 Agent Plan。浏览器跨域支持尚待真实验证。</div>' : ''}${!old ? '<div>应用后，密钥和请求内容将发送到上方填写的地址；应用本身不发送请求。</div><div class="security-actions"><button type="button" class="chip" data-action="trust-target">应用设置</button><button type="button" class="chip" data-action="clear-key">清除密钥</button></div>' : ''}</div>
  </div></fieldset></div>`;
}
function modelCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.model;
  const field = (label, key, placeholder) => `<div class="formfield"><label for="${key}${m.id}">${label}</label><input class="block-input" type="number" id="${key}${m.id}" data-card="${m.id}" data-key="${key}" placeholder="${placeholder}" value="${esc(x[key])}" step="any"></div>`;
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}<div class="card-type">模型设置</div><div class="subgrid">${page === 'chat' ? `${field('输出预算 Token', 'output', 'API 默认')}${field('温度', 'temperature', 'API 默认')}${field('Top P', 'topP', 'API 默认')}<div class="formfield"><label for="context${m.id}">上下文</label><output id="context${m.id}" class="block-value">本页内存中的对话</output></div>` : `<div class="formfield"><label for="count${m.id}">生成数量</label><output id="count${m.id}" class="block-value">1</output></div><div class="formfield"><label for="format${m.id}">输出格式</label><output id="format${m.id}" class="block-value">上游原始格式</output></div>`}</div><div class="model-note">${page === 'chat' ? `文本输入；图片请求可由 Agent 调用图片工作台。每次工具生成前须确认。${d.api.protocol === 'ark' ? ' Token 预算使用 max_completion_tokens，含思考与回答。' : ''}` : '文本生成图片；比例和分辨率在输入框右下方选择。'}</div></div></fieldset></div>`;
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
  const d = get(), cap = getImageCapabilities(d.api);
  return `<div class="menu-wrap" data-image-control><button class="size-btn" type="button" data-action="size-toggle" aria-expanded="${sizeOpen}" aria-label="选择长宽比与分辨率" ${d.busy ? 'disabled' : ''}>${cap ? `${esc(d.aspectRatio)} · ${esc(d.imageSize)}` : '图片参数'} ${icon('chev', 14)}</button>${sizeOpen ? `<div class="size-menu" id="image-options"><div class="menu-heading">长宽比与分辨率</div><div class="matrix-model">${esc(cap?.label || '未支持的图片模型')}</div>${cap ? `<div class="matrix-scroll"><table class="option-matrix" aria-label="${esc(cap.label)} 图片长宽比与分辨率"><colgroup><col class="matrix-ratio-col">${cap.sizes.map(() => '<col>').join('')}</colgroup><thead><tr><th scope="col">长宽比</th>${cap.sizes.map(size => `<th scope="col">${size}</th>`).join('')}</tr></thead><tbody>${cap.ratios.map(item => `<tr><th scope="row"><span class="size-name">${item.ratio}</span></th>${cap.sizes.map(size => { const selected = d.aspectRatio === item.ratio && d.imageSize === size; return `<td><button type="button" class="matrix-choice ${selected ? 'sel' : ''}" data-action="set-image-options" data-ratio="${item.ratio}" data-image-size="${size}" aria-label="长宽比 ${item.ratio}，${size}，${selectedPixels(d, item.ratio, size)}" aria-pressed="${selected}"><span class="matrix-mark" aria-hidden="true">${selected ? '✓' : ''}</span><span class="matrix-pixels">${selectedPixels(d, item.ratio, size)}</span></button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>${cap.presetNotes ? `<div class="matrix-notice">${esc(cap.presetNotes)}</div>` : ''}` : '<div class="matrix-notice">此模型的图片参数尚未支持。请选择 Nano Banana 2.1 或已支持的 Seedream 5.0 Flash / Pro。</div>'}</div>` : ''}</div>`;
}
function tabsMarkup() {
  return `<div class="tabs" role="tablist" aria-label="页面导航">${[['chat', '对话'], ['image', '图片生成'], ['logs', '通讯日志']].map(([id, label]) => `<button role="tab" aria-selected="${page === id}" class="tab ${page === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}
function renderLogsPage() {
  syncLogSecrets();
  app.innerHTML = `<main class="main"><header class="top">${tabsMarkup()}</header><section class="thread"><div class="thread-inner"><div class="log-actions"><button class="chip" data-action="export-logs">导出 JSON</button><button class="chip" data-action="clear-logs">清空日志</button></div><div id="network-logs"></div></div></section></main>`;
  renderNetworkLogs(app.querySelector('#network-logs'));
  mountFloatingMenu();
  syncFloatingNavigation();
}

function captureControlFocus() {
  const active = document.activeElement;
  if (active?.tagName !== 'BUTTON' || !app.contains(active) || !active.dataset.action) return null;
  return Object.fromEntries(['action','tab','ratio','imageSize','id','kind','card']
    .filter(key => active.dataset[key] !== undefined).map(key => [key, active.dataset[key]]));
}
function restoreControlFocus(identity) {
  if (!identity) return;
  const target = [...app.querySelectorAll('button[data-action]')]
    .find(button => !button.disabled && Object.entries(identity).every(([key,value]) => button.dataset[key] === value));
  target?.focus({ preventScroll: true });
}
function render(scrollEnd = false) {
  const focusIdentity = captureControlFocus();
  if (page === 'logs') { renderLogsPage(); restoreControlFocus(focusIdentity); return; }
  const d = get(), scrollTop = app.scrollTop;
  app.innerHTML = `<main class="main"><header class="top">${tabsMarkup()}</header><section class="thread" id="thread" aria-label="${page === 'chat' ? '对话' : '图片'}历史"><div class="thread-inner">${d.messages.map(messageMarkup).join('')}${d.busy ? '<div class="message"><div class="api-loading" role="status" aria-label="正在加载"><span class="api-spinner" aria-hidden="true"></span><span class="sr-only">正在加载</span></div></div>' : ''}</div></section><footer class="composer-area"><div class="compose"><textarea id="draft" rows="1" placeholder="${page === 'image' ? '描述你想生成的图片…' : ''}" aria-label="${page === 'image' ? '图片提示词' : '聊天消息'}" ${d.busy ? 'disabled' : ''}>${esc(d.draft)}</textarea><div class="compose-actions"><div class="left-actions">${plusMarkup()}</div><div class="right-actions">${page === 'image' ? sizeMarkup() : ''}${d.busy ? '<button class="send" data-action="cancel" aria-label="取消请求" title="取消请求">■</button>' : `<button class="send" data-action="send" aria-label="${page === 'image' ? '生成图片' : '发送消息'}" title="${page === 'image' ? '生成图片' : '发送消息'}">${icon('up')}</button>`}</div></div></div><div class="compose-metrics">${usageMetricsMarkup(d.lastUsage)}<span>耗时 <strong>${d.elapsed === null ? '...' : `${d.elapsed.toFixed(1)}s`}</strong></span></div></footer></main>`;
  mountFloatingMenu();
  syncFloatingNavigation();
  positionFloatingMenu();
  app.scrollTop = scrollEnd ? app.scrollHeight : scrollTop;
  restoreControlFocus(focusIdentity);
}
function trustTarget(d, report = text => status(d, text, 'error'), apply = false) {
  let target;
  try { target = canonicalEndpoint(d.api.url); } catch (e) { report(errorText(e)); return false; }
  if (trusted(d.api)) return true;
  if (!apply) { report('目标地址尚未确认，请先在设置卡点击应用设置；未发送请求。'); return false; }
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
function modelListStatus(d, card, text) {
  card.modelListStatus = text;
  if (get() === d) render();
}
async function pullModels(card) {
  const d = get(); if (d.busy) return;
  closeMenus();
  syncLogSecrets();
  if (d.api.protocol === 'ark') { modelListStatus(d, card, '普通 Ark API 暂无已核实的模型列表接口，请填写官方模型 ID。'); return; }
  if (!d.api.key.trim()) { modelListStatus(d, card, '请先填写 API Key；尚未发送模型列表请求。'); return; }
  card.modelListStatus = '';
  if (!trustTarget(d, text => { card.modelListStatus = text; })) { modelListStatus(d, card, card.modelListStatus || '目标地址尚未确认，未发送模型列表请求。'); return; }
  d.busy = true; d.controller = new AbortController(); render();
  try {
    card.models = await listModels({ config: { ...d.api }, signal: d.controller.signal });
    if (get() === d) subMenu = `models:${card.id}`;
  } catch (e) { card.modelListStatus = errorText(e); }
  finally { d.busy = false; d.controller = null; if (get() === d) { render(); if (subMenu === `models:${card.id}`) focusFloatingMenu(); } }
}
async function send() {
  const d = get(); if (!d) return { status: 'not-sent', reason: 'select-workspace' };
  syncLogSecrets();
  const requestPage = page, text = d.draft.trim();
  if (d.busy || !text) return { status: 'not-sent', reason: d.busy ? 'busy' : 'empty' };
  closeMenus();
  const pending = d.messages.find(m => m.id === d.pendingTextId);
  if (!pending || pending.text !== text) { const m = { id: nextId++, type: 'user', text }; d.messages.push(m); d.pendingTextId = m.id; }
  if (!isConfigured(d)) { addCard('api'); return { status: 'needs-configuration' }; }
  if (requestPage === 'image' && !matrixSupported(d)) { status(d, '此图片模型的参数尚未支持，请选择 Nano Banana 2.1 或 Seedream 5.0 Flash / Pro。', 'error'); return { status: 'not-sent', reason: 'unsupported-model' }; }
  const config = { ...d.api }, args = { prompt: text, aspectRatio: d.aspectRatio, imageSize: d.imageSize };
  if (requestPage === 'image' && !approveImage({ target: canonicalEndpoint(config.url), model: config.model, args })) { render(true); return { status: 'declined' }; }
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
    return { status: 'completed', messageCount: d.messages.length };
  } catch (e) {
    status(d, errorText(e), 'error');
    if (!checkpointed) d.draft = text;
    else { d.pendingTextId = null; status(d, '已保留本轮工具上下文。你可以继续对话；已完成的图片不会自动重做。'); }
    return { status: e?.code === 'CANCELLED' ? 'cancelled' : 'failed', code: e instanceof AppError ? e.code : 'REQUEST_FAILED' };
  } finally { d.busy = false; d.controller = null; d.elapsed = (performance.now() - started) / 1000; if (get() === d) render(true); }
}
app.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action, d = get(), card = getCard(Number(el.dataset.id));
  if (d?.busy && !['tab', 'cancel'].includes(action)) return;
  switch (action) {
    case 'tab': page = el.dataset.tab; closeMenus(); render(); break;
    case 'plus': plusOpen = !plusOpen; sizeOpen = false; subMenu = ''; render(); if (plusOpen) focusFloatingMenu(); break;
    case 'new-card': addCard(el.dataset.kind); break;
    case 'size-toggle': sizeOpen = !sizeOpen; plusOpen = false; subMenu = ''; render(); if (sizeOpen) focusFloatingMenu(); break;
    case 'set-image-options': if (matrixSupported(d) && getImageCapabilities(d.api).ratios.some(x => x.ratio === el.dataset.ratio) && getImageCapabilities(d.api).sizes.includes(el.dataset.imageSize)) { const scroll = app.querySelector('.matrix-scroll')?.scrollTop || 0; d.aspectRatio = el.dataset.ratio; d.imageSize = el.dataset.imageSize; render(); app.querySelector('.matrix-scroll').scrollTop = scroll; } break;
    case 'supplier': plusOpen = sizeOpen = false; subMenu = subMenu === `supplier:${card.id}` ? '' : `supplier:${card.id}`; render(); if (subMenu) focusFloatingMenu(); break;
    case 'protocol-menu':
      plusOpen = sizeOpen = false; subMenu = subMenu === `protocol:${card.id}` ? '' : `protocol:${card.id}`;
      render(); if (subMenu) (app.querySelector('[data-floating-menu] [aria-selected="true"]') || app.querySelector('[data-floating-menu] button'))?.focus({preventScroll:true}); break;
    case 'choose-protocol':
      if (!['gemini','openai','ark'].includes(el.dataset.protocol)) break;
      updateField({target:{value:el.dataset.protocol,dataset:{card:String(card.id),key:'protocol'}}});
      subMenu = ''; render(); app.querySelector(`#protocol${card.id}`)?.focus?.({preventScroll:true}); break;
    case 'choose-supplier': {
      const p = providers[Number(el.dataset.index)];
      const sameProviderTarget = d.api.protocol === p.protocol && (sameEndpoint(d.api.url, p.url) || (!p.url && d.api.supplier === p.name));
      if (!sameProviderTarget) {
        archiveWorkspaceKey(d);
        if (d.api.protocol !== p.protocol) d.history = [];
        d.api = { ...d.api, protocol: p.protocol, url: p.url, key: '', supplier: p.name, model: defaultModel(p.protocol, page), trustedTarget: '' };
        card.models = []; syncLogSecrets();
        if (page === 'image') resetImageOptions(d, true);
      } else d.api.supplier = p.name;
      card.modelListStatus = ''; subMenu = ''; render(); break;
    }
    case 'toggle-key': card.showKey = !card.showKey; render(); break;
    case 'trust-target': {
      const settingsCard = getCard(activeCardId(d));
      const applied = trustTarget(d, text => { if (settingsCard) settingsCard.modelListStatus = text; }, true);
      if (applied && settingsCard) settingsCard.modelListStatus = '';
      render(); break;
    }
    case 'clear-key': archiveWorkspaceKey(d); d.api.key = ''; d.api.trustedTarget = ''; syncLogSecrets(); status(d, '本页密钥已清除。'); render(); break;
    case 'pull-models': await pullModels(card); break;
    case 'choose-model': d.api.model = el.dataset.model; if (page === 'image') resetImageOptions(d); subMenu = ''; render(); break;
    case 'send': await send(); break;
    case 'cancel': d.controller?.abort(); break;
    case 'clear-logs': clearNetworkLogs(); break;
    case 'export-logs': {
      const url = URL.createObjectURL(new Blob([exportNetworkLogs()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'llm-network-logs.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); break;
    }
  }
});
function updateField(e) {
  const t = e.target, d = get();
  resizeSettingField(t);
  if (!d) return;
  if (t.id === 'draft') { d.draft = t.value; resizeDraft(t); return; }
  const id = Number(t.dataset.card), key = t.dataset.key, card = getCard(id);
  if (!card || id !== activeCardId(d) || !key || d.busy) return;
  if (card.kind === 'api') {
    const changed = d.api[key] !== t.value;
    d.api[key] = t.value;
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
    }
    // No API-key snapshots anywhere in the message list.
    if (key !== 'key') card.values[key] = t.value;
    syncLogSecrets();
    if (page === 'image') resetImageOptions(d);
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
app.addEventListener('change', e => { updateField(e); if (e.target.dataset?.key === 'key') archiveWorkspaceKey(get()); if (e.target.tagName === 'SELECT') render(); });
document.addEventListener('keydown', e => {
  if (e.target.dataset?.action === 'protocol-menu' && ['ArrowDown','ArrowUp'].includes(e.key)) {
    e.preventDefault(); plusOpen = sizeOpen = false; subMenu = `protocol:${e.target.dataset.id}`; render();
    (app.querySelector('[data-floating-menu] [aria-selected="true"]') || app.querySelector('[data-floating-menu] button'))?.focus({preventScroll:true});
  } else if (e.target.dataset?.action === 'choose-protocol' && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
    e.preventDefault(); const choices = [...app.querySelectorAll('[data-floating-menu="protocol-menu"] [role="option"]')];
    const index = choices.indexOf(e.target), next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus({preventScroll:true}); choices[next]?.scrollIntoView({block:'nearest'});
  }
  if (e.key === 'Escape' && (plusOpen || sizeOpen)) { e.preventDefault(); dismissFloatingMenu(true); }
  else if (e.key === 'Escape' && subMenu) { e.preventDefault(); dismissFloatingMenu(true); }
  if (e.target.id === 'draft' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
subscribeNetworkLogs(() => {
  if (page === 'logs') renderNetworkLogs(app.querySelector('#network-logs'));
});
function publicSessionState() {
  syncLogSecrets();
  return sanitizeLogValue({
    page,
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
  return d ? { page, draft: d.draft, api: { ...d.api }, settings: { ...d.model }, aspectRatio: d.aspectRatio, imageSize: d.imageSize } : null;
}
const pageSession = createPageSession({
  state: publicSessionState,
  logs: () => { syncLogSecrets(); return getNetworkLogs(); },
  navigate: ({ page: destination }) => { page = destination; closeMenus(); render(); return publicSessionState(); },
  draft: ({ text }) => { const d = get(); if (!d || d.busy) throw new Error('No editable workspace'); d.draft = text; render(); return { updated: true }; },
  settings: args => {
    const d = get(); if (!d || d.busy) throw new Error('No editable workspace');
    const api = { ...d.api, ...(args.model === undefined ? {} : { model: args.model.trim() }) };
    let options;
    if (args.aspectRatio !== undefined || args.imageSize !== undefined) {
      if (page !== 'image') throw new Error('Image settings require the image workspace');
      options = normalizeImageOptions(api, { aspectRatio: args.aspectRatio ?? d.aspectRatio, imageSize: args.imageSize ?? d.imageSize });
    }
    d.api = api;
    for (const key of ['output', 'temperature', 'topP']) if (args[key] !== undefined) d.model[key] = args[key];
    if (options) { d.aspectRatio = options.aspectRatio; d.imageSize = options.imageSize; }
    if (page === 'image') resetImageOptions(d);
    render(); return publicSessionState();
  },
  confirmSend: () => {
    const d = get(); if (!d || d.busy || !d.draft.trim() || approvedSessionRequest) return false;
    syncLogSecrets();
    const snapshot = sessionRequestSnapshot();
    const approved = window.confirm(`允许已连接的页面控制工具发送当前${page === 'image' ? '图片' : '文本'}请求？\n\n目标：${sanitizeLogValue(d.api.url)}\n模型：${sanitizeLogValue(d.api.model)}\n提示词：${sanitizeLogValue(d.draft)}\n此操作可能消耗 API 额度。API 目标与图片生成确认仍然适用。`);
    if (approved) approvedSessionRequest = snapshot;
    return approved;
  },
  send: () => {
    const approved = approvedSessionRequest; approvedSessionRequest = null;
    // Confirmation yields a microtask in the command dispatcher. Recheck the
    // exact page/prompt/config/settings snapshot so a racing command cannot
    // replace what the user just approved. The snapshot is never logged.
    if (!approved || JSON.stringify(approved) !== JSON.stringify(sessionRequestSnapshot())) return { status: 'not-sent', reason: 'changed-after-confirmation' };
    return send();
  },
  cancel: () => {
    const pendingApproval = Boolean(approvedSessionRequest); approvedSessionRequest = null;
    const d = get(); if (!d && !pendingApproval) throw new Error('Select workspace');
    d?.controller?.abort(); return { requested: pendingApproval || Boolean(d?.controller) };
  }
});
window.llmWorkbench = pageSession;
registerPageSessionTools(pageSession);
render();
