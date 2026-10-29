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

test('Pages build includes only twelve production files and exact source bytes', async () => {
  await exec(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(root) });
  const expected = ['.nojekyll', 'index.html', 'src/agent.js', 'src/app.js', 'src/core.js', 'src/icons.js', 'src/image-capabilities.js', 'src/logs.js', 'src/session-webmcp.js', 'src/session.js', 'src/styles.css', 'src/usage.js'];
  assert.deepEqual(await walk(new URL('dist/', root)), expected);
  for (const file of expected) assert.deepEqual(await readFile(new URL(`dist/${file}`, root)), await readFile(new URL(file, root)));
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
      await readFile(imported);
    }
  }
});
