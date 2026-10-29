import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validateHosts } from './module-library.mjs';

export async function main(args=process.argv.slice(2)) {
  if (!args.length || args[0]==='--help') {
    console.log('npm run modules:host -- MODULE_ID [--live] [--prompt TEXT] [--out DIRECTORY]');
    return 0;
  }
  const catalog=JSON.parse(await readFile(resolve(ROOT,'module-library/catalog.json'),'utf8'));
  const module=catalog.modules.find(m=>m.id===args[0]);
  if (!module) throw Error('Unknown module ID');
  const registry=JSON.parse(await readFile(resolve(ROOT,catalog.hostRegistry),'utf8'));
  const host=registry.hosts.find(h=>h.id===module.host.id);
  await validateHosts({modules:[module]},{schemaVersion:1,hosts:[host]});
  const result=spawnSync(process.execPath,[resolve(ROOT,host.entry),...args.slice(1)],{
    stdio:'inherit',cwd:ROOT,timeout:130000
  });
  if (result.error) throw Error('Host process failed or timed out');
  return result.status===0?0:1;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
