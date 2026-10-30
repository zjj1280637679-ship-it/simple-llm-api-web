import {AppError} from './app-error.js';
import {canonicalEndpoint,validateEndpoint} from './api-target.js';
import {requestJSON} from './request-transport.js';
import {observeCompletion} from './completion-evidence.js';
import {decideCompletion,completionMessage} from './completion-policy.js';
export {AppError} from './app-error.js';
export {canonicalEndpoint,validateEndpoint} from './api-target.js';
export {subscribeCredentialUse} from './request-transport.js';
import { reasoningBody, isDeepSeekChatEndpoint } from './reasoning.js';
import { attachmentParts, attachmentMetadata } from './attachments.js';
import { usageFrom, createTextTiming, visibleOutputTokens, replyMetricsSnapshot } from './usage.js';
import { getImageCapabilities, normalizeImageOptions, getImageTool, GEMINI_CAPABILITY } from './image-capabilities.js';
export { ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_PRO_MODEL, ARK_SIZE_LIMITS, getImageCapabilities, normalizeImageOptions, getImageTool } from './image-capabilities.js';

/** Protocol/business facade shared by browser and CLI. Transport, target policy
 * and completion judgments have separate owners; re-exports preserve callers. */
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

const fail = (code, message, status) => { throw new AppError(code, message, status); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cancelled = () => new AppError('CANCELLED', '请求已取消；已到达供应商的请求仍可能产生费用。');
function checkAbort(signal) { if (signal?.aborted) throw cancelled(); }

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

/** Interpret first, then apply the current JSON compatibility policy. */
function textCompletion(reason,protocol,refusal=false) {
  const evidence=observeCompletion({protocol,reason,refusal});
  const decision=decideCompletion(evidence);
  if(!decision.admitted)fail(decision.code,completionMessage(decision));
  return {...evidence,admission:decision};
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
    const completion=textCompletion(json.stop_reason,'anthropic');
    const text = json.content.filter(block => block.type === 'text').map(block => block.text || '').join('');
    if (!text) fail('EMPTY','模型没有返回文本。');
    return complete({text,toolCalls:[],rawAssistant:{role:'assistant',content:json.content},usage:usageFrom(json,'anthropic'),finishReason:json.stop_reason,completion});
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
