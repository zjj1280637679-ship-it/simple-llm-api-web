import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('every browser QA inline JavaScript script parses as its actual script type',async()=>{
 const root=new URL('./browser/',import.meta.url),temp=await mkdtemp(join(tmpdir(),'qa-syntax-'));
 try {for(const file of await readdir(root)){
  if(!file.endsWith('.html'))continue;
  const html=await readFile(new URL(file,root),'utf8');let index=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=/.test(match[1]) || /\btype\s*=\s*["'](?:application\/json|importmap)/.test(match[1]))continue;
   const path=join(temp,`${file}-${index++}.${/\btype\s*=\s*["']module/.test(match[1])?'mjs':'js'}`);
   await writeFile(path,match[2]);const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
   assert.equal(result.status,0,`${file}: ${result.stderr}`);
  }
 }}finally{await rm(temp,{recursive:true,force:true})}
});
