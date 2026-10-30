import * as persistence from '../src/persistence.js';
import * as reasoning from '../src/reasoning.js';
import * as attachments from '../src/attachments.js';
import * as usage from '../src/usage.js';
import test, {afterEach} from 'node:test';
const owned=new Set();
afterEach(()=>{for(const ui of owned)ui.dispose();owned.clear();});
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {createWorkbench} from '../src/workbench.js';
import * as core from '../src/core.js';
import { icon } from '../src/icons.js';
import * as logs from '../src/logs.js';
import { createPageSession } from '../src/session.js';

// A small event/DOM harness for the production module. No browser, network,
// real key, external package or production testing hooks are required.
async function mount({ confirm = () => true, runConversation, dispatchCommand, listModels } = {}) {
  const listeners = {};
  let html = '', nodes = new Map(), renders = 0;
  const thread = { scrollTop: 0, scrollHeight: 100 };
  const app = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; renders += 1; nodes = new Map();
      if (value.includes('id="network-logs"')) nodes.set('#network-logs', { textContent: '' });
      for (const match of value.matchAll(/<span id="(api-trust\d+)">(.*?)<\/span>/g)) nodes.set(`#${match[1]}`, { textContent: match[2] });
      for (const match of value.matchAll(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"[^>]*>(?:([^<]*)<\/textarea>)?/g)) {
        const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        nodes.set(`#${match[1]}`, { id: match[1], value: attrs.value || match[2] || '', dataset: { card: attrs['data-card'], key: attrs['data-key'] }, selectionStart: 0, selectionEnd: 0 });
      }
    },
    get renders() { return renders; },
    querySelector: selector => selector === '#thread' ? thread : nodes.get(selector) || null,
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const document = { getElementById: () => app, addEventListener: () => {}, activeElement: null };
  const neverFetch = () => assert.fail('No network may run in control regressions.');
  const context = createWorkbench({document,window:{confirm,addEventListener(){}},services:{confirm,
    runConversation:runConversation || neverFetch,listModels:listModels || neverFetch,dispatchCommand:dispatchCommand || neverFetch,
    renderNetworkLogs:container=>{if(container)container.textContent=logs.exportNetworkLogs();},registerTools:()=>({available:false}),
    createStore:()=>({load:async()=>null,journal(){},schedule:async()=>{},reportError(){},close(){}})
  }});
  await context.ready;
  owned.add(context);
  return {
    ...context, app, document, session: context.session,
    input: target => listeners.input({ target }),
    click: dataset => listeners.click({ target: { closest: () => ({ dataset }) } })
  };
}
function configure(ui, page = 'chat') {
  ui.setPage(page); ui.addCard('api');
  const d = ui.data[page], card = d.messages.at(-1);
  d.api.key = 'synthetic-control-key';
  d.api.trustedTarget = core.canonicalEndpoint(d.api.url);
  ui.render();
  return { d, card };
}

test('live page session preserves unknown completion beside returned workflow status',async()=>{
  const ui=await mount({runConversation:async()=>({text:'synthetic result',history:[],completion:{status:'unknown'}})});
  const {d}=configure(ui);d.draft='synthetic prompt';
  const response=await ui.session.execute({command:'request.send',args:{}});
  assert.equal(response.ok,true);assert.equal(response.result.status,'completed');
  assert.equal(response.result.outcome.operation,'returned');
  assert.equal(response.result.outcome.protocolCompletion,'unknown');
  assert.equal(response.result.outcome.goalSatisfied,'unknown');
  assert.equal(response.result.outcome.durablePersistence,'unknown');
});

test('URL input immediately revokes visible trust without rebuilding the focused input', async()=> {
  const ui = await mount(), { d, card } = configure(ui);
  const input = ui.app.querySelector(`#url${card.id}`), renders = ui.app.renders;
  input.value = 'https://new.example.com/v1';
  input.selectionStart = input.selectionEnd = 12;
  ui.document.activeElement = input;
  assert.equal(ui.isConfigured(ui.data.chat), true);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /发送或拉取时使用上方配置/);
  ui.input(input);
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.equal(ui.app.querySelector(`#key${card.id}`).value, '');
  assert.equal(ui.isConfigured(ui.data.chat), false);
  assert.equal(ui.app.querySelector('.top-right'), null);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /请填写密钥/);
  assert.equal(ui.app.renders, renders);
  assert.equal(ui.app.querySelector(`#url${card.id}`), input);
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.selectionStart, 12); assert.equal(input.selectionEnd, 12);
});

test('key and model edits immediately keep configuration validation accurate without a full render', async()=> {
  const ui = await mount(), { card } = configure(ui), renders = ui.app.renders;
  const key = ui.app.querySelector(`#key${card.id}`), model = ui.app.querySelector(`#model${card.id}`);
  key.value = ''; ui.input(key);
  assert.equal(ui.isConfigured(ui.data.chat), false);
  key.value = 'synthetic-replacement-key'; ui.input(key);
  assert.equal(ui.isConfigured(ui.data.chat), true);
  model.value = ''; ui.input(model);
  assert.equal(ui.isConfigured(ui.data.chat), false);
  assert.equal(ui.app.renders, renders);
});

test('reselecting the same canonical provider retains key, trust, custom model and model list', async()=> {
  for (const url of ['https://generativelanguage.googleapis.com/v1beta', 'https://generativelanguage.googleapis.com:443/v1beta/']) {
    const ui = await mount(), { d, card } = configure(ui);
    d.api.url = url; d.api.model = 'gemini-custom-model';
    card.models = [{ id: 'gemini-custom-model' }];
    const before = { ...d.api }, models = card.models;
    await ui.click({ action: 'choose-supplier', id: String(card.id), index: '0' });
    assert.deepEqual({ ...d.api }, before);
    assert.equal(card.models, models);
  }
});

test('reselecting the active custom provider keeps its manually entered target and credentials', async()=> {
  const ui = await mount(), { d, card } = configure(ui);
  Object.assign(d.api, { url: 'https://custom.example.com/v1beta', trustedTarget: 'https://custom.example.com/v1beta', supplier: '自定义 · Gemini 格式', model: 'gemini-custom-model' });
  const before = { ...d.api };
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '2' });
  assert.deepEqual({ ...d.api }, before);
});

test('restoring a provider default after manual URL change still clears key and trust', async()=> {
  const ui = await mount(), { d, card } = configure(ui);
  d.api.url = d.api.trustedTarget = 'https://custom.example.com/v1beta';
  d.api.model = 'gemini-custom-model';
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '0' });
  assert.equal(d.api.url, core.GEMINI_ENDPOINT);
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.equal(d.api.model, core.DEFAULT_TEXT_MODEL);
});

test('changing protocol or switching into a different custom provider still clears credentials', async()=> {
  for (const index of ['1', '2', '3']) {
    const ui = await mount(), { d, card } = configure(ui);
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  }
});

test('image page accepts the shared core models/ prefix and still rejects other protocols/models', async()=> {
  const ui = await mount(), { d } = configure(ui, 'image');
  d.api.model = ` models/${core.IMAGE_MODEL} `;
  await ui.click({ action: 'size-toggle' });
  assert.equal(ui.matrixSupported(d), true);
  assert.equal((ui.app.innerHTML.match(/data-action="set-image-options"/g) || []).length, 42);
  d.api.protocol = 'openai'; assert.equal(ui.matrixSupported(d), false);
  d.api.protocol = 'gemini'; d.api.model = 'models/not-an-image-model'; assert.equal(ui.matrixSupported(d), false);
});

test('Token metric identifies usage as the last request rather than a summed Agent turn', async()=> {
  const ui = await mount();
  assert.match(ui.app.innerHTML, />词元 <strong>/);
});


test('Ark preset changes only the active workspace and renders its 24 option matrix', async()=> {
  const ui = await mount(), { d, card } = configure(ui, 'image');
  const chatBefore = { ...ui.data.chat.api };
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '4' });
  assert.equal(d.api.protocol, 'ark'); assert.equal(d.api.url, core.ARK_ENDPOINT);
  assert.equal(d.api.model, core.ARK_FLASH_MODEL); assert.equal(d.imageSize, '2K');
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.deepEqual({ ...ui.data.chat.api }, chatBefore);
  await ui.click({ action: 'size-toggle' });
  assert.equal((ui.app.innerHTML.match(/data-action="set-image-options"/g) || []).length, 24);
  assert.match(ui.app.innerHTML, /1K 为应用预设/);
  assert.match(ui.app.innerHTML, /1.5K/);
  assert.doesNotMatch(ui.app.innerHTML, /data-image-size="4K"/);
});

test('Ark text preset uses the ordinary endpoint and honest manual model entry', async()=> {
  const ui = await mount(), { d, card } = configure(ui);
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '4' });
  assert.equal(d.api.protocol, 'ark'); assert.equal(d.api.model, core.ARK_TEXT_MODEL);
  assert.match(ui.app.innerHTML, /普通 API · 非 Agent Plan/);
  assert.match(ui.app.innerHTML, /手填模型/);
  await ui.click({ action: 'pull-models', id: String(card.id) });
  assert.match(ui.app.innerHTML, /暂无已核实的模型列表接口/);
});

test('logs tab has no composer, shows sanitized records and can clear them', async()=> {
  logs.clearNetworkLogs();
  const ui = await mount();
  logs.recordNetwork({ requestId: 'ui-log', source: 'mock', endpoint: 'https://api.example.com', status: 200 });
  await ui.click({ action: 'tab', tab: 'logs' });
  assert.match(ui.app.innerHTML, /导出 JSON/);
  assert.doesNotMatch(ui.app.innerHTML, /id="draft"/);
  assert.match(ui.app.querySelector('#network-logs').textContent, /ui-log/);
  await ui.click({ action: 'clear-logs' });
  assert.equal(logs.getNetworkLogs().length, 0);
});

test('live page session state redacts keys and cannot edit endpoints or trust', async()=> {
  const ui = await mount(), { d } = configure(ui);
  d.draft = 'test ' + d.api.key;
  const state = await ui.session.execute({ command: 'session.state', args: {} });
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /synthetic-control-key/);
  assert.match(serialized, /REDACTED/);
  await assert.rejects(ui.session.execute({ command: 'settings.update', args: { url: 'https://other.example.com' } }));
  await assert.rejects(ui.session.execute({ command: 'settings.update', args: { key: 'synthetic-injection' } }));
});

test('live page session updates Ark parameters but rejects unavailable 4K atomically', async()=> {
  const ui = await mount(), { d, card } = configure(ui, 'image');
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '4' });
  const result = await ui.session.execute({ command: 'settings.update', args: { imageSize: '1.5K', aspectRatio: '16:9' } });
  assert.equal(result.ok, true); assert.equal(d.imageSize, '1.5K'); assert.equal(d.aspectRatio, '16:9');
  const rejected = await ui.session.execute({ command: 'settings.update', args: { imageSize: '4K' } });
  assert.equal(rejected.ok, false); assert.equal(d.imageSize, '1.5K');
  await ui.session.execute({ command: 'page.navigate', args: { page: 'logs' } });
  const hidden = await ui.session.execute({ command: 'draft.set', args: { text: 'must not change hidden draft' } });
  assert.equal(hidden.ok, false);
});

test('live page session send needs page confirmation and reports actual failure rather than success', async()=> {
  let calls = 0;
  const ui = await mount({ confirm: () => false, runConversation: () => { calls++; } }), { d } = configure(ui);
  d.draft = 'not authorized';
  assert.equal((await ui.session.execute({ command: 'request.send', args: {} })).ok, false);
  assert.equal(calls, 0);
  const approved = await mount({ runConversation: async () => { throw new core.AppError('NETWORK', 'Network failed'); } });
  configure(approved); approved.data.chat.draft = 'authorized synthetic failure';
  const result = await approved.session.execute({ command: 'request.send', args: {} });
  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.code, 'NETWORK');
});


test('session approval is bound to the exact draft and rejects a racing replacement', async()=> {
  let calls = 0;
  const ui = await mount({ runConversation: async () => { calls++; return { text: 'should not send', history: [] }; } });
  configure(ui); ui.data.chat.draft = 'approved draft';
  const sending = ui.session.execute({ command: 'request.send', args: {} });
  await ui.session.execute({ command: 'draft.set', args: { text: 'changed after approval' } });
  const result = await sending;
  assert.equal(result.result.status, 'not-sent');
  assert.equal(result.result.reason, 'changed-after-confirmation');
  assert.equal(calls, 0);
});

test('session approval cannot be redirected to a different workspace or model', async()=> {
  for (const change of [{ command: 'page.navigate', args: { page: 'image' } }, { command: 'settings.update', args: { model: 'different-model' } }]) {
    let calls = 0;
    const ui = await mount({ runConversation: async () => { calls++; } });
    configure(ui); ui.data.chat.draft = 'approved draft';
    const sending = ui.session.execute({ command: 'request.send', args: {} });
    await ui.session.execute(change);
    const result = await sending;
    assert.equal(result.result.status, 'not-sent'); assert.equal(calls, 0);
  }
});

test('unused key from the other workspace is redacted in fetch logs, session logs and log tab', async()=> {
  logs.clearNetworkLogs();
  const secret = 'synthetic-unused-other-workspace-6e447';
  const ui = await mount({ runConversation: async () => {
    logs.recordNetwork({ source: 'mock', requestId: 'cross-workspace', responsePayload: { text: secret } });
    return { text: secret, history: [] };
  } });
  const image = configure(ui, 'image');
  const keyInput = ui.app.querySelector(`#key${image.card.id}`); keyInput.value = secret; ui.input(keyInput);
  configure(ui, 'chat'); ui.data.chat.draft = 'synthetic request';
  await ui.session.execute({ command: 'request.send', args: {} });
  assert.doesNotMatch(logs.exportNetworkLogs(), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(await ui.session.execute({ command: 'session.logs', args: {} })), new RegExp(secret));
  await ui.click({ action: 'tab', tab: 'logs' });
  assert.doesNotMatch(ui.app.querySelector('#network-logs').textContent, new RegExp(secret));
});


test('session cancel during the confirmation microtask prevents the request from starting', async()=> {
  let calls = 0;
  const ui = await mount({ runConversation: async () => { calls++; return { text: 'must not run', history: [] }; } });
  configure(ui); ui.data.chat.draft = 'approved then cancelled';
  const sending = ui.session.execute({ command: 'request.send', args: {} });
  const cancelled = await ui.session.execute({ command: 'request.cancel', args: {} });
  const result = await sending;
  assert.equal(cancelled.result.requested, true);
  assert.equal(result.result.status, 'not-sent');
  assert.equal(calls, 0);
});


test('repeated missing-key model pulls stay in one card status without network or history spam', async()=> {
  const ui = await mount(); ui.addCard('api');
  const d = ui.data.chat, card = d.messages.at(-1), count = d.messages.length;
  for (let i=0;i<10;i++) await ui.click({action:'pull-models',id:String(card.id)});
  assert.equal(d.messages.length,count);
  assert.match(card.modelListStatus,/尚未发送/);
  assert.equal((ui.app.innerHTML.match(/尚未发送模型列表请求/g)||[]).length,1);
  const key=ui.app.querySelector(`#key${card.id}`); key.value='synthetic';ui.input(key);
  assert.equal(card.modelListStatus,'');
});
test('corrected settings continue and busy model pulls never duplicate a request', async()=> {
  let calls=0,resolve;
  const ui=await mount({listModels:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  const {d,card}=configure(ui);card.modelListStatus='old validation';
  const pending=ui.click({action:'pull-models',id:String(card.id)});
  for(let i=0;i<10;i++)await ui.click({action:'pull-models',id:String(card.id)});
  assert.equal(calls,1);assert.equal(d.busy,true);assert.equal(card.modelListStatus,'');
  resolve([{id:'synthetic-model'}]);await pending;
  assert.equal(d.busy,false);assert.equal(card.models[0].id,'synthetic-model');
});
test('invalid model-list targets update one status without requests', async()=> {
 const ui=await mount(),{d,card}=configure(ui),count=d.messages.length;
 const url=ui.app.querySelector(`#url${card.id}`);url.value='http://unsafe.example/v1';ui.input(url);
 const key=ui.app.querySelector(`#key${card.id}`);key.value='synthetic-new';ui.input(key);
 for(let i=0;i<5;i++)await ui.click({action:'pull-models',id:String(card.id)});
 assert.equal(d.messages.length,count);assert.ok(card.modelListStatus);assert.equal(d.api.trustedTarget,'');
});

test('settings menus replace bottom menus rather than leaving an inline second menu', async()=>{
 const ui=await mount(),{d,card}=configure(ui,'image');
 for(let i=0;i<10;i++){
  await ui.click({action:i%2?'plus':'size-toggle'});
  await ui.click({action:'supplier',id:String(card.id)});
  assert.equal((ui.app.innerHTML.match(/class="inline-list"/g)||[]).length,1);
  assert.doesNotMatch(ui.app.innerHTML,/class="(?:plus-menu|size-menu)"/);
 }
 d.api.key='';await ui.click({action:'plus'});
 await ui.click({action:'pull-models',id:String(card.id)});
 assert.doesNotMatch(ui.app.innerHTML,/class="(?:plus-menu|size-menu|inline-list)"/);
});

test('supplier format picker replaces separate protocol and preserves invalidation', async()=>{
 const ui=await mount(),{d,card}=configure(ui);d.history=[{role:'user',content:'old context'}];card.models=[{id:'old'}];
 await ui.click({action:'plus'});await ui.click({action:'supplier',id:String(card.id)});
 assert.match(ui.app.innerHTML,/role="listbox"/);assert.equal((ui.app.innerHTML.match(/role="option"/g)||[]).length,8);
 assert.doesNotMatch(ui.app.innerHTML,/data-action="protocol-menu"|id="protocol-label/);
 assert.doesNotMatch(ui.app.innerHTML,/class="plus-menu"/);
 await ui.click({action:'choose-supplier',id:String(card.id),index:'3'});
 assert.equal(d.api.protocol,'openai');assert.equal(d.api.key,'');assert.equal(d.api.trustedTarget,'');assert.equal(d.api.model,'');assert.equal(d.api.url,'');
 assert.equal(d.history.length,0);assert.equal(card.models.length,0);
 assert.doesNotMatch(ui.app.innerHTML,/role="listbox"/);
 assert.match(ui.app.innerHTML,/自定义 · OpenAI 格式/);
});

test('filled configuration applies only on send/list actions with no settings buttons', async()=>{
 let sent=0,listed=0;
 const ui=await mount({confirm:()=>assert.fail('No target modal'),runConversation:async({config,imageConfig})=>{sent++;assert.equal(config.trustedTarget,config.url);assert.equal(imageConfig.trustedTarget,imageConfig.url);return {text:'ok',history:[]};},listModels:async({config})=>{listed++;assert.equal(config.trustedTarget,config.url);return[];}});
 ui.addCard('api');const d=ui.data.chat,card=d.messages.at(-1),key=ui.app.querySelector(`#key${card.id}`);
 key.value='synthetic';ui.input(key);assert.equal(sent+listed,0);assert.equal(d.api.trustedTarget,'');
 assert.doesNotMatch(ui.app.innerHTML,/data-action="(?:trust-target|clear-key)"/);
 await ui.click({action:'pull-models',id:String(card.id)});assert.equal(listed,1);
 ui.data.image.api.key='synthetic-image';ui.data.image.api.trustedTarget='';d.draft='test';await ui.click({action:'send'});assert.equal(sent,1);
});

for (const [index, name, url] of [
  ['5', 'DeepSeek', 'https://api.deepseek.com'],
  ['6', '智谱 AI · 普通 API', 'https://open.bigmodel.cn/api/paas/v4']
]) {
  test(`${name} preset is visible and switches to ordinary OpenAI-compatible API without carrying Gemini state`, async()=> {
    const ui = await mount(), { d, card } = configure(ui);
    const imageBefore = { ...ui.data.image.api };
    await ui.click({ action: 'supplier', id: String(card.id) });
    assert.ok(ui.app.innerHTML.includes(name));
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.supplier, name); assert.equal(d.api.url, url);
    assert.equal(d.api.protocol, 'openai'); assert.equal(d.api.model, '');
    assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
    assert.equal(ui.isConfigured(d), false);
    assert.deepEqual({ ...ui.data.image.api }, imageBefore);
    d.api.model = 'user-selected-model'; d.api.key = 'synthetic-provider-key';
    d.api.trustedTarget = url;
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.model, 'user-selected-model');
    assert.equal(d.api.key, 'synthetic-provider-key');
  });
  test(`${name} does not claim image generation support`, async()=> {
    const ui = await mount(), { d, card } = configure(ui, 'image');
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.model, ''); assert.equal(ui.matrixSupported(d), false);
  });
}

test('pending request shows only accessible spinner and clears it on completion', async()=>{
 let resolve;
 const ui=await mount({runConversation:()=>new Promise(r=>{resolve=r;})}),{d}=configure(ui);
 d.draft='offline pending';const pending=ui.click({action:'send'});await Promise.resolve();
 assert.equal(d.busy,true);assert.match(ui.app.innerHTML,/class="api-spinner"/);
 assert.match(ui.app.innerHTML,/role="status" aria-label="等待响应头；可随时取消"/);
 assert.doesNotMatch(ui.app.innerHTML,/正在请求 API/);
 assert.match(ui.app.innerHTML,/data-action="cancel"/);
 resolve({text:'offline result',usage:null,messages:[]});await pending;
 assert.equal(d.busy,false);assert.doesNotMatch(ui.app.innerHTML,/class="api-spinner"/);
});

test('attachment send clears draft only on success, guards duplicate, and retains history', async()=>{
 let resolve, sent;
 const ui=await mount({runConversation: args=>{sent=args;return new Promise(r=>resolve=r);}}),{d}=configure(ui);
 const files=await attachments.prepareFiles([new File(['fixture'],'a.png',{type:'image/png'})],[],'gemini',['image']);
 d.attachments=files;
 const operation=ui.click({action:'send'});await Promise.resolve();
 assert.equal(d.busy,true);assert.equal(d.attachments.length,0);assert.equal(sent.messages[0].attachments[0].id,files[0].id);
 await ui.click({action:'send'});assert.equal(d.messages.filter(m=>m.type==='user').length,1);
 resolve({history:sent.messages,text:'OK'});await operation;
 assert.equal(d.history[0].attachments[0].id,files[0].id);assert.match(ui.app.innerHTML,/a.png/);
});
test('failed attachment send restores draft; remove/clear preserve unrelated state', async()=>{
 const ui=await mount({runConversation:async()=>{throw new Error('failure');}}),{d}=configure(ui);
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'a.txt',{type:'text/plain'})],[],'gemini',['text']);d.draft='hello';
 await ui.click({action:'send'});assert.equal(d.attachments.length,1);assert.equal(d.draft,'hello');
 await ui.click({action:'remove-attachment',id:d.attachments[0].id});assert.equal(d.attachments.length,0);assert.equal(d.draft,'hello');
 await ui.click({action:'clear-chat'});assert.equal(d.history.length,0);assert.equal(d.messages.length,0);assert.equal(d.api.key,'synthetic-control-key');
});
test('input modality toggles and protocol changes reject incompatible draft before request', async()=>{
 const ui=await mount(),{d}=configure(ui);ui.addCard('model');const card=d.messages.at(-1);
 await ui.click({action:'toggle-input',id:String(card.id),modality:'image'});assert(!d.model.inputs.includes('image'));
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'a.pdf',{type:'application/pdf'})],[],'gemini',['pdf']);d.api.protocol='ark';
 await ui.click({action:'send'});assert.equal(d.busy,false);assert.equal(d.attachments.length,1);assert.match(d.attachmentError,/未启用/);
});
test('page session permits attachment-only approval, describes files and rejects attachment race', async()=>{
 let confirmation='',calls=0;
 const ui=await mount({confirm:message=>{confirmation=message;return true;},runConversation:async args=>{calls++;return {text:'OK',history:args.messages};}}),{d}=configure(ui);
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'note.txt',{type:'text/plain'})],[],'gemini',['text']);
 const result=await ui.session.execute({command:'request.send',args:{}});assert.equal(result.result.status,'completed');assert.equal(calls,1);assert.match(confirmation,/note.txt.*KiB/);
 d.attachments=await attachments.prepareFiles([new File(['fixture2'],'second.txt',{type:'text/plain'})],[],'gemini',['text']);
 const sending=ui.session.execute({command:'request.send',args:{}});d.attachments=[];const raced=await sending;assert.equal(raced.result.reason,'changed-after-confirmation');assert.equal(calls,1);
 d.attachmentReading=true;d.draft='not ready';assert.equal((await ui.session.execute({command:'request.send',args:{}})).ok,false);assert.equal(calls,1);
});

test('late success or error cannot steal a reading position after switching away and back', async()=>{
 for(const fail of [false,true]){
  let resolve,reject;
  const ui=await mount({runConversation:()=>new Promise((ok,no)=>{resolve=ok;reject=no;})}),{d}=configure(ui);
  ui.app.scrollHeight=5000;ui.app.clientHeight=800;ui.app.scrollTop=100;d.draft='delayed offline';
  const pending=ui.click({action:'send'});assert.equal(ui.app.scrollTop,5000);
  ui.app.scrollTop=600;
  await ui.click({action:'tab',tab:'image'});await ui.click({action:'tab',tab:'chat'});
  assert.equal(ui.app.scrollTop,600);
  if(fail)reject(new core.AppError('TEST','late failure'));else resolve({text:'late result',history:[],usage:null});
  await pending;assert.equal(ui.app.scrollTop,600);assert.equal(d.busy,false);
 }
});

test('reopening settings preserves key, deleting it clears memory immediately, inactive cards cannot restore it', async()=>{
 const ui=await mount(),{d,card:old}=configure(ui);const retained=d.api.key;
 ui.addCard('api');const current=d.messages.at(-1),key=ui.app.querySelector(`#key${current.id}`);
 assert.equal(key.value,retained);assert.equal(d.api.key,retained);assert.equal(Object.hasOwn(old.values,'key'),false);
 key.value='';ui.input(key);assert.equal(d.api.key,'');assert.equal(d.api.trustedTarget,'');
 ui.input({dataset:{card:String(old.id),key:'key'},value:'stale-key'});assert.equal(d.api.key,'');
});
test('send reconciles eventless autofill, while target edits never carry an unchanged old key', async()=>{
 let calls=0;
 const ui=await mount({runConversation:async({config})=>{calls++;assert.equal(config.key,'autofilled-new');return{text:'ok',history:[]};}});
 const {d,card}=configure(ui);ui.app.querySelector(`#key${card.id}`).value='autofilled-new';d.draft='autofilled';await ui.click({action:'send'});assert.equal(calls,1);
 ui.addCard('api');const next=d.messages.at(-1),url=ui.app.querySelector(`#url${next.id}`);url.value='https://other.example.com/v1';
 d.draft='must not send old key';await ui.click({action:'send'});assert.equal(calls,1);assert.equal(d.api.key,'');assert.equal(d.api.trustedTarget,'');
});
test('deleting a key without blur prevents send and list immediately', async()=>{
 const ui=await mount(),{d,card}=configure(ui);const key=ui.app.querySelector(`#key${card.id}`);key.value='';ui.input(key);
 await ui.click({action:'pull-models',id:String(card.id)});assert.match(card.modelListStatus,/请先填写/);
 d.draft='no key';await ui.click({action:'send'});assert.equal(d.api.key,'');assert.equal(d.busy,false);
});

test('eventless target and new-key autofill stay consistent across consecutive sends', async()=>{
 let calls=0;const ui=await mount({runConversation:async({config})=>{calls++;assert.equal(config.url,'https://new.example.com/v1');assert.equal(config.key,'new-autofill');return{text:'ok',history:[]};}}),{d,card}=configure(ui);
 ui.app.querySelector(`#url${card.id}`).value='https://new.example.com/v1';ui.app.querySelector(`#key${card.id}`).value='new-autofill';
 for(let i=0;i<2;i++){d.draft='request '+i;await ui.click({action:'send'});assert.equal(ui.app.querySelector(`#key${card.id}`).value,'');assert.equal(d.api.key,'new-autofill');}
 assert.equal(calls,2);
});
test('page-tool confirmation snapshots autofill before approval and refuses eventless post-approval edits', async()=>{
 let calls=0,ui,card;
 ui=await mount({confirm:()=>{ui.app.querySelector(`#url${card.id}`).value='https://racing.example.com/v1';ui.app.querySelector(`#key${card.id}`).value='racing-key';return true;},runConversation:async()=>{calls++;return{text:'unexpected',history:[]};}});
 ({card}=configure(ui));ui.data.chat.draft='tool send';
 const result=await ui.session.execute({command:'request.send',args:{}});
 assert.equal(calls,0);assert.equal(result.result.reason,'changed-after-confirmation');
});

test('all custom format entries start empty and cannot request before credentials are filled', async()=>{
 for(const [index,protocol] of [['2','gemini'],['3','openai'],['7','anthropic']]){
  const ui=await mount(),{d,card}=configure(ui);await ui.click({action:'choose-supplier',id:String(card.id),index});
  assert.equal(d.api.protocol,protocol);for(const key of ['url','key','model','trustedTarget'])assert.equal(d.api[key],'');
  assert.equal(ui.isConfigured(d),false);
  await ui.click({action:'pull-models',id:String(card.id)});
  assert.match(card.modelListStatus,/请先填写/);
 }
});
test('historical cards and invalid supplier IDs cannot mutate the current credentials', async()=>{
 const ui=await mount(),{d,card}=configure(ui);ui.addCard('api');const before={...d.api};
 for(const action of ['supplier','choose-supplier','pull-models','choose-model','toggle-key']){
  await ui.click({action,id:String(card.id),index:'3',model:'unexpected'});
  assert.deepEqual({...d.api},before);
 }
 const current=d.messages.findLast(m=>m.type==='card');
 await ui.click({action:'choose-supplier',id:String(current.id),index:'999'});
 assert.deepEqual({...d.api},before);
});
test('legacy custom provider label reselects without discarding current manual endpoint', async()=>{
 const ui=await mount(),{d,card}=configure(ui);Object.assign(d.api,{supplier:'自定义 · Gemini',url:'https://custom.example.com/v1beta',model:'custom'});
 await ui.click({action:'choose-supplier',id:String(card.id),index:'2'});
 assert.equal(d.api.url,'https://custom.example.com/v1beta');assert.equal(d.api.key,'synthetic-control-key');assert.equal(d.api.model,'custom');
});

test('manual endpoint edits remove misleading official supplier identity', async()=>{
 const ui=await mount(),{d,card}=configure(ui);
 ui.input({value:'https://gateway.example.com/v1beta',dataset:{card:String(card.id),key:'url'}});
 assert.equal(d.api.supplier,'自定义 · Gemini 格式');
 ui.render();assert.match(ui.app.innerHTML,/自定义 · Gemini 格式<\/button>/);
 assert.doesNotMatch(ui.app.innerHTML,/>Google Gemini<\/button>/);
 ui.input({value:core.GEMINI_ENDPOINT,dataset:{card:String(card.id),key:'url'}});
 assert.equal(d.api.supplier,'Google Gemini');
});

test('pure family choice never enables strength; unset keeps family quick values', async()=>{
 const ui=await mount(),{d}=configure(ui);d.api.protocol='openai';d.api.url='https://gateway.example/v1';d.api.model='custom';ui.addCard('model');const id=String(d.messages.at(-1).id);
 await ui.click({action:'reasoning-toggle',id});
 const menu=ui.app.innerHTML.match(/<section class="reasoning-menu reasoning-family-list"[\s\S]*?<\/section>/)[0];
 assert.match(menu,/Claude 模板/);assert.match(menu,/DeepSeek 模板/);assert.doesNotMatch(menu,/不指定|推荐|思考开关|high|预算|应用|取消/);
 await ui.click({action:'reasoning-family',id,family:'openai'});assert.equal(d.model.reasoningFamily,'openai');assert.equal(d.model.reasoning,undefined);
 await ui.click({action:'reasoning-toggle'});await ui.click({action:'reasoning-quick',template:'openai-effort',value:'high'});assert.equal(d.model.reasoning.value,'high');
 await ui.click({action:'reasoning-toggle'});await ui.click({action:'reasoning-quick',value:''});assert.equal(d.model.reasoning,undefined);assert.equal(d.model.reasoningFamily,'openai');
 await ui.click({action:'reasoning-toggle'});assert.match(ui.app.innerHTML,/data-value="high"/);
});
test('reasoning incompatible protocol selection is cleared when changing supplier', async()=>{
 const ui=await mount(),{d,card}=configure(ui);d.model.reasoning={template:'openai-effort',value:'high'};
 await ui.click({action:'choose-supplier',id:String(card.id),index:'7'});
 assert.equal(d.api.protocol,'anthropic');assert.equal(d.model.reasoning,undefined);
});

test('cross-protocol family fails visibly without changing protocol or configuration', async()=>{
 const ui=await mount(),{d}=configure(ui);ui.addCard('model');const id=String(d.messages.at(-1).id);
 await ui.click({action:'reasoning-toggle',id});await ui.click({action:'reasoning-family',id,family:'anthropic'});
 assert.equal(d.api.protocol,'gemini');assert.equal(d.model.reasoningFamily,undefined);assert.match(d.reasoningIssue,/接口格式不匹配/);
});
test('session approval rejects in-place reasoning value changes before dispatch', async()=>{
 let calls=0;const ui=await mount({runConversation:async()=>{calls++;return {text:'no',history:[]}}}),{d}=configure(ui);
 d.draft='test';d.model.reasoning={template:'gemini-budget',value:1024};
 const pending=ui.session.execute({command:'request.send',args:{}});d.model.reasoning.value=2048;
 const result=await pending;assert.equal(calls,0);assert.equal(result.result.reason,'changed-after-confirmation');
});

test('each streamed round retains its own immutable metrics through later sends and failure', async()=>{
 let send=0;
 const ui=await mount({runConversation:async({onDelta,onResponse})=>{
   send++;
   const first=usage.replyMetricsSnapshot({totalTokens:send*100,inputTokens:10,cachedTokens:0},{chunks:2,durationMs:1000},10);
   onDelta('first',{round:0});onResponse({metrics:first},{round:0});
   onDelta('second',{round:1});
   if(send===2) throw new core.AppError('CANCELLED','cancelled fixture');
   const final=usage.replyMetricsSnapshot({totalTokens:200,inputTokens:20,cachedTokens:0},{chunks:2,durationMs:2000},30);
   onResponse({metrics:final},{round:1});return {text:'second',history:[],usage:final.usage,metrics:final};
 }}),{d}=configure(ui);
 d.draft='one';await ui.click({action:'send'});
 let replies=d.messages.filter(m=>m.type==='chatResult');
 assert.equal(replies.length,2);assert.equal(replies[0].metrics.speed,10);assert.equal(replies[1].metrics.speed,15);
 const previous=replies[0].metrics;
 assert.strictEqual(d.lastMetrics,replies[1].metrics);
 d.draft='two';await ui.click({action:'send'});
 replies=d.messages.filter(m=>m.type==='chatResult');
 assert.strictEqual(replies[0].metrics,previous);assert.equal(previous.usage.totalTokens,100);
 assert.equal(replies.at(-1).incomplete,true);assert.equal(replies.at(-1).metrics,undefined);assert.equal(d.lastMetrics,null);
 assert.match(ui.app.innerHTML,/reply-metrics/);assert.doesNotMatch(ui.app.innerHTML,/耗时 <strong>/);
});

 test('clearing conversation also clears footer metrics snapshot', async()=>{
 const ui=await mount(),{d}=configure(ui);d.lastMetrics={usage:{totalTokens:10},speed:2};
 await ui.click({action:'clear-chat'});assert.equal(d.lastMetrics,null);assert.equal(d.lastUsage,null);
 });

test('historical family card cannot change current family and supplier change clears incompatible family', async()=>{
 const ui=await mount(),{d}=configure(ui);d.api.protocol='openai';d.api.url='https://gateway.example/v1';ui.addCard('model');const old=String(d.messages.at(-1).id);
 await ui.click({action:'reasoning-toggle',id:old});await ui.click({action:'reasoning-family',id:old,family:'deepseek'});assert.equal(d.model.reasoningFamily,'deepseek');
 ui.addCard('model');await ui.click({action:'reasoning-toggle',id:old});await ui.click({action:'reasoning-family',id:old,family:'openai'});assert.equal(d.model.reasoningFamily,'deepseek');
 ui.addCard('api');await ui.click({action:'choose-supplier',id:String(d.messages.at(-1).id),index:'0'});assert.equal(d.model.reasoningFamily,undefined);
});
test('quick setting validation failure is visible once without sending or silently changing selection', async()=>{
 const ui=await mount(),{d}=configure(ui);d.api.protocol='anthropic';d.api.url='https://gateway.example/v1';d.api.model='claude-opus-4-6';d.api.url='https://api.anthropic.com/v1';d.model.reasoningMode='anthropic-effort';d.model.temperature='0.7';
 for(let i=0;i<5;i++)await ui.click({action:'reasoning-quick',template:'anthropic-effort',value:'high'});
 assert.equal(d.model.reasoning,undefined);assert.match(d.reasoningIssue,/温度/);assert.equal((ui.app.innerHTML.match(/class="reasoning-error"/g)||[]).length,1);
 await ui.click({action:'reasoning-quick',value:''});assert.equal(d.reasoningIssue,'');
});

test('budget is editable only in composer intensity layer and blank never becomes zero', async()=>{
 const ui=await mount(),{d}=configure(ui);d.api.model='gemini-2.5-flash';ui.addCard('model');
 await ui.click({action:'reasoning-toggle',id:String(d.messages.at(-1).id)});assert.doesNotMatch(ui.app.innerHTML,/id="reasoning-quick-budget"/);
 await ui.click({action:'reasoning-family',id:String(d.messages.at(-1).id),family:'gemini'});assert.equal(d.model.reasoning,undefined);
 await ui.click({action:'reasoning-toggle'});const field=ui.app.querySelector('#reasoning-quick-budget');field.value='';
 await ui.click({action:'reasoning-budget-apply'});assert.equal(d.model.reasoning,undefined);assert.match(d.reasoningIssue,/请输入/);
 ui.app.querySelector('#reasoning-quick-budget').value='1024';await ui.click({action:'reasoning-budget-apply'});assert.equal(d.model.reasoning.value,'1024');
});

test('historical unselected custom family does not inherit a later official provider', async()=>{
 const ui=await mount(),{d}=configure(ui);d.api.protocol='openai';d.api.url='https://gateway.example/v1';d.api.model='x';ui.addCard('model');const old=d.messages.at(-1);
 ui.addCard('api');await ui.click({action:'choose-supplier',id:String(d.messages.at(-1).id),index:'0'});
 assert.equal(old.values.reasoningFamily,null);assert.match(ui.app.innerHTML,new RegExp('id="reasoning-model'+old.id+'"[^>]*>选择模板</button>'));
});

test('composer reasoning label shows current value, unset and budget without generic set marker', async()=>{
 const ui=await mount(),{d,card}=configure(ui);d.api.protocol='openai';d.api.url='https://api.deepseek.com';d.api.model='deepseek-flash';ui.render();
 assert.match(ui.app.innerHTML,/aria-label="思考强度：不指定"/);
 await ui.click({action:'reasoning-quick',template:'deepseek-effort',value:'high'});assert.match(ui.app.innerHTML,/aria-label="思考强度：high"/);assert.doesNotMatch(ui.app.innerHTML,/已设/);
 await ui.click({action:'reasoning-quick',value:''});assert.match(ui.app.innerHTML,/aria-label="思考强度：不指定"/);
 d.api.protocol='gemini';d.api.url=core.GEMINI_ENDPOINT;d.api.model='gemini-2.5-flash';d.model.reasoning={template:'gemini-budget',value:1024};ui.render();assert.match(ui.app.innerHTML,/aria-label="思考强度：1024 Token"/);
 d.model.reasoning.value=-1;ui.render();assert.match(ui.app.innerHTML,/aria-label="思考强度：动态"/);d.model.reasoning.value=0;ui.render();assert.match(ui.app.innerHTML,/aria-label="思考强度：关闭"/);
 await ui.click({action:'choose-supplier',id:String(card.id),index:'7'});assert.match(ui.app.innerHTML,/aria-label="思考强度：不指定"/);
});


test('typing API credentials one character at a time never archives prefixes into persisted history', async()=>{
 const ui=await mount();ui.addCard('api');const d=ui.data.chat;
 d.draft='status signature sk-ordinary';
 d.history=[{role:'assistant',content:'status',raw:{parts:[{text:'status',thoughtSignature:'s'},{thoughtSignature:'sk-long-opaque-signature'}]}}];
 const original=JSON.stringify(d.history),field=ui.app.querySelector(`#key${d.messages.at(-1).id}`);
 for(const value of ['s','sk','sk-','sk-real-complete']){
  field.value=value;ui.input(field);const saved=ui.persisted();
  assert.equal(saved.workspaces.chat.api.url,d.api.url);
  assert.equal(JSON.stringify(saved.workspaces.chat.history),original);
  assert.equal(saved.workspaces.chat.draft,'status signature sk-ordinary');
  assert.equal(saved.workspaces.chat.api.key,undefined);
 }
});

test('only an explicitly submitted complete credential remains protected after field replacement', async()=>{
 const ui=await mount({runConversation:async({config})=>{await core.listModels({config,fetchImpl:async()=>new Response(JSON.stringify({models:[]}),{status:200})});return {text:'done',history:[],usage:null};}}),{d}=configure(ui);
 d.api.key='sk-complete-credential';ui.render();d.draft='hello';await ui.click({action:'send'});
 const field=ui.app.querySelector(`[data-key="key"]`) || ui.app.querySelector(`#key${d.messages.find(m=>m.type==='card').id}`);
 field.value='';ui.input(field);
 d.draft='Bearer sk-complete-credential / key=sk-complete-credential';
 const saved=ui.persisted();assert.ok(!saved.workspaces.chat.draft.includes('sk-complete-credential'));assert.ok(saved.workspaces.chat.draft.includes('[密钥已移除]'));
});

test('any output after an API card freezes fields and buttons; reopening captures current settings',async()=>{
 const ui=await mount({runConversation:async()=>({text:'answer',history:[]})}),{d,card}=configure(ui);
 d.api.model='chosen-model';ui.render();d.draft='send';await ui.click({action:'send'});
 const frozen=JSON.stringify(card.values);assert.equal(card.values.model,'chosen-model');
 ui.input({dataset:{card:String(card.id),key:'model'},value:'stale'});
 await ui.click({action:'choose-supplier',id:String(card.id),index:'4'});
 assert.equal(d.api.model,'chosen-model');assert.match(ui.app.innerHTML,new RegExp(`data-interaction-card="${card.id}"[\\s\\S]*?<fieldset disabled`));
 d.api.model='later-model';ui.render();assert.equal(JSON.stringify(card.values),frozen);
 ui.addCard('api');assert.equal(d.messages.at(-1).values.model,'later-model');
});
test('model list resolving after a later card does not mutate the historical card',async()=>{
 let release;const ui=await mount({listModels:()=>new Promise(resolve=>release=resolve)}),{d,card}=configure(ui);
 const pending=ui.click({action:'pull-models',id:String(card.id)});ui.addCard('model');
 release([{id:'late'}]);await pending;assert.deepEqual(card.models,[]);assert.equal(d.busy,false);assert.doesNotMatch(ui.app.innerHTML,/data-model="late"/);
});
test('inline page confirmation waits for its tail-card action and sends exactly once',async()=>{
 let calls=0;const ui=await mount({confirm:null,runConversation:async()=>{calls++;return {text:'done',history:[]};}}),{d}=configure(ui);d.draft='inline test';
 const pending=ui.session.execute({command:'request.send',args:{}});const card=d.messages.at(-1),confirmationText=card.values.text;
 assert.equal(card.kind,'confirmation');assert.equal(calls,0);
 assert.match(ui.app.innerHTML,/data-action="confirm-card"/);
 await ui.click({action:'confirm-card',id:String(card.id),choice:'yes'});
 assert.equal((await pending).ok,true);await ui.click({action:'confirm-card',id:String(card.id),choice:'yes'});assert.equal(calls,1);
 assert.equal(d.messages.find(m=>m.id===card.id).values.text,confirmationText);
});
test('a newer card cancels an inline confirmation and obsolete confirm events cannot send',async()=>{
 let calls=0;const ui=await mount({confirm:null,runConversation:async()=>calls++}),{d}=configure(ui);d.draft='not sent';
 const pending=ui.session.execute({command:'request.send',args:{}}),card=d.messages.at(-1);ui.addCard('model');
 assert.equal((await pending).error,'CONFIRMATION_REQUIRED');await ui.click({action:'confirm-card',id:String(card.id),choice:'yes'});assert.equal(calls,0);
});
test('confirmation cards remain actionable during an agent request; cancel releases a waiting tool',async()=>{
 let consent;const ui=await mount({confirm:null,runConversation:async({confirmTool})=>{consent=await confirmTool({target:'https://example.com',model:'fixture',args:{prompt:'synthetic'}});return {text:'cancelled tool',history:[]};}}),{d}=configure(ui);d.draft='tool';
 const pending=ui.click({action:'send'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(d.busy,true);assert.equal(d.messages.at(-1).kind,'confirmation');
 await ui.click({action:'cancel'});await pending;assert.equal(consent,false);assert.equal(d.busy,false);
});
test('chart and log cards use snapshots and the shared action guard',async()=>{
 logs.clearNetworkLogs();const ui=await mount(),{d}=configure(ui);d.lastUsage={inputTokens:0,outputTokens:12,totalTokens:null};
 await ui.click({action:'new-card',kind:'chart'});const chart=d.messages.at(-1);assert.deepEqual(chart.values.rows.map(x=>x.value),[0,12,null]);
 await ui.click({action:'new-card',kind:'logs'});const logCard=d.messages.at(-1);d.lastUsage={inputTokens:99};
 await ui.click({action:'refresh-chart',id:String(chart.id)});assert.equal(chart.values.rows[0].value,0);
 logs.recordNetwork({source:'synthetic',requestId:'late'});assert.equal(logCard.values.entries.length,0);
 await ui.click({action:'refresh-logs-card',id:String(logCard.id)});assert.equal(logCard.values.entries.length,1);
 assert.equal(ui.persisted().workspaces.chat.messages.at(-1).kind,'logs');logs.clearNetworkLogs();
});
