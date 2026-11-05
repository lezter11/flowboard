import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {candidateGuard,safeEnv} from '../operations/prod-guards.mjs';
const source=process.cwd();
function git(root,args){return execFileSync('git',args,{cwd:root,env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
test('candidate guard accepts clean exact detached synthetic repository and refuses wrong SHA, attached HEAD, dirt, missing or extra migration',async()=>{
 const root=await fs.mkdtemp('/private/tmp/flowboard-operations-review-');
 try{
  await fs.mkdir(path.join(root,'database'),{recursive:true});
  await fs.cp(path.join(source,'database/migrations'),path.join(root,'database/migrations'),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'synthetic-candidate-guard',private:true}));
  await fs.writeFile(path.join(root,'.gitignore'),'node_modules/\n');
  await fs.mkdir(path.join(root,'node_modules/pg'),{recursive:true});
  await fs.writeFile(path.join(root,'node_modules/pg/index.js'),'module.exports={syntheticFixture:true};\n');
  git(root,['init','--quiet']);git(root,['add','.']);git(root,['-c','user.name=Synthetic Review','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Synthetic guard fixture']);
  const sha=git(root,['rev-parse','HEAD']);const branch=git(root,['symbolic-ref','--short','HEAD']);
  await assert.rejects(candidateGuard(root,sha),/detached candidate required/);
  git(root,['checkout','--detach','--quiet',sha]);
  const accepted=await candidateGuard(root,sha);assert.equal(accepted.sha,sha);assert.equal(accepted.pg.syntheticFixture,true);await accepted.recheck();
  await assert.rejects(candidateGuard(root,'a'.repeat(40)));
  await fs.writeFile(path.join(root,'unexpected.txt'),'synthetic');await assert.rejects(candidateGuard(root,sha),/candidate must be clean/);await fs.unlink(path.join(root,'unexpected.txt'));
  const first=path.join(root,'database/migrations/0001_initial.sql'),original=await fs.readFile(first);await fs.writeFile(first,'synthetic drift');await assert.rejects(candidateGuard(root,sha));await fs.writeFile(first,original);
  await fs.writeFile(path.join(root,'database/migrations/28_surprise.sql'),'synthetic');await assert.rejects(candidateGuard(root,sha));await fs.unlink(path.join(root,'database/migrations/28_surprise.sql'));
  await fs.unlink(first);await assert.rejects(candidateGuard(root,sha));await fs.writeFile(first,original);
  git(root,['checkout','--quiet',branch]);await assert.rejects(candidateGuard(root,sha));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('candidate guard refuses malformed SHA and a non-private-tmp root',async()=>{await assert.rejects(candidateGuard(source,'invalid'));await assert.rejects(candidateGuard(source,'a'.repeat(40)),/isolated private\/tmp candidate required/);});
