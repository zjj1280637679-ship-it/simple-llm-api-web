/** SSE framing is independent of network chunks and UTF-8 character boundaries. */
export async function readSSE(response, { signal, onEvent, error }) {
  if (!response.body?.getReader) throw error('STREAM_UNSUPPORTED', '供应商没有返回可读取的流；未自动重试。');
  const type = response.headers?.get?.('content-type');
  if (type && !type.toLowerCase().includes('text/event-stream')) throw error('STREAM_UNSUPPORTED', '供应商未返回 SSE 流；未自动切换或重试。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], event = '', done = false;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once:true});
  const check = () => { if (signal?.aborted) throw error('CANCELLED', '请求已取消；已到达供应商的请求仍可能产生费用。'); };
  function line(value) {
    if (!value) {
      if (data.length) { check(); const value = data.join('\n'); data = []; if (onEvent(value, event) === false) done = true; }
      event = ''; return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0,colon);
    let valueText = colon < 0 ? '' : value.slice(colon+1);
    if (valueText.startsWith(' ')) valueText = valueText.slice(1);
    if (field === 'data') data.push(valueText);
    if (field === 'event') event = valueText;
  }
  function drain(final = false) {
    for (;;) {
      const match = /[\r\n]/.exec(buffer);
      if (!match) break;
      const i = match.index;
      if (!final && buffer[i] === '\r' && i === buffer.length-1) break;
      const length = buffer[i] === '\r' && buffer[i+1] === '\n' ? 2 : 1;
      const value = buffer.slice(0,i); buffer = buffer.slice(i+length); line(value);
      if (done) break;
    }
    if (buffer.length > 8 * 1024 * 1024 || data.join('\n').length > 8 * 1024 * 1024) throw error('STREAM_FORMAT','流式数据帧过大。');
  }
  try {
    check();
    while (!done) {
      const chunk = await reader.read(); check();
      buffer += decoder.decode(chunk.value, {stream:!chunk.done}); drain(chunk.done);
      if (chunk.done) { if (buffer) line(buffer); line(''); break; }
    }
  } catch (caught) {
    check();
    if (caught?.code) throw caught;
    throw error('STREAM_INTERRUPTED','流式连接中断；部分回复未完成，未自动重试。');
  } finally {
    signal?.removeEventListener('abort', abort);
    try { await reader.cancel(); } catch { /* Already closed. */ }
    reader.releaseLock();
  }
}

/** Build the same native assistant shape as the nonstream transport. */
export async function collectTextStream(response, {protocol, signal, onDelta, error}) {
  const gemini = protocol === 'gemini';
  const parts = [], calls = new Map();
  let text = '', finish = null, usage = null, refusal = '', reasoning = '', ended = false;
  const metadata = {};
  await readSSE(response, {signal,error,onEvent(data,event) {
    if (event === 'error') throw error('STREAM_ERROR','供应商在流中返回错误；部分回复未完成。');
    if (data.trim() === '[DONE]') { ended = true; return false; }
    let json;
    try { json = JSON.parse(data); } catch { throw error('STREAM_FORMAT','供应商返回了无效的流式 JSON。'); }
    if (!json || typeof json !== 'object' || json.error) throw error('STREAM_ERROR','供应商在流中返回错误；部分回复未完成。');
    for (const key of (gemini ? ['modelVersion','responseId','createTime'] : ['id','model','created','object','system_fingerprint','service_tier'])) {
      if (json[key] !== undefined) metadata[key] = json[key];
    }
    if (gemini) {
      if (json.usageMetadata) usage = json.usageMetadata;
      if (json.promptFeedback?.blockReason) throw error('BLOCKED','供应商未返回内容，可能受安全策略限制。');
      const candidate = json.candidates?.find(c => (c.index ?? 0) === 0);
      if (!candidate) return;
      if (candidate.finishReason) finish = candidate.finishReason;
      for (const part of candidate.content?.parts || []) {
        // Preserve native boundaries/signatures, including opaque thought parts.
        parts.push(part);
        if (typeof part.text === 'string' && !part.thought) { text += part.text; onDelta?.(part.text); }
      }
    } else {
      if (json.usage) usage = json.usage;
      const choice = json.choices?.find(c => (c.index ?? 0) === 0);
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string') { text += delta.content; onDelta?.(delta.content); }
      if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
      if (typeof delta.refusal === 'string') refusal += delta.refusal;
      for (const fragment of delta.tool_calls || []) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0) throw error('TOOL_FORMAT','工具调用缺少有效索引；未执行工具。');
        const call = calls.get(fragment.index) || {id:'',type:'function',function:{name:'',arguments:''}};
        if (fragment.id) call.id += fragment.id;
        if (fragment.type) call.type = fragment.type;
        if (fragment.function?.name) call.function.name += fragment.function.name;
        if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
        calls.set(fragment.index,call);
      }
    }
  }});
  if (!finish || (!gemini && !ended)) throw error('STREAM_INTERRUPTED','流式回复未正常结束；部分内容未加入对话上下文。');
  if (!['STOP','stop','tool_calls','function_call'].includes(finish)) throw error('STREAM_INCOMPLETE','模型未完整结束回复（可能达到输出限制或被拦截）；部分内容未加入对话上下文。');
  if (gemini) return {...metadata,candidates:[{content:{role:'model',parts},finishReason:finish}],usageMetadata:usage};
  const message = {role:'assistant',content:text};
  if (calls.size) message.tool_calls = [...calls].sort(([a],[b]) => a-b).map(([,call]) => call);
  if (refusal) message.refusal = refusal;
  if (reasoning) message.reasoning_content = reasoning;
  return {...metadata,choices:[{message,finish_reason:finish}],usage};
}
