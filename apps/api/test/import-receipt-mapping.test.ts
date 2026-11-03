import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs/promises';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { workbook } from './support/import-workbook.ts';

async function preview(f:Awaited<ReturnType<typeof lifecycleFixture>>,status:string){
  const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream','idempotency-key':crypto.randomUUID()},body:new Uint8Array(workbook([{externalId:'prototype_'+status,title:'Synthetic mapping receipt',status,priority:'high'}])).buffer});
  assert.equal(response.status,201,await response.clone().text());return(await response.json()as any).data;
}

test('Import mappings: inherited-property status labels remain invalid unless explicitly mapped',async t=>{
  const f=await lifecycleFixture(t);
  for(const label of ['constructor','toString','__proto__']){
    const p=await preview(f,label);assert.equal(p.state,'invalid');
    const untouched=await f.request('POST',`/imports/${p.id}/mappings`,'owner',{mappings:{},expectedVersion:p.version});assert.equal(untouched.status,200,await untouched.clone().text());
    const current=(await untouched.json()as any).data;assert.equal(current.state,'invalid');assert.equal(current.rows[0].outcome,'invalid');assert.equal(current.rows[0].status,label,'Empty mappings must preserve the original source status');
    const mappingInput=label==='__proto__'?{mappings:{},mappingEntries:[{sourceStatus:label,columnId:'col2'}]}:{mappings:{[label]:'col2'}};
    const mapped=await f.request('POST',`/imports/${p.id}/mappings`,'owner',{...mappingInput,expectedVersion:current.version});assert.equal(mapped.status,200,await mapped.clone().text());
    const body=(await mapped.json()as any).data;assert.equal(body.state,'ready',label);assert.equal(body.rows[0].status,'Current column');
  }
});

test('Import receipt: uploader and commit actors are persisted facts, safe for a different authorized reader',async t=>{
  const f=await lifecycleFixture(t);const p=await preview(f,'Current column');
  assert.equal(p.createdById,f.actors.owner!.user.id);assert.equal(p.createdBy.displayName,'Retention owner');assert.match(p.createdAt,/Z$/);assert.equal(p.committedBy,null);
  const committed=await f.request('POST',`/imports/${p.id}/commit`,'manager',{expectedVersion:p.version,previewDigest:p.previewDigest,defaultColumnId:p.defaultColumnId});assert.equal(committed.status,200,await committed.clone().text());
  const result=(await committed.json()as any).data;
  assert.equal(result.createdById,f.actors.owner!.user.id);assert.equal(result.committedById,f.actors.manager!.user.id);assert.equal(result.committedBy.displayName,'Retention manager');assert.match(result.committedAt,/Z$/);
  assert.equal(JSON.stringify(result.createdBy).includes('@'),false);assert.equal(JSON.stringify(result.committedBy).includes('@'),false);
  assert.ok(result.rows[0].cardId);assert.equal((await f.request('GET',`/imports/${p.id}`,'member')).status,403);
  await f.pool.query("UPDATE project_memberships SET status='removed' WHERE id='pm_manager'");
  const later=(await(await f.request('GET',`/imports/${p.id}`)).json()as any).data;
  assert.equal(later.committedById,f.actors.manager!.user.id);assert.equal(later.committedBy.activeInProject,false);
});

test('Import pages: malformed limit/cursor never silently restarts or reaches SQL casts',async t=>{
  const f=await lifecycleFixture(t);const p=await preview(f,'Current column');
  for(const query of ['limit=2junk','limit=101','limit=-1','cursor=2e0','cursor=not-a-row']){
    const r=await f.request('GET',`/imports/${p.id}?${query}`);assert.equal(r.status,422,query);assert.equal((await r.json()as any).data,undefined);
  }
});

test('Genuine supplied template: blank optional Assignees must not swallow the following Status cell',async t=>{
  const f=await lifecycleFixture(t);
  const body=await fs.readFile(new URL('./fixtures/import-blank-assignee.xlsx',import.meta.url));
  const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream','idempotency-key':crypto.randomUUID()},body:new Uint8Array(body).buffer});
  assert.equal(response.status,201);const p=(await response.json()as any).data;
  assert.equal(p.rows[0].status,'Prototype Review');assert.equal(p.state,'invalid');assert.equal(p.canCommit,false);
  assert.equal(p.rows[0].description,'Synthetic official workbook row');assert.deepEqual(p.rows[0].assigneeIds,[]);
  const mapped=await f.request('POST',`/imports/${p.id}/mappings`,'owner',{mappings:{},mappingEntries:[{sourceStatus:'Prototype Review',columnId:'col2'}],expectedVersion:p.version});
  assert.equal(mapped.status,200);assert.equal((await mapped.json()as any).data.state,'ready');
});

for(const [file,expected] of [['import-self-closing-row.xlsx',['=Browser imported literal title','After blank row']],['import-self-closing-shared-string.xlsx',['Shared-string card']]]as const)test(`XLSX empty XML elements: ${file} preserves row/string boundaries`,async t=>{
  const f=await lifecycleFixture(t);const bytes=await fs.readFile(new URL('./fixtures/'+file,import.meta.url));
  const response=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream','idempotency-key':crypto.randomUUID()},body:new Uint8Array(bytes).buffer});
  assert.equal(response.status,201,await response.clone().text());const p=(await response.json()as any).data;
  assert.deepEqual(p.rows.map((r:any)=>r.title),expected);assert.ok(p.rows.every((r:any)=>r.status==='Prototype Review'));assert.equal(p.canCommit,false);
});
