/** Advisory structure inventory. No keyword ban, quality score or proof badge. */
import {readdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

const root = new URL('../', import.meta.url);
async function files(directory) {
  const entries=await readdir(new URL(directory,root),{withFileTypes:true});
  const result=[];
  for(const entry of entries) {
    const path=directory+entry.name;
    if(entry.isDirectory())result.push(...await files(path+'/'));
    else if(entry.isFile())result.push(path);
  }
  return result.sort();
}
const sources=(await files('src/')).filter(path=>path.endsWith('.js'));
const modules=[];
for(const path of sources) {
  const source=await readFile(new URL(path,root),'utf8');
  const imports=[...source.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)]
    .map(match=>posix.normalize(posix.join(posix.dirname(path),match[1])));
  modules.push({path,bytes:Buffer.byteLength(source),lines:source.split('\n').length-Number(source.endsWith('\n')),
    maxLineCharacters:Math.max(...source.split('\n').map(line=>line.length)),
    relativeImports:[...new Set(imports)].sort(),sha256:createHash('sha256').update(source).digest('hex')});
}
const cards=[];
for(const path of (await files('docs/contracts/')).filter(path=>path.endsWith('.json'))) {
  const card=JSON.parse(await readFile(new URL(path,root),'utf8'));
  if(card.host.moduleId!==card.module.id || card.host.moduleVersion!==card.module.version)throw new Error(`Host binding mismatch: ${path}`);
  for(const record of [card.module,card.host]) {
    if(!/^\d+\.\d+\.\d+$/.test(record.version) || new Date(record.createdAt).toISOString()!==record.createdAt || new Date(record.updatedAt).toISOString()!==record.updatedAt || Date.parse(record.updatedAt)<Date.parse(record.createdAt)) throw new Error(`Invalid revision metadata: ${path}`);
  }
  for(const input of [card.module.source,card.host.entry,...card.tests]) {
    if(input.startsWith('/') || input.split('/').some(part=>part==='..'||!part))throw new Error(`Non-canonical path: ${input}`);
    await readFile(new URL(input,root));
  }
  cards.push({path,module:card.module.id,host:card.host.id,gates:card.gates});
}
console.log(JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),mode:'advisory',
  interpretation:'Size and long lines identify review locations, not defects or bans. Literal imports are an approximate static view, not an effect-dependency or proof graph. Card validation checks structure only.',
  modules,cards},null,2));
