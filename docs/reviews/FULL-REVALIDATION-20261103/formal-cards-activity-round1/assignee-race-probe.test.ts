import assert from 'node:assert/strict';
import test from 'node:test';
import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';

test('observation: recipient demotion can commit after eligibility read but before new assignment commits',async t=>{
 const f=await lifecycleFixture(t);const fence=837451928;
 await f.pool.query(`CREATE FUNCTION assignment_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${fence}); RETURN NEW; END $$; CREATE TRIGGER assignment_fence BEFORE INSERT ON card_assignees FOR EACH ROW EXECUTE FUNCTION assignment_fence()`);
 const holder=await f.pool.connect();await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock($1)',[fence]);
 let released=false;t.after(async()=>{if(!released){await holder.query('ROLLBACK');holder.release();}});
 const writer=f.request('PATCH','/cards/card','owner',{assigneeIds:[f.actors.member!.user.id],expectedVersion:1});
 let waits=[];
 for(let i=0;i<100;i++){waits=(await f.pool.query(`SELECT pid,query,wait_event FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE '%INSERT INTO card_assignees%'`,[f.schema])).rows;if(waits.length)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(waits.length,1,'Actual mounted card writer must be blocked in its new assignment insert after eligibility read');
 const demote=await f.request('PATCH','/projects/prj/members/'+f.actors.member!.user.id,'owner',{role:'viewer',status:'active',expectedVersion:1});
 const demoteBody=await demote.clone().text();
 await holder.query('COMMIT');holder.release();released=true;
 const assignment=await writer;
 const final=(await f.pool.query(`SELECT pm.role,ca.user_id FROM project_memberships pm JOIN card_assignees ca ON ca.user_id=pm.user_id AND ca.project_id=pm.project_id WHERE pm.project_id='prj' AND ca.card_id='card'`)).rows;
 console.log(JSON.stringify({observation:'assignee-demotion-race',blockedWriterPid:waits[0].pid,demotionStatus:demote.status,assignmentStatus:assignment.status,finalRoles:final.map(r=>r.role),demoteBody:JSON.parse(demoteBody).data?.role}));
 assert.equal(demote.status,200);assert.equal(assignment.status,200);assert.equal(final[0]?.role,'viewer','Observation pins current behavior, not acceptance');
});
