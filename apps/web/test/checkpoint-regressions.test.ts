import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../src/lib/api.ts';
import { discardRefusedRows } from '../src/lib/feed-state.ts';
import { createCardDraftSessions } from '../src/lib/card-drafts.ts';
import { createCardForms } from '../src/lib/create-card-state.ts';
import type { Card } from '@flowboard/contracts';
const card={id:'private-card',boardId:'private-board',projectId:'project',title:'Server title',description:'Private untouched server description',priority:'high',dueDate:null,assigneeIds:['server-person'],columnId:'column',version:2} as Card;

test('FCP-02 refused read erases clean server fields from external draft store while keeping only edited values',()=>{
  const store=createCardDraftSessions();const clean=store.forCard('actor',card);const edited=store.forCard('actor',{...card,id:'edited'});edited.edit({title:'My unsent title',description:''});const client=new QueryClient();
  for(const id of [card.id,'edited']){const key=['card',id,'actor'];client.setQueryData(key,card);discardRefusedRows(client,key,new ApiError(403,'FORBIDDEN','Refused'));assert.equal(client.getQueryData(key),undefined);}
  client.clear();assert.equal(clean.get().base.description,'');assert.equal(clean.get().draft.description,'');assert.deepEqual(clean.get().draft.assigneeIds,[]);assert.equal(edited.get().draft.title,'My unsent title');assert.equal(edited.get().draft.description,'');assert.equal(edited.get().base.title,'');
  edited.observe({...card,id:'edited',version:3});assert.equal(edited.get().draft.title,'My unsent title');assert.equal(edited.get().draft.description,'');assert.deepEqual(edited.get().draft.assigneeIds,['server-person']);assert.equal(edited.get().conflict,true);
});

test('FCP-04 confirmed receipt permits explicit fresh operation and preserves receipt history',async()=>{
  const form=createCardForms().forBoard('actor','board','column');const firstCommand=form.command;form.edit({title:'First',priority:'urgent'});form.created('first');
  assert.equal(typeof form.startAnother,'function');assert.equal(form.startAnother(),true);assert.equal(form.get().createdId,null);assert.equal(form.get().draft.title,'');assert.equal(form.get().draft.priority,'');assert.notEqual(form.command,firstCommand);assert.deepEqual(form.get().receipts,['first']);
  form.edit({title:'Second'});await assert.rejects(form.command.run({boardId:'board',input:{title:'Second',columnId:'column',description:'',priority:'high',dueDate:null,assigneeIds:[],expectedBoardVersion:1}},async()=>{throw new TypeError('unknown result');}));assert.equal(form.startAnother(),false);assert.equal(form.get().draft.title,'Second');
});

test('FCP-03 dialog stack routes a key to top only and restores lower inert state',async()=>{
  const module=await import('../src/lib/inert-lock.ts');assert.equal(typeof module.createDialogStack,'function');const stack=module.createDialogStack();
  const target=()=>{const attrs=new Set<string>();return {hasAttribute:(key:string)=>attrs.has(key),setAttribute:(key:string)=>{attrs.add(key);},removeAttribute:(key:string)=>{attrs.delete(key);}};};const parent=target(),child=target();const a=stack.push(parent),b=stack.push(child);let closed=0;a.handle(()=>{closed+=100;});b.handle(()=>{closed++;});assert.equal(closed,1);assert.equal(parent.hasAttribute('inert'),true);assert.equal(child.hasAttribute('inert'),false);b.release();assert.equal(parent.hasAttribute('inert'),false);a.handle(()=>{closed++;});assert.equal(closed,2);a.release();
});

test('FCP-01 fresh canonical empty board list erases former board stats and snapshot caches',async()=>{
  const module=await import('../src/lib/portfolio-state.ts').catch(()=>null);assert.ok(module?.readPortfolioBoards,'actual shared portfolio read is available');const client=new QueryClient();client.setQueryData(['boards','project'],[{id:'revoked'}]);client.setQueryData(['board-stats','revoked'],{board:{name:'Private name'}});client.setQueryData(['board','revoked'],{board:{name:'Private name'}});const result=await module.readPortfolioBoards(client,'project',async()=>({data:[]}));assert.deepEqual(result,[]);assert.equal(client.getQueryData(['board-stats','revoked']),undefined);assert.equal(client.getQueryData(['board','revoked']),undefined);client.clear();
});

test('FCP-02 generic protected settings memory retains changed empty input but erases clean baselines until authorized restore',async()=>{
  const {createMemoryDrafts}=await import('../src/lib/memory-drafts.ts');const {redactProtectedDrafts}=await import('../src/lib/protected-drafts.ts');const store=createMemoryDrafts(),scope=['settings','probe-actor','probe-project'];const name=store.value([...scope,'name'],()=> 'Server project name'),description=store.value([...scope,'description'],()=> 'Private server description');const baseline=store.ref([...scope,'base'],()=>({name:'Server project name',description:'Private server description'}));description.set('');
  assert.equal(typeof store.protectFields,'function');const group=store.protectFields(scope,{actorId:'probe-actor',projectId:'probe-project'},{name:{scope:[...scope,'name'],base:()=>baseline.current.name,empty:''},description:{scope:[...scope,'description'],base:()=>baseline.current.description,empty:''}},()=>{baseline.current={name:'',description:''};});redactProtectedDrafts({projectId:'probe-project'});assert.equal(name.get(),'');assert.equal(description.get(),'');assert.deepEqual(baseline.current,{name:'',description:''});assert.deepEqual(group.restore({name:'Fresh name',description:'New private description'}),{retained:true});assert.equal(name.get(),'Fresh name');assert.equal(description.get(),'');
});

test('FCP-02 unknown original field command survives access loss with the exact original body/key',async()=>{
  const {redactProtectedDrafts}=await import('../src/lib/protected-drafts.ts');const store=createCardDraftSessions(),session=store.forCard('retry-actor',card);session.edit({title:'My title'});const input={title:'My title',description:card.description,expectedVersion:2};session.intent({fieldInput:input});let originalKey='';await assert.rejects(session.fields.run(input,async(_body,key)=>{originalKey=key;throw new TypeError('lost response');}));redactProtectedDrafts({actorId:'retry-actor'});assert.equal(session.get().base.description,'');assert.equal(session.get().draft.description,'');assert.deepEqual(session.get().fieldInput,input);let sent:unknown;await session.fields.run({title:'different',expectedVersion:99},async(body,key)=>{sent={body,key};});assert.deepEqual(sent,{body:input,key:originalKey});
});

test('FCP-01 displayed portfolio polling includes list and stats keys, and refused list erases prior statistics',async()=>{
  const {readPortfolioBoards,portfolioPollKeys}=await import('../src/lib/portfolio-state.ts');assert.deepEqual(portfolioPollKeys(['project'],['board']),[['boards','project'],['board-stats','board']]);const client=new QueryClient();client.setQueryData(['boards','project'],[{id:'board'}]);client.setQueryData(['board-stats','board'],{privateCount:25});await assert.rejects(readPortfolioBoards(client,'project',async()=>{throw new ApiError(403,'FORBIDDEN','No access');}));assert.equal(client.getQueryData(['boards','project']),undefined);assert.equal(client.getQueryData(['board-stats','board']),undefined);client.clear();
});

test('FCP-02 session scope transition redacts only lost prior resources and preserves unrelated authorized baselines',async()=>{
  const module=await import('../src/lib/protected-drafts.ts');let projectA=0,projectB=0;module.registerProtectedDraft(Symbol(),{actorId:'transition-actor',projectId:'a'},()=>projectA++);module.registerProtectedDraft(Symbol(),{actorId:'transition-actor',projectId:'b'},()=>projectB++);assert.equal(typeof module.redactSessionDraftTransition,'function');const before=JSON.stringify(['transition-actor',[['a','owner',false],['b','member',false]]]);module.redactSessionDraftTransition(before,JSON.stringify(['transition-actor',[['a','owner',false],['b','member',false],['c','owner',false]]]));assert.deepEqual([projectA,projectB],[0,0]);module.redactSessionDraftTransition(before,JSON.stringify(['transition-actor',[['a','owner',false]]]));assert.deepEqual([projectA,projectB],[0,1]);module.redactSessionDraftTransition(before,'signedOut');assert.deepEqual([projectA,projectB],[1,2]);
});
