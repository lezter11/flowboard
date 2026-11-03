import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { recordActivity } from '../../../../apps/api/src/adapters/activity.ts';
import { activityAssigneeReferences } from '../../../../apps/api/src/services/activity-people.ts';

test('Independent mounted edit/privacy and conflict probe: actor, scope and effect counts remain separate',async t=>{
 const f=await lifecycleFixture(t);const original=await f.post('INDEPENDENT_REMOVED_PREVIEW');
 const before=(await f.pool.query('SELECT (SELECT count(*) FROM notifications)::int n,(SELECT count(*) FROM outbox)::int o,(SELECT count(*) FROM activity_log)::int a')).rows[0];
 for(const actor of ['manager','owner','viewer','outsider']){
  const r=await f.request('PATCH','/comments/'+original.id,actor,{body:'Attempted takeover',mentions:[],expectedVersion:1});
  assert.equal(r.status,actor==='outsider'?404:403,actor+' '+await r.clone().text());
 }
 assert.deepEqual((await f.pool.query('SELECT (SELECT count(*) FROM notifications)::int n,(SELECT count(*) FROM outbox)::int o,(SELECT count(*) FROM activity_log)::int a')).rows[0],before);
 const body={body:'Independent corrected text',mentions:[],expectedVersion:1};const key='independent-comment-edit-original';
 assert.equal((await f.request('PATCH','/comments/'+original.id,'member',body,key)).status,200);
 assert.equal((await f.request('PATCH','/comments/'+original.id,'member',body,key)).status,200);
 const stale=await f.request('PATCH','/comments/'+original.id,'member',{...body,body:'Stale overwrite'});assert.equal(stale.status,409);
 const inbox=await f.request('GET','/notifications','manager');assert.equal(inbox.status,200);const text=await inbox.text();assert.equal(text.includes('INDEPENDENT_REMOVED_PREVIEW'),false);assert.ok(text.includes('[Comment edited]'));
 const after=(await f.pool.query('SELECT (SELECT count(*) FROM notifications)::int n,(SELECT count(*) FROM outbox)::int o,(SELECT count(*) FROM activity_log)::int a')).rows[0];assert.equal(after.n,before.n);assert.equal(after.o,before.o);assert.equal(after.a,before.a+1);
 assert.equal((await f.pool.query('SELECT version,body FROM comments WHERE id=$1',[original.id])).rows[0].version,2);
});

test('Independent authorized activity projection ignores arbitrary keys and redacted references',async t=>{
 const f=await lifecycleFixture(t);const member=f.actors.member!.user.id, outsider=f.actors.outsider!.user.id;
 assert.deepEqual(activityAssigneeReferences({purged:true,assignees:{added:[member]}}),[]);
 assert.equal(activityAssigneeReferences({assignees:{added:Array.from({length:100},(_,i)=>'id'+i),removed:Array.from({length:100},(_,i)=>'old'+i)}}).length,40);
 for(const [id,changes]of Object.entries({arbitrary:{body:member,custom:[member]},redacted:{redacted:true,assignees:{added:[member]}},scoped:{assignees:{added:[member,outsider,'missing-user'],removed:[]}}})){
  await recordActivity(f.pool,{workspaceId:'ws',projectId:'prj',boardId:'brd',cardId:'card',actorId:f.actors.owner!.user.id,action:'card_updated',safeChanges:{...changes,probeId:id}});
 }
 for(const path of ['/cards/card/activity','/projects/prj/activity','/workspaces/ws/activity']){
  const r=await f.request('GET',path);assert.equal(r.status,200);const rows=(await r.json()as any).data;
  for(const id of ['arbitrary','redacted'])assert.deepEqual(rows.find((r:any)=>r.safeChanges.probeId===id).referencedPeople,[]);
  const people=rows.find((r:any)=>r.safeChanges.probeId==='scoped').referencedPeople;assert.deepEqual(people.map((p:any)=>p.id),[member]);assert.equal(people[0].assignable,false);assert.equal(people[0].mentionable,false);assert.equal(Object.hasOwn(people[0],'email'),false);
 }
 for(const [actor,path,status]of [['member','/projects/prj/activity',403],['viewer','/projects/prj/activity',403],['manager','/workspaces/ws/activity',403],['outsider','/cards/card/activity',404]]as const)assert.equal((await f.request('GET',path,actor)).status,status);
});
