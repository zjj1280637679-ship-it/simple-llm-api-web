import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('relay mirrors queue controls with isolated profile and shared implementation', async () => {
  const [queue, relay, app] = await Promise.all([
    source('h3-queue/index.html'), source('h3-relay/index.html'), source('h3-queue/app.js')
  ]);
  assert.deepEqual(ids(relay), ids(queue));
  assert.equal(new Set(ids(relay)).size, ids(relay).length);
  assert.match(relay, /data-h3-profile="relay"/);
  assert.match(relay, /<title>MiniMax H3 中转站/);
  assert.match(relay, /src="\.\.\/h3-queue\/app\.js"/);
  assert.match(relay, /href="\.\.\/h3-queue\/style\.css"/);
  assert.match(app, /document\.documentElement\.dataset\.h3Profile === 'relay'/);
  assert.match(app, /simple-llm-h3-relay-v1/);
  assert.match(app, /simple-llm-h3-queue-v1/);
  assert.match(queue, /src="\.\/app\.js"/);
  assert.doesNotMatch(relay, /value="h3-sk-/);
});

test('relay asset links resolve inside the public site', async () => {
  const relay = await source('h3-relay/index.html');
  for (const ref of [...relay.matchAll(/(?:src|href)="(\.\.?\/[^"?#]+\.(?:js|css))"/g)].map(x => x[1])) {
    const file = new URL(ref, new URL('../h3-relay/index.html', import.meta.url));
    assert.match(file.pathname, /\/h3-queue\/(?:app\.js|style\.css)$/);
    await readFile(file);
  }
});
