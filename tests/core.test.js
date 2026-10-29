import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, DEFAULT_TEXT_MODEL, IMAGE_MODEL, GEMINI_ENDPOINT, aspectRatios, imageSizes,
  imagePixels, canonicalEndpoint, validateEndpoint, listModels, generateText,
  generateImage, dispatchCommand, makeToolResult, IMAGE_TOOL,
} from '../src/core.js';

const FAKE_KEY = 'synthetic-unit-test-key-not-a-credential';
const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const gemini = overrides => ({protocol:'gemini',url:GEMINI_ENDPOINT,trustedTarget:GEMINI_ENDPOINT,key:FAKE_KEY,model:DEFAULT_TEXT_MODEL,...overrides});
const openai = overrides => ({protocol:'openai',url:'https://api.example.com/v1',trustedTarget:'https://api.example.com/v1',key:FAKE_KEY,model:'test-chat',...overrides});
const imageConfig = () => gemini({model:IMAGE_MODEL});
const user = [{role:'user',content:'你好'}];
const jsonResponse = body => ({ok:true,status:200,json:async () => body});
const responseText = text => ({candidates:[{content:{role:'model',parts:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:4,totalTokenCount:7}});
const responseImage = () => ({candidates:[{content:{role:'model',parts:[{inlineData:{mimeType:'image/png',data:PNG_PIXEL}}]}}]});
const noFetch = () => { assert.fail('unexpected outbound request'); };
const code = expected => error => error instanceof AppError && error.code === expected;

test('defaults and all 42 image options retain official pixel mapping', () => {
  assert.equal(DEFAULT_TEXT_MODEL,'gemini-flash-lite-latest');
  assert.equal(IMAGE_MODEL,'gemini-nano-banana-2.1');
  assert.equal(aspectRatios.length * imageSizes.length,42);
  assert.equal(imagePixels('1:8','4K'),'1536×12288');
  assert.equal(imagePixels('16:9','2K'),'2752×1536');
  assert.equal(imagePixels('7:6','1K'),'');
});

test('endpoint canonicalization keeps exact approved base path', () => {
  assert.equal(canonicalEndpoint('https://API.EXAMPLE.COM:443/v1/'),'https://api.example.com/v1');
  assert.equal(validateEndpoint(gemini()),GEMINI_ENDPOINT);
  assert.throws(() => validateEndpoint(gemini({trustedTarget:''})),code('UNTRUSTED_ENDPOINT'));
  assert.throws(() => validateEndpoint(gemini({url:'https://evil.example.com/v1'})),code('UNTRUSTED_ENDPOINT'));
  assert.throws(() => validateEndpoint(gemini({protocol:'anthropic'})),code('PROTOCOL'));
});

test('malicious and private endpoints rejected before any key transmission', async () => {
  for (const url of ['http://api.example.com/v1','https://a:b@api.example.com/v1','https://api.example.com/v1?key=foo','https://api.example.com/v1#key','https://localhost/v1','https://127.0.0.1/v1','https://0x7f000001/v1','https://2130706433/v1','https://192.168.1.1/v1','https://[::1]/v1','https://[::ffff:127.0.0.1]/v1','https://metadata.google.internal/v1','https://foo.local/v1','https://api.example.com/\nfoo','https://api.example.com\\@evil.example.com']) {
    await assert.rejects(listModels({config:gemini({url,trustedTarget:url}),fetchImpl:noFetch}),code('ENDPOINT'),url);
  }
});

test('Gemini text sends header key only and real generateContent body', async () => {
  const result = await generateText({config:gemini(),messages:user,settings:{output:'256',temperature:'0.2',topP:'0.9'},fetchImpl:async (url,options) => {
    assert.equal(url,`${GEMINI_ENDPOINT}/models/${DEFAULT_TEXT_MODEL}:generateContent`);
    assert.equal(options.headers['x-goog-api-key'],FAKE_KEY);
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert(!url.includes(FAKE_KEY));
    assert(!options.body.includes(FAKE_KEY));
    assert.deepEqual(JSON.parse(options.body),{contents:[{role:'user',parts:[{text:'你好'}]}],generationConfig:{maxOutputTokens:256,temperature:0.2,topP:0.9}});
    return jsonResponse(responseText('<script>must remain text</script>'));
  }});
  assert.equal(result.text,'<script>must remain text</script>');
  assert.equal(result.usage.totalTokens,7);
  assert.deepEqual(result.toolCalls,[]);
});

test('OpenAI compatible text uses chat/completions, Bearer, supported fields', async () => {
  const result = await generateText({config:openai(),messages:user,settings:{output:100,topP:0.5},fetchImpl:async (url,options) => {
    assert.equal(url,'https://api.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization,`Bearer ${FAKE_KEY}`);
    assert.deepEqual(JSON.parse(options.body),{model:'test-chat',messages:user,stream:false,max_completion_tokens:100,top_p:0.5});
    return jsonResponse({choices:[{message:{role:'assistant',content:'hello'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}});
  }});
  assert.equal(result.text,'hello');
  assert.equal(result.usage.totalTokens,5);
});

test('model listing uses approved target and removes only Gemini models prefix', async () => {
  const models = await listModels({config:gemini(),fetchImpl:async (url,options) => {
    assert.equal(url,`${GEMINI_ENDPOINT}/models?pageSize=1000`);
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    return jsonResponse({models:[{name:`models/${DEFAULT_TEXT_MODEL}`,displayName:'Flash Lite',supportedGenerationMethods:['generateContent']}]});
  }});
  assert.deepEqual(models,[{id:DEFAULT_TEXT_MODEL,name:'Flash Lite',methods:['generateContent']}]);
  assert.deepEqual(await listModels({config:openai(),fetchImpl:async url => {
    assert.equal(url,'https://api.example.com/v1/models');
    return jsonResponse({data:[{id:'model-a'}]});
  }}),[{id:'model-a',name:'model-a'}]);
});

test('Gemini function call keeps full thought signatures and matching response id', async () => {
  const native = {role:'model',parts:[{functionCall:{name:'image_generate',id:'call-7',args:{prompt:'cat'}},thoughtSignature:'opaque-signature'}]};
  const first = await generateText({config:gemini(),messages:user,tools:[IMAGE_TOOL],fetchImpl:async (_url,options) => {
    assert.equal(JSON.parse(options.body).tools[0].functionDeclarations[0].name,'image_generate');
    return jsonResponse({candidates:[{content:native}]});
  }});
  assert.deepEqual(first.rawAssistant,native);
  const tool = makeToolResult(gemini(),first.toolCalls[0],{ok:true,imageCount:1});
  assert.equal(tool.raw.parts[0].functionResponse.id,'call-7');
  await generateText({config:gemini(),messages:[...user,{role:'assistant',content:'',raw:first.rawAssistant},tool],fetchImpl:async (_url,options) => {
    const contents = JSON.parse(options.body).contents;
    assert.deepEqual(contents[1],native);
    assert.deepEqual(contents[2],{role:'user',parts:[{functionResponse:{name:'image_generate',response:{ok:true,imageCount:1},id:'call-7'}}]});
    return jsonResponse(responseText('done'));
  }});
});

test('OpenAI function calls parse JSON but never execute it', async () => {
  const native = {role:'assistant',content:null,tool_calls:[{id:'call-a',type:'function',function:{name:'image_generate',arguments:'{"prompt":"cat"}'}}]};
  const result = await generateText({config:openai(),messages:user,tools:[IMAGE_TOOL],fetchImpl:async (_url,options) => {
    assert.equal(JSON.parse(options.body).tools[0].type,'function');
    return jsonResponse({choices:[{message:native,finish_reason:'tool_calls'}]});
  }});
  assert.deepEqual(result.toolCalls,[{id:'call-a',name:'image_generate',args:{prompt:'cat'}}]);
  assert.deepEqual(makeToolResult(openai(),result.toolCalls[0],{ok:true}).raw,{role:'tool',tool_call_id:'call-a',content:'{"ok":true}'});
  await assert.rejects(generateText({config:openai(),messages:user,fetchImpl:async () => jsonResponse({choices:[{message:{...native,tool_calls:[{id:'call-a',type:'function',function:{name:'image_generate',arguments:'process.exit()'}}]}}]})}),code('TOOL_FORMAT'));
});

test('image generation maps ratio and size and only decodes inline raster data', async () => {
  const result = await generateImage({config:imageConfig(),prompt:'A mountain',aspectRatio:'16:9',imageSize:'2K',fetchImpl:async (url,options) => {
    assert.equal(url,`${GEMINI_ENDPOINT}/models/${IMAGE_MODEL}:generateContent`);
    assert.deepEqual(JSON.parse(options.body).generationConfig,{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'16:9',imageSize:'2K'}});
    return jsonResponse(responseImage());
  }});
  assert.equal(result.images[0].data,PNG_PIXEL);
  assert.equal(result.model,IMAGE_MODEL);
  assert.equal(result.imageSize,'2K');
});

test('image models and unsafe image payloads fail honestly', async () => {
  await assert.rejects(generateImage({config:openai(),prompt:'cat',fetchImpl:noFetch}),code('IMAGE_MODEL'));
  await assert.rejects(generateImage({config:imageConfig(),prompt:'cat',aspectRatio:'7:2',fetchImpl:noFetch}),code('IMAGE_OPTIONS'));
  await assert.rejects(generateImage({config:imageConfig(),prompt:'cat',fetchImpl:async () => jsonResponse(responseText('No image produced'))}),code('NO_IMAGE'));
  const unsafe = {candidates:[{content:{parts:[{inlineData:{mimeType:'image/svg+xml',data:'aGVsbG8='}}]}}]};
  await assert.rejects(generateImage({config:imageConfig(),prompt:'cat',fetchImpl:async () => jsonResponse(unsafe)}),code('IMAGE_DATA'));
});

test('dispatcher only permits typed image command and requires a fresh approval', async () => {
  const base = {imageConfig:imageConfig(),fetchImpl:noFetch};
  await assert.rejects(dispatchCommand({command:'shell',args:{prompt:'rm -rf'}},base),code('COMMAND'));
  await assert.rejects(dispatchCommand({command:'image.generate',args:{prompt:'cat',url:'https://evil.example.com'}},{...base,confirmed:true}),code('COMMAND_ARGS'));
  await assert.rejects(dispatchCommand({command:'image.generate',args:{prompt:'cat'}},base),code('CONFIRMATION'));
  const result = await dispatchCommand({command:'image.generate',args:{prompt:'cat'}},{imageConfig:imageConfig(),confirmed:true,fetchImpl:async () => jsonResponse(responseImage())});
  assert.equal(result.images.length,1);
});

test('HTTP and network errors never leak upstream bodies or credential-bearing causes', async () => {
  for (const status of [400,401,403,404,429,500]) {
    let parsed = false;
    await assert.rejects(generateText({config:gemini(),messages:user,fetchImpl:async () => ({ok:false,status,json:async () => { parsed=true; return {error:{message:FAKE_KEY}}; }})}),error => {
      assert.equal(error.code,'HTTP');
      assert.equal(error.status,status);
      assert(!JSON.stringify(error).includes(FAKE_KEY));
      assert(!error.message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(parsed,false);
  }
  await assert.rejects(generateText({config:gemini(),messages:user,fetchImpl:async () => {throw new Error(`secret ${FAKE_KEY}`);}}),error => error.code === 'NETWORK' && !String(error.stack).includes(FAKE_KEY));
});

test('cancellation before, during fetch and during parse never starts retry', async () => {
  const pre = new AbortController(); pre.abort();
  await assert.rejects(generateText({config:gemini(),messages:user,signal:pre.signal,fetchImpl:noFetch}),code('CANCELLED'));
  const during = new AbortController();
  let requests = 0;
  await assert.rejects(generateText({config:gemini(),messages:user,signal:during.signal,fetchImpl:async () => {requests++;during.abort();throw new Error('Abort');}}),code('CANCELLED'));
  assert.equal(requests,1);
  const parse = new AbortController();
  await assert.rejects(generateText({config:gemini(),messages:user,signal:parse.signal,fetchImpl:async () => ({ok:true,status:200,json:async () => {parse.abort();return responseText('late');}})}),code('CANCELLED'));
});

test('invalid settings, model injection, JSON, and blocked response give controlled errors', async () => {
  await assert.rejects(generateText({config:gemini(),messages:user,settings:{temperature:'NaN'},fetchImpl:noFetch}),code('SETTINGS'));
  await assert.rejects(generateText({config:gemini({model:'foo:generateContent?key=stolen'}),messages:user,fetchImpl:noFetch}),code('MODEL'));
  await assert.rejects(generateText({config:gemini(),messages:user,fetchImpl:async () => ({ok:true,json:async () => {throw new Error(FAKE_KEY);}})}),error => error.code === 'RESPONSE' && !error.message.includes(FAKE_KEY));
  await assert.rejects(generateText({config:gemini(),messages:user,fetchImpl:async () => jsonResponse({promptFeedback:{blockReason:'SAFETY'}})}),code('BLOCKED'));
});

test('Gemini system text uses systemInstruction rather than pretending it is user input', async () => {
  await generateText({config:gemini(),messages:[{role:'system',content:'Be concise.'},...user],fetchImpl:async (_url,options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.systemInstruction,{parts:[{text:'Be concise.'}]});
    assert.equal(body.contents.length,1);
    return jsonResponse(responseText('OK'));
  }});
});


test('image raster signatures reject plain text mislabeled as PNG/JPEG/WebP', async () => {
  for (const mimeType of ['image/png','image/jpeg','image/webp']) {
    await assert.rejects(generateImage({config:imageConfig(),prompt:'cat',fetchImpl:async () => jsonResponse({candidates:[{content:{parts:[{inlineData:{mimeType,data:'aGVsbG8='}}]}}]})}),code('IMAGE_DATA'));
  }
});

test('accidentally pasted key in API path is rejected before network', async () => {
  for (const path of [FAKE_KEY, encodeURIComponent(FAKE_KEY).replace('synthetic','%73ynthetic')]) {
    const url = `https://api.example.com/${path}/v1`;
    await assert.rejects(listModels({config:gemini({url,trustedTarget:url}),fetchImpl:noFetch}),code('ENDPOINT'));
  }
});

test('Ark Flash and Pro send image generation fields with no invented ratio/sequence options', async () => {
  const {ARK_FLASH_MODEL,ARK_PRO_MODEL,ARK_ENDPOINT} = await import('../src/core.js');
  for (const model of [ARK_FLASH_MODEL,ARK_PRO_MODEL]) {
    const config = {protocol:'ark',url:ARK_ENDPOINT,trustedTarget:ARK_ENDPOINT,key:FAKE_KEY,model};
    const result = await generateImage({config,prompt:'A tree',aspectRatio:'16:9',imageSize:'2K',fetchImpl:async (url,options) => {
      assert.equal(url,`${ARK_ENDPOINT}/images/generations`);
      assert.equal(options.headers.Authorization,`Bearer ${FAKE_KEY}`);
      assert.deepEqual(JSON.parse(options.body),{model,prompt:'A tree',size:'2816x1584',response_format:'b64_json',output_format:'png'});
      return jsonResponse({data:[{b64_json:PNG_PIXEL,size:'2816x1584',output_format:'png'}]});
    }});
    assert.equal(result.images[0].data,PNG_PIXEL);
    assert.equal(result.images[0].size,'2816x1584');
    assert.equal(result.size,'2816x1584');
    assert.equal(result.model,model);
  }
});

test('Ark URL-only response never downloads URL, retries generation or logs URL', async () => {
  const {ARK_FLASH_MODEL,ARK_ENDPOINT} = await import('../src/core.js');
  const {clearNetworkLogs,getNetworkLogs} = await import('../src/logs.js');
  clearNetworkLogs();
  let requests = 0;
  const secretURL = 'https://images.example.com/sensitive-image-name.png?signature=opaque-signed-value';
  await assert.rejects(generateImage({config:{protocol:'ark',url:ARK_ENDPOINT,trustedTarget:ARK_ENDPOINT,key:FAKE_KEY,model:ARK_FLASH_MODEL},prompt:'A tree',fetchImpl:async () => {
    requests++;
    return jsonResponse({data:[{url:secretURL}]});
  }}),error => error.code === 'IMAGE_URL_ONLY' && !error.message.includes(secretURL));
  assert.equal(requests,1);
  const logs = JSON.stringify(getNetworkLogs());
  assert(!logs.includes(secretURL));
  assert(!logs.includes('sensitive-image-name'));
  assert(logs.includes('[OMITTED: image URL]'));
});

test('Ark unsupported image combinations and unverified model listing never fetch', async () => {
  const {ARK_FLASH_MODEL,ARK_ENDPOINT} = await import('../src/core.js');
  const config = {protocol:'ark',url:ARK_ENDPOINT,trustedTarget:ARK_ENDPOINT,key:FAKE_KEY,model:ARK_FLASH_MODEL};
  await assert.rejects(listModels({config,fetchImpl:noFetch}),code('MODELS_UNSUPPORTED'));
  await assert.rejects(generateImage({config,prompt:'cat',imageSize:'4K',fetchImpl:noFetch}),code('IMAGE_OPTIONS'));
  await assert.rejects(generateImage({config:{...config,model:'ep-unverified'},prompt:'cat',fetchImpl:noFetch}),code('IMAGE_MODEL'));
  await assert.rejects(generateImage({config,prompt:'cat',fetchImpl:async () => jsonResponse({data:[{b64_json:'aGVsbG8='}]})}),code('IMAGE_DATA'));
});

test('Ark text and tool messages preserve encrypted_content with the documented chat path', async () => {
  const {ARK_TEXT_MODEL,ARK_ENDPOINT} = await import('../src/core.js');
  const config = {protocol:'ark',url:ARK_ENDPOINT,trustedTarget:ARK_ENDPOINT,key:FAKE_KEY,model:ARK_TEXT_MODEL};
  const native = {role:'assistant',content:null,encrypted_content:'opaque-encrypted-reasoning',tool_calls:[{id:'ark-1',type:'function',function:{name:'image_generate',arguments:'{"prompt":"cat"}'}}]};
  const first = await generateText({config,messages:user,tools:[IMAGE_TOOL],settings:{output:512},fetchImpl:async (url,options) => {
    assert.equal(url,`${ARK_ENDPOINT}/chat/completions`);
    const body = JSON.parse(options.body);
    assert.equal(body.model,ARK_TEXT_MODEL);
    assert.equal(body.max_completion_tokens,512);
    assert.equal(body.max_tokens,undefined);
    assert.equal(body.tools[0].type,'function');
    return jsonResponse({choices:[{message:native,finish_reason:'tool_calls'}]});
  }});
  const tool = makeToolResult(config,first.toolCalls[0],{ok:true});
  await generateText({config,messages:[...user,{role:'assistant',content:'',raw:first.rawAssistant},tool],fetchImpl:async (_url,options) => {
    assert.deepEqual(JSON.parse(options.body).messages[1],native);
    assert.equal(JSON.parse(options.body).messages[2].tool_call_id,'ark-1');
    return jsonResponse({choices:[{message:{role:'assistant',content:'Done'}}]});
  }});
});

test('network diagnostics identify mocks, upsert completion and redact echoed credentials', async () => {
  const {clearNetworkLogs,getNetworkLogs} = await import('../src/logs.js');
  clearNetworkLogs();
  await generateText({config:gemini(),messages:[{role:'user',content:`private ${FAKE_KEY}`}],fetchImpl:async () => jsonResponse(responseText(`echo ${FAKE_KEY}`))});
  const logs = getNetworkLogs();
  assert.equal(logs.length,1);
  assert.equal(logs[0].source,'mock');
  assert.equal(logs[0].status,200);
  assert.equal(logs[0].provider,'gemini');
  assert.equal(logs[0].requestHeaders['x-goog-api-key'],'[REDACTED]');
  assert.equal(logs[0].requestHeaders['Content-Type'],'application/json');
  assert.equal(logs[0].error,null);
  assert(!JSON.stringify(logs).includes(FAKE_KEY));
  assert(JSON.stringify(logs).includes('[REDACTED]'));
});

test('preflight errors create no network logs and HTTP failure logs no raw upstream body', async () => {
  const {clearNetworkLogs,getNetworkLogs} = await import('../src/logs.js');
  clearNetworkLogs();
  await assert.rejects(generateText({config:gemini({trustedTarget:''}),messages:user,fetchImpl:noFetch}),code('UNTRUSTED_ENDPOINT'));
  assert.deepEqual(getNetworkLogs(),[]);
  await assert.rejects(generateText({config:gemini(),messages:user,fetchImpl:async () => ({ok:false,status:429,json:async () => {assert.fail('error body should not be read');}})}),code('HTTP'));
  const logs = getNetworkLogs();
  assert.equal(logs.length,1);
  assert.equal(logs[0].status,429);
  assert.equal(logs[0].error.code,'HTTP');
  assert.equal(logs[0].responsePayload,null);
});


test('ordinary Ark rejects Coding Plan endpoint including encoded path before network', async () => {
  const {ARK_TEXT_MODEL} = await import('../src/core.js');
  const {clearNetworkLogs,getNetworkLogs} = await import('../src/logs.js');
  clearNetworkLogs();
  for (const url of ['https://ark.cn-beijing.volces.com/api/plan/v3','https://trusted.example.com/api/plan/v3/','https://trusted.example.com/%61pi/plan/v3','https://trusted.example.com/api%2fplan%2fv3']) {
    await assert.rejects(generateText({config:{protocol:'ark',url,trustedTarget:url,key:FAKE_KEY,model:ARK_TEXT_MODEL},messages:user,fetchImpl:noFetch}),code('ARK_PLAN_ENDPOINT'));
  }
  assert.deepEqual(getNetworkLogs(),[]);
});

test('network logs include only redacted request headers and allowlisted response headers', async () => {
  const {clearNetworkLogs,getNetworkLogs} = await import('../src/logs.js');
  clearNetworkLogs();
  await generateText({config:openai(),messages:user,fetchImpl:async () => ({...jsonResponse({choices:[{message:{role:'assistant',content:'ok'}}]}),headers:new Headers({'content-type':'application/json','x-request-id':'request-123','set-cookie':'unsafe-cookie','authorization':FAKE_KEY,'x-private-header':'not-logged'})})});
  const [entry] = getNetworkLogs();
  assert.equal(entry.requestHeaders.Authorization,'[REDACTED]');
  assert.equal(entry.requestHeaders.Accept,'application/json');
  assert.equal(entry.requestHeaders['Content-Type'],'application/json');
  assert.deepEqual(entry.responseHeaders,{'content-type':'application/json','x-request-id':'request-123'});
  const serialized = JSON.stringify(entry);
  assert(!serialized.includes(FAKE_KEY));
  assert(!serialized.includes('unsafe-cookie'));
  assert(!serialized.includes('not-logged'));
});

for (const url of ['https://api.deepseek.com', 'https://open.bigmodel.cn/api/paas/v4']) {
  test(`restored provider appends chat path once: ${url}`, async () => {
    const result = await generateText({ config: openai({ url, trustedTarget: url }), messages: user,
      fetchImpl: async (target, options) => {
        assert.equal(target, `${url}/chat/completions`);
        assert.equal(JSON.parse(options.body).model, 'test-chat');
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'synthetic OK' } }] });
      }
    });
    assert.equal(result.text, 'synthetic OK');
  });
}
