import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
test('independent project lifecycle: delayed archive must respect documented expected project version',async t=>{
 const f=await lifecycleFixture(t);
 const initial=(await f.pool.query("SELECT version FROM projects WHERE id='prj'")).rows[0].version;
 const archive=await f.request('POST','/projects/prj/archive','owner',{expectedVersion:initial});assert.equal(archive.status,200);
 const afterArchive=(await f.pool.query("SELECT version FROM projects WHERE id='prj'")).rows[0].version;
 const reopen=await f.request('POST','/projects/prj/reopen','owner',{expectedVersion:afterArchive});assert.equal(reopen.status,200);
 const delayed=await f.request('POST','/projects/prj/archive','owner',{expectedVersion:initial});
 const state=(await f.pool.query("SELECT archived,version FROM projects WHERE id='prj'")).rows[0];
 console.log(JSON.stringify({initial,afterArchive,delayedStatus:delayed.status,state,payload:await delayed.clone().json()}));
 assert.equal(delayed.status,409,'Documented expectedVersion must reject a delayed opposite lifecycle transition');
 assert.equal(state.archived,false,'Failed stale archive must preserve the newer reopened state');
});
