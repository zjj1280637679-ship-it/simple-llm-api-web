import { describeTransport } from './transport-evidence.js';
import { readErrorDiagnostic } from './error-diagnostic.js';
import { reasoningBody, isDeepSeekChatEndpoint } from './reasoning.js';
import { collectTextStream } from './stream.js';
import { attachmentParts, attachmentMetadata } from './attachments.js';
import { usageFrom, createTextTiming, visibleOutputTokens, replyMetricsSnapshot } from './usage.js';
import { getImageCapabilities, normalizeImageOptions, getImageTool, GEMINI_CAPABILITY } from './image-capabilities.js';
import { recordNetwork, setLogSecrets, sanitizeLogValue } from './logs.js';
export { ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_PRO_MODEL, ARK_SIZE_LIMITS, getImageCapabilities, normalizeImageOptions, getImageTool } from './image-capabilities.js';

// Memory-only observer for the exact credential used at the transport boundary.
// Does not persist or expose request payloads; consumers decide their local policy.
const credentialUseObservers=new Set();
export function subscribeCredentialUse(observer) { credentialUseObservers.add(observer);return ()=>credentialUseObservers.delete(observer); }
function announceCredentialUse(key) { for(const observer of credentialUseObservers)try{observer(key);}catch{} }

/** Shared browser/Node transport. No storage, SDK, evaluation, shell, or automatic retry. */
export const DEFAULT_TEXT_MODEL = 'gemini-flash-lite-latest';
export const IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const ARK_TEXT_MODEL = 'doubao-seed-2-1-lite-260915';
// Compatibility API derived from the single capability table.
export const aspectRatios = Object.freeze(GEMINI_CAPABILITY.ratios.map(({ratio,pixelsBySize}) =>
  Object.freeze({ratio,pixels:pixelsBySize['1K']})));
export const imageSizes = GEMINI_CAPABILITY.sizes;
export function imagePixels(ratio,size) {
  return GEMINI_CAPABILITY.ratios.find(item=>item.ratio===ratio)?.pixelsBySize[size]?.join('×') || '';
}

export class AppError extends Error {
  constructor(code, message, status) {
    super(message); this.name = 'AppError'; this.code = code;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, message, status) => { throw new AppError(code, message, status); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cancelled = () => new AppError('CANCELLED', '请求已取消；已到达供应商的请求仍可能产生费用。');
function checkAbort(signal) { if (signal?.aborted) throw cancelled(); }

/** URL approval is bound to the full canonical base URL, never just a provider label. */
export function canonicalEndpoint(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || !value.trim() || /[\s\\]/.test(value.trim()))
    fail('ENDPOINT', '请填写不含空白字符的 HTTPS API 基础地址。');
  let url;
  try { url = new URL(value.trim()); } catch { fail('ENDPOINT', 'API 基础地址格式不正确。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    fail('ENDPOINT', 'API 地址必须使用 HTTPS，且不能含用户名、密码、查询参数或片段。');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Current public-web transport profile excludes IP/local names. A local-model
  // host needs its own network/credential policy; this is not a product-wide ban.
  // No DNS resolution or ownership verification is performed here.
  if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(host))
    fail('ENDPOINT', '仅支持公开域名的 HTTPS 地址；不支持 IP、内网或本机地址。');
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function validateEndpoint(config) {
  if (!config || !['gemini','openai','ark','anthropic'].includes(config.protocol))
    fail('PROTOCOL', '当前支持 Gemini、OpenAI、Anthropic Messages 和火山方舟格式。');
  const base = canonicalEndpoint(config.url);
  let approved;
  try { approved = canonicalEndpoint(config.trustedTarget); } catch {
    fail('UNTRUSTED_ENDPOINT', '请先确认此 API 地址；密钥尚未发送。');
  }
  if (base !== approved) fail('UNTRUSTED_ENDPOINT', 'API 地址已改变，请重新确认后再发送密钥。');
  if (typeof config.key !== 'string' || !config.key.trim() || /[\r\n]/.test(config.key))
    fail('KEY', '请填写有效的 API Key。');
  let decoded = base;
  try { decoded = decodeURIComponent(base); } catch { /* URL parser already checked structure. */ }
  if (config.protocol === 'ark' && /\/api\/plan\/v3(?:\/|$|[?#])/i.test(decoded))
    fail('ARK_PLAN_ENDPOINT', '当前接入的是火山方舟普通 API，不支持 Coding Plan 地址；请使用普通 API 基础地址与对应密钥。');
  if (base.includes(config.key.trim()) || decoded.includes(config.key.trim()))
    fail('ENDPOINT', 'API 地址中不能包含密钥；请将密钥只填写在 API Key 字段。');
  return base;
}
function modelId(config) {
  const rawModel = String(config.model || '');
  if (/[\r\n]/.test(rawModel)) fail('MODEL', '模型 ID 不能含换行符。');
  const model = rawModel.trim();
  if (!model || model.length > 200) fail('MODEL', '请填写模型 ID。');
  const id = config.protocol === 'gemini' ? model.replace(/^models\//, '') : model;
  if (config.protocol === 'gemini' && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
    fail('MODEL', 'Gemini 模型 ID 格式不正确。');
  return id;
}

/** Error diagnostics select bounded JSON fields and redact registered credentials.
 * The upstream message remains an unverified report, not a root-cause diagnosis.
 */
let nextRequestId = 0;
async function requestJSON(config, path, {body, logBody, signal, onDelta, onReasoningDelta, onPhase, fetchImpl = globalThis.fetch} = {}) {
  const base = validateEndpoint(config);
  if (config.attachmentContext && logBody === undefined) logBody = {model:config.model, note:'附件会话派生请求；正文不写入日志'};
  checkAbort(signal);
  if (typeof fetchImpl !== 'function') fail('FETCH', '运行环境不支持 fetch；请使用现代浏览器或 Node.js 20+。');
  const headers = {Accept:onDelta ? 'text/event-stream' : 'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (config.protocol === 'gemini') headers['x-goog-api-key'] = config.key.trim();
  else if (config.protocol === 'anthropic') { headers['x-api-key'] = config.key.trim(); headers['anthropic-version'] = '2023-06-01';
    // Official SDK browser opt-in, restricted to the exact official API base.
    if (base === 'https://api.anthropic.com/v1') headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  else headers.Authorization = `Bearer ${config.key.trim()}`;
  const started = Date.now();
  const event = {
    requestId:`request-${started}-${++nextRequestId}`, startedAt:new Date(started).toISOString(),
    method:body === undefined ? 'GET' : 'POST', endpoint:`${base}${path}`, provider:config.protocol,
    source:fetchImpl === globalThis.fetch ? 'network' : 'mock', transport:describeTransport(fetchImpl), requestPayload:logBody ?? body,
    requestHeaders:{Accept:headers.Accept,...(body === undefined ? {} : {'Content-Type':'application/json'}),[config.protocol === 'gemini' ? 'x-goog-api-key' : config.protocol === 'anthropic' ? 'x-api-key' : 'Authorization']:'[REDACTED]'},
  };
  // Diagnostic failures must never affect a request, and credentials never enter log headers.
  try { setLogSecrets([config.key]); } catch { /* Diagnostics are optional. */ }
  const record = details => { try { recordNetwork({...event,durationMs:Date.now() - started,...details}); } catch { /* Never break a request for logging. */ } };
  record({status:'pending'});
  let response;
  const responseHeaders = () => {
    const safe = {};
    for (const name of ['content-type','x-request-id','request-id','x-tt-logid']) {
      try { const value = response?.headers?.get?.(name); if (typeof value === 'string' && value) safe[name] = value; } catch { /* Stub or nonstandard header access cannot affect transport. */ }
    }
    return safe;
  };
  try {
    try {
      onPhase?.('waiting_headers');
      checkAbort(signal);
      announceCredentialUse(config.key.trim());
      response = await fetchImpl(`${base}${path}`, {
        method:event.method, headers,
        ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal,
        redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store', mode:'cors',
      });
    } catch {
      if (signal?.aborted) throw cancelled();
      fail('NETWORK', '连接失败：请检查网络、API 地址及供应商 CORS 设置。重定向不会自动跟随。');
    }
    checkAbort(signal);
    if (!response.ok) {
      const status = response.status;
      const details = {400:'可能与请求参数或模型配置有关。',401:'鉴权未通过，请核对凭据及目标。',403:'请求被拒绝，请核对访问条件。',404:'未找到请求资源，请核对路径及模型。',408:'服务返回请求超时。',429:'可能与请求频率、配额或容量有关。'};
      const diagnostic=await readErrorDiagnostic(response,{sanitize:value=>sanitizeLogValue(value),signal});
      checkAbort(signal);
      record({status,responsePayload:diagnostic,responseHeaders:responseHeaders()});
      const reported=typeof diagnostic?.fields?.message==='string' ? ` 上游说明（未独立核实）：${diagnostic.fields.message}` : '';
      fail('HTTP', `API 请求失败（HTTP ${Number.isInteger(status) ? status : '错误'}）：${details[status] || (status >= 500 ? '服务端返回错误。' : '请检查配置与服务状态。')} 具体原因尚未核实。${reported}`, status);
    }
    onPhase?.('headers_received');
    let json;
    try { json = onDelta ? await collectTextStream(response, {protocol:config.protocol,signal,onDelta,onReasoningDelta,onPhase,error:(code,message)=>new AppError(code,message)}) : await response.json(); } catch (error) {
      if (onDelta && error instanceof AppError) throw error;
      if (signal?.aborted) throw cancelled();
      fail('RESPONSE', 'API 返回了无法解析的 JSON。');
    }
    checkAbort(signal);
    if (!isRecord(json)) fail('RESPONSE', 'API 响应格式不正确。');
    const responsePayload = config.protocol === 'ark' && path === '/images/generations' && Array.isArray(json.data)
      ? {...json,data:json.data.map(item => isRecord(item) && Object.hasOwn(item,'url') ? {...item,url:'[OMITTED: image URL]'} : item)} : json;
    record({status:response.status,responsePayload:logBody ? {omitted:'attachment request response content',usage:responsePayload?.usage || responsePayload?.usageMetadata || null} : responsePayload,responseHeaders:responseHeaders()});
    return json;
  } catch (error) {
    record({status:error?.code === 'CANCELLED' ? 'cancelled' : response?.status || 'error',responseHeaders:responseHeaders(),error:{code:error?.code || 'REQUEST',message:error instanceof AppError ? error.message : '请求未完成。'}});
    throw error;
  }
}

export async function listModels({config, signal, fetchImpl, onPhase} = {}) {
  if (config?.protocol === 'ark') fail('MODELS_UNSUPPORTED', '当前未接入火山方舟模型列表接口；请手动填写已开通的模型 ID。');
  // One documented page of up to 1000 Gemini models. Never follow a provider-supplied URL.
  const json = await requestJSON(config, config.protocol === 'gemini' ? '/models?pageSize=1000' : config.protocol === 'anthropic' ? '/models?limit=1000' : '/models', {signal,fetchImpl,onPhase});
  const models = config.protocol === 'gemini' ? json.models : json.data;
  if (!Array.isArray(models)) fail('RESPONSE', '模型列表响应格式不正确。');
  return models.filter(isRecord).map(model => config.protocol === 'gemini'
    ? {id:String(model.name || '').replace(/^models\//,''),name:String(model.displayName || model.name || ''),methods:Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.filter(x => typeof x === 'string') : []}
    : {id:String(model.id || ''),name:String(model.display_name || model.id || '')}).filter(model => model.id);
}

function settingsBody(settings, protocol) {
  const result = {};
  const output = settings.maxOutputTokens ?? settings.output;
  const numeric = (value, name, min, max, integer=false) => {
    if (value === '' || value === undefined || value === null) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed)))
      fail('SETTINGS', `${name}设置不正确。`);
    return parsed;
  };
  const max = numeric(output,'最大输出 Token',1,1000000,true);
  const temperature = numeric(settings.temperature,'温度',0,protocol === 'anthropic' ? 1 : 2);
  const topP = numeric(settings.topP,'Top P',0,1);
  if (max !== undefined) result[protocol === 'gemini' ? 'maxOutputTokens' : protocol === 'anthropic' ? 'max_tokens' : 'max_completion_tokens'] = max;
  if (temperature !== undefined) result.temperature = temperature;
  if (topP !== undefined) result[protocol === 'gemini' ? 'topP' : 'top_p'] = topP;
  if (protocol === 'anthropic') {
    result.max_tokens ??= 4096;
    if (temperature !== undefined && topP !== undefined) fail('SETTINGS','Anthropic 请仅设置温度或 Top P 其中一项。');
  }
  return result;
}
function nativeMessages(messages, protocol) {
  if (!Array.isArray(messages) || !messages.length) fail('MESSAGES', '没有可发送的消息。');
  return messages.map(message => {
    if (!isRecord(message) || !['user','assistant','tool','system'].includes(message.role))
      fail('MESSAGES','消息历史格式不正确。');
    if (protocol === 'anthropic' && message.role === 'tool') fail('TOOLS_UNSUPPORTED','Anthropic 格式暂不支持工具历史，请开始新对话。');
    if (isRecord(message.raw)) {
      if (protocol === 'anthropic' && message.raw.role === 'assistant' && Array.isArray(message.raw.content)) return {role:'assistant',content:message.raw.content};
      if (protocol === 'gemini' && Array.isArray(message.raw.parts)) return message.raw;
      if (['openai','ark'].includes(protocol) && typeof message.raw.role === 'string' && !message.raw.parts) return message.raw;
    }
    if (message.role === 'tool') fail('MESSAGES', '工具历史与当前协议不匹配；请开始新的对话。');
    const text = typeof message.content === 'string' ? message.content : '';
    const attachments = attachmentParts(message.attachments || [], protocol);
    return protocol === 'gemini'
      ? {role:message.role === 'assistant' ? 'model' : 'user',parts:[...(text || !attachments.length ? [{text}] : []),...attachments]}
      : {role:message.role,content:attachments.length ? [...(text ? [{type:'text',text}] : []),...attachments] : text};
  });
}
function geminiCandidate(json) {
  const candidate = json.candidates?.[0];
  if (!candidate || !Array.isArray(candidate.content?.parts)) {
    if (json.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY')
      fail('BLOCKED', '供应商未返回内容，可能受安全策略限制。');
    fail('EMPTY', '供应商没有返回内容，请检查模型与输出参数。');
  }
  return candidate;
}

function textCompletion(reason, protocol, refusal = false) {
  if (refusal) fail('BLOCKED', '供应商返回了拒绝标记；未执行工具或提交为完整回复。');
  // Missing metadata remains unknown for existing compatible JSON endpoints.
  // An explicit failure/truncation cannot become success merely because text parses.
  if (reason === undefined || reason === null || reason === '') return {status:'unknown',reason:null};
  const accepted = protocol === 'gemini' ? ['STOP'] : protocol === 'anthropic'
    ? ['end_turn','stop_sequence'] : ['stop','tool_calls','function_call'];
  if (!accepted.includes(reason)) fail('RESPONSE_INCOMPLETE', '供应商返回了未完整结束或当前未识别的结束标记；未执行工具或提交为完整回复。');
  return {status:'complete',reason};
}

export async function generateText({config, messages, settings = {}, tools = [], signal, fetchImpl, onDelta, onReasoningDelta, onPhase, now} = {}) {
  validateEndpoint(config);
  const timing = createTextTiming(now);
  const observedDelta = onDelta ? delta => { timing.observe(delta); onDelta(delta); } : undefined;
  const model = modelId(config);
  if (config.protocol === 'anthropic' && tools.length) fail('TOOLS_UNSUPPORTED','Anthropic 格式暂不支持工具调用。');
  const generation = settingsBody(settings, config.protocol);
  // DeepSeek shares the Chat format, not OpenAI's output-budget field.
  if (isDeepSeekChatEndpoint(config) && generation.max_completion_tokens !== undefined) {
    generation.max_tokens = generation.max_completion_tokens;
    delete generation.max_completion_tokens;
  }
  const systemMessages = ['gemini','anthropic'].includes(config.protocol) && Array.isArray(messages) ? messages.filter(message => message?.role === 'system') : [];
  const history = nativeMessages(['gemini','anthropic'].includes(config.protocol) && Array.isArray(messages) ? messages.filter(message => message?.role !== 'system') : messages, config.protocol);
  let body;
  if (config.protocol === 'gemini') {
    body = {contents:history,generationConfig:generation};
    if (systemMessages.length) body.systemInstruction = {parts:systemMessages.map(message => ({text:String(message.content || '')}))};
    if (tools.length) body.tools = [{functionDeclarations:tools.map(tool => ({name:tool.name,description:tool.description,parameters:tool.parameters}))}];
  } else if (config.protocol === 'anthropic') {
    body = {model,messages:history,stream:typeof onDelta === 'function',...generation};
    if (systemMessages.length) body.system = systemMessages.map(message => ({type:'text',text:String(message.content || '')}));
  } else {
    body = {model,messages:history,stream:typeof onDelta === 'function',...(onDelta ? {stream_options:{include_usage:true}} : {}),...generation};
    if (tools.length) body.tools = tools.map(tool => ({type:'function',function:tool}));
  }
  let thinkingControls;try {thinkingControls=reasoningBody(config,settings.reasoning,settings);}catch(error){fail('REASONING_SETTINGS',error.message);}
  if (thinkingControls.generationConfig) body.generationConfig = {...body.generationConfig,...thinkingControls.generationConfig};
  else Object.assign(body,thinkingControls);
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 16 * 1024 * 1024) fail('ATTACHMENT_LIMIT','对话附件累计过大，请清空对话后重新添加。');
  const chatPath = new URL(config.url).pathname.replace(/\/+$/, '').endsWith('/chat/completions') ? '' : '/chat/completions';
  const json = await requestJSON(config, config.protocol === 'gemini' ? `/models/${model}:${onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent'}` : config.protocol === 'anthropic' ? '/messages' : chatPath, {body,signal,fetchImpl,onDelta:observedDelta,onReasoningDelta,onPhase, logBody: messages.some(m => m.attachments?.length) ? {model, note:'包含附件；请求正文不写入日志', messages:messages.map(m => ({role:m.role,attachments:attachmentMetadata(m.attachments)}))} : undefined});
  const complete = response => ({...response, metrics:replyMetricsSnapshot(response.usage, timing.snapshot(), visibleOutputTokens(json,config.protocol,{thinking:body.thinking}))});
  if (config.protocol === 'gemini') {
    const candidate = geminiCandidate(json);
    const completion = textCompletion(candidate.finishReason, 'gemini', Boolean(json.promptFeedback?.blockReason));
    const rawAssistant = candidate.content;
    const toolCalls = rawAssistant.parts.filter(part => part.functionCall).map(part => ({
      id:part.functionCall.id || '',name:part.functionCall.name,args:part.functionCall.args || {},
    }));
    const text = rawAssistant.parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('');
    if (!text && !toolCalls.length) fail('EMPTY','模型没有返回文本或工具调用。');
    return complete({text,toolCalls,rawAssistant,usage:usageFrom(json,config.protocol,{endpoint:config.url}),finishReason:candidate.finishReason || null,completion});
  }
  if (config.protocol === 'anthropic') {
    if (json.role !== 'assistant' || !Array.isArray(json.content)) fail('RESPONSE','Anthropic 响应格式不正确。');
    if (json.content.some(block => !['text','thinking','redacted_thinking'].includes(block?.type))) fail('CONTENT_UNSUPPORTED','Anthropic 返回了尚未支持的内容或工具调用；未加入历史。');
    if (!['end_turn','stop_sequence'].includes(json.stop_reason)) fail('STREAM_INCOMPLETE','Anthropic 回复未完整结束；未加入历史。');
    const text = json.content.filter(block => block.type === 'text').map(block => block.text || '').join('');
    if (!text) fail('EMPTY','模型没有返回文本。');
    return complete({text,toolCalls:[],rawAssistant:{role:'assistant',content:json.content},usage:usageFrom(json,'anthropic'),finishReason:json.stop_reason,completion:textCompletion(json.stop_reason,'anthropic')});
  }
  const choice = json.choices?.[0];
  const rawAssistant = choice?.message;
  if (!isRecord(rawAssistant)) fail('EMPTY','供应商没有返回对话消息。');
  const completion = textCompletion(choice.finish_reason, config.protocol, Boolean(rawAssistant.refusal));
  const text = typeof rawAssistant.content === 'string' ? rawAssistant.content : '';
  const toolCalls = (Array.isArray(rawAssistant.tool_calls) ? rawAssistant.tool_calls : []).map(call => {
    if (call.type !== 'function' || !isRecord(call.function)) fail('TOOL_FORMAT','模型返回了不支持的工具调用格式。');
    let args;
    try { args = JSON.parse(call.function.arguments); } catch { fail('TOOL_FORMAT','模型返回了无效的工具 JSON 参数；未执行工具。'); }
    return {id:call.id || '',name:call.function.name,args};
  });
  if (!text && !toolCalls.length) {
    if (rawAssistant.refusal || choice.finish_reason === 'content_filter') fail('BLOCKED','供应商未返回内容，可能受安全策略限制。');
    fail('EMPTY','模型没有返回文本或工具调用。');
  }
  return complete({text,toolCalls,rawAssistant,usage:usageFrom(json,config.protocol,{endpoint:config.url}),finishReason:choice.finish_reason || null,completion});
}

export const IMAGE_TOOL = Object.freeze({
  name:'image_generate',
  description:'Generate one image in the configured image workbench when it serves the requested task. This host obtains approval for each call that may consume API quota. Other commands are not registered in this host.',
  parameters:{type:'object',properties:{
    prompt:{type:'string',description:'Complete description of the image to generate.'},
    aspectRatio:{type:'string',enum:aspectRatios.map(item => item.ratio)},
    imageSize:{type:'string',enum:[...imageSizes]},
  },required:['prompt']},
});

function checkedRaster(mimeType, data) {
  if (!['image/png','image/jpeg','image/webp'].includes(mimeType) || typeof data !== 'string' || !data.length || data.length > 80000000 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    fail('IMAGE_DATA', '供应商返回了不支持或损坏的图片数据。');
  let prefix;
  try { prefix = atob(data.slice(0, 32)); } catch { fail('IMAGE_DATA', '供应商返回了无法解码的图片数据。'); }
  const bytes = [...prefix].map(character => character.charCodeAt(0));
  const matches = (signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  const valid = mimeType === 'image/png' ? matches([137,80,78,71,13,10,26,10])
    : mimeType === 'image/jpeg' ? matches([255,216,255])
    : matches([82,73,70,70]) && matches([87,69,66,80], 8);
  if (!valid) fail('IMAGE_DATA', '供应商返回的图片内容与格式不匹配。');
  return {mimeType,data};
}
export async function generateImage({config, prompt, aspectRatio, imageSize, signal, fetchImpl, onPhase} = {}) {
  validateEndpoint(config);
  const model = modelId(config);
  let options;
  try { options = normalizeImageOptions(config,{aspectRatio,imageSize}); } catch (error) {
    fail(error.code || 'IMAGE_OPTIONS',error.message);
  }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 30000)
    fail('PROMPT', '图片提示词应为 1–30000 个字符。');
  if (config.protocol === 'ark') {
    const json = await requestJSON(config,'/images/generations',{
      body:{model,prompt:prompt.trim(),size:options.size,response_format:'b64_json',output_format:'png'},signal,fetchImpl,onPhase,
    });
    if (!Array.isArray(json.data) || !json.data.length) fail('NO_IMAGE','供应商没有返回图片；此次请求可能仍计费，请检查模型、额度或响应。');
    const images = json.data.map(item => {
      if (!isRecord(item)) fail('IMAGE_DATA','供应商返回的图片记录格式不正确。');
      if (!item.b64_json && typeof item.url === 'string')
        fail('IMAGE_URL_ONLY','供应商仅返回图片链接，未按请求返回图片数据；本页未下载或重新生成，此次请求可能已计费。');
      const mimeType = {png:'image/png',jpeg:'image/jpeg',jpg:'image/jpeg',webp:'image/webp'}[item.output_format || 'png'];
      const image = checkedRaster(mimeType,item.b64_json);
      if (typeof item.size === 'string' && /^[0-9]{1,6}x[0-9]{1,6}$/.test(item.size)) image.size = item.size;
      return image;
    });
    return {images,text:'',usage:usageFrom(json,config.protocol,{endpoint:config.url}),...options,model};
  }
  const json = await requestJSON(config, `/models/${model}:generateContent`, {
    body:{contents:[{role:'user',parts:[{text:prompt.trim()}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:options.aspectRatio,imageSize:options.imageSize}}},signal,fetchImpl,onPhase,
  });
  const candidate = geminiCandidate(json);
  const parts = candidate.content.parts;
  const images = parts.filter(part => part.inlineData && !part.thought).map(part => checkedRaster(part.inlineData.mimeType,part.inlineData.data));
  if (!images.length) fail('NO_IMAGE', '供应商没有返回图片；此次请求可能仍计费，请检查提示词、额度或模型响应。');
  return {images,text:parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join(''),usage:usageFrom(json,config.protocol,{endpoint:config.url}),...options,model};
}

/** The only executable command. API keys/endpoint/model cannot come from model tool arguments. */
export async function dispatchCommand(command, context = {}) {
  if (!isRecord(command) || command.command !== 'image.generate' || Object.keys(command).some(key => !['command','args'].includes(key)))
    fail('COMMAND', '不支持此命令；仅允许 image.generate。');
  const args = command.args;
  if (!isRecord(args) || Object.keys(args).some(key => !['prompt','aspectRatio','imageSize'].includes(key)))
    fail('COMMAND_ARGS', '图片命令参数不正确；不接受地址、密钥、模型或任意代码。');
  if (context.confirmed !== true) fail('CONFIRMATION', '图片调用尚未获得用户确认；未发送请求。');
  checkAbort(context.signal);
  return generateImage({config:context.imageConfig,...args,signal:context.signal,fetchImpl:context.fetchImpl,onPhase:context.onPhase});
}

/** Supply a compact non-secret result summary here, never image bytes or configuration. */
export function makeToolResult(config, call, result) {
  const content = JSON.stringify(result);
  if (config.protocol === 'gemini') {
    const functionResponse = {name:call.name,response:result};
    if (call.id) functionResponse.id = call.id;
    return {role:'tool',name:call.name,tool_call_id:call.id,content,raw:{role:'user',parts:[{functionResponse}]}};
  }
  return {role:'tool',name:call.name,tool_call_id:call.id,content,raw:{role:'tool',tool_call_id:call.id,content}};
}
