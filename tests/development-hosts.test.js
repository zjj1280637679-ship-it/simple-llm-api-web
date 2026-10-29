import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

for (const slug of readdirSync(new URL('../docs/contracts/',import.meta.url)).filter(name=>name.endsWith('.json')).map(name=>name.slice(0,-5))) {
  test(`${slug} host exercises the production module and identifies exact source/host revisions`, () => {
    const root=new URL('../',import.meta.url);
    const output=execFileSync(process.execPath,[new URL(`development/hosts/${slug}.mjs`,root).pathname],{encoding:'utf8',timeout:10000});
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
