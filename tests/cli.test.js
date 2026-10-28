import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../cli.mjs';
import { GEMINI_ENDPOINT, IMAGE_MODEL } from '../src/core.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const key = 'synthetic-cli-secret';
const base = ['image.generate', '--prompt', 'A cat', '--endpoint', GEMINI_ENDPOINT];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=';
const capture = () => { const lines = []; return { lines, io: { stdout: text => lines.push(text), stderr: text => lines.push(text) } }; };

test('actual Node CLI --help is a no-network executable smoke test', () => {
  const result = spawnSync(process.execPath, ['cli.mjs', '--help'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /image\.generate/);
  assert.match(result.stdout, /--yes/);
  assert.equal(result.stderr, '');
});

test('CLI does not read environment or fetch for --help', async () => {
  const { io, lines } = capture();
  const env = new Proxy({}, { get() { assert.fail('Help must not read secrets'); } });
  assert.equal(await main(['--help'], env, io, () => assert.fail('No fetch')), 0);
  assert.match(lines.join(''), /GEMINI_API_KEY/);
});

test('CLI requires explicit --yes and never accepts a command-line key', async () => {
  const { io, lines } = capture();
  assert.equal(await main(base, { GEMINI_API_KEY: key }, io, () => assert.fail('No fetch')), 1);
  assert.match(lines.join(''), /未确认/);
  assert.equal(await main([...base, '--key', key, '--yes'], {}, io, () => assert.fail('No fetch')), 1);
  assert.equal(lines.join('').includes(key), false);
});

test('CLI uses the real shared dispatcher with a synthetic fetch and writes the returned image', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minimal-llm-cli-'));
  const { io, lines } = capture(); let calls = 0;
  try {
    const code = await main([...base, '--out', directory, '--aspect-ratio', '16:9', '--image-size', '2K', '--yes'], { GEMINI_API_KEY: key }, io, async (url, options) => {
      calls += 1;
      assert.equal(url, `${GEMINI_ENDPOINT}/models/${IMAGE_MODEL}:generateContent`);
      assert.equal(url.includes(key), false);
      assert.equal(options.headers['x-goog-api-key'], key);
      assert.deepEqual(JSON.parse(options.body).generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '2K' });
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }));
    });
    assert.equal(code, 0);
    assert.equal(calls, 1);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.deepEqual(await readFile(path.join(directory, files[0])), Buffer.from(png, 'base64'));
    assert.equal(lines.join('').includes(key), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI rejects unsafe targets and unsupported protocol without fetching', async () => {
  for (const extra of [
    ['image.generate', '--prompt', 'cat', '--endpoint', 'http://127.0.0.1', '--yes'],
    ['image.generate', '--prompt', 'cat', '--endpoint', `${GEMINI_ENDPOINT}?key=oops`, '--yes'],
    [...base, '--protocol', 'openai', '--yes'],
  ]) {
    const { io } = capture();
    assert.equal(await main(extra, { GEMINI_API_KEY: key }, io, () => assert.fail('No fetch')), 1);
  }
});

test('CLI sanitizes failure without exposing an upstream key echo', async () => {
  const { io, lines } = capture(); let calls = 0;
  const code = await main([...base, '--yes'], { GEMINI_API_KEY: key }, io, async () => {
    calls += 1; return new Response(key, { status: 401 });
  });
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.equal(lines.join('').includes(key), false);
  assert.match(lines.join(''), /401/);
});
