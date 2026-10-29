import {
  AppError, canonicalEndpoint, dispatchCommand, generateText, getImageTool, makeToolResult, normalizeImageOptions,
} from './core.js';

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 4;

function stopped(signal) {
  if (signal?.aborted) throw new AppError('CANCELLED', '请求已取消；已到达供应商的请求仍可能产生费用。');
}

function agentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function imageInvocation(call, imageConfig) {
  if (!imageConfig?.url || !imageConfig?.key || !imageConfig?.model) {
    throw agentError('IMAGE_CONFIG_REQUIRED', '请先在图片生成页完成 API 设置，再授权对话调用图片工作台。');
  }
  const target = canonicalEndpoint(imageConfig.url);
  if (imageConfig.trustedTarget !== target) {
    throw agentError('UNTRUSTED_ENDPOINT', '图片 API 地址尚未确认。请在图片生成页确认目标地址。');
  }
  const args = call.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['prompt', 'aspectRatio', 'imageSize'].includes(key))
    || typeof args.prompt !== 'string' || !args.prompt.trim()
    || (args.aspectRatio !== undefined && typeof args.aspectRatio !== 'string')
    || (args.imageSize !== undefined && typeof args.imageSize !== 'string')) {
    throw agentError('INVALID_TOOL_ARGUMENTS', '图片工具参数无效；只接受提示词、长宽比与分辨率。');
  }
  const { aspectRatio, imageSize } = normalizeImageOptions(imageConfig, {
    aspectRatio: args.aspectRatio, imageSize: args.imageSize,
  });
  return {
    command: 'image.generate',
    args: { prompt: args.prompt.trim(), aspectRatio, imageSize },
    target,
    model: imageConfig.model,
    protocol: imageConfig.protocol,
  };
}

function imageSummary(result) {
  return {
    ok: true,
    message: '图片 API 已返回文件，已交给界面显示；请勿重复生成同一图片。',
    text: result.text || '',
    imageCount: result.images.length,
    images: result.images.map(image => ({ mimeType: image.mimeType })),
    model: result.model,
    aspectRatio: result.aspectRatio,
    imageSize: result.imageSize,
  };
}

/**
 * Portable conversation runner. Models may invoke exactly one capability,
 * image.generate; model output is never evaluated as code or an OS command.
 * onHistory checkpoints preserve a completed chargeable operation if a later
 * text request fails. There are no automatic network retries.
 */
export async function runConversation({
  config, imageConfig, messages, settings = {}, signal,
  confirmTool, onToolResult, onHistory, fetchImpl, onDelta, onResponse, onPhase,
}) {
  const history = messages.map(message => ({ ...message }));
  const toolResults = [];
  const completed = new Map();
  let toolRounds = 0;
  let toolCallCount = 0;
  let pendingCalls = [];
  let round = 0;
  // Plain chat should work with providers/models that do not support tools.
  // Configure and trust the separate image workspace before advertising its tool.
  const imageTool = config.protocol !== 'anthropic' && imageConfig?.key && imageConfig?.trustedTarget ? getImageTool(imageConfig) : null;
  const tools = imageTool ? [imageTool] : [];
  const checkpoint = () => onHistory?.(history.map(message => ({ ...message })));

  try {
    for (;;) {
      stopped(signal);
      const response = await generateText({
        config, messages: history, settings, tools, signal, fetchImpl, onPhase,
        onDelta: onDelta ? delta => onDelta(delta, {round}) : undefined,
      });
      stopped(signal);
      onResponse?.(response, {round});
      round += 1;
      history.push({ role: 'assistant', content: response.text || '', raw: response.rawAssistant });
      const calls = response.toolCalls || [];
      pendingCalls = [...calls];
      if (!calls.length) {
        checkpoint();
        return { text: response.text || '', history, usage: response.usage, toolResults };
      }
      toolRounds += 1;
      toolCallCount += calls.length;
      if (toolCallCount > MAX_TOOL_CALLS) {
        throw agentError('TOOL_LIMIT', '本轮最多接受 4 次工具调用；未执行超额调用。');
      }

      for (const call of calls) {
        stopped(signal);
        let summary;
        if (call.name !== 'image_generate') {
          summary = { ok: false, code: 'UNKNOWN_TOOL', message: '只允许 image_generate，不支持 shell 或其他命令。' };
        } else if (toolRounds > MAX_TOOL_ROUNDS) {
          summary = { ok: false, code: 'TOOL_LIMIT', message: '本轮图片工具调用已达上限。请等待用户新指令。' };
        } else {
          const invocation = imageInvocation(call, imageConfig);
          const fingerprint = JSON.stringify(invocation);
          if (completed.has(fingerprint)) {
            summary = { ...completed.get(fingerprint), reused: true };
          } else {
            if (typeof confirmTool !== 'function') {
              throw agentError('CONFIRMATION_REQUIRED', '图片调用需要用户确认目标地址、模型和本次参数。');
            }
            const approved = await confirmTool(invocation);
            stopped(signal);
            if (!approved) {
              summary = { ok: false, code: 'USER_DECLINED', message: '用户未授权本次图片调用，未发送图片请求。' };
              completed.set(fingerprint, summary);
            } else {
              const result = await dispatchCommand(
                { command: invocation.command, args: invocation.args },
                { imageConfig: {...imageConfig, attachmentContext: history.some(message => message.attachments?.length)}, confirmed: true, signal, fetchImpl, onPhase },
              );
              summary = imageSummary(result);
              completed.set(fingerprint, summary);
              const event = { call, result, invocation };
              toolResults.push(event);
              // Save the native function response before any UI callback or next
              // request. The image bytes remain in the UI result, not text context.
              history.push(makeToolResult(config, call, summary));
              pendingCalls.shift();
              if (!pendingCalls.length) checkpoint();
              await onToolResult?.(event);
              continue;
            }
          }
        }
        history.push(makeToolResult(config, call, summary));
        pendingCalls.shift();
        if (!pendingCalls.length) checkpoint();
      }
      if (toolRounds > MAX_TOOL_ROUNDS) {
        throw agentError('TOOL_LIMIT', '本轮工具调用已达上限；已完成的图片保留，请继续发送新消息。');
      }
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught : agentError('REQUEST_FAILED', '请求失败。');
    // Finish any native function-call group without retrying an interrupted
    // operation. Future user turns must not replay unfinished tool calls.
    for (const call of pendingCalls) {
      history.push(makeToolResult(config, call, {
        ok: false, code: error.name === 'AbortError' || error.code === 'CANCELLED' ? 'CANCELLED' : 'NOT_COMPLETED',
        message: '本次工具调用未完成，未自动重试。已完成的图片请查看对话记录。',
      }));
    }
    if (pendingCalls.length) checkpoint();
    // A checkpoint is intentionally attached without configuration or API keys.
    error.history = history;
    error.toolResults = toolResults;
    throw error;
  }
}
