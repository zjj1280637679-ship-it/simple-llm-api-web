import {observeCompletion} from './completion-evidence.js';
import {decideCompletion,completionMessage} from './completion-policy.js';

/** SSE framing is independent of network chunks and UTF-8 character boundaries. */
export async function readSSE(response, { signal, onEvent, error, onPhase }) {
  if (!response.body?.getReader) throw error('STREAM_UNSUPPORTED', '供应商没有返回可读取的流；未自动重试。');
  const type = response.headers?.get?.('content-type');
  if (type && !type.toLowerCase().includes('text/event-stream')) throw error('STREAM_UNSUPPORTED', '供应商未返回 SSE 流；未自动切换或重试。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], event = '', done = false, frameBytes = 0, receivedBytes = false;
  const maxFrameBytes = 8 * 1024 * 1024, encoder = new TextEncoder();
  const budget = bytes => { if (bytes > maxFrameBytes) throw error('STREAM_FORMAT','流式数据帧过大。'); };
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once:true});
  const check = () => { if (signal?.aborted) throw error('CANCELLED', '请求已取消；已到达供应商的请求仍可能产生费用。'); };
  function line(value) {
    // Check before storing or dispatching, including a complete frame in one read.
    frameBytes += encoder.encode(value).byteLength + 1;
    budget(frameBytes);
    if (!value) {
      if (data.length) { check(); const value = data.join('\n'); data = []; if (onEvent(value, event) === false) done = true; }
      event = ''; frameBytes = 0; return;
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
    if (!done) { budget(frameBytes + buffer.length); budget(frameBytes + encoder.encode(buffer).byteLength); }
  }
  try {
    check();
    while (!done) {
      const chunk = await reader.read(); check();
      if (chunk.value?.byteLength && !receivedBytes) { receivedBytes = true; onPhase?.('first_chunk'); }
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
export async function collectTextStream(response, {protocol, signal, onDelta, onReasoningDelta, error, onPhase}) {
  if (protocol === 'anthropic') return collectAnthropicStream(response,{signal,onDelta,onReasoningDelta,error,onPhase});
  const gemini = protocol === 'gemini';
  const parts = [], calls = new Map();
  let text = '', finish = null, usage = null, refusal = '', reasoning = '', encrypted = '', ended = false;
  const metadata = {};
  await readSSE(response, {signal,error,onPhase,onEvent(data,event) {
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
        if (typeof part.text === 'string' && part.text.length) onPhase?.(part.thought ? 'reasoning' : 'output');
        if (part.functionCall?.name) onPhase?.('output');
        if (typeof part.text === 'string' && part.thought === true && part.text) onReasoningDelta?.(part.text);
        if (typeof part.text === 'string' && !part.thought) { text += part.text; onDelta?.(part.text); }
      }
    } else {
      if (json.usage) usage = json.usage;
      const choice = json.choices?.find(c => (c.index ?? 0) === 0);
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content.length) onPhase?.('output');
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length) onPhase?.('reasoning');
      // Ark emits a complete opaque block independently, often with empty text.
      // Keep it byte-for-byte; it is neither display text nor a reasoning signal.
      if (typeof delta.encrypted_content === 'string' && delta.encrypted_content.length) {
        if (encrypted && encrypted !== delta.encrypted_content) throw error('STREAM_FORMAT','供应商返回了冲突的加密上下文；未保存残缺回复。');
        encrypted = delta.encrypted_content;
      }
      if (typeof delta.content === 'string') { text += delta.content; onDelta?.(delta.content); }
      if (typeof delta.reasoning_content === 'string') { reasoning += delta.reasoning_content; if (delta.reasoning_content) onReasoningDelta?.(delta.reasoning_content); }
      if (typeof delta.refusal === 'string') refusal += delta.refusal;
      for (const fragment of delta.tool_calls || []) {
        if (fragment.id || fragment.function?.name || fragment.function?.arguments) onPhase?.('output');
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
  const admission=decideCompletion(observeCompletion({protocol,reason:finish,refusal:Boolean(refusal)}),{channel:'sse',terminalObserved:ended});
  if(!admission.admitted)throw error(admission.code,completionMessage(admission));
  if (gemini) return {...metadata,candidates:[{content:{role:'model',parts},finishReason:finish}],usageMetadata:usage};
  const message = {role:'assistant',content:text};
  if (calls.size) message.tool_calls = [...calls].sort(([a],[b]) => a-b).map(([,call]) => call);
  if (refusal) message.refusal = refusal;
  if (reasoning) message.reasoning_content = reasoning;
  if (encrypted) message.encrypted_content = encrypted;
  return {...metadata,choices:[{message,finish_reason:finish}],usage};
}

/** Messages SSE: preserve native block boundaries and opaque thinking signatures. */
async function collectAnthropicStream(response, {signal,onDelta,onReasoningDelta,error,onPhase}) {
  let message = null, ended = false;
  const blocks = new Map(), closed = new Set();
  const malformed = () => error('STREAM_FORMAT','Anthropic 流式事件格式或顺序不正确；未加入历史。');
  await readSSE(response,{signal,error,onPhase,onEvent(data,event) {
    let value;
    try { value = JSON.parse(data); } catch { throw malformed(); }
    if (!value || typeof value !== 'object') throw malformed();
    if (event === 'error' || value.type === 'error' || value.error) throw error('STREAM_ERROR','供应商在流中返回错误；部分回复未完成。');
    switch (value.type) {
      case 'message_start':
        if (message || value.message?.role !== 'assistant' || !Array.isArray(value.message.content) || value.message.content.length) throw malformed();
        message = {...value.message,usage:{...value.message.usage}};
        break;
      case 'content_block_start': {
        if (!message || !Number.isInteger(value.index) || value.index < 0 || blocks.has(value.index)) throw malformed();
        const block = value.content_block;
        if (!['text','thinking','redacted_thinking'].includes(block?.type)) throw error('CONTENT_UNSUPPORTED','Anthropic 返回了尚未支持的内容或工具调用；未加入历史。');
        blocks.set(value.index,{...block});
        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) { onPhase?.('reasoning'); onReasoningDelta?.(block.thinking); }
        if (block.type === 'text' && block.text) { onPhase?.('output'); onDelta?.(block.text); }
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(value.index), delta = value.delta;
        if (!block || closed.has(value.index) || !delta) throw malformed();
        if (delta.type === 'text_delta' && block.type === 'text' && typeof delta.text === 'string') {
          block.text = (block.text || '') + delta.text;
          if (delta.text) { onPhase?.('output'); onDelta?.(delta.text); }
        } else if (delta.type === 'thinking_delta' && block.type === 'thinking' && typeof delta.thinking === 'string') {
          block.thinking = (block.thinking || '') + delta.thinking;
          if (delta.thinking) { onPhase?.('reasoning'); onReasoningDelta?.(delta.thinking); }
        } else if (delta.type === 'signature_delta' && block.type === 'thinking' && typeof delta.signature === 'string') {
          block.signature = (block.signature || '') + delta.signature;
        } else throw error('CONTENT_UNSUPPORTED','Anthropic 返回了尚未支持的内容增量；未加入历史。');
        break;
      }
      case 'content_block_stop':
        if (!blocks.has(value.index) || closed.has(value.index)) throw malformed();
        closed.add(value.index); break;
      case 'message_delta':
        if (!message || closed.size !== blocks.size) throw malformed();
        message = {...message,...value.delta,usage:{...message.usage,...value.usage}}; break;
      case 'message_stop':
        if (!message || closed.size !== blocks.size || !message.stop_reason) throw malformed();
        ended = true; return false;
      // Pings and new top-level event types carry no supported content.
      default: break;
    }
  }});
  if (!ended) throw error('STREAM_INTERRUPTED','Anthropic 流式回复未正常结束；部分内容未加入上下文。');
  const sorted = [...blocks].sort(([a],[b]) => a-b);
  if (sorted.some(([index],i) => index !== i)) throw malformed();
  return {...message,content:sorted.map(([,block]) => block)};
}
