/** Read the frozen graph. These results guide inspection, not effect/proof claims. */
import {loadGraph, findNode, identity} from './lib.mjs';

try {
  const {graph} = await loadGraph();
  const [command = 'overview', ...args] = process.argv.slice(2);
  const input = args.join(' ');
  const brief = n => ({id:n.id, label:n.label, kind:n.kind, status:n.status});
  let result;
  if (command === 'overview') {
    result = {counts:graph.counts, flows:graph.nodes.filter(n=>n.kind==='flow').map(brief),
      routes:graph.readingRoutes.map(({id,label})=>({id,label})),
      boundaries:graph.nodes.filter(n=>n.kind==='boundary').map(brief)};
  } else if (command === 'search') {
    if (!input) throw new Error('search needs a term');
    const matches = graph.nodes.filter(n=>JSON.stringify(n).toLowerCase().includes(input.toLowerCase()));
    result = {total:matches.length, returned:Math.min(matches.length,50), nodes:matches.slice(0,50).map(brief)};
  } else if (command === 'show') {
    const node = findNode(graph,input);
    if (!node) throw new Error(`Unknown node: ${input}`);
    result = {node, edges:graph.edges.filter(e=>e.source===node.id || e.target===node.id)};
  } else if (command === 'route') {
    result = graph.readingRoutes.find(r=>r.id===input);
    if (!result) throw new Error(`Unknown route: ${input}; use overview`);
  } else if (command === 'impact') {
    const node = findNode(graph,input);
    if (node?.kind !== 'file') throw new Error('impact needs an indexed file path');
    const affected = new Set([node.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (edge.relation==='references_import' && affected.has(edge.target) && !affected.has(edge.source)) {
          affected.add(edge.source); changed = true;
        }
      }
    }
    const modules = graph.nodes.filter(n=>n.kind==='module' && affected.has(`file:${n.module.source}`));
    result = {input:node.path, scope:'Partial navigation through recorded static import/re-export references. Dynamic imports, injected collaborators, DOM/event coupling and semantic effects may be absent.',
      files:[...affected].map(id=>id.slice(5)).sort(),
      registeredModules:modules.map(n=>({id:n.module.id, source:n.module.source, contract:n.contract, host:n.host.entry, tests:n.tests})),
      relatedTopics:graph.readingRoutes.filter(r=>[...r.read,...r.inspect,...r.verify].includes(node.path)).map(r=>r.id)};
  } else {
    throw new Error('Commands: overview | search TERM | show ID_OR_PATH | route ID | impact FILE');
  }
  console.log(JSON.stringify({...identity(graph), result},null,2));
} catch (error) {
  console.error(error.message); process.exitCode = 2;
}
