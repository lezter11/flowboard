import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs/promises';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { workbook } from '../../../../apps/api/test/support/import-workbook.ts';
import { parseExcelWorkbook } from '../../../../apps/api/src/services/excel-parser.ts';
test('Changed invalid duplicate must keep validation errors and block a mixed batch',async t=>{
 const f=await lifecycleFixture(t);const upload=async(rows:any[])=>{const r=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(workbook(rows)).buffer});return {status:r.status,...await r.json()as any};};
 const commit=async(p:any)=>{const r=await f.request('POST',`/imports/${p.id}/commit`,'owner',{expectedVersion:p.version,previewDigest:p.previewDigest,defaultColumnId:'col2'});return {status:r.status,...await r.json()as any};};
 const original={externalId:'1',title:'Stable original title'};
 const invalidWithoutMarker=await upload([{...original,externalId:'unseen',dueDate:'2026-02-31'}]);assert.equal(invalidWithoutMarker.data.state,'invalid');
 const a=await upload([original]);assert.equal((await commit(a.data)).status,200);
 const source=[{...original,dueDate:'2026-02-31'},{externalId:'new-row',title:'Must not create alongside an invalid row'}];
 const parser=parseExcelWorkbook(workbook(source));assert.equal(parser.rows[0].rawErrors[0].code,'INVALID_DATE');
 const mixed=await upload(source);const completed=await commit(mixed.data);
 const effects=(await f.pool.query("SELECT title,due_date FROM cards WHERE id<>'card' ORDER BY title")).rows;
 await fs.writeFile(new URL('./validation-duplicate-detail.json',import.meta.url),JSON.stringify({invalidWithoutMarker,parser:parser.rows,mixed,completed,effects},null,2)+'\n');
 assert.equal(mixed.data.state,'invalid','A prior marker must not erase the mandatory invalid-date error');assert.notEqual(completed.status,200);assert.equal(effects.length,1);
});
