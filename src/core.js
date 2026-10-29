import { getImageCapabilities, normalizeImageOptions, getImageTool } from './image-capabilities.js';
import { recordNetwork, setLogSecrets } from './logs.js';
export { ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_PRO_MODEL, ARK_SIZE_LIMITS, getImageCapabilities, normalizeImageOptions, getImageTool } from './image-capabilities.js';

/** Shared browser/Node transport. No storage, SDK, evaluation, shell, or automatic retry. */
export const DEFAULT_TEXT_MODEL = 'gemini-flash-lite-latest';
export const IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const ARK_TEXT_MODEL = 'doubao-seed-2-1-lite-260915';
// Google GenerateContent table, verified 2026-10-28. 2K/4K are 2x/4x each dimension.
export const aspectRatios = Object.freeze([
  {ratio:'1:1',pixels:[1024,1024]}, {ratio:'1:4',pixels:[512,2048]},
  {ratio:'1:8',pixels:[384,3072]}, {ratio:'2:3',pixels:[848,1264]},
  {ratio:'3:2',pixels:[1264,848]}, {ratio:'3:4',pixels:[896,1200]},
  {ratio:'4:1',pixels:[2048,512]}, {ratio:'4:3',pixels:[1200,896]},
  {ratio:'4:5',pixels:[928,1152]}, {ratio:'5:4',pixels:[1152,928]},
  {ratio:'8:1',pixels:[3072,384]}, {ratio:'9:16',pixels:[768,1376]},
  {ratio:'16:9',pixels:[1376,768]}, {ratio:'21:9',pixels:[1584,672]},
]);
export const imageSizes = Object.freeze(['1K','2K','4K']);
export function imagePixels(ratio, size) {
  const entry = aspectRatios.find(item => item.ratio === ratio);
  const scale = {'1K':1,'2K':2,'4K':4}[size];
  return entry && scale ? entry.pixels.map(value => value * scale).join('×') : '';
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
  if (typeof value !== 'string' || !value.trim() || /[\s\\]/.test(value.trim()))
    fail('ENDPOINT', '请填写不含空白字符的 HTTPS API 基础地址。');
  let url;
  try { url = new URL(value.trim()); } catch { fail('ENDPOINT', 'API 基础地址格式不正确。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    fail('ENDPOINT', 'API 地址必须使用 HTTPS，且不能含用户名、密码、查询参数或片段。');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Deliberately disallow all IP literals and local/private naming. This does not perform DNS
  // resolution: a user must still trust the public hostname they explicitly approve.
  if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(host))
    fail('ENDPOINT', '仅支持公开域名的 HTTPS 地址；不支持 IP、内网或本机地址。');
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function validateEndpoint(config) {
  if (!config || !['gemini','openai','ark'].includes(config.protocol))
    fail('PROTOCOL', '当前仅支持 Gemini 原生、OpenAI 兼容和火山方舟协议。');
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
  const model = String(config.model || '').trim();
  if (!model || model.length > 200) fail('MODEL', '请填写模型 ID。');
  const id = config.protocol === 'gemini' ? model.replace(/^models\//, '') : model;
  if (config.protocol === 'gemini' && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
    fail('MODEL', 'Gemini 模型 ID 格式不正确。');
  return id;
}

/** Network errors deliberately omit upstream bodies/URLs/causes: they can echo credentials. */
let nextRequestId = 0;
async function requestJSON(config, path, {body, signal, fetchImpl = globalThis.fetch} = {}) {
  const base = validateEndpoint(config);
  checkAbort(signal);
  if (typeof fetchImpl !== 'function') fail('FETCH', '运行环境不支持 fetch；请使用现代浏览器或 Node.js 20+。');
  const headers = {Accept:'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (config.protocol === 'gemini') headers['x-goog-api-key'] = config.key.trim();
  else headers.Authorization = `Bearer ${config.key.trim()}`;
  const started = Date.now();
  const event = {
    requestId:`request-${started}-${++nextRequestId}`, startedAt:new Date(started).toISOString(),
    method:body === undefined ? 'GET' : 'POST', endpoint:`${base}${path}`, provider:config.protocol,
    source:fetchImpl === globalThis.fetch ? 'network' : 'mock', requestPayload:body,
    requestHeaders:{Accept:'application/json',...(body === undefined ? {} : {'Content-Type':'application/json'}),[config.protocol === 'gemini' ? 'x-goog-api-key' : 'Authorization']:'[REDACTED]'},
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
      const details = {400:'请求参数或模型能力不匹配。',401:'API Key 无效或已失效。',403:'此 Key 无权访问模型或服务。',404:'API 路径或模型不存在。',408:'供应商请求超时。',429:'额度不足或请求频率受限。'};
      fail('HTTP', `API 请求失败（HTTP ${Number.isInteger(status) ? status : '错误'}）：${details[status] || (status >= 500 ? '供应商暂时不可用。' : '请检查配置和模型支持。')}`, status);
    }
    let json;
    try { json = await response.json(); } catch {
      if (signal?.aborted) throw cancelled();
      fail('RESPONSE', 'API 返回了无法解析的 JSON。');
    }
    checkAbort(signal);
    if (!isRecord(json)) fail('RESPONSE', 'API 响应格式不正确。');
    const responsePayload = config.protocol === 'ark' && path === '/images/generations' && Array.isArray(json.data)
      ? {...json,data:json.data.map(item => isRecord(item) && Object.hasOwn(item,'url') ? {...item,url:'[OMITTED: image URL]'} : item)} : json;
    record({status:response.status,responsePayload,responseHeaders:responseHeaders()});
    return json;
  } catch (error) {
    record({status:error?.code === 'CANCELLED' ? 'cancelled' : response?.status || 'error',responseHeaders:responseHeaders(),error:{code:error?.code || 'REQUEST',message:error instanceof AppError ? error.message : '请求未完成。'}});
    throw error;
  }
}

export async function listModels({config, signal, fetchImpl} = {}) {
  if (config?.protocol === 'ark') fail('MODELS_UNSUPPORTED', '当前未接入火山方舟模型列表接口；请手动填写已开通的模型 ID。');
  // One documented page of up to 1000 Gemini models. Never follow a provider-supplied URL.
  const json = await requestJSON(config, config.protocol === 'gemini' ? '/models?pageSize=1000' : '/models', {signal,fetchImpl});
  const models = config.protocol === 'gemini' ? json.models : json.data;
  if (!Array.isArray(models)) fail('RESPONSE', '模型列表响应格式不正确。');
  return models.filter(isRecord).map(model => config.protocol === 'gemini'
    ? {id:String(model.name || '').replace(/^models\//,''),name:String(model.displayName || model.name || ''),methods:Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.filter(x => typeof x === 'string') : []}
    : {id:String(model.id || ''),name:String(model.id || '')}).filter(model => model.id);
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
  const temperature = numeric(settings.temperature,'温度',0,2);
  const topP = numeric(settings.topP,'Top P',0,1);
  if (max !== undefined) result[protocol === 'gemini' ? 'maxOutputTokens' : 'max_completion_tokens'] = max;
  if (temperature !== undefined) result.temperature = temperature;
  if (topP !== undefined) result[protocol === 'gemini' ? 'topP' : 'top_p'] = topP;
  return result;
}
function nativeMessages(messages, protocol) {
  if (!Array.isArray(messages) || !messages.length) fail('MESSAGES', '没有可发送的消息。');
  return messages.map(message => {
    if (!isRecord(message) || !['user','assistant','tool','system'].includes(message.role))
      fail('MESSAGES','消息历史格式不正确。');
    if (isRecord(message.raw)) {
      if (protocol === 'gemini' && Array.isArray(message.raw.parts)) return message.raw;
      if (['openai','ark'].includes(protocol) && typeof message.raw.role === 'string' && !message.raw.parts) return message.raw;
    }
    if (message.role === 'tool') fail('MESSAGES', '工具历史与当前协议不匹配；请开始新的对话。');
    const text = typeof message.content === 'string' ? message.content : '';
    return protocol === 'gemini'
      ? {role:message.role === 'assistant' ? 'model' : 'user',parts:[{text}]}
      : {role:message.role,content:text};
  });
}
function usageFrom(json, protocol) {
  const usage = protocol === 'gemini' ? json.usageMetadata : json.usage;
  if (!isRecord(usage)) return null;
  const integer = value => Number.isFinite(value) && value >= 0 ? value : null;
  return protocol === 'gemini'
    ? {inputTokens:integer(usage.promptTokenCount),outputTokens:integer(usage.candidatesTokenCount),totalTokens:integer(usage.totalTokenCount),cachedTokens:integer(usage.cachedContentTokenCount)}
    : {inputTokens:integer(usage.prompt_tokens),outputTokens:integer(usage.completion_tokens),totalTokens:integer(usage.total_tokens),cachedTokens:integer(usage.prompt_tokens_details?.cached_tokens)};
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

export async function generateText({config, messages, settings = {}, tools = [], signal, fetchImpl} = {}) {
  validateEndpoint(config);
  const model = modelId(config);
  const generation = settingsBody(settings, config.protocol);
  const systemMessages = config.protocol === 'gemini' && Array.isArray(messages) ? messages.filter(message => message?.role === 'system') : [];
  const history = nativeMessages(config.protocol === 'gemini' && Array.isArray(messages) ? messages.filter(message => message?.role !== 'system') : messages, config.protocol);
  let body;
  if (config.protocol === 'gemini') {
    body = {contents:history,generationConfig:generation};
    if (systemMessages.length) body.systemInstruction = {parts:systemMessages.map(message => ({text:String(message.content || '')}))};
    if (tools.length) body.tools = [{functionDeclarations:tools.map(tool => ({name:tool.name,description:tool.description,parameters:tool.parameters}))}];
  } else {
    body = {model,messages:history,stream:false,...generation};
    if (tools.length) body.tools = tools.map(tool => ({type:'function',function:tool}));
  }
  const json = await requestJSON(config, config.protocol === 'gemini' ? `/models/${model}:generateContent` : '/chat/completions', {body,signal,fetchImpl});
  if (config.protocol === 'gemini') {
    const candidate = geminiCandidate(json);
    const rawAssistant = candidate.content;
    const toolCalls = rawAssistant.parts.filter(part => part.functionCall).map(part => ({
      id:part.functionCall.id || '',name:part.functionCall.name,args:part.functionCall.args || {},
    }));
    const text = rawAssistant.parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('');
    if (!text && !toolCalls.length) fail('EMPTY','模型没有返回文本或工具调用。');
    return {text,toolCalls,rawAssistant,usage:usageFrom(json,config.protocol),finishReason:candidate.finishReason || null};
  }
  const choice = json.choices?.[0];
  const rawAssistant = choice?.message;
  if (!isRecord(rawAssistant)) fail('EMPTY','供应商没有返回对话消息。');
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
  return {text,toolCalls,rawAssistant,usage:usageFrom(json,config.protocol),finishReason:choice.finish_reason || null};
}

export const IMAGE_TOOL = Object.freeze({
  name:'image_generate',
  description:'Generate one image in the image workbench. The user must approve each paid call. Use only when an image is requested. No shell or other commands are available.',
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
export async function generateImage({config, prompt, aspectRatio, imageSize, signal, fetchImpl} = {}) {
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
      body:{model,prompt:prompt.trim(),size:options.size,response_format:'b64_json',output_format:'png'},signal,fetchImpl,
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
    return {images,text:'',usage:usageFrom(json,config.protocol),...options,model};
  }
  const json = await requestJSON(config, `/models/${model}:generateContent`, {
    body:{contents:[{role:'user',parts:[{text:prompt.trim()}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:options.aspectRatio,imageSize:options.imageSize}}},signal,fetchImpl,
  });
  const candidate = geminiCandidate(json);
  const parts = candidate.content.parts;
  const images = parts.filter(part => part.inlineData && !part.thought).map(part => checkedRaster(part.inlineData.mimeType,part.inlineData.data));
  if (!images.length) fail('NO_IMAGE', '供应商没有返回图片；此次请求可能仍计费，请检查提示词、额度或模型响应。');
  return {images,text:parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join(''),usage:usageFrom(json,config.protocol),...options,model};
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
  return generateImage({config:context.imageConfig,...args,signal:context.signal,fetchImpl:context.fetchImpl});
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
