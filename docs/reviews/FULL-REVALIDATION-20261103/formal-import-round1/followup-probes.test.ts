import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
const outcomes:any[]=[];
test('Independent import follow-up: unique source IDs, legal XML representations and prohibited package content',async t=>{
 const f=await lifecycleFixture(t);
 for(const name of ['rich-inline-unique','utf16-worksheet','utf16-formula','single-quote-attributes','merged-data','actual-image-package']){
  const bytes=await fs.readFile(new URL(`./${name}.xlsx`,import.meta.url));
  const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(bytes).buffer});
  const body=await response.json() as any; const o:any={name,httpStatus:response.status,body};
  if(body.data?.canCommit){const r=await f.request('POST',`/imports/${body.data.id}/commit`,'owner',{expectedVersion:body.data.version,previewDigest:body.data.previewDigest,defaultColumnId:body.data.defaultColumnId});o.commitStatus=r.status;o.commit=await r.json();if(o.commitStatus===200&&o.commit.data.rows.length)o.persistedTitle=(await f.pool.query('SELECT title FROM cards WHERE id=$1',[o.commit.data.rows[0].cardId])).rows[0]?.title;}
  outcomes.push(o);console.log('PROBE '+JSON.stringify(o));
 }
 await fs.writeFile(new URL('./followup-probe-results.json',import.meta.url),JSON.stringify({schema:f.schema,outcomes},null,2)+'\n');
 assert.equal(outcomes.length,6);
});
