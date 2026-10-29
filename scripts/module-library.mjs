import { readFile, readdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredTestFiles, normalizeTestRun, bindTestResults, testResultsDigest, testResultsMatch, testCommands, summarizeTestResults } from './module-test-results.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'module-library/catalog.json';
const RECORD = 'module-library/evidence/local-tests.json';
const TYPES = {function:'functions',relation:'relations',composition:'compositions'};
const STATES = ['PASS','FAIL','UNKNOWN','STALE'];
export const hostRevisions = hosts => hosts.map(({id,version,createdAt,updatedAt,module,defaultMode,resourceLock}) =>
  ({id,version,createdAt,updatedAt,module:{...module},mode:defaultMode,...(resourceLock ? {resourceLock} : {})}));

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
  await loadResourceRevisions(catalog, registry.hosts, root);
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

// Shared simulator resources are separate from callable F/R/C production modules.
const RESOURCE_REGISTRY = 'module-library/test-resources/catalog.json';
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && Boolean(value.trim());
const validTimedRevision = value => nonempty(value.id) && stableVersion.test(value.version) &&
  utcTimestamp(value.createdAt) && utcTimestamp(value.updatedAt) &&
  Date.parse(value.updatedAt) >= Date.parse(value.createdAt);

export async function validateTestResources(registry, root = ROOT) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.resources)) throw Error('Invalid test resource registry');
  const manifests = new Map();
  for (const entry of registry.resources) {
    if (!/^TR-[A-Z][A-Z0-9-]*-\d{3}$/.test(entry.id) || manifests.has(entry.id) ||
        !entry.manifest?.startsWith('module-library/test-resources/')) throw Error('Invalid or duplicate test resource');
    const manifest = await json(root, entry.manifest);
    if (manifest.resourceId !== entry.id || (manifest.id !== undefined && manifest.id !== entry.id) ||
        manifest.schemaVersion !== '1.0.0' || !stableVersion.test(manifest.resourceVersion) ||
        !stableVersion.test(manifest.fixtureSetVersion) || !nonempty(manifest.protocolSnapshot) ||
        !utcTimestamp(manifest.createdAt) || !utcTimestamp(manifest.updatedAt) ||
        Date.parse(manifest.updatedAt) < Date.parse(manifest.createdAt) ||
        manifest.evidenceType !== 'SIMULATED' || manifest.realApiCalled !== false)
      throw Error('Invalid test resource manifest: ' + entry.id);
    if (['configurationApiVersion','configurationSchemaVersion','configurationEntry'].some(key=>Object.hasOwn(manifest,key))) {
      if (!stableVersion.test(manifest.configurationApiVersion) || manifest.configurationSchemaVersion !== '1.0.0' ||
          typeof manifest.configurationEntry !== 'string' || !manifest.configurationEntry.endsWith('.mjs'))
        throw Error('Invalid configuration API contract');
      const base = dirname(entry.manifest);
      const target = relative(root, inside(resolve(root, base), manifest.configurationEntry)).split(sep).join('/');
      await regular(root, target);
    }
    if (!Array.isArray(manifest.fixtures) || !manifest.fixtures.length ||
        !Array.isArray(manifest.scenarios) || !manifest.scenarios.length) throw Error('Missing resource fixtures or scenarios');
    const fixtures = new Map(), scenarios = new Set();
    for (const fixture of manifest.fixtures) {
      if (!validTimedRevision(fixture) || fixtures.has(fixture.id) || !sha256(fixture.sha256))
        throw Error('Invalid resource fixture');
      // Fixture paths are package-relative, never outside their owning resource.
      const base = dirname(entry.manifest), target = relative(root, inside(resolve(root, base), fixture.path)).split(sep).join('/');
      const bytes = await readFile(await regular(root, target));
      if (digest(bytes) !== fixture.sha256) throw Error('Resource fixture hash mismatch: ' + fixture.id);
      const contents = JSON.parse(bytes.toString('utf8'));
      if (['id','version','createdAt','updatedAt'].some(field=>contents[field] !== fixture[field]))
        throw Error('Resource fixture metadata mismatch: ' + fixture.id);
      fixtures.set(fixture.id, fixture);
    }
    for (const scenario of manifest.scenarios) {
      if (!validTimedRevision(scenario) || scenarios.has(scenario.id) || !fixtures.has(scenario.fixtureId))
        throw Error('Invalid resource scenario');
      scenarios.add(scenario.id);
    }
    if (manifest.assets !== undefined && !Array.isArray(manifest.assets)) throw Error('Invalid resource assets');
    const assets = new Set();
    for (const asset of manifest.assets || []) {
      if (!validTimedRevision(asset) || assets.has(asset.id) || !sha256(asset.sha256) ||
          (asset.mimeType !== undefined && !nonempty(asset.mimeType)) ||
          ['width','height'].some(field=>asset[field] !== undefined && (!Number.isInteger(asset[field]) || asset[field] <= 0)))
        throw Error('Invalid resource asset');
      const base = dirname(entry.manifest), target = relative(root, inside(resolve(root, base), asset.path)).split(sep).join('/');
      if (digest(await readFile(await regular(root, target))) !== asset.sha256)
        throw Error('Resource asset hash mismatch: ' + asset.id);
      assets.add(asset.id);
    }
    manifests.set(entry.id, {manifest, manifestPath:entry.manifest,
      manifestSha256:digest(await readFile(await regular(root, entry.manifest)))});
  }
  return manifests;
}

export function validateHostResourceLock(lock, manifests) {
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.resources) || !lock.resources.length)
    throw Error('Invalid host resource lock');
  const seen = new Set();
  for (const binding of lock.resources) {
    const source = manifests.get(binding.resourceId), manifest = source?.manifest;
    const scenario = manifest?.scenarios.find(s=>s.id===binding.scenarioId);
    const fixture = manifest?.fixtures.find(f=>f.id===scenario?.fixtureId);
    const key = binding.resourceId + '/' + binding.scenarioId;
    if (!source || !scenario || !fixture || seen.has(key) || binding.resourceVersion !== manifest.resourceVersion ||
        binding.scenarioVersion !== scenario?.version || binding.fixtureSetVersion !== manifest.fixtureSetVersion ||
        binding.fixtureSha256 !== fixture?.sha256 || binding.protocolSnapshot !== manifest.protocolSnapshot)
      throw Error('Host resource lock mismatch: ' + key);
    seen.add(key);
  }
  return lock;
}

export function validateResourceRevisionTransition(previous = [], current = []) {
  const cards = revisions => [...new Map(revisions.map(revision => [revision.resourceId,{
    id:revision.resourceId,version:revision.resourceVersion,createdAt:revision.createdAt,updatedAt:revision.updatedAt
  }])).values()];
  validateRevisionTransition({moduleRevisions:cards(previous)}, cards(current));
}

export async function loadResourceRevisions(catalog, hosts, root = ROOT) {
  // No-resource catalogues and old unit-test records remain readable.
  if (!catalog.testResourceRegistry && !hosts.some(h=>h.resourceLock)) return [];
  const registryPath = catalog.testResourceRegistry || RESOURCE_REGISTRY;
  if (!registryPath.startsWith('module-library/test-resources/')) throw Error('Invalid resource registry path');
  const manifests = await validateTestResources(await json(root, registryPath), root);
  const revisions = [];
  for (const host of hosts) {
    if (!host.resourceLock) continue;
    if (!host.resourceLock.startsWith('module-library/hosts/')) throw Error('Invalid host resource lock path');
    const lock = validateHostResourceLock(await json(root, host.resourceLock), manifests);
    const lockSha256 = digest(await readFile(await regular(root, host.resourceLock)));
    for (const binding of lock.resources) {
      const {manifest, manifestSha256} = manifests.get(binding.resourceId);
      revisions.push({...binding,hostId:host.id,createdAt:manifest.createdAt,updatedAt:manifest.updatedAt,
        manifestSha256,lockSha256});
    }
  }
  return revisions;
}

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
    if (m.tests.some(file=>relative(root,inside(root,file)).split(sep).join('/') !== file))
      throw Error('Required test paths must be canonical: '+m.id);
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

export function evidenceState(record, hashes, modules, hosts = [], resources = []) {
  if (!record) return 'UNKNOWN';
  if (record.schemaVersion !== 5 || record.kind !== 'local-tests' || record.status !== 'PASS' ||
      !Array.isArray(record.moduleIds) || record.moduleIds.join('|') !== modules.map(m => m.id).join('|')) return 'STALE';
  if (JSON.stringify(record.moduleRevisions) !== JSON.stringify(moduleRevisions(modules))) return 'STALE';
  if (JSON.stringify(record.hostRevisions) !== JSON.stringify(hostRevisions(hosts))) return 'STALE';
  if (JSON.stringify(record.resourceRevisions || []) !== JSON.stringify(resources)) return 'STALE';
  if (!testResultsMatch(record,modules,hashes)) return 'STALE';
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
    'scripts/module-library.mjs','scripts/module-host.mjs','scripts/gemini-simulator.mjs','scripts/ark-simulator.mjs','scripts/simulator-cli.mjs','cli.mjs','web-cli.mjs','cli-mcp-transport.mjs',
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
export async function runLocal(catalog, root) {
  const runStartedAt = new Date().toISOString();
  const files = requiredTestFiles(catalog.modules), results = [], commands = [];
  const env = {...process.env};
  // Do not inherit an enclosing test runner's IPC mode or hidden test filters.
  delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  // One process per required file gives unambiguous entry-file ownership even
  // when it imports test cases from helpers, and works with Node 20 events.
  for (const file of files) {
    const args = testCommands(catalog.modules)[results.length];
    const run = spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env,
      maxBuffer:20*1024*1024,timeout:120000});
    if (run.error) throw Error('Local verification failed for '+file+'; evidence was not replaced: '+run.error.message);
    const result = normalizeTestRun(run.stdout || '',{file,root,exitCode:run.status});
    results.push(result); commands.push(args);
    console.log(file+' | '+result.status+' | '+JSON.stringify(result.stats));
    if (result.status !== 'PASS') throw Error('Incomplete required tests: '+file+'; evidence was not replaced');
  }
  const stats = summarizeTestResults(results);
  if (!files.length) throw Error('No required test files');
  return {commands,stats,results,runnerEnvironment:{NODE_OPTIONS:'cleared',NODE_TEST_CONTEXT:'cleared'},runStartedAt,runFinishedAt:new Date().toISOString()};
}

export async function writeRecordAtomic(root, record) {
  const target = inside(root,RECORD), temp = target+'.'+randomUUID()+'.tmp';
  try {
    await writeFile(temp,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    await rename(temp,target);
  } finally { await rm(temp,{force:true}); }
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
  const resources = await loadResourceRevisions(catalog, hosts, root);
  const hashes = await inputHashes(root);
  let record = await loadRecord(root);
  validateRevisionTransition(record, catalog.modules);
  validateRevisionTransition({moduleRevisions:record?.hostRevisions}, hosts);
  validateResourceRevisionTransition(record?.resourceRevisions, resources);
  if (['verify','record'].includes(command)) {
    const result = await runLocal(catalog, root);
    const after = await inputHashes(root);
    if (JSON.stringify(hashes) !== JSON.stringify(after)) throw Error('Inputs changed during verification');
    if (command === 'record') {
      const {results,...execution} = result;
      const testResults = bindTestResults(catalog.modules,results,after);
      record = {schemaVersion:5,kind:'local-tests',status:'PASS',recordedAt:new Date().toISOString(),
        baseCommit:catalog.baseCommit,node:process.version,platform:process.platform,
        scope:'Local execution and synthetic network only; no automatic F/C/H/Q promotion.',
        evidenceTypes:['LOCAL','SIMULATED'],realApiCalled:false,
        moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),
        hostRevisions:hostRevisions(hosts),resourceRevisions:resources,...execution,
        testResults,testResultsSha256:testResultsDigest(testResults),fileHashes:after};
      if (evidenceState(record,after,catalog.modules,hosts,resources) !== 'PASS')
        throw Error('Prospective evidence is invalid; previous evidence was not replaced');
      await writeRecordAtomic(root,record);
    }
  }
  const local = evidenceState(record, hashes, catalog.modules, hosts, resources);
  if (command === 'list') {
    for (const m of selectModules(catalog, filters)) {
      const gates = ['F','C','H','Q'].map(k=>k+':'+m.gates[k].status).join(' ');
      const shanghai = stamp => new Date(stamp).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
      const host = hosts.find(h=>h.id===m.host.id);
      console.log(m.id + '@' + m.version + ' | ' + m.kind + ' | ' + m.title + ' | ' + m.lifecycle.state + ' | local:' + local + ' | ' + gates +
        '\n  创建：' + shanghai(m.createdAt) + ' | 更新：' + shanghai(m.updatedAt) + '（北京时间）' +
        '\n  宿主：' + host.id + '@' + host.version + ' | ' + host.defaultMode +
        ' | 创建：' + shanghai(host.createdAt) + ' | 更新：' + shanghai(host.updatedAt) + '（北京时间）' +
        '\n  必需测试：' + new Set(m.tests).size + ' 个文件；归属及逐文件结果见 local-tests.json（local:' + local + '）' +
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
