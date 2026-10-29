import * as attachments from '../src/attachments.js';
import { usageMetricsMarkup } from '../src/usage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../src/core.js';
import { icon } from '../src/icons.js';
import * as logs from '../src/logs.js';
import { createPageSession } from '../src/session.js';

// A small event/DOM harness for the production module. No browser, network,
// real key, external package or production testing hooks are required.
const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function mount({ confirm = () => true, runConversation, dispatchCommand, listModels } = {}) {
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
  const context = {
    ...core, ...logs, ...attachments, usageMetricsMarkup, icon, document, window: { confirm, addEventListener: () => {} }, createPageSession, registerPageSessionTools: () => {},
    renderNetworkLogs: container => { if (container) container.textContent = logs.exportNetworkLogs(); },
    URL, Blob, Uint8Array, atob, AbortController, performance,
    runConversation: runConversation || neverFetch, listModels: listModels || neverFetch, dispatchCommand: dispatchCommand || neverFetch
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.controlTests = { isConfigured, data, addCard, render, matrixSupported, setPage: p => { page = p; } };`, context);
  return {
    ...context.controlTests, app, document, session: context.window.llmWorkbench,
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

test('URL input immediately revokes visible trust without rebuilding the focused input', () => {
  const ui = mount(), { d, card } = configure(ui);
  const input = ui.app.querySelector(`#url${card.id}`), renders = ui.app.renders;
  input.value = 'https://new.example.com/v1';
  input.selectionStart = input.selectionEnd = 12;
  ui.document.activeElement = input;
  assert.equal(ui.isConfigured(ui.data.chat), true);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /已确认目标/);
  ui.input(input);
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.equal(ui.app.querySelector(`#key${card.id}`).value, '');
  assert.equal(ui.isConfigured(ui.data.chat), false);
  assert.equal(ui.app.querySelector('.top-right'), null);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /调用前需确认目标/);
  assert.equal(ui.app.renders, renders);
  assert.equal(ui.app.querySelector(`#url${card.id}`), input);
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.selectionStart, 12); assert.equal(input.selectionEnd, 12);
});

test('key and model edits immediately keep configuration validation accurate without a full render', () => {
  const ui = mount(), { card } = configure(ui), renders = ui.app.renders;
  const key = ui.app.querySelector(`#key${card.id}`), model = ui.app.querySelector(`#model${card.id}`);
  key.value = ''; ui.input(key);
  assert.equal(ui.isConfigured(ui.data.chat), false);
  key.value = 'synthetic-replacement-key'; ui.input(key);
  assert.equal(ui.isConfigured(ui.data.chat), true);
  model.value = ''; ui.input(model);
  assert.equal(ui.isConfigured(ui.data.chat), false);
  assert.equal(ui.app.renders, renders);
});

test('reselecting the same canonical provider retains key, trust, custom model and model list', async () => {
  for (const url of ['https://generativelanguage.googleapis.com/v1beta', 'https://generativelanguage.googleapis.com:443/v1beta/']) {
    const ui = mount(), { d, card } = configure(ui);
    d.api.url = url; d.api.model = 'gemini-custom-model';
    card.models = [{ id: 'gemini-custom-model' }];
    const before = { ...d.api }, models = card.models;
    await ui.click({ action: 'choose-supplier', id: String(card.id), index: '0' });
    assert.deepEqual({ ...d.api }, before);
    assert.equal(card.models, models);
  }
});

test('reselecting the active custom provider keeps its manually entered target and credentials', async () => {
  const ui = mount(), { d, card } = configure(ui);
  Object.assign(d.api, { url: 'https://custom.example.com/v1beta', trustedTarget: 'https://custom.example.com/v1beta', supplier: '自定义 · Gemini', model: 'gemini-custom-model' });
  const before = { ...d.api };
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '2' });
  assert.deepEqual({ ...d.api }, before);
});

test('restoring a provider default after manual URL change still clears key and trust', async () => {
  const ui = mount(), { d, card } = configure(ui);
  d.api.url = d.api.trustedTarget = 'https://custom.example.com/v1beta';
  d.api.model = 'gemini-custom-model';
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '0' });
  assert.equal(d.api.url, core.GEMINI_ENDPOINT);
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.equal(d.api.model, core.DEFAULT_TEXT_MODEL);
});

test('changing protocol or switching into a different custom provider still clears credentials', async () => {
  for (const index of ['1', '2', '3']) {
    const ui = mount(), { d, card } = configure(ui);
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  }
});

test('image page accepts the shared core models/ prefix and still rejects other protocols/models', async () => {
  const ui = mount(), { d } = configure(ui, 'image');
  d.api.model = ` models/${core.IMAGE_MODEL} `;
  await ui.click({ action: 'size-toggle' });
  assert.equal(ui.matrixSupported(d), true);
  assert.equal((ui.app.innerHTML.match(/data-action="set-image-options"/g) || []).length, 42);
  d.api.protocol = 'openai'; assert.equal(ui.matrixSupported(d), false);
  d.api.protocol = 'gemini'; d.api.model = 'models/not-an-image-model'; assert.equal(ui.matrixSupported(d), false);
});

test('Token metric identifies usage as the last request rather than a summed Agent turn', () => {
  const ui = mount();
  assert.match(ui.app.innerHTML, /末次请求 Token/);
});


test('Ark preset changes only the active workspace and renders its 24 option matrix', async () => {
  const ui = mount(), { d, card } = configure(ui, 'image');
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

test('Ark text preset uses the ordinary endpoint and honest manual model entry', async () => {
  const ui = mount(), { d, card } = configure(ui);
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '4' });
  assert.equal(d.api.protocol, 'ark'); assert.equal(d.api.model, core.ARK_TEXT_MODEL);
  assert.match(ui.app.innerHTML, /普通 API · 非 Agent Plan/);
  assert.match(ui.app.innerHTML, /手填模型/);
  await ui.click({ action: 'pull-models', id: String(card.id) });
  assert.match(ui.app.innerHTML, /暂无已核实的模型列表接口/);
});

test('logs tab has no composer, shows sanitized records and can clear them', async () => {
  logs.clearNetworkLogs();
  const ui = mount();
  logs.recordNetwork({ requestId: 'ui-log', source: 'mock', endpoint: 'https://api.example.com', status: 200 });
  await ui.click({ action: 'tab', tab: 'logs' });
  assert.match(ui.app.innerHTML, /导出 JSON/);
  assert.doesNotMatch(ui.app.innerHTML, /id="draft"/);
  assert.match(ui.app.querySelector('#network-logs').textContent, /ui-log/);
  await ui.click({ action: 'clear-logs' });
  assert.equal(logs.getNetworkLogs().length, 0);
});

test('live page session state redacts keys and cannot edit endpoints or trust', async () => {
  const ui = mount(), { d } = configure(ui);
  d.draft = 'test ' + d.api.key;
  const state = await ui.session.execute({ command: 'session.state', args: {} });
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /synthetic-control-key/);
  assert.match(serialized, /REDACTED/);
  await assert.rejects(ui.session.execute({ command: 'settings.update', args: { url: 'https://other.example.com' } }));
  await assert.rejects(ui.session.execute({ command: 'settings.update', args: { key: 'synthetic-injection' } }));
});

test('live page session updates Ark parameters but rejects unavailable 4K atomically', async () => {
  const ui = mount(), { d, card } = configure(ui, 'image');
  await ui.click({ action: 'choose-supplier', id: String(card.id), index: '4' });
  const result = await ui.session.execute({ command: 'settings.update', args: { imageSize: '1.5K', aspectRatio: '16:9' } });
  assert.equal(result.ok, true); assert.equal(d.imageSize, '1.5K'); assert.equal(d.aspectRatio, '16:9');
  const rejected = await ui.session.execute({ command: 'settings.update', args: { imageSize: '4K' } });
  assert.equal(rejected.ok, false); assert.equal(d.imageSize, '1.5K');
  await ui.session.execute({ command: 'page.navigate', args: { page: 'logs' } });
  const hidden = await ui.session.execute({ command: 'draft.set', args: { text: 'must not change hidden draft' } });
  assert.equal(hidden.ok, false);
});

test('live page session send needs page confirmation and reports actual failure rather than success', async () => {
  let calls = 0;
  const ui = mount({ confirm: () => false, runConversation: () => { calls++; } }), { d } = configure(ui);
  d.draft = 'not authorized';
  assert.equal((await ui.session.execute({ command: 'request.send', args: {} })).ok, false);
  assert.equal(calls, 0);
  const approved = mount({ runConversation: async () => { throw new core.AppError('NETWORK', 'Network failed'); } });
  configure(approved); approved.data.chat.draft = 'authorized synthetic failure';
  const result = await approved.session.execute({ command: 'request.send', args: {} });
  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.code, 'NETWORK');
});


test('session approval is bound to the exact draft and rejects a racing replacement', async () => {
  let calls = 0;
  const ui = mount({ runConversation: async () => { calls++; return { text: 'should not send', history: [] }; } });
  configure(ui); ui.data.chat.draft = 'approved draft';
  const sending = ui.session.execute({ command: 'request.send', args: {} });
  await ui.session.execute({ command: 'draft.set', args: { text: 'changed after approval' } });
  const result = await sending;
  assert.equal(result.result.status, 'not-sent');
  assert.equal(result.result.reason, 'changed-after-confirmation');
  assert.equal(calls, 0);
});

test('session approval cannot be redirected to a different workspace or model', async () => {
  for (const change of [{ command: 'page.navigate', args: { page: 'image' } }, { command: 'settings.update', args: { model: 'different-model' } }]) {
    let calls = 0;
    const ui = mount({ runConversation: async () => { calls++; } });
    configure(ui); ui.data.chat.draft = 'approved draft';
    const sending = ui.session.execute({ command: 'request.send', args: {} });
    await ui.session.execute(change);
    const result = await sending;
    assert.equal(result.result.status, 'not-sent'); assert.equal(calls, 0);
  }
});

test('unused key from the other workspace is redacted in fetch logs, session logs and log tab', async () => {
  logs.clearNetworkLogs();
  const secret = 'synthetic-unused-other-workspace-6e447';
  const ui = mount({ runConversation: async () => {
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


test('session cancel during the confirmation microtask prevents the request from starting', async () => {
  let calls = 0;
  const ui = mount({ runConversation: async () => { calls++; return { text: 'must not run', history: [] }; } });
  configure(ui); ui.data.chat.draft = 'approved then cancelled';
  const sending = ui.session.execute({ command: 'request.send', args: {} });
  const cancelled = await ui.session.execute({ command: 'request.cancel', args: {} });
  const result = await sending;
  assert.equal(cancelled.result.requested, true);
  assert.equal(result.result.status, 'not-sent');
  assert.equal(calls, 0);
});


test('repeated missing-key model pulls stay in one card status without network or history spam', async () => {
  const ui = mount(); ui.addCard('api');
  const d = ui.data.chat, card = d.messages.at(-1), count = d.messages.length;
  for (let i=0;i<10;i++) await ui.click({action:'pull-models',id:String(card.id)});
  assert.equal(d.messages.length,count);
  assert.match(card.modelListStatus,/尚未发送/);
  assert.equal((ui.app.innerHTML.match(/尚未发送模型列表请求/g)||[]).length,1);
  const key=ui.app.querySelector(`#key${card.id}`); key.value='synthetic';ui.input(key);
  assert.equal(card.modelListStatus,'');
});
test('corrected settings continue and busy model pulls never duplicate a request', async () => {
  let calls=0,resolve;
  const ui=mount({listModels:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  const {d,card}=configure(ui);card.modelListStatus='old validation';
  const pending=ui.click({action:'pull-models',id:String(card.id)});
  for(let i=0;i<10;i++)await ui.click({action:'pull-models',id:String(card.id)});
  assert.equal(calls,1);assert.equal(d.busy,true);assert.equal(card.modelListStatus,'');
  resolve([{id:'synthetic-model'}]);await pending;
  assert.equal(d.busy,false);assert.equal(card.models[0].id,'synthetic-model');
});
test('invalid or unapproved model-list targets update one local status and make no request', async () => {
  const ui=mount({confirm:()=>false}),{d,card}=configure(ui),count=d.messages.length;
  d.api.url='invalid';d.api.trustedTarget='';
  for(let i=0;i<5;i++)await ui.click({action:'pull-models',id:String(card.id)});
  assert.equal(d.messages.length,count);assert.ok(card.modelListStatus);
  d.api.url='https://example.com/v1';
  await ui.click({action:'pull-models',id:String(card.id)});
  assert.match(card.modelListStatus,/尚未确认/);assert.equal(d.messages.length,count);
});

test('settings menus replace bottom menus rather than leaving an inline second menu',async()=>{
 const ui=mount(),{d,card}=configure(ui,'image');
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

test('page protocol picker replaces native select and preserves protocol-change invalidation',async()=>{
 const ui=mount(),{d,card}=configure(ui);d.history=[{role:'user',content:'old context'}];card.models=[{id:'old'}];
 await ui.click({action:'plus'});await ui.click({action:'protocol-menu',id:String(card.id)});
 assert.match(ui.app.innerHTML,/role="listbox"/);assert.equal((ui.app.innerHTML.match(/role="option"/g)||[]).length,3);
 assert.doesNotMatch(ui.app.innerHTML,/<select[^>]*id="protocol/);
 assert.doesNotMatch(ui.app.innerHTML,/class="plus-menu"/);
 await ui.click({action:'choose-protocol',id:String(card.id),protocol:'openai'});
 assert.equal(d.api.protocol,'openai');assert.equal(d.api.key,'');assert.equal(d.api.trustedTarget,'');assert.equal(d.api.model,'');
 assert.equal(d.history.length,0);assert.equal(card.models.length,0);
 assert.doesNotMatch(ui.app.innerHTML,/role="listbox"/);
 assert.match(ui.app.innerHTML,/OpenAI 兼容 · Chat Completions/);
});

test('applying displayed API target is an explicit local action without a second modal or request',async()=>{
 const ui=mount({confirm:()=>assert.fail('target application must not open a modal')});ui.addCard('api');
 const d=ui.data.chat,card=d.messages.at(-1);d.api.key='synthetic';
 await ui.click({action:'pull-models',id:String(card.id)});
 assert.equal(d.api.trustedTarget,'');assert.match(card.modelListStatus,/应用设置/);
 await ui.click({action:'trust-target'});
 assert.equal(d.api.trustedTarget,core.canonicalEndpoint(d.api.url));
 d.api.url='http://unsafe.example/v1';d.api.trustedTarget='';
 await ui.click({action:'trust-target'});assert.equal(d.api.trustedTarget,'');
});

for (const [index, name, url] of [
  ['5', 'DeepSeek', 'https://api.deepseek.com'],
  ['6', '智谱 AI · 普通 API', 'https://open.bigmodel.cn/api/paas/v4']
]) {
  test(`${name} preset is visible and switches to ordinary OpenAI-compatible API without carrying Gemini state`, async () => {
    const ui = mount(), { d, card } = configure(ui);
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
  test(`${name} does not claim image generation support`, async () => {
    const ui = mount(), { d, card } = configure(ui, 'image');
    await ui.click({ action: 'choose-supplier', id: String(card.id), index });
    assert.equal(d.api.model, ''); assert.equal(ui.matrixSupported(d), false);
  });
}

test('pending request shows only accessible spinner and clears it on completion',async()=>{
 let resolve;
 const ui=mount({runConversation:()=>new Promise(r=>{resolve=r;})}),{d}=configure(ui);
 d.draft='offline pending';const pending=ui.click({action:'send'});
 assert.equal(d.busy,true);assert.match(ui.app.innerHTML,/class="api-spinner"/);
 assert.match(ui.app.innerHTML,/role="status" aria-label="正在加载"/);
 assert.doesNotMatch(ui.app.innerHTML,/正在请求 API/);
 assert.match(ui.app.innerHTML,/data-action="cancel"/);
 resolve({text:'offline result',usage:null,messages:[]});await pending;
 assert.equal(d.busy,false);assert.doesNotMatch(ui.app.innerHTML,/class="api-spinner"/);
});

test('attachment send clears draft only on success, guards duplicate, and retains history', async()=>{
 let resolve, sent;
 const ui=mount({runConversation: args=>{sent=args;return new Promise(r=>resolve=r);}}),{d}=configure(ui);
 const files=await attachments.prepareFiles([new File(['fixture'],'a.png',{type:'image/png'})],[],'gemini',['image']);
 d.attachments=files;
 const operation=ui.click({action:'send'});
 assert.equal(d.busy,true);assert.equal(d.attachments.length,0);assert.equal(sent.messages[0].attachments[0].id,files[0].id);
 await ui.click({action:'send'});assert.equal(d.messages.filter(m=>m.type==='user').length,1);
 resolve({history:sent.messages,text:'OK'});await operation;
 assert.equal(d.history[0].attachments[0].id,files[0].id);assert.match(ui.app.innerHTML,/a.png/);
});
test('failed attachment send restores draft; remove/clear preserve unrelated state',async()=>{
 const ui=mount({runConversation:async()=>{throw new Error('failure');}}),{d}=configure(ui);
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'a.txt',{type:'text/plain'})],[],'gemini',['text']);d.draft='hello';
 await ui.click({action:'send'});assert.equal(d.attachments.length,1);assert.equal(d.draft,'hello');
 await ui.click({action:'remove-attachment',id:d.attachments[0].id});assert.equal(d.attachments.length,0);assert.equal(d.draft,'hello');
 await ui.click({action:'clear-chat'});assert.equal(d.history.length,0);assert.equal(d.messages.length,0);assert.equal(d.api.key,'synthetic-control-key');
});
test('input modality toggles and protocol changes reject incompatible draft before request',async()=>{
 const ui=mount(),{d}=configure(ui);ui.addCard('model');const card=d.messages.at(-1);
 await ui.click({action:'toggle-input',id:String(card.id),modality:'image'});assert(!d.model.inputs.includes('image'));
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'a.pdf',{type:'application/pdf'})],[],'gemini',['pdf']);d.api.protocol='ark';
 await ui.click({action:'send'});assert.equal(d.busy,false);assert.equal(d.attachments.length,1);assert.match(d.attachmentError,/未启用/);
});
test('page session permits attachment-only approval, describes files and rejects attachment race',async()=>{
 let confirmation='',calls=0;
 const ui=mount({confirm:message=>{confirmation=message;return true;},runConversation:async args=>{calls++;return {text:'OK',history:args.messages};}}),{d}=configure(ui);
 d.attachments=await attachments.prepareFiles([new File(['fixture'],'note.txt',{type:'text/plain'})],[],'gemini',['text']);
 const result=await ui.session.execute({command:'request.send',args:{}});assert.equal(result.result.status,'completed');assert.equal(calls,1);assert.match(confirmation,/note.txt.*KiB/);
 d.attachments=await attachments.prepareFiles([new File(['fixture2'],'second.txt',{type:'text/plain'})],[],'gemini',['text']);
 const sending=ui.session.execute({command:'request.send',args:{}});d.attachments=[];const raced=await sending;assert.equal(raced.result.reason,'changed-after-confirmation');assert.equal(calls,1);
 d.attachmentReading=true;d.draft='not ready';assert.equal((await ui.session.execute({command:'request.send',args:{}})).ok,false);assert.equal(calls,1);
});
