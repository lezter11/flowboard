import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { workbook } from '../../../../apps/api/test/support/import-workbook.ts';
const observations:any[]=[];
for(const changed of [{priority:'not-a-priority'},{dueDate:'2026-02-31'},{externalId:1}])test(`Previously imported row retains invalid-field errors ${JSON.stringify(changed)}`,async t=>{
 const f=await lifecycleFixture(t);
 const upload=async(row:any)=>{const r=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(workbook([row])).buffer});return {status:r.status,...await r.json()as any};};
 const original={externalId:'1',title:'Stable original title'};const a=await upload(original);assert.equal(a.status,201);assert.equal(a.data.state,'ready');
 const committed=await f.request('POST',`/imports/${a.data.id}/commit`,'owner',{expectedVersion:a.data.version,previewDigest:a.data.previewDigest,defaultColumnId:'col2'});assert.equal(committed.status,200);
 const b=await upload({...original,...changed});observations.push({changed,preview:b});t.after(async()=>fs.writeFile(new URL('./validation-duplicate-results.json',import.meta.url),JSON.stringify(observations,null,2)+'\n'));
 assert.equal(b.data.state,'invalid','Invalid changed source values must not be silently reclassified as already imported');assert.equal(b.data.rows[0].outcome,'invalid');assert.ok(b.data.rows[0].errors.length);
});
