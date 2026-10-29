import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../src/core.js';
import { icon } from '../src/icons.js';

// A small event/DOM harness for the production module. No browser, network,
// real key, external package or production testing hooks are required.
const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function mount() {
  const listeners = {};
  let html = '', nodes = new Map(), renders = 0;
  const thread = { scrollTop: 0, scrollHeight: 100 };
  const app = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; renders += 1; nodes = new Map();
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
    ...core, icon, document, window: { confirm: () => true },
    URL, Blob, Uint8Array, atob, AbortController, performance,
    runConversation: neverFetch, listModels: neverFetch, dispatchCommand: neverFetch
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.controlTests = { data, addCard, render, matrixSupported, setPage: p => { page = p; } };`, context);
  return {
    ...context.controlTests, app, document,
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
