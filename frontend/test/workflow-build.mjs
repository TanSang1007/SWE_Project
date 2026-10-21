// Build a byte-identical frontend snapshot in an owned temporary directory.
// Existing Next development servers, their .next tree and next-env remain untouched.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const frontend=resolve(import.meta.dirname,'..');const root=resolve(frontend,'..');
export const workflowFrontendDirectory=join(root,'.tmp','a03-frontend-build');
export async function buildWorkflowFrontend(){
  const target=resolve(workflowFrontendDirectory);const marker=join(target,'.brewlite-a03-build');
  assert(target.startsWith(root+sep)&&target===join(root,'.tmp','a03-frontend-build'));
  if(existsSync(target)){assert(existsSync(marker)&&readFileSync(marker,'utf8')==='BrewLite A03 owned test build');rmSync(target,{recursive:true,force:true});}
  mkdirSync(target,{recursive:true});writeFileSync(marker,'BrewLite A03 owned test build');
  for(const file of ['package.json','tsconfig.json','next.config.ts','postcss.config.mjs'])cpSync(join(frontend,file),join(target,file));
  for(const dir of ['src','public'])cpSync(join(frontend,dir),join(target,dir),{recursive:true});
  await new Promise((ok,fail)=>{const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'build'],{cwd:target,env:{...process.env,NODE_ENV:'production',NEXT_PUBLIC_API_BASE_URL:'http://localhost:3101'},stdio:'inherit',windowsHide:true});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(new Error('Isolated frontend build failed')));});
}
