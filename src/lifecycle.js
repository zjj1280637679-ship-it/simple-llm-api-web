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
