import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';

const outcomes:any[]=[];
test('Independent import review: valid-ZIP literal and package adversarial probes through mounted HTTP and real PostgreSQL',async t=>{
 const f=await lifecycleFixture(t);
 for(const name of ['control','embedded-image','external-relationship','macro-content-type','double-entity','rich-inline-text','invalid-numeric-entity','formula','xxe']){
  const bytes=await fs.readFile(new URL(`./${name}.xlsx`,import.meta.url));
  const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(bytes).buffer});
  const body=await response.json() as any;
  const o:any={name,httpStatus:response.status,body};
  if(name==='double-entity'||name==='rich-inline-text'){
   if(body.data?.canCommit){const r=await f.request('POST',`/imports/${body.data.id}/commit`,'owner',{expectedVersion:body.data.version,previewDigest:body.data.previewDigest,defaultColumnId:body.data.defaultColumnId});o.commitStatus=r.status;o.commit=await r.json();}
   if(o.commitStatus===200)o.persistedTitle=(await f.pool.query('SELECT title FROM cards WHERE id=$1',[o.commit.data.rows[0].cardId])).rows[0]?.title;
  }
  outcomes.push(o);console.log('PROBE '+JSON.stringify(o));
 }
 assert.equal(outcomes.find(o=>o.name==='control').httpStatus,201,'Control must prove mounted harness works');
 assert.equal(outcomes.find(o=>o.name==='formula').body.error.code,'FORMULA_REJECTED');
 assert.equal(outcomes.find(o=>o.name==='xxe').body.error.code,'XXE_DETECTED');
 await fs.writeFile(new URL('./mounted-probe-results.json',import.meta.url),JSON.stringify({schema:f.schema,outcomes},null,2)+'\n');
});
