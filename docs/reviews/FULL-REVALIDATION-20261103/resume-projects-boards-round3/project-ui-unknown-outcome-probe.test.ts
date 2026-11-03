import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import {api} from '../../../../apps/web/src/lib/api.ts';

test('independent actual Settings changeLifecycle function plus API and mounted PostgreSQL: unknown Archive retry preserves original action',async t=>{
 const f=await lifecycleFixture(t);
 const source=await readFile(new URL('../../../../apps/web/src/app/settings/page.tsx',import.meta.url),'utf8');
 const matched=source.match(/  const changeLifecycle = async \(\) => \{([\s\S]*?)\n  \};/);assert.ok(matched,'Extract the exact actual Settings operation rather than reimplementing it');
 let project:any={id:'prj',name:'Retention',isArchived:false,version:1};
 const calls:Array<{path:string,body:any,key:string|null,status:number}>=[];let reads:Promise<unknown>[]=[];let dialogOpen=true;
 const oldFetch=globalThis.fetch;let lost=false;
 globalThis.fetch=async(input:any,init:any)=>{
  const headers=new Headers(init.headers);headers.set('cookie',`flowboard_session=${f.actors.owner.user.id && f.actors.owner.session.id}`);headers.set('origin','http://localhost');
  const response=await f.app.request('http://localhost'+String(input),{...init,headers});
  calls.push({path:String(input),body:JSON.parse(init.body),key:headers.get('idempotency-key'),status:response.status});
  if(!lost){lost=true;assert.equal(response.status,200);throw new TypeError('Synthetic committed response lost');}return response;
 };
 const refetch=()=>{const p=f.pool.query("SELECT archived,version FROM projects WHERE id='prj'").then(r=>{project={...project,isArchived:r.rows[0].archived,version:r.rows[0].version};});reads.push(p);return p;};
 const makeAction=()=>new Function('project','api','setLifecycleBusy','setLifecycleError','toast','setArchiveOpen','refetch','queryClient','describeError',`return async()=>{${matched[1]}}`)(project,api,()=>{},()=>{},()=>{},(v:boolean)=>{dialogOpen=v;},refetch,{invalidateQueries:async()=>{}},()=> 'Network error; retry');
 try{
  await makeAction()();await Promise.all(reads);assert.equal(project.isArchived,true);assert.equal(dialogOpen,true,'Failed initial response keeps the same modal open');
  await makeAction()();await Promise.all(reads);t.diagnostic(JSON.stringify({calls,finalProject:project,dialogOpen}));
  assert.equal(calls[1].path,calls[0].path,'A retry of the unresolved Archive should keep the original action');
  assert.equal(calls[1].key,calls[0].key,'Retry should retain its committed command key');
  assert.deepEqual(calls[1].body,calls[0].body,'Retry should retain original expectedVersion');
 }finally{globalThis.fetch=oldFetch;}
});
