import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../cli.mjs';
import { ARK_ENDPOINT, ARK_FLASH_MODEL, ARK_PRO_MODEL, GEMINI_ENDPOINT, IMAGE_MODEL } from '../src/core.js';

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

const arkBase = ['image.generate', '--protocol', 'ark', '--prompt', 'A cat', '--endpoint', ARK_ENDPOINT];
const arkKey = 'synthetic-ark-cli-secret';

test('Ark CLI defaults to Flash + 2K and writes synthetic returned raster through shared core', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minimal-llm-ark-cli-'));
  const { io, lines } = capture(); let calls = 0;
  const readVariables = [];
  const env = new Proxy({ ARK_API_KEY: arkKey, GEMINI_API_KEY: key }, { get(target, property) { readVariables.push(property); return target[property]; } });
  try {
    const code = await main([...arkBase, '--out', directory, '--yes'], env, io, async (url, options) => {
      calls += 1;
      assert.equal(url, `${ARK_ENDPOINT}/images/generations`);
      assert.equal(options.headers.Authorization, `Bearer ${arkKey}`);
      assert.equal(options.headers['x-goog-api-key'], undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.model, ARK_FLASH_MODEL);
      assert.equal(body.size, '2048x2048');
      assert.equal(body.response_format, 'b64_json');
      assert.equal(JSON.stringify(body).includes(arkKey), false);
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }));
    });
    assert.equal(code, 0);
    assert.equal(calls, 1);
    assert.deepEqual(readVariables, ['ARK_API_KEY']);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.deepEqual(await readFile(path.join(directory, files[0])), Buffer.from(png, 'base64'));
    assert.equal(lines.join('').includes(arkKey), false);
    assert.equal(lines.join('').includes(key), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Ark CLI supports explicit Pro model using same image transport', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minimal-llm-ark-pro-cli-'));
  const { io } = capture();
  try {
    assert.equal(await main([...arkBase, '--model', ARK_PRO_MODEL, '--out', directory, '--yes'], { ARK_API_KEY: arkKey }, io, async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, ARK_PRO_MODEL);
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }));
    }), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI keys never fall back or cross-copy between Gemini and Ark', async () => {
  for (const [args, env, required] of [[arkBase, { GEMINI_API_KEY: key }, 'ARK_API_KEY'], [base, { ARK_API_KEY: arkKey }, 'GEMINI_API_KEY']]) {
    const { io, lines } = capture();
    assert.equal(await main([...args, '--yes'], env, io, () => assert.fail('No key fallback or fetch')), 1);
    assert.match(lines.join(''), new RegExp(required));
    assert.equal(lines.join('').includes(key), false);
    assert.equal(lines.join('').includes(arkKey), false);
  }
});

test('Ark CLI rejects unsupported sizes before key access or network', async () => {
  const { io } = capture();
  const env = new Proxy({}, { get() { assert.fail('Reject invalid options before reading key'); } });
  assert.equal(await main([...arkBase, '--image-size', '4K', '--yes'], env, io, () => assert.fail('No image fetch')), 1);
});

test('Ark CLI failure does not log an upstream secret echo or retry', async () => {
  const { io, lines } = capture(); let calls = 0;
  const code = await main([...arkBase, '--yes'], { ARK_API_KEY: arkKey }, io, async () => {
    calls += 1;
    return new Response(arkKey, { status: 403 });
  });
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.equal(lines.join('').includes(arkKey), false);
  assert.match(lines.join(''), /403/);
});

test('CLI rejects percent-escaped key in target before stdout or fetch, regardless of hex case', async () => {
  const secret = 'synthetic+cred/byte';
  for (const escaped of ['synthetic%2Bcred%2Fbyte', 'synthetic%2bcred%2fbyte']) {
    const stdout = [], stderr = [];
    const code = await main(['image.generate', '--prompt', 'cat', '--endpoint', `https://api.example.com/${escaped}`, '--yes'],
      { GEMINI_API_KEY: secret }, { stdout: text => stdout.push(text), stderr: text => stderr.push(text) },
      () => assert.fail('Secret-bearing target must not fetch'));
    assert.equal(code, 1);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.join('').includes(secret), false);
    assert.equal(stderr.join('').toLowerCase().includes(escaped.toLowerCase()), false);
  }
});

test('CLI redacts literal and URL-encoded secrets from output errors with regex metacharacters safely', async () => {
  const secret = 'synthetic+cred/byte.[x]';
  const encoded = encodeURIComponent(secret);
  for (const form of [secret, encoded, encoded.replace(/%[0-9A-F]{2}/g, match => match.toLowerCase())]) {
    const errors = []; let fetches = 0;
    const code = await main([...base, '--yes'], { GEMINI_API_KEY: secret }, {
      stdout: () => { throw new Error(`output failed: ${form}`); },
      stderr: text => errors.push(text),
    }, () => { fetches += 1; assert.fail('Output failure precedes fetch'); });
    assert.equal(code, 1);
    assert.equal(fetches, 0);
    assert.equal(errors.join('').includes(form), false);
    assert.match(errors.join(''), /\[REDACTED\]/);
  }
});
