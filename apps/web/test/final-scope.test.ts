import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/lib/api.ts';
import {daysUntil,dueInfo} from '../src/lib/dates.ts';
import {auditServerFilters} from '../src/lib/audit-filters.ts';

test('canonical workspace calendar controls colors regardless of browser day or a skipped local date',()=>{
  assert.equal(daysUntil('2026-11-03','2026-11-04'),-1);assert.equal(dueInfo('2026-11-04',false,'2026-11-04')?.label,'Due today');assert.equal(dueInfo('2026-11-03',false,'2026-11-04')?.state,'overdue');assert.equal(dueInfo('2026-11-03',false,null)?.state,'normal');assert.equal(daysUntil('2011-12-30','2011-12-29'),1);assert.equal(daysUntil('2026-02-30','2026-03-01'),null);
});
test('audit dates cover explicit UTC days and invalid ranges never query',()=>{
  const filters=auditServerFilters({projectId:' p ',cardId:' card ',actorId:' actor ',action:' card_moved ',fromDate:'2026-11-01',toDate:'2026-11-03'});assert.deepEqual(filters,{projectId:'p',cardId:'card',actorId:'actor',action:'card_moved',fromDate:'2026-11-01T00:00:00.000Z',toDate:'2026-11-03T23:59:59.999Z'});assert.throws(()=>auditServerFilters({projectId:'',cardId:'',actorId:'',action:'',fromDate:'2026-11-04',toDate:'2026-11-03'}));
});
test('workspace/project audit and accessible project list forward exact opaque cursors/server filters and abort',async()=>{
  const old=globalThis.fetch;const requests:Array<{url:URL;init?:RequestInit}>=[];const abort=new AbortController();globalThis.fetch=async(url,init)=>{requests.push({url:new URL(String(url),'http://local'),init});return Response.json({data:[],nextCursor:'more'});};
  try{await api.listWorkspaceActivity('workspace /1',{projectId:'p',cardId:'c',actorId:'a',action:'card_moved',fromDate:'2026-11-01T00:00:00Z',toDate:'2026-11-03T23:59:59Z',cursor:'opaque+/=',signal:abort.signal});await api.listProjectActivity('p',50,'opaque+/=',abort.signal,{actorId:'a',action:'card_moved'});await api.listAccessibleProjects({cursor:'opaque+/=',signal:abort.signal});assert.equal(requests[0]!.url.pathname,'/api/v1/workspaces/workspace%20%2F1/activity');assert.deepEqual(Object.fromEntries(requests[0]!.url.searchParams),{limit:'50',projectId:'p',cardId:'c',actorId:'a',action:'card_moved',fromDate:'2026-11-01T00:00:00Z',toDate:'2026-11-03T23:59:59Z',cursor:'opaque+/='});assert.deepEqual(Object.fromEntries(requests[1]!.url.searchParams),{limit:'50',actorId:'a',action:'card_moved',cursor:'opaque+/='});assert.equal(requests[2]!.url.pathname,'/api/v1/projects');assert.deepEqual(Object.fromEntries(requests[2]!.url.searchParams),{limit:'50',cursor:'opaque+/='});assert.ok(requests.every((r)=>r.init?.signal===abort.signal));}finally{globalThis.fetch=old;}
});
test('image gallery actual shared envelope retains items/count/null cursor without legacy fallback',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({data:{items:[],nextCursor:null,totalCount:0}});try{assert.deepEqual((await api.listCardImages('card')).data,{items:[],nextCursor:null,totalCount:0});}finally{globalThis.fetch=old;}
});
