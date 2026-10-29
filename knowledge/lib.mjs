/** Knowledge navigation only: no network, credentials, or production imports. */
import {readFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export function inside(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')) throw new Error(`Invalid relative path: ${path}`);
  const target = resolve(root, path), rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Path escapes repository: ${path}`);
  return target;
}
export async function loadGraph(root = repositoryRoot) {
  const pointer = JSON.parse(await readFile(inside(root, 'knowledge/current.json'), 'utf8'));
  const graph = JSON.parse(await readFile(inside(root, `knowledge/${pointer.graph}`), 'utf8'));
  if (pointer.snapshotId !== graph.snapshotId || pointer.sourceCommit !== graph.source?.commit) throw new Error('Pointer and snapshot identity differ');
  return {pointer, graph};
}
export function findNode(graph, input) {
  return graph.nodes.find(n => n.id === input || n.id === `file:${input}` || n.id === `module:${input}` || n.id === `host:${input}`);
}
export function identity(graph) {
  return {snapshotId:graph.snapshotId, sourceCommit:graph.source.commit, projectVersion:graph.source.projectVersion,
    knowledgeVersion:graph.knowledgeVersion, note:'Frozen knowledge. Run node knowledge/check.mjs before treating it as current.'};
}
