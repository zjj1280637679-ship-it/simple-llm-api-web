/** 开发态课题：一张卡当前是否处于历史末项，其动作可否执行？
 * 状态边界：无活跃状态字段；类型登记表、唯一 id 与有序历史；外部 handler 效果另验。
 * 扩展：新类型经显式定义登记；动作条件和 commit 回查共享。
 * 契约：docs/contracts/interaction-cards.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Card identity and action admission. Liveness is a relation to the history tail,
 * never a stored lifecycle flag. A live card can still lack an action prerequisite.
 * Host handlers own effects; commit rechecks position after an asynchronous wait.
 */
export const CARD_VERSION = 1;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function liveCard(messages) {
  const last = messages?.at(-1);
  return last?.type === 'card' ? last : undefined;
}
export function isLiveCard(messages, id) {
  return Number.isSafeInteger(id) && id > 0 && liveCard(messages)?.id === id;
}
export function createCardRegistry(definitions) {
  const types = new Map();
  for (const definition of definitions) {
    if (!definition?.kind || types.has(definition.kind) || !Number.isSafeInteger(definition.version)) throw new Error('Invalid or duplicate card definition');
    types.set(definition.kind, definition);
  }
  const definitionFor = card => {
    const definition = types.get(card?.kind);
    return definition?.version === (card?.version ?? CARD_VERSION) ? definition : undefined;
  };
  return Object.freeze({
    kinds: Object.freeze([...types.keys()]),
    definitionFor,
    actionFor:(card,action)=>{const actions=definitionFor(card)?.actions;return actions&&Object.hasOwn(actions,action)?actions[action]:undefined;},
    create(kind, id, workspace, values) {
      const definition = types.get(kind);
      if (!definition || !Number.isSafeInteger(id) || id < 1) throw new Error('Unknown card type or identity');
      const card={id, type:'card', kind, version:definition.version, values:definition.capture(values ?? definition.initial(workspace))};
      if(definition.validateCard && !definition.validateCard(card))throw new Error('Invalid card values');
      return card;
    },
    execute(input, context) {
      if (!object(input) || Object.keys(input).some(key=>!['id','action','args'].includes(key)) || !object(input.args ?? {})) return {ok:false, reason:'invalid-card-command'};
      const {workspace, isActive=()=>true} = context;
      if (!isActive() || !isLiveCard(workspace?.messages, input.id)) return {ok:false, reason:'historical-card'};
      const card = liveCard(workspace.messages), definition = definitionFor(card);
      const action = definition?.actions?.[input.action];
      if (!action || !Object.hasOwn(definition.actions,input.action)) return {ok:false, reason:'unsupported-card-action'};
      if (workspace.busy && !action.whileBusy) return {ok:false, reason:'busy'};
      const args = input.args ?? {};
      if (!action.validate(args)) return {ok:false, reason:'invalid-card-arguments'};
      const current = () => isActive() && isLiveCard(workspace.messages,card.id) && liveCard(workspace.messages) === card;
      const commit = effect => { if (!current()) return false; effect(); return true; };
      return action.run({card,workspace,args,current,commit});
    }
  });
}
