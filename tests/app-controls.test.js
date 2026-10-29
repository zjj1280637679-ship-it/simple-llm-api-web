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
function mount({ confirm = () => true, runConversation, dispatchCommand } = {}) {
  const listeners = {};
  let html = '', nodes = new Map(), renders = 0;
  const thread = { scrollTop: 0, scrollHeight: 100 };
  const app = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; renders += 1; nodes = new Map();
      if (value.includes('id="network-logs"')) nodes.set('#network-logs', { textContent: '' });
      nodes.set('.top-right', { innerHTML: value.match(/<div class="top-right"[^>]*>(.*?)<\/div>/)?.[1] || '' });
      for (const match of value.matchAll(/<span id="(api-trust\d+)">(.*?)<\/span>/g)) nodes.set(`#${match[1]}`, { textContent: match[2] });
      for (const match of value.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        nodes.set(`#${match[1]}`, { id: match[1], value: attrs.value || '', dataset: { card: attrs['data-card'], key: attrs['data-key'] }, selectionStart: 0, selectionEnd: 0 });
      }
    },
    get renders() { return renders; },
    querySelector: selector => selector === '#thread' ? thread : nodes.get(selector) || null,
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const document = { getElementById: () => app, addEventListener: () => {}, activeElement: null };
  const neverFetch = () => assert.fail('No network may run in control regressions.');
  const context = {
    ...core, ...logs, icon, document, window: { confirm }, createPageSession, registerPageSessionTools: () => {},
    renderNetworkLogs: container => { if (container) container.textContent = logs.exportNetworkLogs(); },
    URL, Blob, Uint8Array, atob, AbortController, performance,
    runConversation: runConversation || neverFetch, listModels: neverFetch, dispatchCommand: dispatchCommand || neverFetch
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.controlTests = { data, addCard, render, matrixSupported, setPage: p => { page = p; } };`, context);
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

test('URL input immediately revokes visible trust and badge without rebuilding the focused input', () => {
  const ui = mount(), { d, card } = configure(ui);
  const input = ui.app.querySelector(`#url${card.id}`), renders = ui.app.renders;
  input.value = 'https://new.example.com/v1';
  input.selectionStart = input.selectionEnd = 12;
  ui.document.activeElement = input;
  assert.match(ui.app.querySelector('.top-right').innerHTML, /API 已配置/);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /已确认目标/);
  ui.input(input);
  assert.equal(d.api.key, ''); assert.equal(d.api.trustedTarget, '');
  assert.equal(ui.app.querySelector(`#key${card.id}`).value, '');
  assert.match(ui.app.querySelector('.top-right').innerHTML, /API 未配置/);
  assert.doesNotMatch(ui.app.querySelector('.top-right').innerHTML, /ready/);
  assert.match(ui.app.querySelector(`#api-trust${card.id}`).textContent, /调用前需确认目标/);
  assert.equal(ui.app.renders, renders);
  assert.equal(ui.app.querySelector(`#url${card.id}`), input);
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.selectionStart, 12); assert.equal(input.selectionEnd, 12);
});

test('key and model edits immediately keep configuration badge accurate without a full render', () => {
  const ui = mount(), { card } = configure(ui), renders = ui.app.renders;
  const key = ui.app.querySelector(`#key${card.id}`), model = ui.app.querySelector(`#model${card.id}`);
  key.value = ''; ui.input(key);
  assert.match(ui.app.querySelector('.top-right').innerHTML, /API 未配置/);
  key.value = 'synthetic-replacement-key'; ui.input(key);
  assert.match(ui.app.querySelector('.top-right').innerHTML, /API 已配置/);
  model.value = ''; ui.input(model);
  assert.match(ui.app.querySelector('.top-right').innerHTML, /API 未配置/);
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
