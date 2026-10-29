// API-reported telemetry only; see docs/USAGE_METRICS.md for field provenance.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
// Official GenerateContent uses a proto3 scalar: an omitted cached count is zero.
// Apply only to a completed, usable official response; compatible services may differ.
function officialGeminiZero(u, endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && url.hostname === 'generativelanguage.googleapis.com'
      && !Object.hasOwn(u, 'cachedContentTokenCount')
      && count(u.promptTokenCount) !== null && count(u.totalTokenCount) !== null && u.promptTokenCount <= u.totalTokenCount;
  } catch { return false; }
}
export function usageFrom(json, protocol, {endpoint} = {}) {
  const u = protocol === 'gemini' ? json?.usageMetadata : json?.usage;
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  if (protocol === 'anthropic') {
    const uncached = count(u.input_tokens), read = count(u.cache_read_input_tokens), write = count(u.cache_creation_input_tokens), output = count(u.output_tokens);
    const input = [uncached,read,write].every(n => n !== null) ? count(uncached + read + write) : null;
    return {inputTokens:input,outputTokens:output,totalTokens:input !== null && output !== null ? count(input + output) : null,cachedTokens:read,cacheCreationTokens:write};
  }
  return protocol === 'gemini'
    ? {inputTokens:count(u.promptTokenCount),outputTokens:count(u.candidatesTokenCount),totalTokens:count(u.totalTokenCount),cachedTokens:officialGeminiZero(u,endpoint) ? 0 : count(u.cachedContentTokenCount),...(officialGeminiZero(u,endpoint) ? {cacheCountSource:"gemini-proto-default-zero"} : {})}
    : {inputTokens:count(u.prompt_tokens),outputTokens:count(u.completion_tokens),totalTokens:count(u.total_tokens),cachedTokens:count(u.prompt_tokens_details?.cached_tokens)};
}
export function usageMetrics(usage) {
  const input = count(usage?.inputTokens), cached = count(usage?.cachedTokens);
  const ratio = input !== null && input > 0 && cached !== null && cached <= input ? cached / input : null;
  return {
    total: count(usage?.totalTokens) ?? '...',
    cache: cached === null ? '...' : `${cached} Token${ratio === null ? '' : ` · ${(ratio * 100).toFixed(1)}%`}`,
    context: input === null ? '...' : `${input} Token · 窗口 ...`,
    cacheRatio: ratio
  };
}
export function usageMetricsMarkup(usage) {
  const m = usageMetrics(usage);
  return `<span title="上游返回的末次模型请求总量；不是多轮工具任务累计量">词元 <strong>${m.total}</strong></span><span title="末次请求缓存输入 Token ÷ 输入 Token；官方 Gemini 完整用量中省略缓存计数按协议为零；其他缺失显示三个点，输入为零不计算比例">命中 <strong>${m.cache}</strong></span><span title="末次请求的输入 Token，包含上游计入的历史与工具内容；不是当前草稿估算。模型窗口未核实时不计算占用百分比">输入 <strong>${m.context}</strong></span>`;
}

// A clock per model request, never per conversation/tool task. Ignore empty deltas.
export function createTextTiming(now = () => performance.now()) {
  let first = null, last = null, chunks = 0;
  return {
    observe(text) { if (typeof text !== 'string' || !text.length) return; const at = now(); first ??= at; last = at; chunks++; },
    snapshot() { return Object.freeze({chunks, durationMs: chunks > 1 && last > first ? last - first : null}); }
  };
}
// Deliberately conservative: missing reasoning detail is not evidence of zero.
export function visibleOutputTokens(json, protocol, {thinking} = {}) {
  if (protocol === 'gemini') {
    const candidates = json?.candidates;
    if (candidates?.length !== 1 || !candidates[0].content?.parts?.every(p => typeof p.text === 'string')) return null;
    return count(json.usageMetadata?.candidatesTokenCount);
  }
  if (protocol === 'anthropic') {
    if ((thinking && thinking.type !== 'disabled') || !json?.content?.length || !json.content.every(b => b.type === 'text')) return null;
    return count(json.usage?.output_tokens);
  }
  const choices = json?.choices, detail = json?.usage?.completion_tokens_details;
  if (choices?.length !== 1 || choices[0].message?.tool_calls?.length || choices[0].message?.audio || choices[0].message?.refusal) return null;
  const output = count(json.usage?.completion_tokens), reasoning = count(detail?.reasoning_tokens);
  if (output === null || reasoning === null || reasoning > output || (detail?.audio_tokens ?? 0) !== 0 || (detail?.rejected_prediction_tokens ?? 0) !== 0) return null;
  return output - reasoning;
}
export function replyMetricsSnapshot(usage, timing = null, textTokens = null) {
  const durationMs = timing?.durationMs;
  const speed = count(textTokens) !== null && timing?.chunks > 1 && Number.isFinite(durationMs) && durationMs > 0 ? textTokens * 1000 / durationMs : null;
  return Object.freeze({usage:usage ? Object.freeze({...usage}) : null,
    speed:Number.isFinite(speed) ? speed : null,
    textTokens:count(textTokens), durationMs:Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null});
}
export function replyMetricsMarkup(metrics) {
  const speed = typeof metrics?.speed === 'number' && Number.isFinite(metrics.speed) && metrics.speed >= 0 ? `≈ ${metrics.speed.toFixed(1)} Token/s` : '...';
  return usageMetricsMarkup(metrics?.usage) + `<span title="流式到达估算：本次正文输出 Token ÷ 首个至末个非空正文片段的到达间隔，不含首字等待。首片段批量和网络缓冲会带来偏差，并非模型内部实测速率。单片段、缺少用量、思考/工具词元无法可靠分离时显示三个点。">速度 <strong>${speed}</strong></span>`;
}
