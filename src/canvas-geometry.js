/** 开发态课题：视口变化如何保持操作可达而不恢复旧焦点？
 * 状态/边界：诊断环最多80项；观察器/DOM 几何由宿主提供，外部状态未有限化。
 * 扩展：扩展几何策略时用真实宿主及反例验证阈值，阈值不是定理。
 * 契约：docs/contracts/canvas-geometry.json；局部宿主不替代完整 F/C/H/Q。
 */
import { createScope } from './lifecycle.js';

/** Owns geometry/focus/menu effects; it never reads workspace messages or credentials. */
export function createCanvasGeometry({app, document = {}, window = {}, getComputedStyle = globalThis.getComputedStyle, ResizeObserver = globalThis.ResizeObserver, closeMenus = () => {}}) {
const scope = createScope();
const listen = scope.listen;
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
const readDiagnostics = window.__llmScrollDiagnostics = () => scrollDiagnostics.map(entry => ({...entry,appRect:entry.appRect?{...entry.appRect}:null,mainRect:entry.mainRect?{...entry.mainRect}:null,recentAction:entry.recentAction?{...entry.recentAction}:null}));
listen(app, 'scroll', () => recordScrollDiagnostic('app-scroll'), {passive:true});
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
listen(window, 'resize', syncFloatingNavigation);
// Viewport/chrome/screenshot events are geometry changes, not a request to
// reveal whatever old control happens to remain focused.
const refreshVisualViewport = event => { recordScrollDiagnostic(event?.type === 'scroll' ? 'viewport-scroll' : 'viewport-resize'); syncFloatingNavigation(); };
listen(window.visualViewport, 'resize', refreshVisualViewport);
listen(window.visualViewport, 'scroll', refreshVisualViewport);
const focusableSelector = 'input,textarea,select,button,a[href],summary,[tabindex],[contenteditable="true"]';
let focusIntent = null;
listen(document, 'pointerdown', event => {
  if (event.isTrusted === false) return;
  const target = event.target.closest?.(focusableSelector);
  focusIntent = target && app.contains?.(target) ? {target, at:Date.now()} : null;
}, true);
listen(document, 'keydown', event => {
  if (event.isTrusted !== false && event.key === 'Tab') focusIntent = {target:null, at:Date.now()};
}, true);
listen(window, 'blur', () => { focusIntent = null; recordScrollDiagnostic('window-blur'); });
listen(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') focusIntent = null;
  recordScrollDiagnostic('visibility');
});
listen(app, 'focusin', event => {
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
  closeMenus();
  floatingMenuObserver?.disconnect();
  menu.remove();
  anchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) anchor?.focus({preventScroll:true});
}
function focusFloatingMenu() { app.querySelector('[data-floating-menu] button')?.focus({preventScroll:true}); }
listen(app, 'scroll', positionFloatingMenu, true);
listen(window, 'resize', positionFloatingMenu);
listen(window.visualViewport, 'resize', positionFloatingMenu);
listen(window.visualViewport, 'scroll', positionFloatingMenu);
listen(document, 'pointerdown', event => {
  const menu = app.querySelector('[data-floating-menu]');
  if (!menu || menu.contains(event.target) || event.target.closest?.('[data-action="plus"],[data-action="size-toggle"],[data-action="supplier"],[data-action="pull-models"],[data-action="reasoning-toggle"]')) return;
  dismissFloatingMenu();
});

return { canvasSurfaceSnapshot, recordScrollDiagnostic, scrollDiagnosticReport, freezeScrollReport, exportScrollReport, resizeSettingField, syncSettingFields, resizeDraft, captureScrollGeometry, restoreScrollGeometry, protectFloatingFocus, syncFloatingNavigation, floatingMenuBounds, settingsMenuBounds, positionFloatingMenu, mountFloatingMenu, dismissFloatingMenu, focusFloatingMenu, dispose() {
 scope.dispose(); navigationObserver?.disconnect(); settingsFieldObserver?.disconnect(); floatingMenuObserver?.disconnect();
 if(window.__llmScrollDiagnostics === readDiagnostics)delete window.__llmScrollDiagnostics;
} };
}
