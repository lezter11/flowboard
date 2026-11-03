import assert from 'node:assert/strict';
import test from 'node:test';
import {hashSessionToken} from '../../../../apps/api/src/adapters/session.ts';
import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';
test('round3 board privacy: anonymous and expired sessions cannot distinguish an inaccessible existing board from a nonexistent board',async t=>{
 const f=await lifecycleFixture(t);
 await f.pool.query('UPDATE sessions SET expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$1',[hashSessionToken(f.actors.viewer.session.id)]);
 const observations:any[]=[];
 for(const [actor,cookie]of [['anonymous',undefined],['expired',`flowboard_session=${f.actors.viewer.session.id}`],['authenticated-outsider',`flowboard_session=${f.actors.outsider.session.id}`]]as const){
  const responses=[];
  for(const id of ['brd','missing_board']){
   const response=await f.app.request('http://localhost/api/v1/boards/'+id,{headers:cookie?{cookie}:{}});const body=await response.json()as any;
   assert.equal(body.data,undefined);responses.push({target:id,status:response.status,code:body.error.code,message:body.error.message});
  }
  observations.push({actor,responses});
 }
 t.diagnostic(JSON.stringify(observations));
 assert.deepEqual(observations[2].responses.map((x:any)=>[x.status,x.code,x.message]),[[404,'NOT_FOUND','Board not found.'],[404,'NOT_FOUND','Board not found.']],'authenticated outsider control is private');
 for(const observation of observations.slice(0,2))assert.deepEqual(observation.responses[0].status,observation.responses[1].status,observation.actor+' response status must not reveal private board existence');
});
