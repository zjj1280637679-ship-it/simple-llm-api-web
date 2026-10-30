/** 开发态课题：原生业务 JSON 能否在声明输入范围内无语义删改地复制？
 * 状态/边界：活动路径与节点计数；深度 <=64、节点 <=100000；字符串字节由组合控制。
 * 扩展：扩展输入类型时先定义保真关系、资源预算与失败出口。
 * 契约：docs/contracts/native-json.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Copy bounded native protocol JSON without interpreting property names.
 * This is data preservation, not credential detection or a hostile-object sandbox.
 */
export const NATIVE_JSON_LIMITS = Object.freeze({depth:64, nodes:100000});

export function copyNativeJSON(value) {
  const ancestors = new Set();
  let nodes = 0;
  const invalid = () => {
    throw Object.assign(new Error('原生上下文超出当前 JSON 保存范围；未改写或保存该快照。'), {
      code:'NATIVE_JSON'
    });
  };

  function copy(item, depth) {
    if (++nodes > NATIVE_JSON_LIMITS.nodes || depth > NATIVE_JSON_LIMITS.depth) invalid();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid();
      return item;
    }
    if (typeof item !== 'object' || ancestors.has(item)) invalid();
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) invalid();

    const keys = Reflect.ownKeys(item);
    const entries = [];
    if (array && (item.length > NATIVE_JSON_LIMITS.nodes || keys.length !== item.length + 1)) invalid();
    ancestors.add(item);
    try {
      for (const key of keys) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) invalid();
        entries.push([key, copy(descriptor.value, depth + 1)]);
      }
      // fromEntries defines own data properties: __proto__ does not set a prototype.
      return array ? entries.map(([, child]) => child) : Object.fromEntries(entries);
    } finally {
      ancestors.delete(item);
    }
  }

  return copy(value, 0);
}
