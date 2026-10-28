import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('production uses local modules and defensive browser policy', async () => {
  const html = await read('index.html');
  assert.match(html, /type="module" src="\.\/src\/app\.js"/);
  assert.match(html, /connect-src https:/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<\s]/);
});
test('production has no simulated result or persistent key storage', async () => {
  const app = await read('src/app.js');
  assert.doesNotMatch(app, /localStorage|sessionStorage|document\.cookie|eval\(|new Function\(/);
  assert.doesNotMatch(app, /已收到你的消息|sample-art|抽象城市夜景/);
  assert.match(app, /dispatchCommand/);
  assert.match(app, /runConversation/);
  assert.match(app, /key: ''/);
  assert.match(app, /esc\(m\.text\)/);
  assert.match(app, /if \(d\.busy \|\| !text\) return/);
});
test('production starts with no pre-filled user or model history', async () => {
  assert.match(await read('src/app.js'), /messages: \[\], history: \[\]/);
});
test('design baseline remains separate from production', async () => {
  const design = await read('design/index.html');
  assert.match(design, /Development note: interactions are local-only/);
  assert.match(design, /Design requirement: The first-page conversation agent/);
  assert.match(design, /gemini-nano-banana-2\.1/);
});
