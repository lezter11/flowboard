import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
for(const role of ['member','viewer'])test(`independent display scope: ${role} should not enumerate a teammate outside the requested board`,async t=>{
 const f=await lifecycleFixture(t);
 await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager.user.id]);
 const scopedPicker=await f.request('GET','/projects/prj/people?purpose=mention&boardId=brd',role);
 const picker=await scopedPicker.json();assert.equal(scopedPicker.status,200);assert.equal(picker.data.some(p=>p.id===f.actors.manager.user.id),false);
 const displayResponse=await f.request('GET','/projects/prj/people?purpose=display&boardId=brd',role);
 const display=await displayResponse.json();
 console.log(JSON.stringify({role,displayStatus:displayResponse.status,pickerCount:picker.data.length,displayCount:display.data?.length,exposesInaccessibleTeammate:display.data?.some(p=>p.id===f.actors.manager.user.id)}));
 assert.ok(displayResponse.status>=400 || !display.data.some(p=>p.id===f.actors.manager.user.id),'Explicit board-scoped display returns identities without board access');
});
