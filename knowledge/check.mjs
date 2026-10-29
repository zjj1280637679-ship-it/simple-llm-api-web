/** Verify structure and frozen-file correspondence; never promotes F/C/H/Q. */
import {readFile, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGraph, inside, repositoryRoot} from './lib.mjs';

const excluded = new Set(['.git','node_modules','dist','knowledge','AGENTS.md']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export async function checkKnowledge(root = repositoryRoot) {
  const {pointer,graph} = await loadGraph(root);
  if (graph.schemaVersion!=='1.0.0' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Unsupported graph structure');
  if (!/^[a-f0-9]{40}$/.test(graph.source?.commit) || !/^[a-f0-9]{40}$/.test(graph.source?.tree)) throw new Error('Invalid source identity');
  const ids = new Set(), files = new Map(), edgeIds = new Set();
  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id) || !node.kind || !node.status || !node.label || !Array.isArray(node.refs) || !node.refs.length) throw new Error(`Invalid/duplicate node: ${node.id}`);
    ids.add(node.id);
    if (node.kind==='file') {
      inside(root,node.path);
      if (node.id!==`file:${node.path}` || files.has(node.path) || !/^[a-f0-9]{64}$/.test(node.sha256) || !/^[a-f0-9]{40}$/.test(node.gitBlobSha)) throw new Error(`Invalid file identity: ${node.id}`);
      files.set(node.path,node);
    }
  }
  const references = graph.nodes.flatMap(n=>n.refs);
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target) || !edge.relation || !Array.isArray(edge.refs) || !edge.refs.length) throw new Error(`Invalid/dangling edge: ${edge.id}`);
    edgeIds.add(edge.id); references.push(...edge.refs);
  }
  for (const ref of references) {
    if (!files.has(ref.path) || ref.gitBlobSha!==files.get(ref.path).gitBlobSha || (ref.line!==undefined && (!Number.isInteger(ref.line) || ref.line<1))) throw new Error(`Invalid source reference: ${ref.path}`);
  }
  for (const route of graph.readingRoutes) for (const path of [...route.read,...route.inspect,...route.verify]) if (!files.has(path)) throw new Error(`Unknown route path: ${path}`);
  const counts={files:files.size,modules:graph.nodes.filter(n=>n.kind==='module').length,hosts:graph.nodes.filter(n=>n.kind==='host').length,nodes:ids.size,edges:edgeIds.size};
  if (Object.keys(counts).some(k=>counts[k]!==graph.counts[k]) || files.size!==graph.source.filesMatched) throw new Error('Count metadata mismatch');
  const drift=[], bytesByPath=new Map();
  for (const [path,node] of files) {
    try {
      const full=inside(root,path);
      if (!(await lstat(full)).isFile()) {drift.push({path,reason:'not-regular-file'});continue;}
      const bytes=await readFile(full);
      if (sha256(bytes)!==node.sha256 || gitBlob(bytes)!==node.gitBlobSha) drift.push({path,reason:'content-changed'});
      else bytesByPath.set(path,bytes);
    } catch(error) {drift.push({path,reason:error.code==='ENOENT'?'missing':error.code||'read-failed'});}
  }
  for (const ref of references) {
    if (!ref.anchor || !bytesByPath.has(ref.path)) continue;
    const text=bytesByPath.get(ref.path).toString('utf8');
    const start=text.split('\n').slice(0,ref.line-1).join('\n').length+(ref.line>1?1:0);
    if (!text.startsWith(ref.anchor,start) && !text.slice(start,text.indexOf('\n',start)===-1?undefined:text.indexOf('\n',start)).includes(ref.anchor)) {
      // Curated anchors may begin inside a line; static multiline imports begin at its start.
      throw new Error(`Anchor/line mismatch: ${ref.path}:${ref.line}`);
    }
  }
  const additions=[];
  async function walk(prefix='') {
    for (const entry of await readdir(inside(root,prefix||'.'),{withFileTypes:true})) {
      if (!prefix && excluded.has(entry.name)) continue;
      const path=prefix+entry.name;
      if (entry.isDirectory()) await walk(path+'/');
      else if (!files.has(path)) additions.push(path);
    }
  }
  await walk();
  const status=drift.length || additions.length ? 'DRIFT' : 'MATCH';
  return {status,structure:'PASS',snapshotId:graph.snapshotId,sourceCommit:graph.source.commit,counts,matchedFiles:bytesByPath.size,drift,additions,
    publicationOverlay:['knowledge/**','AGENTS.md'],ignoredBuildAndDependencyDirectories:['.git','dist','node_modules'],
    scope:'Local file identity and graph references only; no network, remote-head verification, evidence-truth certification, semantic completeness or F/C/H/Q promotion.'};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const report=await checkKnowledge();console.log(JSON.stringify(report,null,2));if(report.status!=='MATCH')process.exitCode=1;}
  catch(error) {console.error(`INVALID: ${error.message}`);process.exitCode=2;}
}
