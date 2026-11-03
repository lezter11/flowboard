import assert from 'node:assert/strict';
import test from 'node:test';
import { importStatusResponseSchema } from '@flowboard/contracts';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { workbook, type Row } from './support/import-workbook.ts';
import { cleanupExpiredImports } from '../src/services/import-retention.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { MemoryStorageDriver, runWithStorageDriver } from '../src/adapters/storage.ts';

async function upload(f:Awaited<ReturnType<typeof lifecycleFixture>>,rows:Row[]){
  const r=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:new Uint8Array(workbook(rows)).buffer});
  assert.equal(r.status,201,await r.clone().text());return await r.json()as any;
}
const validRow=(id='source-id',title='Private original title'):Row=>({externalId:id,title,description:'Private original description',priority:'urgent',dueDate:'2026-12-15'});
const assertContract=(body:unknown)=>{const parsed=importStatusResponseSchema.safeParse(body);assert.equal(parsed.success,true,parsed.success?'':JSON.stringify(parsed.error.issues));};
const commit=async(f:Awaited<ReturnType<typeof lifecycleFixture>>,p:any)=>{const r=await f.request('POST',`/imports/${p.id}/commit`,'owner',{expectedVersion:p.version,previewDigest:p.previewDigest,defaultColumnId:p.defaultColumnId});assert.equal(r.status,200,await r.clone().text());const body=await r.json()as any;assertContract(body);return body.data;};

test('Import response: invalid previews preserve missing/oversized raw fields and still match their response contract',async t=>{
  const f=await lifecycleFixture(t);
  const rows:Row[]=[
    {...validRow('missing-title'),title:''},{...validRow(),externalId:''},
    {...validRow('long-title'),title:'T'.repeat(201)},
    {...validRow('long-description'),description:'D'.repeat(20_001)},
    {...validRow(),externalId:'E'.repeat(65)},
    {...validRow('bad-priority'),priority:'unsupported'},
    {...validRow('bad-date'),dueDate:'2026-02-31'},
    {...validRow('bad-assignee'),assignees:'nobody@flowboard.example'},
  ];
  const body=await upload(f,rows);assert.equal(body.data.state,'invalid');assert.equal(body.data.canCommit,false);assert.equal(body.data.rows.length,8);
  assert.ok(body.data.rows.every((row:any)=>row.outcome==='invalid'&&row.errors.length));assertContract(body);
  assert.equal(body.data.rows[0].title,'');assert.equal(body.data.rows[1].externalId,'');assert.equal(body.data.rows[2].title.length,201);assert.equal(body.data.rows[3].description.length,20_001);
  const attempt=await f.request('POST',`/imports/${body.data.id}/commit`,'owner',{expectedVersion:body.data.version,previewDigest:body.data.previewDigest,defaultColumnId:'col2'});assert.equal(attempt.status,409);
  assert.equal(Number((await f.pool.query("SELECT COUNT(*) n FROM cards WHERE id<>'card'")).rows[0].n),0);
});

test('Import response: cleaned committed receipt retains only explicit minimal row/card provenance',async t=>{
  const f=await lifecycleFixture(t),p=(await upload(f,[validRow()])).data;
  assertContract({data:p});const completed=await commit(f,p),cardId=completed.rows[0].cardId;
  assert.equal((await cleanupExpiredImports(f.pool,{asOfDate:new Date(Date.now()+31*60*1000)})).cleanedCount,1);
  const r=await f.request('GET',`/imports/${p.id}`);assert.equal(r.status,200);const body=await r.json()as any;assertContract(body);
  assert.deepEqual(body.data.rows[0],{rowNumber:2,contentRedacted:true,externalId:null,title:null,description:null,status:null,priority:null,dueDate:null,assigneeIds:[],outcome:'created',errors:[],cardId});
  assert.equal(body.data.counts.created,1);assert.equal(body.data.canCommit,false);
  for(const secret of ['source-id','Private original title','Private original description','2026-12-15','urgent'])assert.equal(JSON.stringify(body).includes(secret),false);
  const row=(await f.pool.query('SELECT title,description,external_id,row_hash,assignee_ids,priority,due_date FROM card_import_rows WHERE import_id=$1',[p.id])).rows[0];
  assert.deepEqual(row,{title:'',description:null,external_id:'',row_hash:null,assignee_ids:null,priority:null,due_date:null});
  assert.equal((await cleanupExpiredImports(f.pool,{asOfDate:new Date(Date.now()+32*60*1000)})).cleanedCount,0);
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager!.user.id]);assert.equal((await f.request('GET',`/imports/${p.id}`,'manager')).status,404);
});

test('Import response: expired and cancelled receipts are schema-valid after immediate redaction',async t=>{
  const f=await lifecycleFixture(t);
  for(const terminal of ['cancelled','expired']){
    const p=(await upload(f,[validRow(terminal)])).data;
    if(terminal==='cancelled'){const cancelled=await f.request('DELETE',`/imports/${p.id}`);assert.equal(cancelled.status,200);assert.deepEqual(await cancelled.json(),{data:{id:p.id,state:'cancelled'}});}
    else await f.pool.query("UPDATE card_imports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[p.id]);
    const r=await f.request('GET',`/imports/${p.id}`);assert.equal(r.status,200);const body=await r.json()as any;assertContract(body);assert.equal(body.data.state,terminal);assert.equal(body.data.rows[0].contentRedacted,true);assert.equal(body.data.rows[0].cardId,null);
  }
});

test('Import response: per-card purge redacts one row without relabeling the remaining live content',async t=>{
  const f=await lifecycleFixture(t),p=(await upload(f,[validRow('purged-row','Will be purged'),validRow('live-row','Keep this original')])).data;
  const completed=await commit(f,p),purged=completed.rows[0].cardId;
  const snapshot=(await f.pool.query("SELECT c.version,b.structure_version FROM cards c JOIN boards b ON b.id=c.board_id WHERE c.id=$1",[purged])).rows[0];
  const deletion=await f.request('POST',`/cards/${purged}/delete`,'owner',{expectedVersion:snapshot.version,expectedBoardVersion:snapshot.structure_version});assert.equal(deletion.status,200,await deletion.clone().text());
  const result=await runWithStorageDriver(new MemoryStorageDriver(),()=>purgeExpiredTrash(f.pool,{asOfDate:new Date(Date.now()+25*60*60*1000)}));assert.ok(result.purgedCardIds.includes(purged));
  const r=await f.request('GET',`/imports/${p.id}`);assert.equal(r.status,200);const body=await r.json()as any;assertContract(body);
  assert.equal(body.data.rows[0].contentRedacted,true);assert.equal(body.data.rows[0].title,null);assert.equal(body.data.rows[1].title,'Keep this original');assert.notEqual(body.data.rows[1].contentRedacted,true);
});
