import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const exec = promisify(execFile);
async function walk(url, prefix = '') {
  const result = [];
  for (const name of await readdir(url)) {
    const child = new URL(name, url), info = await lstat(child);
    assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) result.push(...await walk(new URL(`${name}/`, url), `${prefix}${name}/`));
    else result.push(`${prefix}${name}`);
  }
  return result.sort();
}

test('Pages build includes only allowlisted production files and versioned resource references', async () => {
  await exec(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(root) });
  const expected = ['src/app-error.js', 'src/api-target.js', 'src/request-transport.js', 'src/completion-evidence.js', 'src/completion-policy.js', 'src/image-evidence.js', 'src/request-outcome.js', 'src/error-diagnostic.js', 'src/transport-evidence.js', 'src/image-delivery.js', 'src/workbench.js', 'src/lifecycle.js', 'src/canvas-geometry.js', 'src/view-position.js', 'src/request-lifecycle.js', 'src/workspace-storage.js', 'src/clipboard-report.js', 'src/stream-painter.js', 'src/view-markup.js', '.nojekyll', 'index.html', 'src/agent.js', 'src/app.js', 'src/attachments.js', 'src/core.js', 'src/icons.js', 'src/image-capabilities.js', 'src/logs.js', 'src/native-json.js', 'src/persistence.js', 'src/provider-identity.js', 'src/reasoning.js', 'src/session-webmcp.js', 'src/session.js', 'src/stream.js', 'src/styles.css', 'src/usage.js'];
  assert.deepEqual(await walk(new URL('dist/', root)), expected.sort());
  const first = new Map();
  let version;
  for (const file of expected) {
    const built = await readFile(new URL(`dist/${file}`,root),'utf8'), source=await readFile(new URL(file,root),'utf8');
    first.set(file,built);
    assert.equal(built.replace(/\?v=[a-f0-9]{20}/g,''),source);
    for (const match of built.matchAll(/\?v=([a-f0-9]{20})/g)) { version ??= match[1]; assert.equal(match[1],version); }
  }
  assert.ok(version);
  const entry=first.get('index.html');
  assert.match(entry,/app\.js\?v=[a-f0-9]{20}/);
  assert.match(entry,/styles\.css\?v=[a-f0-9]{20}/);
  await exec(process.execPath,['scripts/build.mjs'],{cwd:fileURLToPath(root)});
  for(const [file,content] of first) assert.equal(await readFile(new URL(`dist/${file}`,root),'utf8'),content);
});

test('Pages workflow publishes dist rather than the repository root', async () => {
  const workflow = await readFile(new URL('.github/workflows/pages.yml', root), 'utf8');
  assert.match(workflow, /path: dist/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /path: ['"]?\.\/?['"]?\s*$/m);
});


test('all relative production module imports exist inside the deployment artifact', async () => {
  await exec(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(root) });
  for (const file of (await walk(new URL('dist/', root))).filter(name => name.endsWith('.js'))) {
    const url = new URL(`dist/${file}`, root), source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      const imported = new URL(match[1], url);
      assert.equal(imported.href.startsWith(new URL('dist/', root).href), true);
      assert.match(imported.search,/^\?v=[a-f0-9]{20}$/);
      imported.search=''; await readFile(imported);
    }
  }
});
