// API-reported telemetry only; see docs/USAGE_METRICS.md for field provenance.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function usageFrom(json, protocol) {
  const u = protocol === 'gemini' ? json?.usageMetadata : json?.usage;
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  return protocol === 'gemini'
    ? {inputTokens:count(u.promptTokenCount),outputTokens:count(u.candidatesTokenCount),totalTokens:count(u.totalTokenCount),cachedTokens:count(u.cachedContentTokenCount)}
    : {inputTokens:count(u.prompt_tokens),outputTokens:count(u.completion_tokens),totalTokens:count(u.total_tokens),cachedTokens:count(u.prompt_tokens_details?.cached_tokens)};
}
export function usageMetrics(usage) {
  const input = count(usage?.inputTokens), cached = count(usage?.cachedTokens);
  const ratio = input !== null && input > 0 && cached !== null && cached <= input ? cached / input : null;
  return {
    total: count(usage?.totalTokens) ?? '未知',
    cache: cached === null ? '未知' : `${cached} Token${ratio === null ? '' : ` · ${(ratio * 100).toFixed(1)}%`}`,
    context: `${input === null ? '未知' : input} Token · 窗口未知`,
    cacheRatio: ratio
  };
}
export function usageMetricsMarkup(usage) {
  const m = usageMetrics(usage);
  return `<span title="上游返回的末次模型请求总量；不是多轮工具任务累计量">末次请求 Token <strong>${m.total}</strong></span><span title="末次请求缓存输入 Token ÷ 输入 Token；未返回字段显示未知，输入为零不计算比例">缓存命中 <strong>${m.cache}</strong></span><span title="末次请求的输入 Token，包含上游计入的历史与工具内容；不是当前草稿估算。模型窗口未核实时不计算占用百分比">上下文（末次输入） <strong>${m.context}</strong></span>`;
}
