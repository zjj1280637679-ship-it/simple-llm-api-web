/** 开发态课题：谁释放已登记资源，晚到资源如何处理？
 * 状态/边界：disposed 布尔值 + 宿主控制大小的释放函数集合。
 * 扩展：新增资源通过 own/listen 登记，释放函数的外部效果另验。
 * 契约：docs/contracts/lifecycle.json；局部宿主不替代完整 F/C/H/Q。
 */
/** A host owns all registrations until dispose; disposal is idempotent. */
export function createScope() {
  let disposed = false;
  const releases = [];
  function own(release) {
    if (typeof release !== 'function') return release;
    if (disposed) release();
    else releases.push(release);
    return release;
  }
  return {
    get disposed() { return disposed; },
    own,
    listen(target, event, handler, options) {
      target?.addEventListener?.(event, handler, options);
      own(() => target?.removeEventListener?.(event, handler, options));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const release of releases.splice(0).reverse()) {
        try { release(); } catch { /* Release the other owned resources too. */ }
      }
    }
  };
}
