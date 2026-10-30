import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
async function check(directory) {
  for(const entry of await readdir(new URL(directory,root),{withFileTypes:true})) {
    const path=directory+entry.name;
    if(entry.isDirectory())await check(path+'/');
    else if(/\.(m?js)$/.test(path)) {
      const result=spawnSync(process.execPath,['--check',new URL(path,root).pathname],{encoding:'utf8'});
      if(result.status!==0)throw new Error(`${path}: ${result.stderr}`);
    }
  }
}
for(const directory of ['src/','scripts/','development/hosts/','development/models/','cli/'])await check(directory);
console.log('Syntax checks passed for production, development hosts, scripts and CLI.');
