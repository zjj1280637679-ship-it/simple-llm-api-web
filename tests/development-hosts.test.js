import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

test('every contract has one unique module and host identity in the complete catalog',()=>{
  const root=new URL('../',import.meta.url);
  const contracts=readdirSync(new URL('docs/contracts/',root)).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(new URL(`docs/contracts/${name}`,root),'utf8')));
  const catalog=JSON.parse(readFileSync(new URL('module-library/catalog.json',root),'utf8')).entries;
  assert.equal(catalog.length,contracts.length);
  for(const values of [catalog.map(e=>e.id),catalog.map(e=>e.source),contracts.map(c=>c.module.id),contracts.map(c=>c.host.id)])assert.equal(new Set(values).size,values.length);
  for(const contract of contracts){
    const entry=catalog.find(e=>e.source===contract.module.source);
    assert.ok(entry,`Missing catalog entry: ${contract.module.source}`);
    assert.equal(entry.id,contract.module.id);assert.equal(entry.version,contract.module.version);assert.deepEqual(entry.host,contract.host);
  }
});

for (const slug of readdirSync(new URL('../docs/contracts/',import.meta.url)).filter(name=>name.endsWith('.json')).map(name=>name.slice(0,-5))) {
  test(`${slug} host exercises the production module and identifies exact source/host revisions`, () => {
    const root=new URL('../',import.meta.url);
    const output=execFileSync(process.execPath,[fileURLToPath(new URL(`development/hosts/${slug}.mjs`,root))],{encoding:'utf8',timeout:10000});
    const result=JSON.parse(output);
    assert.equal(result.status,'PASS');
    assert.equal(result.host.moduleVersion,result.module.version);
    assert.equal(result.host.moduleId,result.module.id);
    for(const revision of [result.module,result.host]) {
      assert.match(revision.version,/^\d+\.\d+\.\d+$/);
      assert.equal(new Date(revision.createdAt).toISOString(),revision.createdAt);
      assert.ok(Date.parse(revision.updatedAt)>=Date.parse(revision.createdAt));
    }
    for(const [path,hash] of Object.entries(result.hashes)) {
      assert.equal(hash,createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'));
    }
  });
}
