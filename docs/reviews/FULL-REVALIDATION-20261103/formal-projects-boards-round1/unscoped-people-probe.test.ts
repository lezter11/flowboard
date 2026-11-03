import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
test('independent adversarial: Member without board grants cannot enumerate full project identities via unscoped display picker',async t=>{
 const f=await lifecycleFixture(t);
 await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.member.user.id]);
 const denied=await f.request('GET','/projects/prj/members','member');assert.equal(denied.status,403);
 const response=await f.request('GET','/projects/prj/people','member');
 const payload=await response.json();
 console.log(JSON.stringify({status:response.status,payload}));
 assert.ok(response.status>=400 || payload.data.length===0,'Member has zero board grants yet unscoped people exposes full project identities');
});
