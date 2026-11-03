import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
const positive:Record<string,string>={control:'=Browser imported literal title','double-entity':'Literal &#x41; and &#65;','rich-inline-text':'First Second','rich-inline-unique':'First Second','utf16-worksheet':'=Browser imported literal title','single-quote-attributes':'=Browser imported literal title'};
const negatives=['embedded-image','external-relationship','macro-content-type','invalid-numeric-entity','formula','xxe','utf16-formula','merged-data','actual-image-package'];
const observations:any[]=[];
for(const name of [...Object.keys(positive),...negatives])test(`Independent round3 unchanged original XLSX: ${name}`,async t=>{
 const f=await lifecycleFixture(t), fixture=new URL(`../formal-import-round1/${name}.xlsx`,import.meta.url),bytes=await fs.readFile(fixture);
 const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(bytes).buffer});const body=await response.json()as any;
 const o:any={name,fixture:`docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/${name}.xlsx`,fixtureSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),httpStatus:response.status,body};observations.push(o);t.after(async()=>{await fs.writeFile(new URL('./original-results.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');});
 if(name in positive){assert.equal(response.status,201,JSON.stringify(body));assert.equal(body.data.counts.total,1);assert.equal(body.data.rows[0].title,positive[name]);assert.equal(body.data.state,'ready');
  const r=await f.request('POST',`/imports/${body.data.id}/commit`,'owner',{expectedVersion:body.data.version,previewDigest:body.data.previewDigest,defaultColumnId:body.data.defaultColumnId});o.commitStatus=r.status;o.commit=await r.json();assert.equal(r.status,200,JSON.stringify(o.commit));o.persisted=(await f.pool.query('SELECT title,description FROM cards WHERE id=$1',[o.commit.data.rows[0].cardId])).rows[0];assert.equal(o.persisted.title,positive[name]);assert.equal(o.persisted.description,'Synthetic official workbook row');
 }else{assert.equal(response.status,422,JSON.stringify(body));assert.equal(Number((await f.pool.query('SELECT COUNT(*)n FROM card_imports')).rows[0].n),0);assert.equal(Number((await f.pool.query("SELECT COUNT(*)n FROM cards WHERE id<>'card'")).rows[0].n),0);assert.equal(Number((await f.pool.query('SELECT COUNT(*)n FROM idempotency_receipts')).rows[0].n),0);}
});
