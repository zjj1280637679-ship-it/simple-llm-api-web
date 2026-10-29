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
