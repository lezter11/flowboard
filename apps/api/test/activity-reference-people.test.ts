import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { recordActivity } from '../src/adapters/activity.ts';
import { projectNameSuffixes } from '../src/services/person-suffix.ts';

test('Activity reference identities: exact changed people only, safe historical names and no directory bypass',async t=>{
  const f=await lifecycleFixture(t),member=f.actors.member!.user.id,manager=f.actors.manager!.user.id;
  await f.pool.query("UPDATE users SET display_name=CASE WHEN id=$1 THEN 'José' ELSE 'Jose' END WHERE id=ANY($2::text[])",[manager,[member,manager]]);
  const first=await f.request('PATCH','/cards/card','owner',{expectedVersion:1,assigneeIds:[member]});assert.equal(first.status,200);
  const second=await f.request('PATCH','/cards/card','owner',{expectedVersion:2,assigneeIds:[manager]});assert.equal(second.status,200);
  const res=await f.request('GET','/cards/card/activity');assert.equal(res.status,200);const body=await res.json()as any;
  const changed=body.data.find((event:any)=>event.safeChanges.assignees?.removed?.includes(member));assert.ok(changed);
  assert.deepEqual(changed.referencedPeople.map((p:any)=>p.id).sort(),[member,manager].sort());
  const suffixes=await projectNameSuffixes(f.pool,'prj');
  for(const person of changed.referencedPeople){assert.equal(person.nameSuffix,suffixes.get(person.id));assert.equal(Object.hasOwn(person,'email'),false);assert.equal(person.assignable,false);assert.equal(person.mentionable,false);}
  assert.equal(changed.referencedPeople.some((p:any)=>p.id===f.actors.viewer!.user.id),false);
  assert.equal((await f.request('GET','/projects/prj/people','member')).status,403);
  await f.pool.query("UPDATE project_memberships SET status='removed',version=version+1 WHERE user_id=$1 AND project_id='prj'",[member]);
  await f.pool.query("UPDATE users SET display_name='Renamed former teammate' WHERE id=$1",[member]);
  const history=(await(await f.request('GET','/cards/card/activity')).json()as any).data.find((e:any)=>e.id===changed.id);
  const former=history.referencedPeople.find((p:any)=>p.id===member);assert.equal(former.displayName,'Renamed former teammate');assert.equal(former.activeInProject,false);
  // Corrupt/legacy references cannot turn an authorized event into global identity lookup.
  await recordActivity(f.pool,{workspaceId:'ws',projectId:'prj',boardId:'brd',cardId:'card',actorId:f.actors.owner!.user.id,action:'card_updated',safeChanges:{assignees:{added:[f.actors.outsider!.user.id,'unknown-user'],removed:[]}}});
  for(const path of ['/cards/card/activity','/projects/prj/activity','/workspaces/ws/activity']){
    const response=await f.request('GET',path);assert.equal(response.status,200);const page=await response.json()as any;
    const unsafe=page.data.find((e:any)=>e.safeChanges.assignees?.added?.includes('unknown-user'));assert.ok(unsafe);assert.deepEqual(unsafe.referencedPeople,[]);
    assert.equal(JSON.stringify(page).includes('retention-outsider@flowboard.example'),false);
  }
});

test('Activity identity lookup: mounted query count stays constant from1to12distinct actors',async t=>{
  const f=await lifecycleFixture(t);
  for(let i=0;i<12;i++){
    const actor=await createDevUserAndSession(`audit-batch-${i}@flowboard.example`,`Audit actor ${i}`,f.pool);
    await f.pool.query("INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES($1,'prj','ws',$2,'member','active',NOW(),NOW())",[`batch-${i}`,actor.user.id]);
    await recordActivity(f.pool,{workspaceId:'ws',projectId:'prj',boardId:'brd',cardId:'card',actorId:actor.user.id,action:'card_created',safeChanges:{}});
  }
  const sample=await f.pool.connect(),prototype=Object.getPrototypeOf(sample),original=prototype.query;sample.release();let queries=0;
  prototype.query=function(...args:any[]){if(this.connectionParameters.options===`-c search_path=${f.schema}`)queries++;return original.apply(this,args);};
  t.after(()=>{prototype.query=original;});
  await(await f.request('GET','/cards/card/activity?limit=1')).arrayBuffer();
  queries=0;const one=await f.request('GET','/cards/card/activity?limit=1');assert.equal(one.status,200);await one.arrayBuffer();const oneCount=queries;
  queries=0;const many=await f.request('GET','/cards/card/activity?limit=20');assert.equal(many.status,200);const data=(await many.json()as any).data;const manyCount=queries;
  assert.equal(new Set(data.map((e:any)=>e.actorId)).size,12);assert.ok(oneCount>0);
  console.log(JSON.stringify({measurement:'mounted activity query count',oneActor:oneCount,twelveActors:manyCount}));assert.equal(manyCount,oneCount,'Page actor cardinality must not add one query group per actor');
});
