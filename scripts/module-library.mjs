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
export const hostRevisions = hosts => hosts.map(({id,version,createdAt,updatedAt,module,defaultMode}) =>
  ({id,version,createdAt,updatedAt,module:{...module},mode:defaultMode}));

export async function validateHosts(catalog, registry, root = ROOT) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.hosts)) throw Error('Invalid host registry');
  const modules = new Map(catalog.modules.map(m=>[m.id,m])), hosts = new Map(), entries = new Set();
  for (const host of registry.hosts) {
    if (!/^H-[FRC]-\d{3}$/.test(host.id) || hosts.has(host.id)) throw Error('Invalid or duplicate host ID');
    hosts.set(host.id,host);
    if (typeof host.version !== 'string' || !stableVersion.test(host.version) ||
        !utcTimestamp(host.createdAt) || !utcTimestamp(host.updatedAt) ||
        Date.parse(host.updatedAt)<Date.parse(host.createdAt)) throw Error('Invalid host revision');
    const module=modules.get(host.module?.id);
    if (!module || module.version!==host.module.version || host.goal!==module.goal)
      throw Error('Host module revision mismatch');
    if (!host.entry?.startsWith('module-library/hosts/') || !host.entry.endsWith('/run.mjs') || entries.has(host.entry))
      throw Error('Invalid host entry');
    entries.add(host.entry); await regular(root,host.entry); await regular(root,host.instructions);
    if (!Array.isArray(host.modes) || !host.modes.length || new Set(host.modes).size!==host.modes.length ||
        !host.modes.every(mode=>['local','synthetic','live'].includes(mode)) ||
        !host.modes.includes(host.defaultMode) || host.defaultMode==='live') throw Error('Invalid host modes');
    for (const field of ['requires','supplies','criteria','limits']) {
      if (!Array.isArray(host[field]) || !host[field].length || !host[field].every(x=>typeof x==='string' && x.trim()))
        throw Error('Incomplete host scope: '+field);
    }
    if (typeof host.minimality!=='string' || !host.minimality.trim()) throw Error('Missing host minimality');
  }
  const borrowed=new Set();
  for (const module of modules.values()) {
    const host=hosts.get(module.host?.id);
    if (!host || host.module.id!==module.id || host.version!==module.host.version || borrowed.has(host.id))
      throw Error('Missing or mismatched module host: '+module.id);
    borrowed.add(host.id);
  }
  if (borrowed.size!==hosts.size) throw Error('Unreferenced host');
}
const digest = value => createHash('sha256').update(value).digest('hex');
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const utcTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const moduleRevisions = modules => modules.map(({id, version, createdAt, updatedAt}) =>
  ({id, version, createdAt, updatedAt}));
export const LIFECYCLES = ['candidate','maintained','quarantined','deprecated','archived'];
const unavailable = state => ['quarantined','archived'].includes(state);

export function validateDependencies(modules) {
  const byId = new Map(modules.map(m => [m.id,m]));
  for (const m of modules) {
    const life = m.lifecycle;
    if (!life || !LIFECYCLES.includes(life.state) || typeof life.reason !== 'string' || !life.reason.trim() ||
        !Object.hasOwn(life,'replacement')) throw Error('Invalid lifecycle: ' + m.id);
    if (life.replacement !== null) {
      const target = byId.get(life.replacement?.id);
      if (!target || target.id === m.id || target.version !== life.replacement.version)
        throw Error('Invalid replacement: ' + m.id);
      // A replacement pointer is a migration candidate, not equivalence evidence.
    }
    if (!Array.isArray(m.dependencies)) throw Error('Missing dependencies: ' + m.id);
    const seen = new Set();
    for (const dep of m.dependencies) {
      const target = byId.get(dep?.id);
      if (!target || target.id === m.id || seen.has(dep.id) || target.version !== dep.version)
        throw Error('Invalid pinned dependency: ' + m.id);
      seen.add(dep.id);
      if (!unavailable(life.state) && unavailable(target.lifecycle?.state))
        throw Error('Unavailable dependency: ' + m.id + ' -> ' + dep.id);
    }
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error('Dependency cycle: ' + id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependencies) visit(dep.id);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

export function validateRecipe(recipe, catalog, scenario) {
  const byId = new Map(catalog.modules.map(m => [m.id,m]));
  if (!['candidate','maintained','quarantined','deprecated','archived'].includes(recipe.status))
    throw Error('Invalid recipe status');
  if (recipe.scenario !== scenario.id || !byId.has(recipe.implementation) ||
      !Array.isArray(recipe.members) || !recipe.members.every(id => byId.has(id)))
    throw Error('Dangling recipe reference');
  if (byId.get(recipe.implementation).kind !== 'composition') throw Error('Recipe implementation must be a composition');
  const members = new Set([recipe.implementation,...recipe.members]);
  if (members.size !== recipe.members.length + 1) throw Error('Duplicate recipe member');
  if (!recipe.versions || Object.keys(recipe.versions).length !== members.size ||
      [...members].some(id => recipe.versions[id] !== byId.get(id).version))
    throw Error('Recipe version mismatch');
  for (const id of members) {
    const m = byId.get(id);
    if (!unavailable(recipe.status) && unavailable(m.lifecycle.state)) throw Error('Unavailable recipe member: ' + id);
    if (m.dependencies.some(dep => !members.has(dep.id))) throw Error('Incomplete recipe dependency closure: ' + id);
  }
  if (!Array.isArray(recipe.relations)) throw Error('Missing recipe relations');
  for (const edge of recipe.relations) {
    if (![edge.owner,edge.from,edge.to].every(id => members.has(id)) || !edge.effect)
      throw Error('Invalid relation ownership');
  }
}

export function validateRevisionTransition(record, modules) {
  if (!record?.moduleRevisions) return; // Bootstrap / schema migration; never invent prior history.
  if (!Array.isArray(record.moduleRevisions)) throw Error('Invalid recorded revisions');
  const current = new Map(modules.map(m => [m.id,m]));
  for (const old of record.moduleRevisions) {
    const next = current.get(old.id);
    if (!next) throw Error('Retain archived module card instead of deleting: ' + old.id);
    if (!stableVersion.test(old.version) || !utcTimestamp(old.createdAt) || !utcTimestamp(old.updatedAt))
      throw Error('Invalid recorded revision: ' + old.id);
    if (next.createdAt !== old.createdAt) throw Error('Creation timestamp is immutable: ' + old.id);
    if (Date.parse(next.updatedAt) < Date.parse(old.updatedAt)) throw Error('Update timestamp moved backwards: ' + old.id);
    const a = old.version.split('.').map(BigInt), b = next.version.split('.').map(BigInt);
    let order = 0;
    for (let i = 0; i < 3 && !order; i++) order = b[i] > a[i] ? 1 : b[i] < a[i] ? -1 : 0;
    if (order < 0) throw Error('Module version moved backwards: ' + old.id);
    if (order > 0 && Date.parse(next.updatedAt) <= Date.parse(old.updatedAt))
      throw Error('Version upgrade needs a newer timestamp: ' + old.id);
  }
}
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
  if (catalog.schemaVersion !== 4 || !Array.isArray(catalog.modules) || !catalog.modules.length) throw Error('Invalid catalogue');
  await regular(root, catalog.maintenancePolicy);
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
  validateDependencies(catalog.modules);
  const recipe = await json(root, 'module-library/recipes/agent-image-turn.json');
  validateRecipe(recipe, catalog, scenario);
  await validateHosts(catalog, await json(root, catalog.hostRegistry), root);
  return catalog;
}

export function selectModules(catalog, {kind, tag, query, lifecycle} = {}) {
  if (kind && !TYPES[kind]) throw Error('Unknown kind: ' + kind);
  if (lifecycle && !LIFECYCLES.includes(lifecycle)) throw Error('Unknown lifecycle: ' + lifecycle);
  return catalog.modules.filter(m => (!kind || m.kind === kind) && (!tag || m.tags.includes(tag)) &&
    (!lifecycle || m.lifecycle.state === lifecycle) &&
    (!query || [m.id,m.version,m.title,m.goal,...m.tags].join(' ').toLowerCase().includes(query.toLowerCase())));
}

export function evidenceState(record, hashes, modules, hosts = []) {
  if (!record) return 'UNKNOWN';
  if (record.schemaVersion !== 3 || record.kind !== 'local-tests' || record.status !== 'PASS' ||
      !Array.isArray(record.moduleIds) || record.moduleIds.join('|') !== modules.map(m => m.id).join('|')) return 'STALE';
  if (JSON.stringify(record.moduleRevisions) !== JSON.stringify(moduleRevisions(modules))) return 'STALE';
  if (JSON.stringify(record.hostRevisions) !== JSON.stringify(hostRevisions(hosts))) return 'STALE';
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
    'scripts/module-library.mjs','scripts/module-host.mjs','cli.mjs','web-cli.mjs','cli-mcp-transport.mjs',
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
    const key = {'--kind':'kind','--tag':'tag','--query':'query','--lifecycle':'lifecycle'}[args[i]];
    if (command !== 'list' || !key || !args[i+1]) throw Error('Invalid filter');
    filters[key] = args[i+1];
  }
  const catalog = await validateCatalog(await json(root, CATALOG), root);
  const hosts = (await json(root, catalog.hostRegistry)).hosts;
  const hashes = await inputHashes(root);
  let record = await loadRecord(root);
  validateRevisionTransition(record, catalog.modules);
  validateRevisionTransition({moduleRevisions:record?.hostRevisions}, hosts);
  if (['verify','record'].includes(command)) {
    const result = await runLocal(catalog, root);
    const after = await inputHashes(root);
    if (JSON.stringify(hashes) !== JSON.stringify(after)) throw Error('Inputs changed during verification');
    if (command === 'record') {
      record = {schemaVersion:3,kind:'local-tests',status:'PASS',recordedAt:new Date().toISOString(),
        baseCommit:catalog.baseCommit,node:process.version,platform:process.platform,
        scope:'Local execution and synthetic network only; no automatic F/C/H/Q promotion.',
        moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),
        hostRevisions:hostRevisions(hosts),...result,fileHashes:after};
      await writeFile(inside(root, RECORD), JSON.stringify(record,null,2)+'\n');
    }
  }
  const local = evidenceState(record, hashes, catalog.modules, hosts);
  if (command === 'list') {
    for (const m of selectModules(catalog, filters)) {
      const gates = ['F','C','H','Q'].map(k=>k+':'+m.gates[k].status).join(' ');
      const shanghai = stamp => new Date(stamp).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
      const host = hosts.find(h=>h.id===m.host.id);
      console.log(m.id + '@' + m.version + ' | ' + m.kind + ' | ' + m.title + ' | ' + m.lifecycle.state + ' | local:' + local + ' | ' + gates +
        '\n  创建：' + shanghai(m.createdAt) + ' | 更新：' + shanghai(m.updatedAt) + '（北京时间）' +
        '\n  宿主：' + host.id + '@' + host.version + ' | ' + host.defaultMode +
        ' | 创建：' + shanghai(host.createdAt) + ' | 更新：' + shanghai(host.updatedAt) + '（北京时间）' +
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
