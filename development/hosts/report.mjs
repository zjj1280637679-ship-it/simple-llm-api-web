import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export async function report(slug, exercise) {
  const root = new URL('../../', import.meta.url);
  const contractPath = `docs/contracts/${slug}.json`;
  const contract = JSON.parse(await readFile(new URL(contractPath, root), 'utf8'));
  const {module, host} = contract;
  assert.equal(host.moduleId, module.id);
  assert.equal(host.moduleVersion, module.version);
  const startedAt = new Date().toISOString();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Local host does not provide a network transport'); };
  try {
    const observed = await exercise();
    const inputs = [module.source, host.entry, 'development/hosts/report.mjs', contractPath];
    const hashes = Object.fromEntries(await Promise.all(inputs.map(async path => [path,
      createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')])));
    console.log(JSON.stringify({status:'PASS',evidenceType:'LOCAL',module,host,startedAt,
      finishedAt:new Date().toISOString(),runtime:process.version,observed,hashes,
      scope:'Declared host observations only; no real API or complete F/C/H/Q claim.'},null,2));
  } finally {
    globalThis.fetch = oldFetch;
  }
}
