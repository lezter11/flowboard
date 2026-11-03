import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card } from '@flowboard/contracts';
import { api } from '../src/lib/api.ts';
import { cardFieldsInput, cardFieldsDirty, createCardDraftSessions, originalUndoInput } from '../src/lib/card-drafts.ts';
const card:Card={id:'card',workspaceId:'workspace',projectId:'project',boardId:'board',title:'Original',description:'',priority:'high',dueDate:null,assigneeIds:[],columnId:'first',position:0,version:2,state:'active',deletedAt:null,deletedBy:null,restoreUntil:null,commentCount:0,imageCount:0,createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z'};
test('field Save excludes status, and acknowledging fields preserves a separate pending status choice',()=>{
  const store=createCardDraftSessions();const session=store.forCard('actor',card);session.edit({title:'Saved title',columnId:'last'});const input=cardFieldsInput(session.get().draft,session.get().version);assert.equal('columnId' in input,false);assert.equal('toColumnId' in input,false);session.intent({fieldInput:input});session.fieldsSaved(3);assert.equal(cardFieldsDirty(session.get().draft,session.get().base),false);assert.equal(session.get().draft.columnId,'last');assert.equal(session.get().base.columnId,'first');assert.equal(session.get().version,3);
});
test('actor/card draft survives remount/poll and requires deliberate conflict review',()=>{
  const store=createCardDraftSessions();const first=store.forCard('actor',card);first.edit({description:'My text'});const same=store.forCard('actor',card);same.observe({...card,description:'Teammate text',version:3});assert.equal(same.get().draft.description,'My text');assert.equal(same.get().conflict,true);same.review();assert.equal(same.get().conflict,false);assert.equal(store.forCard('other',card).get().draft.description,'');
});
test('undo transport retains original move result version even when another read is newer',async()=>{
  const old=globalThis.fetch;let sent:RequestInit|undefined;let url='';globalThis.fetch=async(path,init)=>{url=String(path);sent=init;return Response.json({data:{id:'card',version:5},replayed:false});};
  try{const input=originalUndoInput(3,8)!;await api.undoCardMove('card',input,'undo-key');assert.equal(url,'/api/v1/cards/card/move-undo');assert.deepEqual(JSON.parse(String(sent?.body)),{expectedVersion:3,expectedBoardVersion:8});assert.equal(new Headers(sent?.headers).get('Idempotency-Key'),'undo-key');assert.equal(originalUndoInput(undefined,8),null);}finally{globalThis.fetch=old;}
});
test('lost field save reply keeps original payload/key across remount and prohibits discard',async()=>{
  const old=globalThis.fetch;const sent:RequestInit[]=[];const store=createCardDraftSessions();const session=store.forCard('actor',card);session.edit({title:'My title'});const input=cardFieldsInput(session.get().draft,2);session.intent({fieldInput:input});globalThis.fetch=async(_url,init)=>{sent.push(init!);if(sent.length===1)throw new TypeError('lost reply');return Response.json({data:{id:'card',version:3},replayed:true});};
  try{await assert.rejects(session.fields.run(input,(body,key)=>api.updateCard('card',body,key)));session.discard();assert.equal(session.get().draft.title,'My title');await store.forCard('actor',card).fields.run({...input,title:'Edited'},(body,key)=>api.updateCard('card',body,key));assert.equal(sent[1]?.body,sent[0]?.body);assert.equal(new Headers(sent[1]?.headers).get('Idempotency-Key'),new Headers(sent[0]?.headers).get('Idempotency-Key'));}finally{globalThis.fetch=old;}
});

test('quick-add text/priority and original operation survive cross-view remount and actor isolation',async()=>{
  const {createQuickAddSessions}=await import('../src/lib/quick-add-state.ts');const store=createQuickAddSessions();const a=store.forBoards('actor',['board']);a.setDrafts({'column':{title:'My draft',priority:'urgent'}});a.setUnresolved('column');assert.equal(store.forBoards('actor',['board']).get().drafts.column?.title,'My draft');assert.equal(store.forBoards('actor',['board']).get().drafts.column?.priority,'urgent');assert.equal(store.forBoards('other',['board']).get().unresolved,null);
});
test('navigation blocks context changes, continues only on explicit choice and allows same-board filter/card changes',async()=>{
  const {createNavigationGuard,sameDraftScope}=await import('../src/lib/navigation-state.ts');const guard=createNavigationGuard();let navigations=0;guard.request('/board?id=b','/inbox',true,()=>navigations++);assert.equal(navigations,0);assert.equal(guard.get()?.href,'/inbox');guard.stay();assert.equal(navigations,0);guard.request('/board?id=b','/inbox',true,()=>navigations++);guard.leave();assert.equal(navigations,1);assert.equal(sameDraftScope('/board?id=b&card=c','/board?id=b&view=list'),true);assert.equal(sameDraftScope('/board?id=b','/board?id=other'),false);guard.request('/board?id=b','/board?id=b&card=new',true,()=>navigations++);assert.equal(navigations,2);
});

test('known create receipt survives failed detail read and cannot be mistaken for another create',async()=>{
  const {createCardForms}=await import('../src/lib/create-card-state.ts');const forms=createCardForms();const a=forms.forBoard('actor','board');assert.equal(a.get().draft.priority,'');a.edit({title:'New',priority:'urgent'});a.created('created-card');assert.equal(forms.forBoard('actor','board').get().createdId,'created-card');assert.equal(forms.forBoard('other','board').get().createdId,null);
});
test('unknown undo command and original versions survive view remount without crossing actors',async()=>{
  const {createUndoSessions}=await import('../src/lib/move-undo-state.ts');const {createRetainedCommand}=await import('../src/lib/retained-command.ts');const sessions=createUndoSessions();const current=sessions.forBoards('actor',['board']);const command=createRetainedCommand<{expectedVersion:number;expectedBoardVersion:number}>(()=>'undo-original');const input={expectedVersion:3,expectedBoardVersion:8};await assert.rejects(command.run(input,async()=>{throw new TypeError('lost undo');}));current.set({cardId:'card',boardId:'board',input,command});let sent:unknown;await sessions.forBoards('actor',['board']).get()!.command.run({expectedVersion:99,expectedBoardVersion:99},async(body,key)=>{sent={body,key};});assert.deepEqual(sent,{body:input,key:'undo-original'});assert.equal(sessions.forBoards('other',['board']).get(),null);
});
