import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient} from '@tanstack/react-query';
import {createMemoryDrafts} from '../src/lib/memory-drafts.ts';
import {hasUnsaved,resetUnsavedForTests} from '../src/lib/unsaved.ts';
import {api} from '../src/lib/api.ts';

test('settings/board/column values and baseline refs survive query cache clearing and route recreation',()=>{
  const store=createMemoryDrafts(),client=new QueryClient();const scope=['settings','alice','project','board','column'];
  const field=store.value(scope,()=>({name:'Original',color:'auto'}));field.set({name:'My unsaved name',color:'sky'});const baseline=store.ref([...scope,'baseline'],()=>({name:'Original',version:2}));baseline.current.version=3;let notified=0;const off=field.subscribe(()=>notified++);off();client.setQueryData(['board','board'],{private:'old'});client.clear();const restored=store.value(scope,()=>({name:'Wrong reset',color:'none'}));assert.equal(restored.get().name,'My unsaved name');assert.equal(restored.get().color,'sky');assert.equal(store.ref([...scope,'baseline'],()=>({name:'wrong',version:0})).current.version,3);assert.equal(store.value(['settings','bob','project','board','column'],()=>({name:'Other actor',color:'none'})).get().name,'Other actor');assert.equal(store.value(['settings','alice','other-project','board','column'],()=>({name:'Other context',color:'none'})).get().name,'Other context');assert.equal(notified,0);
});
test('actual selected File blob stays only in actor/target memory and retains exact workbook bytes',async()=>{
  const store=createMemoryDrafts();const file=new File(['synthetic xlsx bytes'],'sample.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const scope=['import-file','alice','project','board'];store.value<File|null>(scope,()=>null).set(file);const restored=store.value<File|null>(scope,()=>null).get();assert.equal(restored,file);assert.equal(restored?.name,'sample.xlsx');assert.equal(await restored?.text(),'synthetic xlsx bytes');assert.equal(store.value<File|null>(['import-file','bob','project','board'],()=>null).get(),null);
});
test('stored draft warning remains after subscribers unmount until explicit discard/save clears it',()=>{
  resetUnsavedForTests();const store=createMemoryDrafts();const scope=['brief','alice','project'];const value=store.value(scope,()=>'');const off=value.subscribe(()=>{});value.set('Unsent brief');store.mark(scope,true);off();assert.equal(hasUnsaved(),true);store.value(scope,()=>'').set('');store.mark(scope,false);assert.equal(hasUnsaved(),false);
});
for(const type of ['project','board'] as const)test(`create ${type} original request survives route recreation and lost reply with the same actual key/body`,async()=>{
  const store=createMemoryDrafts();const scope=[`create-${type}`,'alice','project'];const command=store.command<{name:string;description?:string}>(scope);const old=globalThis.fetch;const sent:Array<{url:string;body:unknown;key:string|null}>=[];
  globalThis.fetch=async(url,init)=>{sent.push({url:String(url),body:JSON.parse(String(init?.body)),key:new Headers(init?.headers).get('Idempotency-Key')});if(sent.length===1)throw new TypeError('lost after commit');return Response.json({data:{id:'created'}});};
  const send=(input:{name:string;description?:string},key:string):Promise<unknown>=>type==='project'?api.createOwnProject(input,key):api.createBoard('project',input,key);
  try{await assert.rejects(command.run({name:'Original',description:'Original description'},send));const remounted=store.command<{name:string;description?:string}>(scope);assert.equal(remounted.unresolved(),true);await remounted.run({name:'Edited'},send);assert.deepEqual(sent[1],sent[0]);assert.equal(remounted.unresolved(),false);assert.equal(store.command<{name:string}>([`create-${type}`,'bob','project']).unresolved(),false);}finally{globalThis.fetch=old;}
});
