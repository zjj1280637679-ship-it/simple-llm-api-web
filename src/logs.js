/** In-memory, bounded communication diagnostics. No storage or uploads. */
const REDACTED = '[REDACTED]';
const MAX_EVENTS = 100;
const MAX_STRING = 8000;
const MAX_EVENT_CHARS = 64000;
const secrets = new Set();
let activeSecrets = new Set();
const entries = [];
const listeners = new Set();
let sequence = 0;
const sensitive = /^(?:authorization|proxy-authorization|cookie|set-cookie|.*api[-_]?key|key|token|.*[-_]token|accessToken|refreshToken|password|passwd|secret|client_secret|signature|sig|x-amz-.*|x-goog-signature|credential|thoughtSignature|thought_signature|encrypted_content)$/i;

/** Register credentials before a request. Earlier keys remain protected until page close. */
export function setLogSecrets(values = []) {
  let changed = false;
  for (const value of values) if (typeof value === 'string' && value.trim() && !secrets.has(value.trim())) { secrets.add(value.trim()); changed = true; }
  // A credential may have appeared in an earlier prompt, before it became a key.
  if (!changed) return;
  for (let index = 0; index < entries.length; index++) entries[index] = sanitizeLogValue(entries[index], { includeActive: false, preserveRootKeys: true });
}
/** Current editable credentials; typing prefixes must not become permanent secrets. */
export function updateActiveLogSecrets(values = []) {
  const next = new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
  activeSecrets = next;
}
function scrub(value, includeActive = true) {
  let result = value;
  for (const secret of [...new Set([...secrets, ...(includeActive ? activeSecrets : [])])].sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      result = result.split(form).join(REDACTED);
    }
    // URL percent-escape hex digits are case-insensitive; credential letters are not.
    const pattern = encodeURIComponent(secret).match(/%[0-9A-F]{2}|[\s\S]/g).map(part =>
      part.startsWith('%') && part.length === 3
        ? part.replace(/[A-F]/g, letter => `[${letter}${letter.toLowerCase()}]`)
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('');
    result = result.replace(new RegExp(pattern, 'g'), REDACTED);
  }
  return result
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:[^=&\s]*api[-_]?key|key|token|access_token|secret|password|signature|sig|x-amz-[^=&\s]+|x-goog-signature|credential)=)[^&#\s"']*/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
}

/** Safe JSON-compatible copy; never retains live request objects or binary bodies. */
export function sanitizeLogValue(value, { includeActive = true, preserveRootKeys = false } = {}) {
  const cleanText = value => scrub(value, includeActive);
  const seen = new WeakSet();
  let budget = MAX_EVENT_CHARS;
  function walk(item, key = '', depth = 0, parentKey = '') {
    // Reserve JSON punctuation, primitive values and omission markers for every node.
    // Text is charged at its worst-case JSON escape cost (six characters).
    if (budget < 128) return '[TRUNCATED: event size limit]';
    budget -= 128;
    if (sensitive.test(key)) return REDACTED;
    if (item == null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item === 'string') {
      if (/^data:[^,]*;base64,/i.test(item) || /^(?:b64_json|base64)$/i.test(key) || key === 'data' && (/^inline_?data$/i.test(parentKey) || item.length > 256 && /^[A-Za-z0-9+/=\r\n]+$/.test(item))) {
        return { omitted: 'base64', characters: item.length, mimeType: cleanText(item.match(/^data:([^;,]+)/i)?.[1] || 'unspecified') };
      }
      const clean = cleanText(item);
      const limit = Math.min(MAX_STRING, Math.floor(budget / 6));
      budget -= Math.min(clean.length, limit) * 6;
      return clean.length > limit ? `${clean.slice(0, limit)}\n[TRUNCATED: ${clean.length} characters]` : clean;
    }
    if (typeof item !== 'object') return `[${typeof item}]`;
    if (depth >= 12) return '[TRUNCATED: depth limit]';
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (item instanceof Error) return walk({ name: item.name, code: item.code, message: item.message }, '', depth + 1);
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return { omitted: 'binary', bytes: item.byteLength };
    if (typeof Blob !== 'undefined' && item instanceof Blob) return { omitted: 'binary', bytes: item.size, mimeType: cleanText(item.type) };
    if (typeof Headers !== 'undefined' && item instanceof Headers) return walk(Object.fromEntries(item), '', depth + 1);
    if (Array.isArray(item)) {
      const result = [];
      for (const child of item.slice(0, 100)) {
        if (budget < 128) { result.push('[TRUNCATED: event size limit]'); break; }
        result.push(walk(child, '', depth + 1));
      }
      if (item.length > 100 && budget >= 128) { budget -= 128; result.push(`[TRUNCATED: ${item.length} items]`); }
      return result;
    }
    const result = Object.create(null);
    const keys = Object.keys(item);
    for (const field of keys.slice(0, 100)) {
      if (budget < 1400) { result._truncated = 'event size limit'; break; }
      const safeKey = preserveRootKeys && depth === 0 ? field : cleanText(field).slice(0, 200);
      budget -= safeKey.length * 6 + 4;
      result[safeKey] = item.type === 'redacted_thinking' && field === 'data' ? REDACTED : walk(item[field], field, depth + 1, key);
    }
    if (keys.length > 100) result._truncated = `${keys.length} fields`;
    return result;
  }
  return walk(value);
}

/** Called by the transport at the real fetch boundary, never by demo rendering. */
export function recordNetwork(event = {}) {
  setLogSecrets(event.secrets || []);
  const prior = event.requestId && entries.find(entry => entry.requestId === event.requestId);
  if (prior) event = { ...prior, ...event };
  const clean = sanitizeLogValue({
    requestId: event.requestId || `local-${++sequence}`,
    source: event.source === 'network' ? 'network' : event.source === 'mock' ? 'mock' : 'unknown',
    provider: event.provider ?? null,
    startedAt: event.startedAt ?? null,
    durationMs: event.durationMs ?? null,
    status: event.status ?? null,
    method: event.method ?? null,
    endpoint: event.endpoint ?? null,
    requestHeaders: event.requestHeaders ?? null,
    requestPayload: event.requestPayload ?? null,
    responseHeaders: event.responseHeaders ?? null,
    responsePayload: event.responsePayload ?? null,
    error: event.error ?? null,
  }, { includeActive: false, preserveRootKeys: true });
  const index = entries.findIndex(entry => entry.requestId === clean.requestId);
  if (index >= 0) entries[index] = clean;
  else entries.push(clean);
  if (entries.length > MAX_EVENTS) entries.splice(0, entries.length - MAX_EVENTS);
  for (const listener of listeners) { try { listener(); } catch { /* Diagnostics cannot fail requests. */ } }
  return sanitizeLogValue(clean.requestId);
}
export function getNetworkLogs() { return JSON.parse(JSON.stringify(entries.map(entry => sanitizeLogValue(entry, { preserveRootKeys: true })))); }
export function clearNetworkLogs() {
  entries.length = 0;
  for (const listener of listeners) { try { listener(); } catch { /* UI isolation */ } }
}
export function subscribeNetworkLogs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function exportNetworkLogs() {
  return JSON.stringify({ format: 'llm-network-log-v1', note: 'Sanitized, truncated diagnostics; memory only. Payloads may contain private conversation data.', entries: getNetworkLogs() }, null, 2);
}

/** All provider-controlled text goes through textContent, not HTML. */
export function renderNetworkLogs(container) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const note = doc.createElement('p');
  note.textContent = '真实网络通讯与模拟记录分别标注。仅保存在当前页面内存，最多 100 条；密钥已脱敏，大内容会截断。导出仍可能包含私人对话，请谨慎分享。';
  container.append(note);
  if (!entries.length) {
    const empty = doc.createElement('p');
    empty.textContent = '暂无通讯记录。发送请求后显示；不会生成示例日志。';
    container.append(empty);
  }
  for (const entry of getNetworkLogs().reverse()) {
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    const origin = { network: '真实网络', mock: '模拟 / 测试', unknown: '来源未验证' }[entry.source];
    summary.textContent = `${origin} · ${entry.method || '—'} ${entry.endpoint || '—'} · ${entry.status ?? '—'} · ${entry.durationMs ?? '—'} ms`;
    const pre = doc.createElement('pre');
    pre.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, pre);
    container.append(details);
  }
}
