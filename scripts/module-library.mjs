import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'module-library/catalog.json';
const RECORD = 'module-library/evidence/local-tests.json';
const TYPES = {function:'functions',relation:'relations',composition:'compositions'};
const STATES = ['PASS','FAIL','UNKNOWN','STALE'];
const digest = value => createHash('sha256').update(value).digest('hex');
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const utcTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const moduleRevisions = modules => modules.map(({id, version, createdAt, updatedAt}) =>
  ({id, version, createdAt, updatedAt}));
function inside(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\')) throw Error('Invalid repository path');
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || resolve(name) === name) throw Error('Path outside repository: ' + name);
  return path;
}
async function regular(root, name) {
  const path = inside(root, name);
  // Reject symlink ancestors as well as the final file.
  const parts = relative(root, path).split(sep);
  for (let i = 1; i <= parts.length; i++) {
    const info = await lstat(resolve(root, ...parts.slice(0, i)));
    if (info.isSymbolicLink()) throw Error('Symlink is not a library input: ' + name);
    if (i === parts.length && !info.isFile()) throw Error('Expected file: ' + name);
  }
  return path;
}
const json = async (root, name) => JSON.parse(await readFile(await regular(root, name), 'utf8'));

export async function validateCatalog(catalog, root = ROOT) {
  if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.modules) || !catalog.modules.length) throw Error('Invalid catalogue');
  const ids = new Set(), entries = new Set();
  for (const m of catalog.modules) {
    if (!/^[FRC]-\d{3}$/.test(m.id) || ids.has(m.id)) throw Error('Invalid or duplicate module ID');
    ids.add(m.id);
    if (typeof m.version !== 'string' || !stableVersion.test(m.version)) throw Error('Invalid module version: ' + m.id);
    if (!utcTimestamp(m.createdAt) || !utcTimestamp(m.updatedAt) || Date.parse(m.updatedAt) < Date.parse(m.createdAt))
      throw Error('Invalid module timestamps: ' + m.id);
    if (!TYPES[m.kind] || !m.id.startsWith({function:'F',relation:'R',composition:'C'}[m.kind])) throw Error('Invalid module kind');
    if (!m.title || !m.goal || !Array.isArray(m.tags) || !Array.isArray(m.exports) || !m.exports.length || !Array.isArray(m.tests) || !m.tests.length) throw Error('Incomplete module card');
    if (!m.entry?.startsWith('module-library/' + TYPES[m.kind] + '/') || entries.has(m.entry)) throw Error('Invalid or duplicate entry');
    entries.add(m.entry);
    for (const file of [m.entry, m.contract, ...m.tests]) await regular(root, file);
    for (const key of ['F','C','H','Q']) {
      const g = m.gates?.[key];
      if (!g || !STATES.includes(g.status) || !g.reason || !Array.isArray(g.evidence)) throw Error('Missing gate: ' + key);
      if (g.status === 'PASS' && !g.evidence.length) throw Error('PASS needs evidence: ' + m.id + '/' + key);
      for (const file of g.evidence) await regular(root, file);
    }
    if (!m.alternatives || !Object.hasOwn(m.alternatives, 'minDistance')) throw Error('Missing route policy');
  }
  const scenario = await json(root, catalog.scenario);
  if (!scenario.id || !scenario.status) throw Error('Invalid scenario');
  const recipe = await json(root, 'module-library/recipes/agent-image-turn.json');
  if (recipe.scenario !== scenario.id || !ids.has(recipe.implementation) || !recipe.members.every(id => ids.has(id))) throw Error('Dangling recipe reference');
  if (catalog.modules.find(m => m.id === recipe.implementation)?.kind !== 'composition') throw Error('Recipe implementation must be a composition');
  const members = new Set([recipe.implementation, ...recipe.members]);
  for (const edge of recipe.relations) {
    if (![edge.owner,edge.from,edge.to].every(id => members.has(id)) || !edge.effect) throw Error('Invalid relation ownership');
  }
  return catalog;
}

export function selectModules(catalog, {kind, tag, query} = {}) {
  if (kind && !TYPES[kind]) throw Error('Unknown kind: ' + kind);
  return catalog.modules.filter(m => (!kind || m.kind === kind) && (!tag || m.tags.includes(tag)) &&
    (!query || [m.id,m.version,m.title,m.goal,...m.tags].join(' ').toLowerCase().includes(query.toLowerCase())));
}

export function evidenceState(record, hashes, modules) {
  if (!record) return 'UNKNOWN';
  if (record.schemaVersion !== 2 || record.kind !== 'local-tests' || record.status !== 'PASS' ||
      !Array.isArray(record.moduleIds) || record.moduleIds.join('|') !== modules.map(m => m.id).join('|')) return 'STALE';
  if (JSON.stringify(record.moduleRevisions) !== JSON.stringify(moduleRevisions(modules))) return 'STALE';
  const expected = record.fileHashes || {};
  const names = Object.keys(hashes).sort();
  return names.length === Object.keys(expected).length && names.every(name => hashes[name] === expected[name]) ? 'PASS' : 'STALE';
}

export async function inputHashes(root = ROOT) {
  const paths = new Set();
  async function walk(name) {
    if (name === RECORD) return;
    const info = await lstat(inside(root, name));
    if (info.isSymbolicLink()) throw Error('Symlink input: ' + name);
    if (info.isDirectory()) {
      for (const child of await readdir(inside(root, name))) await walk(name + '/' + child);
    } else {
      await regular(root, name); paths.add(name);
    }
  }
  // Deliberately conservative: changes anywhere in these inputs stale the local batch.
  for (const name of ['src','tests','module-library','package.json','scripts/build.mjs',
    'scripts/module-library.mjs','cli.mjs','web-cli.mjs','cli-mcp-transport.mjs',
    'README.md','VALIDATION.md','WEB_SESSION.md','design/REQUIREMENTS.md']) await walk(name);
  // Follow literal local ESM imports, including files newly added outside src/.
  const visited = new Set();
  async function imports(name) {
    if (visited.has(name) || !/\.(?:mjs|js)$/.test(name)) return;
    visited.add(name);
    const source = await readFile(await regular(root, name), 'utf8');
    const patterns = [/(?:from|import)\s*['"](\.[^'"]+)['"]/g, /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
      const target = relative(root, resolve(root, dirname(name), match[1])).split(sep).join('/');
      await regular(root, target); paths.add(target); await imports(target);
    }
  }
  for (const name of [...paths]) await imports(name);
  const hashes = {};
  for (const name of [...paths].sort()) hashes[name] = digest(await readFile(await regular(root, name)));
  return hashes;
}

async function loadRecord(root) {
  try { return await json(root, RECORD); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function runLocal(catalog, root) {
  const files = [...new Set(catalog.modules.flatMap(m => m.tests))].sort();
  const args = ['--test','--test-reporter=tap',...files];
  const result = spawnSync(process.execPath, args, {cwd:root,encoding:'utf8',maxBuffer:20*1024*1024,timeout:120000});
  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(output.split('\n').slice(-12).join('\n') + '\n');
  if (result.error || result.status !== 0) throw Error('Local verification failed; evidence was not replaced');
  const stats = {};
  for (const key of ['tests','pass','fail','skipped','cancelled','todo']) {
    const value = output.match(new RegExp('^# ' + key + ' (\\d+)$','m'));
    if (!value) throw Error('Missing test summary: ' + key);
    stats[key] = Number(value[1]);
  }
  if (!stats.pass || stats.fail || stats.cancelled) throw Error('Incomplete verification');
  return {args, stats, outputSha256:digest(output)};
}

export async function main(args = process.argv.slice(2), root = ROOT) {
  const command = args[0] || 'list';
  if (!['list','check','verify','record'].includes(command)) throw Error('Use list | check | verify | record');
  const filters = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = {'--kind':'kind','--tag':'tag','--query':'query'}[args[i]];
    if (command !== 'list' || !key || !args[i+1]) throw Error('Invalid filter');
    filters[key] = args[i+1];
  }
  const catalog = await validateCatalog(await json(root, CATALOG), root);
  const hashes = await inputHashes(root);
  let record = await loadRecord(root);
  if (['verify','record'].includes(command)) {
    const result = await runLocal(catalog, root);
    const after = await inputHashes(root);
    if (JSON.stringify(hashes) !== JSON.stringify(after)) throw Error('Inputs changed during verification');
    if (command === 'record') {
      record = {schemaVersion:2,kind:'local-tests',status:'PASS',recordedAt:new Date().toISOString(),
        baseCommit:catalog.baseCommit,node:process.version,platform:process.platform,
        scope:'Local execution and synthetic network only; no automatic F/C/H/Q promotion.',
        moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),...result,fileHashes:after};
      await writeFile(inside(root, RECORD), JSON.stringify(record,null,2)+'\n');
    }
  }
  const local = evidenceState(record, hashes, catalog.modules);
  if (command === 'list') {
    for (const m of selectModules(catalog, filters)) {
      const gates = ['F','C','H','Q'].map(k=>k+':'+m.gates[k].status).join(' ');
      const shanghai = stamp => new Date(stamp).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
      console.log(m.id + '@' + m.version + ' | ' + m.kind + ' | ' + m.title + ' | local:' + local + ' | ' + gates +
        '\n  创建：' + shanghai(m.createdAt) + ' | 更新：' + shanghai(m.updatedAt) + '（北京时间）' +
        '\n  ' + m.entry);
    }
    return;
  }
  if (local !== 'PASS') throw Error('Local evidence is ' + local + '; inspect changes, then run npm run modules:record');
  console.log('Catalogue valid; local evidence matches ' + Object.keys(hashes).length + ' input files. Full admission is not inferred.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
