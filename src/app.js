import { createLocalStore, snapshotWorkspace, restoreWorkspace, migrateSnapshot, MAX_SNAPSHOT_BYTES } from './persistence.js';
import { getReasoningTemplates, getRecommendedReasoningTemplate, reasoningBody, REASONING_FAMILIES, reasoningFamilyFor, resolveReasoningFamily } from './reasoning.js';
import { MODALITIES, supportedModalities, prepareFiles, validateAttachments } from './attachments.js';
import { replyMetricsMarkup, replyMetricsSnapshot } from './usage.js';
import { icon } from './icons.js';
import { AppError, DEFAULT_TEXT_MODEL, IMAGE_MODEL, ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_TEXT_MODEL, getImageCapabilities, normalizeImageOptions, canonicalEndpoint, listModels, dispatchCommand } from './core.js';
import { runConversation } from './agent.js';
import { getNetworkLogs, clearNetworkLogs, exportNetworkLogs, subscribeNetworkLogs, renderNetworkLogs, sanitizeLogValue, setLogSecrets, updateActiveLogSecrets } from './logs.js';
import { createPageSession } from './session.js';
import { registerPageSessionTools } from './session-webmcp.js';

const app = document.getElementById('app');
// Optional read-only diagnostics: geometry and node identity only, never content.
const scrollDiagnostics = [];
let lastScrollAction = null, diagnosticSequence = 0, frozenScrollReport = null;
function canvasRect(node) {
  const rect=node?.getBoundingClientRect?.();
  return rect ? Object.fromEntries(['top','bottom','left','right','width','height'].map(k=>[k,Number.isFinite(rect[k])?Math.round(rect[k]*10)/10:null])) : null;
}
function canvasSurfaceSnapshot() {
  const main=app.querySelector?.('.main'), composer=app.querySelector?.('.composer-area');
  const style=typeof getComputedStyle==='function'?getComputedStyle(app):null;
  const classify=node=>node===document.body?'body':node===document.documentElement?'html':node===app?'app':node===main?'main':node?.closest?.('.composer-area')?'composer':node?.closest?.('.top')?'navigation':node?.closest?.('.thread')?'thread':node?'other':'none';
  const width=window.innerWidth||0,height=window.visualViewport?.height||window.innerHeight||0;
  const hits=[.25,.5,.75].map(f=>({x:Math.round(width/2),y:Math.round(height*f),surface:classify(document.elementFromPoint?.(width/2,height*f))}));
  return {app:canvasRect(app),main:canvasRect(main),composer:canvasRect(composer),hits,
    navigationClearance:parseFloat(style?.getPropertyValue?.('--navigation-clearance'))||0,
    composerClearance:parseFloat(style?.getPropertyValue?.('--composer-clearance'))||0,
    keyboardInset:parseFloat(style?.getPropertyValue?.('--keyboard-inset'))||0};
}
function recordScrollDiagnostic(reason, delta = 0) {
  const visual = window.visualViewport, active = document.activeElement, root = document.scrollingElement;
  const now = Date.now();
  if (/write|focus-restore|menu-reveal/.test(reason)) lastScrollAction = {id:++diagnosticSequence,reason,at:now};
  scrollDiagnostics.push({at:now,reason,delta,top:Number(app.scrollTop)||0,
    height:Number(app.scrollHeight)||0,viewport:Number(app.clientHeight)||0,
    rootTop:Number(root?.scrollTop)||0,rootHeight:Number(root?.scrollHeight)||0,
    rootViewport:Number(root?.clientHeight)||0,windowY:Number(window.scrollY)||0,
    innerHeight:Number(window.innerHeight)||0,visualHeight:visual?.height ?? null,
    visualTop:visual?.offsetTop ?? null,visualScale:visual?.scale ?? null,
    visibility:document.visibilityState || null,
    appRect:canvasRect(app),mainRect:canvasRect(app.querySelector?.('.main')),
    navigationInFlow:app.classList?.contains('navigation-in-flow') ?? null,
    composerInFlow:app.classList?.contains('composer-in-flow') ?? null,
    focusTag:active?.tagName || null,focusId:active?.id?.slice(0,64) || null,
    recentAction:lastScrollAction && now-lastScrollAction.at < 1000 ? {...lastScrollAction,age:now-lastScrollAction.at} : null});
  if (scrollDiagnostics.length > 80) scrollDiagnostics.shift();
}
window.__llmScrollDiagnostics = () => scrollDiagnostics.map(entry => ({...entry,appRect:entry.appRect?{...entry.appRect}:null,mainRect:entry.mainRect?{...entry.mainRect}:null,recentAction:entry.recentAction?{...entry.recentAction}:null}));
app.addEventListener('scroll', () => recordScrollDiagnostic('app-scroll'), {passive:true});
window.addEventListener?.('scroll', () => recordScrollDiagnostic('window-scroll'), {passive:true});
window.addEventListener?.('resize', () => recordScrollDiagnostic('window-resize'), {passive:true});
window.addEventListener?.('pageshow', () => recordScrollDiagnostic('pageshow'));
window.addEventListener?.('focus', () => recordScrollDiagnostic('window-focus'));
function scrollDiagnosticReport() {
  const version = selector => (document.querySelector?.(selector)?.getAttribute?.(selector.startsWith('script')?'src':'href') || '').match(/[?&]v=([a-f0-9]{8,64})(?:&|$)/)?.[1] || 'unversioned';
  return {schema:'scroll-diagnostic-v2',capturedAt:new Date().toISOString(),
    build:{app:version('script[type="module"][src]'),css:version('link[rel="stylesheet"][href]')},
    note:'Geometry only. recentAction is temporal correlation, not proof of cause. No input values, messages, URLs or credentials.',
    surface:canvasSurfaceSnapshot(),events:window.__llmScrollDiagnostics()};
}
function freezeScrollReport() { frozenScrollReport = scrollDiagnosticReport(); }
function exportScrollReport() {
  return JSON.stringify(frozenScrollReport || scrollDiagnosticReport(),null,2);
}

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
// Geometry changes (keyboard dismissal, draft shrink, overlay resizing) are
// not navigation. Keep the reading offset, or follow the end only if already there.
function captureScrollGeometry() {
  const top = Number(app.scrollTop), height = Number(app.scrollHeight), viewport = Number(app.clientHeight);
  if (![top, height, viewport].every(Number.isFinite) || viewport <= 0) return null;
  const maximum = Math.max(0, height - viewport);
  return { top: Math.max(0, top), bottom: maximum > 0 && maximum - top <= 2 };
}
function restoreScrollGeometry(position) {
  if (!position) return;
  const next = position.bottom ? Math.max(0, app.scrollHeight - app.clientHeight) : position.top;
  if (Math.abs(app.scrollTop - next) > 1) {
    recordScrollDiagnostic('geometry-write', next - app.scrollTop);
    app.scrollTop = next;
  }
}
function protectFloatingFocus(target) {
  // During rerender/keyboard dismissal focus can fall to body. It is not a
  // field to reveal: scrolling it on every viewport event causes repeated jumps.
  if (!target?.getBoundingClientRect || !app.contains?.(target) ||
      !target.matches?.('input,textarea,select,button,a[href],summary,[tabindex],[contenteditable="true"]')) return;
  const nav = app.querySelector('.top'), composer = app.querySelector('.composer-area');
  if (nav?.contains(target) || composer?.contains(target) || target.closest?.('[data-floating-menu]')) return;
  const rect = target.getBoundingClientRect();
  const floor = nav && !app.classList.contains('navigation-in-flow') ? nav.getBoundingClientRect().bottom + 12 : 0;
  const ceiling = composer && !app.classList.contains('composer-in-flow') ? composer.getBoundingClientRect().top - 12 : window.innerHeight;
  if (rect.top < floor) { recordScrollDiagnostic('explicit-focus-write', rect.top - floor); app.scrollBy({ top: rect.top - floor, behavior: 'instant' }); }
  else if (rect.bottom > ceiling) { recordScrollDiagnostic('explicit-focus-write', rect.bottom - ceiling); app.scrollBy({ top: rect.bottom - ceiling, behavior: 'instant' }); }
}
function syncFloatingNavigation() {
  recordScrollDiagnostic('geometry-before-fields');
  syncSettingFields();
  recordScrollDiagnostic('geometry-after-fields');
  navigationObserver?.disconnect();
  const nav = app.querySelector('.top');
  if (!nav) return;
  const composer = app.querySelector('.composer-area');
  const measure = () => {
    const before = captureScrollGeometry();
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
    recordScrollDiagnostic('geometry-measured');
    restoreScrollGeometry(before);
  };
  measure();
  if (typeof ResizeObserver === 'function') {
    navigationObserver = new ResizeObserver(measure);
    navigationObserver.observe(nav);
    if (composer) navigationObserver.observe(composer);
  }
}
window.addEventListener('resize', syncFloatingNavigation);
// Viewport/chrome/screenshot events are geometry changes, not a request to
// reveal whatever old control happens to remain focused.
const refreshVisualViewport = event => { recordScrollDiagnostic(event?.type === 'scroll' ? 'viewport-scroll' : 'viewport-resize'); syncFloatingNavigation(); };
window.visualViewport?.addEventListener('resize', refreshVisualViewport);
window.visualViewport?.addEventListener('scroll', refreshVisualViewport);
const focusableSelector = 'input,textarea,select,button,a[href],summary,[tabindex],[contenteditable="true"]';
let focusIntent = null;
document.addEventListener('pointerdown', event => {
  if (event.isTrusted === false) return;
  const target = event.target.closest?.(focusableSelector);
  focusIntent = target && app.contains?.(target) ? {target, at:Date.now()} : null;
}, true);
document.addEventListener('keydown', event => {
  if (event.isTrusted !== false && event.key === 'Tab') focusIntent = {target:null, at:Date.now()};
}, true);
window.addEventListener('blur', () => { focusIntent = null; recordScrollDiagnostic('window-blur'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') focusIntent = null;
  recordScrollDiagnostic('visibility');
});
app.addEventListener('focusin', event => {
  const intent = focusIntent; focusIntent = null;
  recordScrollDiagnostic('focusin');
  if (!intent || Date.now() - intent.at > 1000 || (intent.target && intent.target !== event.target)) return;
  if (document.visibilityState === 'hidden' || document.hasFocus?.() === false) return;
  protectFloatingFocus(event.target);
});
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
  return app.querySelector(`[data-action="${menu.dataset.floatingMenu}"]${menu.dataset.menuCard ? `[data-id="${menu.dataset.menuCard}"]` : menu.dataset.floatingMenu==='reasoning-toggle' ? ':not([data-id])' : ''}`);
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
  const menu = app.querySelector('.plus-menu,.size-menu,.inline-list,.reasoning-menu');
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
  if (!menu || menu.contains(event.target) || event.target.closest?.('[data-action="plus"],[data-action="size-toggle"],[data-action="supplier"],[data-action="pull-models"],[data-action="reasoning-toggle"]')) return;
  dismissFloatingMenu();
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const data = { chat: makePage('chat'), image: makePage('image') };
let localHydrated=false,storageState='loading',localSaveTimer,localRestored=false;
const localSecrets=new Set();
const storageLabels={loading:'正在读取本机存档',ready:'本机自动保存已启用',restored:'已恢复本机存档；API Key 请重新填写',saving:'正在保存…',saved:'已保存到本机；API Key 不保存',error:'本机保存失败；当前改动尚未保存，请导出备份后重试', 'size-limit':'本机存档超过 48 MiB；当前改动尚未保存，请备份',conflict:'另一标签页已更新存档；本页暂停保存，请先导出备份',blocked:'存储版本已变化或被占用；请备份后刷新',schema:'本机存档版本不支持或损坏；已停止覆盖',unavailable:'本机存储不可用；仅内存运行，刷新会丢失，请导出备份'};
const localStore=createLocalStore({name:`llm-workbench-local-v1:${(window.location?.pathname || '/').replace(/index\.html$/,'')}`,onStatus:setStorageStatus});

let page = 'chat', plusOpen = false, sizeOpen = false, subMenu = '', nextId = 1;
let reasoningAnchorId = null;
const get = () => data[page];
function syncLogSecrets() { for(const d of Object.values(data))if(d.api.key)localSecrets.add(d.api.key); updateActiveLogSecrets(Object.values(data).map(d => d.api.key)); }
function archiveWorkspaceKey(d) { if (d) { if(d.api.key)localSecrets.add(d.api.key);setLogSecrets([d.api.key]); } }
const activeCardId = d => d.messages.findLast(m => m.type === 'card')?.id;
const getCard = id => get()?.messages.find(m => m.id === id && m.type === 'card');
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
  return `<section class="reasoning-menu reasoning-quick" data-floating-menu="reasoning-toggle" role="menu" aria-label="思考强度"><button type="button" role="menuitemradio" aria-checked="${!current}" data-action="reasoning-quick" data-value="">不指定</button>${values.map(v=>`<button type="button" role="menuitemradio" aria-checked="${current?.template===mode.id && String(current.value)===String(v.value)}" data-action="reasoning-quick" data-template="${esc(mode.id)}" data-value="${esc(v.value)}">${esc(v.label||v.value)}</button>`).join('')}${mode?.kind==='number'?`<div class="reasoning-budget-row"><input type="number" id="reasoning-quick-budget" aria-label="思考预算 Token" placeholder="Token" min="${mode.min}" max="${mode.max}" step="1" value="${esc(d.model.reasoningBudget??'')}"><button type="button" data-action="reasoning-budget-apply">确定</button></div>`:''}</section>`;
}
function reasoningCurrentLabel(d) {
  const current=d.model.reasoning;if(!current)return '不指定';
  const mode=selectedReasoningMode(d);
  if(mode?.kind==='number'){if(mode.specialValues?.includes(Number(current.value)) && Number(current.value)===-1)return '动态';if(Number(current.value)===0)return '关闭';return `${current.value} Token`;}
  return mode?.values?.find(v=>String(v.value)===String(current.value))?.label || String(current.value);
}
function reasoningMarkup() {
  const d=get(), open=subMenu==='reasoning', current=d.model.reasoning, label=reasoningCurrentLabel(d);
  const picker=open ? reasoningAnchorId===null ? reasoningQuickMarkup(d) : `<section class="reasoning-menu reasoning-family-list" data-floating-menu="reasoning-toggle" data-menu-card="${reasoningAnchorId}" role="menu" aria-label="思考模板">${REASONING_FAMILIES.map(f=>`<button type="button" role="menuitemradio" aria-checked="${selectedReasoningFamily(d)===f.id}" data-action="reasoning-family" data-family="${f.id}">${f.label}</button>`).join('')}</section>` : '';
  return `<div class="reasoning-control"><button type="button" class="reasoning-trigger" data-action="reasoning-toggle" aria-label="思考强度：${esc(label)}" aria-haspopup="menu" aria-expanded="${open&&reasoningAnchorId===null}" ${d.busy?'disabled':''}>${esc(label)}</button>${picker}</div>`;
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
function addCard(kind) {
  const d = get();
  const previous = d.messages.find(m => m.id === activeCardId(d));
  if (previous) previous.values = previous.kind === 'api' ? { ...d.api, key: '' } : { ...d.model, reasoningFamily:selectedReasoningFamily(d) };
  // Historical cards never retain an API-key snapshot.
  const values = kind === 'api' ? { ...d.api, key: '' } : { ...d.model, reasoningFamily:selectedReasoningFamily(d) };
  d.messages.push({ id: nextId++, type: 'card', kind, values, showKey: false, models: [] });
  closeMenus(); render(true);
}
function status(d, text, type = 'status', scrollEnd = true) { d.messages.push({ id: nextId++, type, text }); if (get() === d) render(scrollEnd); }
function errorText(error) {
  if (error?.code === 'ATTACHMENT') return error.safeMessage;
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
function protocolLabel(protocol) { return ({gemini:'Gemini 原生 · generateContent',openai:'OpenAI 兼容 · Chat Completions',ark:'火山方舟 · 普通 API',anthropic:'Anthropic · Messages'})[protocol] || protocol; }
function apiCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.api;
  const menu = subMenu.endsWith(`:${m.id}`) ? subMenu.split(':')[0] : '';
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}
    <div class="formfield"><label for="url${m.id}">API 地址</label><div class="fieldrow"><textarea class="setting-text" rows="1" wrap="soft" id="url${m.id}" data-card="${m.id}" data-key="url" placeholder="API 地址" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(x.url)}</textarea><div class="sub-menu"><button type="button" data-action="supplier" aria-haspopup="listbox" aria-controls="supplier-options${m.id}" title="${esc(protocolLabel(x.protocol))}" data-id="${m.id}" aria-expanded="${menu === 'supplier'}" class="uniform-btn">${esc(providerIdentity(x).name)}</button>${menu === 'supplier' ? `<div id="supplier-options${m.id}" class="inline-list" role="listbox" aria-label="供应商与 API 格式" data-floating-menu="supplier" data-menu-card="${m.id}">${providers.map((p, i) => `<button class="inline-item" role="option" aria-selected="${providerIdentity(x).name === p.name}" data-action="choose-supplier" data-id="${m.id}" data-index="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div></div></div>
    <div class="formfield"><label for="key${m.id}">API Key</label><div class="fieldrow"><input id="key${m.id}" data-card="${m.id}" data-key="key" type="${!old && m.showKey ? 'text' : 'password'}" placeholder="" aria-describedby="key-help${m.id}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(old ? '' : x.key)}"><button type="button" data-action="toggle-key" data-id="${m.id}" class="uniform-btn">${m.showKey ? '隐藏' : '显示'}</button></div><div class="field-reading" id="key-help${m.id}">${old ? '未保留历史密钥' : '仅保留在本页内存，刷新即清除'}</div></div>
    <div class="formfield"><label for="model${m.id}">模型 ID</label><div class="fieldrow"><textarea class="setting-text" rows="1" wrap="soft" id="model${m.id}" data-card="${m.id}" data-key="model" placeholder="模型 ID" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(x.model)}</textarea><div class="sub-menu"><button type="button" data-action="pull-models" data-id="${m.id}" aria-expanded="${menu === 'models'}" class="uniform-btn" ${x.protocol === 'ark' ? 'disabled title="普通 Ark API 未核实模型列表接口，请填写官方模型 ID"' : ''}>${x.protocol === 'ark' ? '手填模型' : '拉取模型'}</button>${menu === 'models' ? `<div class="inline-list" data-floating-menu="pull-models" data-menu-card="${m.id}">${m.models.length ? m.models.map(model => `<button class="inline-item" data-action="choose-model" data-id="${m.id}" data-model="${esc(model.id)}">${esc(model.id)}</button>`).join('') : '<span class="inline-item">上游未返回可用模型</span>'}</div>` : ''}</div></div></div>
    <div class="field-reading" id="models-status${m.id}" role="status">${esc(m.modelListStatus || '')}</div>
    <div class="api-security">${!old && d.pendingTextId ? '<div>填写后，再次发送即可继续。</div>' : ''}<span id="api-trust${m.id}">${old ? '密钥不写入历史记录' : apiTrustText(x)}</span>${!old && x.protocol === 'ark' ? '<div>普通 API · 非 Agent Plan。浏览器跨域支持尚待真实验证。</div>' : ''}${!old && x.protocol === 'anthropic' ? '<div>Anthropic Messages 格式：目标为官方 https://api.anthropic.com/v1 时启用官方浏览器访问。密钥可被本页脚本读取，仅保存在内存并在请求时发送到上方地址；实际 CORS 尚未用真实密钥验证。默认输出预算 4096 Token；当前支持文本附件，不提供图片生成或工具调用。</div>' : ''}${!old ? '<div>发送消息或拉取模型时，密钥及请求内容将发送到上方地址；填写本身不发送请求。</div>' : ''}</div>
  </div></fieldset></div>`;
}
function modelCard(m) {
  const d = get(), old = m.id !== activeCardId(d), x = old ? m.values : d.model;
  const field = (label, key, placeholder) => `<div class="formfield"><label for="${key}${m.id}">${label}</label><input class="block-input" type="number" id="${key}${m.id}" data-card="${m.id}" data-key="${key}" placeholder="${placeholder}" value="${esc(x[key])}" step="any"></div>`;
  return `<div class="card-wrap"><fieldset ${old || d.busy ? 'disabled' : ''} class="card-fieldset"><div class="setup-card ${old ? 'old' : ''}">${old ? '<span class="disabled-tag">历史记录</span>' : ''}<div class="card-type">模型设置</div><div class="subgrid">${page === 'chat' ? `${field('输出预算 Token', 'output', 'API 默认')}${field('温度', 'temperature', 'API 默认')}${field('Top P', 'topP', 'API 默认')}<div class="formfield"><label for="reasoning-model${m.id}">自定义思考模板</label><button type="button" id="reasoning-model${m.id}" class="block-value reasoning-model-trigger" data-action="reasoning-toggle" data-id="${m.id}" aria-haspopup="menu" aria-expanded="${subMenu==='reasoning' && reasoningAnchorId===m.id}">${esc(REASONING_FAMILIES.find(f=>f.id===(old ? x.reasoningFamily : x.reasoningFamily || reasoningFamilyFor(d.api,x.reasoningMode || x.reasoning?.template)))?.label || '选择模板')}</button></div><div class="formfield"><label for="context${m.id}">上下文</label><output id="context${m.id}" class="block-value">当前对话上下文</output></div>` : `<div class="formfield"><label for="count${m.id}">生成数量</label><output id="count${m.id}" class="block-value">1</output></div><div class="formfield"><label for="format${m.id}">输出格式</label><output id="format${m.id}" class="block-value">上游原始格式</output></div>`}</div>${page === 'chat' ? `<div class="fieldgroup"><span class="formlabel">输入模态</span><div class="chips">${Object.entries(MODALITIES).map(([kind,label]) => `<button type="button" class="chip ${x.inputs?.includes(kind) ? 'sel' : ''}" data-action="toggle-input" data-id="${m.id}" data-modality="${kind}" aria-pressed="${Boolean(x.inputs?.includes(kind))}" ${!supportedModalities(d.api.protocol).includes(kind) || kind === 'text' ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>` : ''}<div class="model-note">${page === 'chat' ? `输入模态控制可添加的附件，不代表当前模型具备相应能力；以供应商响应为准。附件仅在点击发送时提交到 API。图片生成仍通过独立图片工作台。${d.api.protocol === 'ark' ? ' Token 预算使用 max_completion_tokens，含思考与回答。' : d.api.protocol === 'anthropic' ? ' 输出预算使用 max_tokens，未填时为 4096；当前仅文本附件，不提供工具调用。' : ''}` : '文本生成图片；比例和分辨率在输入框右下方选择。'}</div></div></fieldset></div>`;
}
function imageMarkup(m) {
  return `<div class="message"><div class="assistant-message"><div class="assistant-label">${m.fromTool ? '图片工作台 · Agent 调用' : '图片结果'}</div>${m.images.map((im, i) => `<div class="img-result">${im.failed ? '<div class="mock-status" role="alert">返回的图片文件无法在浏览器中解码。请检查下载文件；不会自动重新生成。</div>' : `<img class="generated-image" data-image-message="${m.id}" data-image-index="${i}" src="${esc(im.url)}" alt="${esc(m.prompt)}" loading="lazy">`}<div class="sample-caption"><span>${esc(m.aspectRatio)} · ${esc(m.imageSize)}</span><a href="${esc(im.url)}" download="image-${m.id}-${i + 1}.${im.extension}">下载</a></div></div>`).join('')}${m.text ? `<div class="assistant-note">${esc(m.text)}</div>` : ''}${m.metrics ? `<div class="reply-metrics">${replyMetricsMarkup(m.metrics)}</div>` : ''}</div></div>`;
}
function messageMarkup(m) {
  if (m.type === 'card') return `<div class="message">${m.kind === 'api' ? apiCard(m) : modelCard(m)}</div>`;
  if (m.type === 'user') return `<div class="message user"><div class="bubble">${esc(m.text)}${attachmentsMarkup(m.attachments)}</div></div>`;
  if (m.type === 'imageResult') return imageMarkup(m);
  if (m.type === 'chatResult') return `<div class="message" data-stream-message="${m.id}"><div class="assistant-message"><div class="assistant-label">${m.incomplete ? '未完成 · 未加入上下文' : m.streaming ? '正在回复…' : '模型回复'}</div><div class="assistant-note reply-text">${esc(m.text)}</div>${m.metrics ? `<div class="reply-metrics">${replyMetricsMarkup(m.metrics)}</div>` : ''}</div></div>`;
  return `<div class="message"><div class="mock-status" role="${m.type === 'error' ? 'alert' : 'status'}">${esc(m.text)}</div></div>`;
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
function plusMarkup() { return `<div class="menu-wrap"><button class="circle" aria-label="展开工具菜单" aria-expanded="${plusOpen}" data-action="plus" ${get().busy ? 'disabled' : ''}>${icon('plus', 22)}</button>${plusOpen ? `<div class="plus-menu">${page === 'chat' ? '<button data-action="attach" data-kind="image">添加图片</button><button data-action="attach" data-kind="file">添加文件</button><button data-action="clear-attachments">清空附件</button><button data-action="clear-chat">清空对话</button>' : ''}<button data-action="local-storage">本机保存与备份</button><button data-action="new-card" data-kind="api">${icon('key')} API 设置</button><button data-action="new-card" data-kind="model">${icon('settings')} 模型设置</button></div>` : ''}</div>`; }
function sizeMarkup() {
  const d = get(), cap = getImageCapabilities(d.api);
  return `<div class="menu-wrap" data-image-control><button class="size-btn" type="button" data-action="size-toggle" aria-expanded="${sizeOpen}" aria-label="选择长宽比与分辨率" ${d.busy ? 'disabled' : ''}>${cap ? `${esc(d.aspectRatio)} · ${esc(d.imageSize)}` : '图片参数'} ${icon('chev', 14)}</button>${sizeOpen ? `<div class="size-menu" id="image-options"><div class="menu-heading">长宽比与分辨率</div><div class="matrix-model">${esc(cap?.label || '未支持的图片模型')}</div>${cap ? `<div class="matrix-scroll"><table class="option-matrix" aria-label="${esc(cap.label)} 图片长宽比与分辨率"><colgroup><col class="matrix-ratio-col">${cap.sizes.map(() => '<col>').join('')}</colgroup><thead><tr><th scope="col">长宽比</th>${cap.sizes.map(size => `<th scope="col">${size}</th>`).join('')}</tr></thead><tbody>${cap.ratios.map(item => `<tr><th scope="row"><span class="size-name">${item.ratio}</span></th>${cap.sizes.map(size => { const selected = d.aspectRatio === item.ratio && d.imageSize === size; return `<td><button type="button" class="matrix-choice ${selected ? 'sel' : ''}" data-action="set-image-options" data-ratio="${item.ratio}" data-image-size="${size}" aria-label="长宽比 ${item.ratio}，${size}，${selectedPixels(d, item.ratio, size)}" aria-pressed="${selected}"><span class="matrix-mark" aria-hidden="true">${selected ? '✓' : ''}</span><span class="matrix-pixels">${selectedPixels(d, item.ratio, size)}</span></button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>${cap.presetNotes ? `<div class="matrix-notice">${esc(cap.presetNotes)}</div>` : ''}` : '<div class="matrix-notice">此模型的图片参数尚未支持。请选择 Nano Banana 2.1 或已支持的 Seedream 5.0 Flash / Pro。</div>'}</div>` : ''}</div>`;
}
function tabsMarkup() {
  return `<div class="tabs" role="tablist" aria-label="页面导航">${[['chat', '对话'], ['image', '图片'], ['logs', '日志']].map(([id, label]) => `<button role="tab" aria-selected="${page === id}" class="tab ${page === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}
function renderLogsPage() {
  syncLogSecrets();
  app.innerHTML = `<main class="main"><header class="top">${tabsMarkup()}</header><section class="thread"><div class="thread-inner"><div class="log-actions"><button class="chip" data-action="export-logs">导出 JSON</button><button class="chip" data-action="clear-logs">清空日志</button></div><details class="scroll-diagnostics"><summary>滚动诊断（不含对话与密钥）</summary><p>发生回弹后打开这里，复制或导出进入日志页前的记录。仅保存最近 80 条位置和事件，不会自动上传。</p><button class="chip" data-action="copy-scroll-diagnostics">复制滚动诊断</button><button class="chip" data-action="export-scroll-diagnostics">导出滚动诊断</button><span id="scroll-diagnostic-status" role="status"></span><textarea id="scroll-diagnostic-text" aria-label="滚动诊断 JSON" readonly rows="5">${esc(exportScrollReport())}</textarea></details><div id="network-logs"></div></div></section></main>`;
  renderNetworkLogs(app.querySelector('#network-logs'));
  recordScrollDiagnostic('render-dom-replaced');
  mountFloatingMenu();
  syncFloatingNavigation();
}

function captureControlFocus() {
  const active = document.activeElement;
  if (active?.tagName !== 'BUTTON' || !app.contains(active) || !active.dataset.action) return null;
  return Object.fromEntries(['action','tab','ratio','imageSize','id','kind','card','template','value','family']
    .filter(key => active.dataset[key] !== undefined).map(key => [key, active.dataset[key]]));
}
function restoreControlFocus(identity) {
  if (!identity) return;
  const target = [...app.querySelectorAll('button[data-action]')]
    .find(button => !button.disabled && Object.entries(identity).every(([key,value]) => button.dataset[key] === value));
  if(target)recordScrollDiagnostic('control-focus-restore');
  target?.focus({ preventScroll: true });
}
// View positions belong to each tab, not to the shared scrolling element.
const viewPositions = new Map();
let renderedPage = null, scrollRestoreVersion = 0;
function rememberViewPosition() {
  recordScrollDiagnostic('remember-view');
  if (!renderedPage) return;
  const top = Math.max(0, Number(app.scrollTop) || 0);
  const maximum = Math.max(0, (Number(app.scrollHeight) || 0) - (Number(app.clientHeight) || 0));
  viewPositions.set(renderedPage, { top, bottom: maximum > 0 && maximum - top <= 2 });
}
function restoreViewPosition(scrollEnd = false) {
  const position = viewPositions.get(page) || {top:0,bottom:false};
  if (scrollEnd) position.bottom = true;
  renderedPage = page;
  const destination = page, version = ++scrollRestoreVersion;
  const apply = () => { recordScrollDiagnostic('view-restore-write', (position.bottom ? app.scrollHeight : position.top)-app.scrollTop); app.scrollTop = position.bottom ? app.scrollHeight : position.top; };
  apply();
  const restoredTop = app.scrollTop;
  // Account for measured floating clearances, without overriding intervening user scroll.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    if (version === scrollRestoreVersion && renderedPage === destination && app.scrollTop === restoredTop) apply();
  });
}
function render(scrollEnd = false) {
  saveLocal();
  recordScrollDiagnostic(scrollEnd ? 'render-send-end' : 'render-start');
  rememberViewPosition();
  const focusIdentity = captureControlFocus();
  if (page === 'logs') { renderLogsPage(); restoreViewPosition(scrollEnd); restoreControlFocus(focusIdentity); return; }
  const d = get();
  app.innerHTML = `<main class="main"><header class="top">${tabsMarkup()}</header><section class="thread" id="thread" aria-label="${page === 'chat' ? '对话' : '图片'}历史"><div class="thread-inner">${d.messages.map(messageMarkup).join('')}${d.busy ? '<div class="message">'+loadingMarkup(d)+'</div>' : ''}</div></section><footer class="composer-area">${d.reasoningIssue?`<div class="reasoning-error" role="alert">${esc(d.reasoningIssue)}</div>`:''}${page === 'chat' ? `<div class="attachment-draft">${attachmentsMarkup(d.attachments,true)}${d.attachmentReading ? '<span role="status">正在读取附件…</span>' : ''}${d.attachmentError ? `<span role="alert">${esc(d.attachmentError)}</span>` : ''}</div>` : ''}<div class="compose"><textarea id="draft" rows="1" placeholder="${page === 'image' ? '描述你想生成的图片…' : ''}" aria-label="${page === 'image' ? '图片提示词' : '聊天消息'}" ${d.busy ? 'disabled' : ''}>${esc(d.draft)}</textarea><div class="compose-actions"><div class="left-actions">${plusMarkup()}</div><div class="right-actions">${page === 'image' ? sizeMarkup() : reasoningMarkup()}${d.busy ? '<button class="send" data-action="cancel" aria-label="取消请求" title="取消请求">■</button>' : `<button class="send" data-action="send" aria-label="${page === 'image' ? '生成图片' : '发送消息'}" title="${page === 'image' ? '生成图片' : '发送消息'}">${icon('up')}</button>`}</div></div></div><div class="compose-metrics">${replyMetricsMarkup(d.lastMetrics)}</div></footer></main>`;
  recordScrollDiagnostic('render-dom-replaced');
  mountFloatingMenu();
  syncFloatingNavigation();
  positionFloatingMenu();
  restoreViewPosition(scrollEnd);
  restoreControlFocus(focusIdentity);
  if(d.busy)paintLoading(d);
}
// Update only the active reply node: do not rebuild composer or displace readers.
function paintStream(d, message) {
  saveLocal();
  if (get() !== d) return;
  const follow = app.scrollHeight - app.clientHeight - app.scrollTop <= 32;
  let node = app.querySelector(`[data-stream-message="${message.id}"]`);
  if (!node) {
    const loading=app.querySelector('.api-loading')?.closest?.('.message');
    if(!loading?.insertAdjacentHTML){render();return;}
    loading.insertAdjacentHTML('beforebegin',messageMarkup(message));
    node=app.querySelector(`[data-stream-message="${message.id}"]`);
    if(!node)return;
  }
  node.querySelector('.reply-text').textContent = message.text;
  node.querySelector('.assistant-label').textContent = message.incomplete ? '未完成 · 未加入上下文' : message.streaming ? '正在回复…' : '模型回复';
  if (message.metrics && !node.querySelector('.reply-metrics')) node.querySelector('.assistant-message').insertAdjacentHTML('beforeend', `<div class="reply-metrics">${replyMetricsMarkup(message.metrics)}</div>`);
  if (follow) { recordScrollDiagnostic('stream-follow-write',app.scrollHeight-app.scrollTop); app.scrollTop = app.scrollHeight; }
}
// These phases describe observed transport evidence, never inferred private thinking.
const REQUEST_DEADLINE_MS = 30 * 60 * 1000;
function loadingPresentation(d, now = Date.now()) {
  const phase = d.requestPhase || 'waiting_headers';
  const active = phase === 'reasoning' || phase === 'output';
  const waited = Math.max(0, (now - (d.requestPhaseAt || now)) / 1000);
  const label = ({waiting_headers:'等待响应头',headers_received:'已收到响应头，等待回复',first_chunk:'已收到数据，等待回复',reasoning:'已收到模型思考信号',output:'正在接收输出'})[phase] || '等待回复';
  return {phase, active, slow:!active && waited >= 15, long:!active && waited >= 45,
    duration:active ? .5 : 1.25,
    label:label + (!active && waited>=45 ? '；等待较久，尚未判定失败，可取消' : '；可随时取消')};
}
function loadingMarkup(d) {
  const x=loadingPresentation(d);
  return `<div class="api-loading" data-phase="${x.phase}" data-active="${x.active}" data-slow="${x.slow}" data-long="${x.long}" title="${esc(x.label)}" role="status" aria-label="${esc(x.label)}"><span class="api-spinner" aria-hidden="true"></span><span class="api-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span><span class="sr-only">${esc(x.label)}</span></div>`;
}
function paintLoading(d, announce=false) {
  if (get() !== d) return;
  const node=app.querySelector('.api-loading'); if(!node) return;
  const x=loadingPresentation(d);
  node.dataset.phase=x.phase;node.dataset.active=String(x.active);node.dataset.slow=String(x.slow);node.dataset.long=String(x.long);
  node.title=x.label;
  const spinner=node.querySelector('.api-spinner');
  // CSS duration remains constant. Synchronize the existing animation timeline
  // before changing rate, rather than recomputing its phase on each timer tick.
  if(spinner?.dataset?.speed !== String(x.duration)){
    for(const animation of spinner?.getAnimations?.() || []){
      if(animation.animationName === 'api-spin' && typeof animation.updatePlaybackRate === 'function') animation.updatePlaybackRate(.8/x.duration);
    }
    if(spinner?.dataset)spinner.dataset.speed=String(x.duration);
  }
  if(announce){node.setAttribute('aria-label',x.label);const live=node.querySelector('.sr-only');if(live)live.textContent=x.label;}
}
function requestPhase(d, phase) {
  if(!d.busy || !['waiting_headers','headers_received','first_chunk','reasoning','output'].includes(phase))return;
  if(phase==='first_chunk' && ['reasoning','output'].includes(d.requestPhase))return;
  if(d.requestPhase===phase)return;
  d.requestPhase=phase;d.requestPhaseAt=Date.now();paintLoading(d,true);
}
function beginLoading(d) {
  d.requestPhase='waiting_headers';d.requestPhaseAt=Date.now();d.requestTimedOut=false;
  const controller=d.controller;
  const tick=setInterval(()=>paintLoading(d),1000);
  const deadline=setTimeout(()=>{d.requestTimedOut=true;controller.abort();},REQUEST_DEADLINE_MS);
  return ()=>{clearInterval(tick);clearTimeout(deadline);};
}
function requestError(d,error) {
  return d.requestTimedOut ? new AppError('CLIENT_TIMEOUT','客户端等待已达 30 分钟，已停止等待；供应商可能已经计费。可检查日志后手动重试，未自动重试。') : error;
}
function applyCurrentTarget(d, report = text => status(d, text, 'error')) {
  try { d.api.trustedTarget = canonicalEndpoint(d.api.url); return true; }
  catch (e) { d.api.trustedTarget = ''; report(errorText(e)); return false; }
}
function syncCurrentApiFields(d) {
  const card = getCard(activeCardId(d));
  if (!card || card.kind !== 'api') return;
  const values = Object.fromEntries(['url','key','model'].map(key => [key, app.querySelector(`#${key}${card.id}`)?.value]));
  // Autofill may skip input events: snapshot first, but never carry an unchanged old key to a changed target.
  if (values.url !== undefined && values.url !== d.api.url && values.key === d.api.key) values.key = '';
  for (const key of ['url','key','model']) if (values[key] !== undefined && values[key] !== d.api[key]) {
    updateField({target:{value:values[key],dataset:{card:String(card.id),key}}});
  }
  const keyField = app.querySelector(`#key${card.id}`);
  if (keyField && keyField.value !== d.api.key) keyField.value = d.api.key;
}
function configuredImageSnapshot() {
  const config = { ...data.image.api };
  try { config.trustedTarget = config.key.trim() ? canonicalEndpoint(config.url) : ''; }
  catch { config.trustedTarget = ''; }
  return config;
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
    return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), extension, data: im.data, mimeType: mime };
  });
  d.messages.push({ id: nextId++, type: 'imageResult', images, text: result.text || '', prompt: args.prompt, aspectRatio: args.aspectRatio || '1:1', imageSize: args.imageSize || '1K', metrics:replyMetricsSnapshot(result.usage), fromTool });
  saveLocal(true);
  if (get() === d) render();
}
function modelListStatus(d, card, text) {
  card.modelListStatus = text;
  if (get() === d) render();
}
async function pullModels(card) {
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
    card.models = await listModels({ config: { ...d.api }, signal: d.controller.signal, onPhase:phase=>requestPhase(d,phase) });
    if (get() === d) subMenu = `models:${card.id}`;
  } catch (e) { card.modelListStatus = errorText(requestError(d,e)); }
  finally { stopLoading(); d.busy = false; d.controller = null; if (get() === d) { render(); if (subMenu === `models:${card.id}`) focusFloatingMenu(); } }
}
async function send() {
  const d = get(); if (!d) return { status: 'not-sent', reason: 'select-workspace' };
  syncCurrentApiFields(d);
  syncLogSecrets();
  const requestPage = page, text = d.draft.trim();
  if (d.busy || d.attachmentReading || (!text && !d.attachments.length)) return { status: 'not-sent', reason: d.busy ? 'busy' : 'empty' };
  closeMenus();
  const attachments = [...d.attachments];
  try { validateAttachments(attachments,d.api.protocol,d.model.inputs); } catch(e) { d.attachmentError=errorText(e); render(); return {status:'not-sent',reason:'attachments'}; }
  const pending = d.messages.find(m => m.id === d.pendingTextId);
  if (!pending || pending.text !== text || JSON.stringify(pending.attachments?.map(a=>a.id)) !== JSON.stringify(attachments.map(a=>a.id))) { const m = { id: nextId++, type: 'user', text, attachments }; d.messages.push(m); d.pendingTextId = m.id; }
  saveLocal(true);
  if (!isConfigured(d)) { addCard('api'); return { status: 'needs-configuration' }; }
  if (!applyCurrentTarget(d)) return {status:'not-sent',reason:'invalid-target'};
  if (requestPage === 'image' && !matrixSupported(d)) { status(d, '此图片模型的参数尚未支持，请选择 Nano Banana 2.1 或 Seedream 5.0 Flash / Pro。', 'error'); return { status: 'not-sent', reason: 'unsupported-model' }; }
  const config = { ...d.api }, args = { prompt: text, aspectRatio: d.aspectRatio, imageSize: d.imageSize };
  if (requestPage === 'image' && !approveImage({ target: canonicalEndpoint(config.url), model: config.model, args })) { render(true); return { status: 'declined' }; }
  d.busy = true; d.controller = new AbortController(); d.draft = ''; d.attachments = []; d.attachmentError = ''; d.lastUsage = null; d.lastMetrics = null;
  const stopLoading=beginLoading(d);
  let checkpointed = false;
  const streamedReplies = new Map();
  render(true);
  if(localHydrated)await saveLocal(true);
  try {
    if (requestPage === 'image') {
      const result = await dispatchCommand({ command: 'image.generate', args }, { imageConfig: config, signal: d.controller.signal, confirmed: true, onPhase:phase=>requestPhase(d,phase) });
      appendImages(d, result, args); d.lastUsage = result.usage; d.lastMetrics = replyMetricsSnapshot(result.usage);
    } else {
      const result = await runConversation({
        config, imageConfig: configuredImageSnapshot(), messages: [...d.history, { role: 'user', content: text, attachments }], settings: { ...d.model }, signal: d.controller.signal,
        onPhase:phase=>requestPhase(d,phase),
        onDelta: (delta, {round}) => {
          if (!delta) return;
          let reply = streamedReplies.get(round);
          if (!reply) {
            reply = {id:nextId++,type:'chatResult',text:'',streaming:true};
            streamedReplies.set(round,reply); d.messages.push(reply);
          }
          reply.text += delta; paintStream(d,reply);
        },
        onResponse: (response, {round}) => {
          const reply = streamedReplies.get(round);
          if (reply) { reply.streaming = false; reply.metrics = response.metrics; paintStream(d,reply); }
        },
        confirmTool: async invocation => approveImage(invocation),
        onHistory: history => { d.history = history; checkpointed = true; saveLocal(true); },
        onToolResult: ({ result, invocation }) => appendImages(d, result, invocation.args, true)
      });
      d.history = result.history;
      if (result.text && !streamedReplies.size) d.messages.push({ id: nextId++, type: 'chatResult', text: result.text, metrics: result.metrics });
      d.lastUsage = result.usage; d.lastMetrics = result.metrics;
    }
    d.pendingTextId = null;
    return { status: 'completed', messageCount: d.messages.length };
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
app.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'local-storage') { openStoragePanel(); return; }
  const action = el.dataset.action, d = get(), card = getCard(Number(el.dataset.id));
  if ((d?.busy || d?.attachmentReading) && !['tab', 'cancel'].includes(action)) return;
  if (['supplier','choose-supplier','pull-models','choose-model','toggle-key'].includes(action) && (!d || card?.id !== activeCardId(d))) return;
  switch (action) {
    case 'tab': if(el.dataset.tab === 'logs')freezeScrollReport(); page = el.dataset.tab; closeMenus(); render(); break;
    case 'reasoning-toggle': {
      if(el.dataset.id && (card?.id!==activeCardId(d) || card.kind!=='model'))break;
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
    case 'reasoning-family': {
      if(reasoningAnchorId===null || reasoningAnchorId!==activeCardId(d))break;
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
    case 'plus': plusOpen = !plusOpen; sizeOpen = false; subMenu = ''; render(); if (plusOpen) focusFloatingMenu(); break;
    case 'attach': selectAttachments(el.dataset.kind); break;
    case 'clear-chat': d.messages=[];d.history=[];d.attachments=[];d.draft='';d.pendingTextId=null;d.attachmentError='';d.lastUsage=null;d.lastMetrics=null;await saveLocal(true);render();break;
    case 'clear-attachments': d.attachments=[]; d.attachmentError=''; render(); break;
    case 'remove-attachment': d.attachments=d.attachments.filter(a=>a.id!==el.dataset.id); d.attachmentError=''; render(); break;
    case 'toggle-input': { const kind=el.dataset.modality; if(card?.id !== activeCardId(d) || kind==='text' || !supportedModalities(d.api.protocol).includes(kind)) break; d.model.inputs=d.model.inputs.includes(kind)?d.model.inputs.filter(k=>k!==kind):[...d.model.inputs,kind]; render(); break; }
    case 'new-card': addCard(el.dataset.kind); break;
    case 'size-toggle': sizeOpen = !sizeOpen; plusOpen = false; subMenu = ''; render(); if (sizeOpen) focusFloatingMenu(); break;
    case 'set-image-options': if (matrixSupported(d) && getImageCapabilities(d.api).ratios.some(x => x.ratio === el.dataset.ratio) && getImageCapabilities(d.api).sizes.includes(el.dataset.imageSize)) { const scroll = app.querySelector('.matrix-scroll')?.scrollTop || 0; d.aspectRatio = el.dataset.ratio; d.imageSize = el.dataset.imageSize; render(); recordScrollDiagnostic('matrix-write',scroll); app.querySelector('.matrix-scroll').scrollTop = scroll; } break;
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
    case 'pull-models': await pullModels(card); break;
    case 'choose-model': d.api.model = el.dataset.model; clearIncompatibleReasoning(d); if (page === 'image') resetImageOptions(d); subMenu = ''; render(); break;
    case 'send': await send(); break;
    case 'cancel': d.controller?.abort(); break;
    case 'copy-scroll-diagnostics': {
      const text=exportScrollReport(), field=app.querySelector('#scroll-diagnostic-text');
      const currentStatus=()=>page==='logs' && app.querySelector('#scroll-diagnostic-text')===field ? app.querySelector('#scroll-diagnostic-status') : null;
      try { await navigator.clipboard.writeText(text); const target=currentStatus();if(target)target.textContent='已复制'; }
      catch { const target=currentStatus();if(target){if(field?.isConnected){field.focus({preventScroll:true});field.select();}target.textContent='请长按文本框复制，或使用导出';} }
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
function updateField(e) {
  const t = e.target, d = get();
  resizeSettingField(t);
  if (!d) return;
  if (t.id === 'draft') { d.draft = t.value; resizeDraft(t); saveLocal(); return; }
  const id = Number(t.dataset.card), key = t.dataset.key, card = getCard(id);
  if (!card || id !== activeCardId(d) || !key || d.busy) return;
  if (card.kind === 'api') {
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
  saveLocal();
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
  if(['reasoning-quick','reasoning-family'].includes(e.target.dataset?.action) && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const choices=[...app.querySelectorAll('[data-floating-menu="reasoning-toggle"] [role="menuitemradio"]')];
    const index=choices.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?choices.length-1:(index+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
    choices[next]?.focus({preventScroll:true});choices[next]?.scrollIntoView({block:'nearest'});
  }
  if (e.target.dataset?.action === 'supplier' && ['ArrowDown','ArrowUp'].includes(e.key)) {
    e.preventDefault(); plusOpen = sizeOpen = false; subMenu = `supplier:${e.target.dataset.id}`; render();
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
  return d ? { page, draft: d.draft, attachments: d.attachments.map(a=>a.id), api: { ...d.api }, settings: { ...d.model, ...(d.model.reasoning ? {reasoning:{...d.model.reasoning}} : {}) }, aspectRatio: d.aspectRatio, imageSize: d.imageSize } : null;
}
const pageSession = createPageSession({
  state: publicSessionState,
  logs: () => { syncLogSecrets(); return getNetworkLogs(); },
  navigate: ({ page: destination }) => { if(destination === 'logs')freezeScrollReport(); page = destination; closeMenus(); render(); return publicSessionState(); },
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
    clearIncompatibleReasoning(d);
    for (const key of ['output', 'temperature', 'topP']) if (args[key] !== undefined) d.model[key] = args[key];
    if (options) { d.aspectRatio = options.aspectRatio; d.imageSize = options.imageSize; }
    if (page === 'image') resetImageOptions(d);
    render(); return publicSessionState();
  },
  confirmSend: () => {
    const d = get(); if (!d || d.busy || d.attachmentReading || (!d.draft.trim() && !d.attachments.length) || approvedSessionRequest) return false;
    syncCurrentApiFields(d);
    syncLogSecrets();
    const snapshot = sessionRequestSnapshot();
    const approved = window.confirm(`允许已连接的页面控制工具发送当前${page === 'image' ? '图片生成' : '对话及附件'}请求？\n\n目标：${sanitizeLogValue(d.api.url)}\n模型：${sanitizeLogValue(d.api.model)}\n提示词：${sanitizeLogValue(d.draft)}\n附件：${d.attachments.length ? d.attachments.map(a=>`${sanitizeLogValue(a.name)} (${(a.size/1024).toFixed(1)} KiB)`).join('、') : '无'}\n此操作可能消耗 API 额度。图片生成的独立确认仍然适用。`);
    if (approved) approvedSessionRequest = snapshot;
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
    d?.controller?.abort(); return { requested: pendingApproval || Boolean(d?.controller) };
  }
});
await initializeLocal();
window.llmWorkbench = pageSession;
registerPageSessionTools(pageSession);
render();


// Hydration completes before controls or page-session tools become available.
async function initializeLocal() {
  app.innerHTML='<p role="status" class="local-loading">正在恢复本机数据…</p>';
  const saved=await localStore.load();
  if(saved) {
    try { const restored=restoreWorkspace(saved,makePage); Object.assign(data,restored.data);page=restored.page;nextId=restored.nextId;
      localRestored=Object.values(data).some(d=>d.messages.length||d.draft);setStorageStatus('restored');
      for(const [key,value] of Object.entries(restored.views))if(['chat','image','logs'].includes(key)&&Number.isFinite(value?.top))viewPositions.set(key,{top:Math.max(0,value.top),bottom:Boolean(value.bottom)});
    } catch { localStore.close(); setStorageStatus('schema'); }
  }
  localHydrated=true;
}
function saveLocal(immediate=false) {
  if(!localHydrated)return;
  clearTimeout(localSaveTimer);
  const capture=()=>{
    try { rememberViewPosition(); return localStore.schedule(snapshotWorkspace({data,page,nextId,views:Object.fromEntries(viewPositions),secrets:[...localSecrets]}),{immediate:true}); }
    catch(e){localStore.reportError(e);}
  };
  if(immediate)return capture();
  localSaveTimer=setTimeout(capture,250);
}
function setStorageStatus(state) {
  storageState=state;
  const warning=['error','size-limit','conflict','blocked','schema','unavailable'].includes(state);
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
  dialog.innerHTML=`<h2>本机保存与备份</h2><p id="local-storage-status">${esc(storageLabels[storageState])}</p><p>自动保留本机的对话、草稿、附件、模型设置和独立指标。API Key 与目标确认不保存；刷新后请重新填写密钥。通讯日志不保存。含账号、密码、查询参数或片段的 API 地址不保存。</p><p>仅限当前浏览器与网站地址。无痕模式、清理浏览器或系统回收空间可能删除数据；这不是永久备份。单份快照上限 48 MiB，超限或配额不足时保留上一份成功存档，不会悄悄删除附件。</p><p>多标签页版本冲突后不会覆盖另一页；先导出本页备份，再刷新读取最新存档。</p><div class="local-storage-actions"><button data-local="export">导出本页备份</button><button data-local="import">恢复备份</button><button data-local="retry">重试保存</button><button data-local="close">关闭</button></div><p id="local-backup-status" role="status"></p>`;
  dialog.addEventListener('click',async event=>{
    const action=event.target.dataset.local;if(!action)return;
    const result=dialog.querySelector('#local-backup-status');
    if(action==='close'){dialog.close();dialog.remove();return;}
    if(action==='retry'){await saveLocal(true);return;}
    if(action==='export')try{
      const value=snapshotWorkspace({data,page,nextId,views:Object.fromEntries(viewPositions),secrets:[...localSecrets]});
      const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='llm-workbench-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);result.textContent='已发起下载。备份包含对话与附件，请妥善保管。';
    }catch{result.textContent='快照过大或无法导出。请先下载重要图片并复制重要文字。';}
    if(action==='import'){
      const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
      picker.onchange=async()=>{try{
        const file=picker.files?.[0];if(!file)return;if(file.size>MAX_SNAPSHOT_BYTES)throw new Error();
        const restored=restoreWorkspace(migrateSnapshot(JSON.parse(await file.text())),makePage);
        if(Object.values(data).some(d=>d.busy)){result.textContent='请先结束当前请求。';return;}
        if(!window.confirm('用备份替换当前本页对话和设置？建议先导出当前内容。'))return;
        Object.assign(data,restored.data);page=restored.page;nextId=restored.nextId;viewPositions.clear();for(const [k,v]of Object.entries(restored.views))viewPositions.set(k,v);
        render();await saveLocal(true);result.textContent='已恢复到本页。是否成功写入本机，请看上方保存状态。';
      }catch{result.textContent='备份格式不支持、损坏或超过 48 MiB；未恢复。';}};picker.click();
    }
  });
  document.body.append(dialog);dialog.showModal();
}

app.addEventListener('scroll',()=>{if(localHydrated)saveLocal();},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveLocal(true);});
window.addEventListener('pagehide',()=>saveLocal(true));
