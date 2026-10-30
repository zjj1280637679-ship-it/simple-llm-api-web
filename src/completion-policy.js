/** 开发态课题：哪种结束证据在当前入口可被接纳？
 * 状态/边界：无持久状态；JSON/SSE、terminal布尔值、规范化证据等价类。
 * 扩展：扩展宿主策略先明确场景、代价、复核触发，不修改证据含义。
 * 契约：docs/contracts/completion-policy.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Question: may this host commit/use a response with this completion evidence?
 * This is policy D-08, separate from marker interpretation. Missing JSON markers
 * are currently tolerated for Gemini/Chat compatibility, while staying unknown.
 * SSE requires its framing witness; Anthropic JSON currently requires a known end.
 * Unknown future markers are held for profile review, not called impossible.
 */
export function decideCompletion(evidence, {channel='json',terminalObserved=false} = {}) {
  const sse = channel === 'sse';
  const policyId = sse ? 'completion.sse.v1' : 'completion.json-compat.v1';
  const hold=(code,reason)=>({admitted:false,code,reason,policyId});
  if (!['json','sse'].includes(channel)) return hold('COMPLETION_POLICY','unknown-channel');
  if (evidence?.markerClass === 'refusal') return hold('BLOCKED','explicit-refusal');
  if (!['gemini','openai','ark','anthropic'].includes(evidence?.protocol)) return hold('COMPLETION_POLICY','unsupported-profile');
  if (sse && (evidence.markerClass==='missing' || (evidence.protocol!=='gemini' && terminalObserved!==true)))
    return hold('STREAM_INTERRUPTED','missing-framing-or-ending-witness');
  if (evidence.status==='complete' && evidence.markerClass==='recognized-complete')
    return {admitted:true,code:null,reason:'recognized-protocol-ending',policyId};
  if (!sse && evidence.protocol!=='anthropic' && evidence.status==='unknown' && evidence.markerClass==='missing')
    return {admitted:true,code:null,reason:'compatibility-with-unknown-ending',policyId};
  return hold(sse || evidence.protocol==='anthropic' ? 'STREAM_INCOMPLETE' : 'RESPONSE_INCOMPLETE',
    evidence.markerClass==='recognized-incomplete' ? 'reported-incomplete' : 'marker-not-covered-by-current-profile');
}

export function completionMessage(decision) {
  if (decision.code==='BLOCKED') return '供应商返回了拒绝标记；未执行工具或提交为完整回复。';
  if (decision.code==='STREAM_INTERRUPTED') return '流式回复缺少完整结束证据；部分内容未加入对话上下文。';
  if (decision.reason==='reported-incomplete') return '供应商报告回复未完整结束；未执行工具或提交为完整回复。';
  return '当前结束标记或响应条件未被本地规则覆盖；未执行工具或提交为完整回复。';
}
