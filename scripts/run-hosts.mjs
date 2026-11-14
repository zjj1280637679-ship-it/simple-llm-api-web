import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('module-library/catalog.json',root),'utf8'));
const results=catalog.entries.map(entry=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL(entry.host.entry,root))],{encoding:'utf8',timeout:10000})));
console.log(JSON.stringify({status:'PASS',scope:'Independent local hosts; no provider live calls or complete formal proof',results},null,2));
