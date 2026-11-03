import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/api.ts';
import { selectedTaskProject } from '../src/lib/task-scope.ts';
import { accessFingerprint, sessionState } from '../src/lib/session-state.ts';
import type { SessionData, SessionProjectSummary } from '@flowboard/contracts';

test('MyTasks sends exactly one project plus server filters/cursor and preserves calendar envelope',async()=>{
  const original=globalThis.fetch;const calls:Array<{url:URL;signal:AbortSignal|null|undefined}>=[];const c=new AbortController();
  globalThis.fetch=async(url,init)=>{calls.push({url:new URL(String(url),'http://local'),signal:init?.signal});return Response.json({data:[],nextCursor:'more',asOfDate:'2026-11-04',timezone:'Pacific/Kiritimati'});};
  try {const page=await api.listMyTasks('project /1',{due:'upcoming',priority:'none',cursor:'opaque+/=',limit:50,signal:c.signal});assert.equal(calls.length,1);assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams),{projectId:'project /1',limit:'50',due:'upcoming',priority:'none',cursor:'opaque+/='});assert.equal(calls[0]!.signal,c.signal);assert.equal(page.asOfDate,'2026-11-04');assert.equal(page.timezone,'Pacific/Kiritimati');assert.equal(page.nextCursor,'more');} finally{globalThis.fetch=original;}
});

test('all remaining feed APIs preserve exact continuation and AbortSignal',async()=>{
  const original=globalThis.fetch;const calls:Array<{url:URL;signal:AbortSignal|null|undefined}>=[];const c=new AbortController();
  globalThis.fetch=async(url,init)=>{calls.push({url:new URL(String(url),'http://local'),signal:init?.signal});return Response.json({data:[],nextCursor:'more',serverNow:'2026-11-03T00:00:00Z'});};
  try {await api.listNotifications({cursor:'opaque+/=',limit:50,signal:c.signal});await api.listProjectActivity('project',50,'opaque+/=',c.signal);await api.listProjectTrash('project',{cursor:'opaque+/=',limit:50,signal:c.signal});for(const call of calls){assert.deepEqual(Object.fromEntries(call.url.searchParams),{limit:'50',cursor:'opaque+/='});assert.equal(call.signal,c.signal);}}finally{globalThis.fetch=original;}
});
const projects=[{id:'first',isArchived:false},{id:'current',isArchived:false},{id:'archived',isArchived:true}] as SessionProjectSummary[];
test('explicit unauthorized task scope never falls back, current authorized scope wins default',()=>{
  assert.equal(selectedTaskProject(projects,'missing','current'),null);assert.equal(selectedTaskProject(projects,'archived','current'),null);assert.equal(selectedTaskProject(projects,null,'current')?.id,'current');assert.equal(selectedTaskProject(projects,null,'missing')?.id,'first');
});
test('session401 overrides stale actor data; access fingerprint ignores display edits and catches scope changes',()=>{
  const data={actor:{id:'actor'},accessibleProjects:projects.map((p)=>({...p,role:'member'}))} as SessionData;
  assert.equal(sessionState(data,{status:401},true,'refused').status,'signedOut');assert.equal(sessionState(data,{status:503},true,'offline').status,'ready');
  const original=accessFingerprint({status:'ready',session:data});
  assert.equal(accessFingerprint({status:'ready',session:{...data,actor:{...data.actor,displayName:'new name'}}}),original);
  assert.notEqual(accessFingerprint({status:'ready',session:{...data,accessibleProjects:data.accessibleProjects.slice(1)}}),original);
  assert.notEqual(accessFingerprint({status:'ready',session:{...data,accessibleProjects:data.accessibleProjects.map((p)=>({...p,role:'viewer'}))}}),original);
});
