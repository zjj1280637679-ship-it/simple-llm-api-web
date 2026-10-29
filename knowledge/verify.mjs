/** Minimal offline host for the knowledge tooling, version 1.0.0.
 * Uses a disposable copy; never changes the working project or its evidence.
 */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkKnowledge} from './check.mjs';
import {loadGraph, repositoryRoot, inside} from './lib.mjs';

const startedAt = new Date().toISOString();
const {graph,pointer} = await loadGraph();
const temp = await mkdtemp(join(tmpdir(),'llm-knowledge-verify-'));
const observed = {};
try {
  for (const n of graph.nodes.filter(n=>n.kind==='file')) {
    const path=inside(temp,n.path);await mkdir(dirname(path),{recursive:true});await copyFile(inside(repositoryRoot,n.path),path);
  }
  await cp(join(repositoryRoot,'knowledge'),join(temp,'knowledge'),{recursive:true});
  observed.cleanCopy = (await checkKnowledge(temp)).status;
  assert.equal(observed.cleanCopy,'MATCH');
  const target=join(temp,'src/persistence.js'), original=await readFile(target);
  await writeFile(target,Buffer.concat([original,Buffer.from('\n// synthetic drift probe\n')]));
  assert.ok((await checkKnowledge(temp)).drift.some(x=>x.path==='src/persistence.js' && x.reason==='content-changed'));
  observed.contentDriftDetected=true;
  await rm(target);
  assert.ok((await checkKnowledge(temp)).drift.some(x=>x.path==='src/persistence.js' && x.reason==='missing'));
  observed.missingFileDetected=true;
  await writeFile(target,original);
  const added='src/knowledge-synthetic-probe.js';await writeFile(join(temp,added),'// temporary addition\n');
  assert.ok((await checkKnowledge(temp)).additions.includes(added));observed.additionDetected=true;
  await rm(join(temp,added));
  const graphPath=inside(temp,`knowledge/${pointer.graph}`), originalGraph=await readFile(graphPath);
  const malformed=JSON.parse(originalGraph);malformed.edges[0].target='file:absent';await writeFile(graphPath,JSON.stringify(malformed));
  await assert.rejects(()=>checkKnowledge(temp),/dangling edge/);observed.danglingEdgeRejected=true;
  await writeFile(graphPath,originalGraph);
  const brokenAnchor=JSON.parse(originalGraph);
  const reference=brokenAnchor.edges.find(e=>e.relation==='references_import').refs[0];reference.line=999999;
  await writeFile(graphPath,JSON.stringify(brokenAnchor));
  await assert.rejects(()=>checkKnowledge(temp),/Anchor\/line mismatch/);observed.badAnchorRejected=true;
  assert.throws(()=>inside(temp,'../outside'),/escapes/);observed.pathTraversalRejected=true;
  const query=args=>spawnSync(process.execPath,[join(repositoryRoot,'knowledge/query.mjs'),...args],{encoding:'utf8'});
  for(const args of [['overview'],['route','storage'],['search','原生'],['show','R-010'],['show','flow:image'],['impact','src/persistence.js']]) {
    const result=query(args);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).sourceCommit,graph.source.commit);
  }
  const impact=JSON.parse(query(['impact','src/persistence.js']).stdout).result;
  assert.ok(impact.files.includes('src/workbench.js'));
  assert.ok(impact.registeredModules.some(m=>m.id==='C-002'));
  observed.queryRoutesAndImpact=true;
  assert.equal(query(['show','missing-node']).status,2);observed.unknownNodeRejected=true;
  const paths=['knowledge/lib.mjs','knowledge/check.mjs','knowledge/query.mjs','knowledge/verify.mjs',`knowledge/${pointer.graph}`];
  const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(inside(repositoryRoot,p))).digest('hex')])));
  console.log(JSON.stringify({toolVersion:'1.0.0',hostVersion:'1.0.0',startedAt,finishedAt:new Date().toISOString(),runtime:process.version,
    snapshotId:graph.snapshotId,sourceCommit:graph.source.commit,status:'PASS',observed,hashes,
    scope:'Offline disposable-copy host. Checks navigation and structural/file-drift detection; no proof of complete semantic knowledge, original test truth or provider availability.'},null,2));
} finally {await rm(temp,{recursive:true,force:true});}
