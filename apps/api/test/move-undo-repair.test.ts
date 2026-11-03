import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

async function fixture(t:Parameters<typeof lifecycleFixture>[0]){
  const f=await lifecycleFixture(t);
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
    VALUES('left','ws','prj','brd','col2','Left','high',0,'active',NOW(),NOW()),('right','ws','prj','brd','col2','Right','high',2000,'active',NOW(),NOW())`);
  const order=async()=> (await f.pool.query("SELECT id FROM cards WHERE column_id='col2' AND state='active' ORDER BY position,id")).rows.map(row=>row.id);
  const move=async(toColumnId:string,previousCardId:string|null,nextCardId:string|null)=>{
    const version=(await f.pool.query("SELECT version FROM cards WHERE id='card'")).rows[0].version;
    return f.request('POST','/cards/card/move','member',{toColumnId,previousCardId,nextCardId,expectedVersion:version,expectedBoardVersion:await f.version()});
  };
  const undo=async(expectedVersion:number,key:string=crypto.randomUUID())=>f.request('POST','/cards/card/move-undo','member',{expectedVersion,expectedBoardVersion:await f.version()},key);
  return{...f,order,move,undo};
}

for(const mode of ['cross-column','same-column'])test(`Move Undo: ${mode} restores original order once, lost-response replay is safe`,async t=>{
  const f=await fixture(t);const moved=await f.move(mode==='cross-column'?'col':'col2',null,mode==='cross-column'?null:'left');assert.equal(moved.status,200,await moved.clone().text());
  const version=(await moved.json()as any).data.version;const expectedBoardVersion=await f.version(),key=crypto.randomUUID();
  const body={expectedVersion:version,expectedBoardVersion};
  const undone=await f.request('POST','/cards/card/move-undo','member',body,key);assert.equal(undone.status,200,await undone.clone().text());
  assert.deepEqual(await f.order(),['left','card','right']);
  const undoVersion=(await undone.json()as any).data.version;
  const replay=await f.request('POST','/cards/card/move-undo','member',body,key);assert.equal(replay.status,200);assert.equal((await replay.json()as any).data.version,undoVersion);
  const again=await f.undo(undoVersion);assert.equal(again.status,409);assert.deepEqual(await f.order(),['left','card','right']);
});

test('Move Undo: intervening edit gives conflict without overwriting',async t=>{
  const f=await fixture(t);const r=await f.move('col',null,null);const version=(await r.json()as any).data.version;
  const edit=await f.request('PATCH','/cards/card','member',{title:'Intervening edit',expectedVersion:version});assert.equal(edit.status,200);
  assert.equal((await f.undo(version)).status,409);
  const card=(await f.pool.query("SELECT title,column_id FROM cards WHERE id='card'")).rows[0];assert.equal(card.title,'Intervening edit');assert.equal(card.column_id,'col');
});

test('Move Undo: changed original gap refuses with409 and no partial effects',async t=>{
  const f=await fixture(t);const moved=await f.move('col',null,null);const version=(await moved.json()as any).data.version;
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)VALUES('between','ws','prj','brd','col2','Intervening card','high',1000,'active',NOW(),NOW())`);
  await f.pool.query("UPDATE boards SET structure_version=structure_version+1 WHERE id='brd'");
  const before=await f.pool.query("SELECT count(*)::int AS n FROM activity_log WHERE card_id='card'");
  assert.equal((await f.undo(version)).status,409);
  assert.equal((await f.pool.query("SELECT column_id FROM cards WHERE id='card'")).rows[0].column_id,'col');
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM activity_log WHERE card_id='card'")).rows[0].n,before.rows[0].n);
});

test('Move Undo: concurrent fresh requests have one effect and one conflict',async t=>{
  const f=await fixture(t);const moved=await f.move('col',null,null);const version=(await moved.json()as any).data.version;
  const outcomes=await Promise.all([f.undo(version),f.undo(version)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(await f.order(),['left','card','right']);
});

test('Move rank calculation: a 1000-card destination never materializes all card rows',async t=>{
  const f=await fixture(t);await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
    SELECT 'bulk_'||n,'ws','prj','brd','col','Bounded neighbor','high',n*1000,'active',NOW(),NOW() FROM generate_series(1,1000)n`);
  const connect=f.pool.connect.bind(f.pool);let maxCardRows=0;
  f.pool.connect=((...args:any[])=>{if(typeof args[0]==='function')return(connect as any)(...args);return(async()=>{
    const client=await(connect as any)(...args),query=client.query.bind(client),release=client.release.bind(client);
    client.query=async(...qs:any[])=>{const result=await query(...qs);if(/^\s*SELECT/i.test(String(qs[0])) && /FROM\s+cards\b/i.test(String(qs[0])))maxCardRows=Math.max(maxCardRows,result.rowCount??0);return result;};
    client.release=(...xs:any[])=>{client.query=query;return release(...xs);};return client;
  })();})as any;
  try{const moved=await f.move('col','bulk_500','bulk_501');assert.equal(moved.status,200,await moved.clone().text());}finally{f.pool.connect=connect;}
  console.log(JSON.stringify({maxCardRowsInMoveRead:maxCardRows}));assert.ok(maxCardRows<=2,'Normal move queries must read bounded neighbors, not1000 destination rows');
});

test('Move ranks: first and last use numeric order across different digit lengths',async t=>{
  const f=await fixture(t);await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
    VALUES('short','ws','prj','brd','col','Short','high',500,'active',NOW(),NOW()),('long','ws','prj','brd','col','Long','high',1000,'active',NOW(),NOW())`);
  const bottom=await f.move('col','long',null);assert.equal(bottom.status,200,await bottom.clone().text());assert.equal((await bottom.json()as any).data.position,2000);
  const top=await f.move('col',null,'short');assert.equal(top.status,200,await top.clone().text());assert.equal((await top.json()as any).data.position,250);
});
