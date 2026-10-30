/** 开发态课题：每页阅读位置与晚到布局回调怎样对应？
 * 状态/边界：页位置表 + 回调版本；默认3个页面，宿主动画帧为外部条件。
 * 扩展：新页面声明位置身份与失效条件。
 * 契约：docs/contracts/view-position.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Per-workbench focus and reading positions; no network/storage or global state. */
export function createViewPosition({app,document,getPage,recordScrollDiagnostic=()=>{},requestAnimationFrame=globalThis.requestAnimationFrame}) {
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
  const position = viewPositions.get(getPage()) || {top:0,bottom:false};
  if (scrollEnd) position.bottom = true;
  renderedPage = getPage();
  const destination = getPage(), version = ++scrollRestoreVersion;
  const apply = () => { recordScrollDiagnostic('view-restore-write', (position.bottom ? app.scrollHeight : position.top)-app.scrollTop); app.scrollTop = position.bottom ? app.scrollHeight : position.top; };
  apply();
  const restoredTop = app.scrollTop;
  // Account for measured floating clearances, without overriding intervening user scroll.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    if (version === scrollRestoreVersion && renderedPage === destination && app.scrollTop === restoredTop) apply();
  });
}

return {viewPositions,captureControlFocus,restoreControlFocus,rememberViewPosition,restoreViewPosition,dispose(){++scrollRestoreVersion;renderedPage=null;viewPositions.clear();}};
}
