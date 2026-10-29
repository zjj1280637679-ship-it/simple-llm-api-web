/** Check whether recorded local evidence still identifies these inputs.
 * This verifies correspondence, not truth, signatures, or formal correctness.
 */
import {readdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = new URL('../',import.meta.url);
async function walk(directory) {
  const found=[];
  for(const entry of await readdir(new URL(directory,root),{withFileTypes:true})) {
    const path=directory+entry.name;
    if(entry.isDirectory())found.push(...await walk(path+'/'));
    else if(entry.isFile())found.push(path);
    else throw new Error(`Expected regular input: ${path}`);
  }
  return found;
}
export async function inputHashes() {
  const paths=['package.json','index.html','.nojekyll'];
  for(const directory of ['src/','tests/','scripts/','development/hosts/','docs/contracts/','.github/workflows/'])paths.push(...await walk(directory));
  return Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,
    createHash('sha256').update(await readFile(new URL(path,root))).digest('hex')])));
}
export async function checkEvidence() {
  const record=JSON.parse(await readFile(new URL('development/evidence/review.json',root),'utf8'));
  const current=await inputHashes();
  if(JSON.stringify(record.inputHashes)!==JSON.stringify(current))throw new Error('STALE: recorded local evidence does not match the current input set/content.');
  for(const run of record.runs) {
    if(!/^development\/evidence\/[a-z0-9-]+\.txt$/.test(run.output))throw new Error('Invalid evidence output path');
    const hash=createHash('sha256').update(await readFile(new URL(run.output,root))).digest('hex');
    if(hash!==run.outputSha256)throw new Error(`STALE: changed command output: ${run.command}`);
  }
  return {status:'MATCH',inputs:Object.keys(current).length,
    scope:'Input/output fingerprints match the recorded local run; no automatic F/C/H/Q promotion.'};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkEvidence(),null,2)); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}
