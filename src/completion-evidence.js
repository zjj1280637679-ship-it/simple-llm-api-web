/** 开发态课题：收到的结束标记在当前本地规则中意味着什么？
 * 状态/边界：无持久状态；4协议 + 未知协议；有限标记等价类，原始字符串不穷举。
 * 扩展：扩展 profile 的明确结束集合与反例，不改变接纳策略。
 * 契约：docs/contracts/completion-evidence.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Question: what does the received end marker establish in our local profile?
 * Pure observation -> interpretation. No admission, storage, retry or UI policy.
 * Complete means a recognized protocol ending, never semantic task success.
 * Extension: add an explicit protocol profile and counterexamples, not a wildcard.
 * Ordinary scalar input only; external protocol correctness remains an assumption.
 */
const profiles = Object.freeze({
  gemini: Object.freeze({complete:['STOP'], incomplete:['MAX_TOKENS','SAFETY']}),
  openai: Object.freeze({complete:['stop','tool_calls','function_call'], incomplete:['length','content_filter']}),
  ark: Object.freeze({complete:['stop','tool_calls','function_call'], incomplete:['length','content_filter']}),
  anthropic: Object.freeze({complete:['end_turn','stop_sequence'], incomplete:['max_tokens','refusal']})
});
export function observeCompletion({protocol, reason, refusal = false} = {}) {
  const marker = typeof reason === 'string' && reason ? reason : null;
  const profile = Object.hasOwn(profiles,protocol) ? profiles[protocol] : null;
  let markerClass = 'unrecognized', status = 'unknown';
  if (refusal === true) { markerClass='refusal'; status='refused'; }
  else if (!profile) markerClass='unsupported-protocol';
  else if (reason === undefined || reason === null || reason === '') markerClass='missing';
  else if (typeof reason !== 'string') markerClass='invalid';
  else if (profile.complete.includes(reason)) { markerClass='recognized-complete'; status='complete'; }
  else if (profile.incomplete.includes(reason)) { markerClass='recognized-incomplete'; status='incomplete'; }
  return {status,reason:marker,markerClass,protocol:profile?protocol:'unknown',
    basis:'local-end-marker-profile-v1',goalSatisfied:'unknown'};
}
