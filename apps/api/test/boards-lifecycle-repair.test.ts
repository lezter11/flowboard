import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { lifecycleFixture as fixture } from './support/lifecycle-fixture.ts';
import { createEmptyImport } from './support/import-fixture.ts';

for(const state of ['trashed','purged'])test(`boards lifecycle: remove an empty column retaining ${state} source IDs and import context`,async t=>{
  const f=await fixture(t);
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,deleted_by,deleted_at,restore_until,created_at,updated_at)
    VALUES('historical','ws','prj','brd','col','Historical source','none',1000,$1,$2,NOW()-INTERVAL '25 hours',NOW()-INTERVAL '1 hour',NOW(),NOW())`,[state,f.actors.owner!.user.id]);
  const preview=await createEmptyImport(f.pool,'brd','col',f.actors.owner!.user.id);
  const deleted=await f.removeColumn();assert.equal(deleted.status,200,await deleted.clone().text());
  const row=(await f.pool.query("SELECT deleted_at,name FROM columns WHERE id='col'")).rows[0];assert.ok(row.deleted_at);assert.equal(row.name,'Old column');
  assert.equal((await f.pool.query("SELECT column_id FROM cards WHERE id='historical'")).rows[0].column_id,'col');
  assert.equal((await f.pool.query('SELECT default_column_id FROM card_imports WHERE id=$1',[preview.id])).rows[0].default_column_id,'col');
  for(const route of ['/boards/brd','/boards/brd/metadata']){const r=await f.request('GET',route);assert.equal(r.status,200);assert.equal(JSON.stringify((await r.json()as any).data.columns).includes('Old column'),false);}
  const add=await f.request('POST','/boards/brd/columns','owner',{name:'Old column',color:'#64748b',category:'todo',expectedBoardVersion:await f.version()});assert.equal(add.status,201,await add.clone().text());
  const newColumn=(await add.json()as any).data.id;assert.notEqual(newColumn,'col');
  const edit=await f.request('PATCH','/boards/brd/columns/col','owner',{name:'Revive old',expectedBoardVersion:await f.version()});assert.equal(edit.status,404);
  const create=await f.request('POST','/boards/brd/cards','owner',{title:'Cannot target retired',columnId:'col',expectedBoardVersion:await f.version()});assert.equal(create.status,422,await create.clone().text());
  const move=await f.request('POST','/cards/card/move','owner',{toColumnId:'col',previousCardId:null,nextCardId:null,expectedVersion:1,expectedBoardVersion:await f.version()});assert.equal(move.status,422,await move.clone().text());
  const placement=await f.request('GET','/boards/brd/columns/col/placement?movingCardId=card&at=first');assert.equal(placement.status,404);
  const stale=await f.request('POST',`/imports/${preview.id}/commit`,'owner',{expectedVersion:preview.version,previewDigest:preview.previewDigest,defaultColumnId:'col'});assert.equal(stale.status,409);
  const reordered=await f.request('POST','/boards/brd/columns/reorder','owner',{columnIds:[newColumn,'col2'],expectedBoardVersion:await f.version()});assert.equal(reordered.status,200);
});

test('boards lifecycle: placement uses bounded actual query results for off-page anchors',async t=>{
  const f=await fixture(t);
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
    SELECT 'x'||lpad(i::text,4,'0'),'ws','prj','brd','col2','Task '||i,'none',i*10,'active',NOW(),NOW() FROM generate_series(1,500) i`);
  const original=pg.Client.prototype.query;let maxRows=0,observed=0;
  t.mock.method(pg.Client.prototype,'query',function(this:pg.Client,...args:any[]){
    const result=(original as any).apply(this,args);const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'';
    if(/^\s*SELECT\s+id\b/i.test(sql)&&/FROM cards\s+WHERE column_id/i.test(sql)&&result?.then)return result.then((r:any)=>{maxRows=Math.max(maxRows,r.rows.length);observed++;return r;});
    return result;
  });
  for(const [at,previous,next]of[['first',null,'x0001'],['last','x0500',null],['before','x0399','x0400'],['after','x0400','x0401']]as const){
    const r=await f.request('GET',`/boards/brd/columns/col2/placement?movingCardId=card&at=${at}${at==='before'||at==='after'?'&anchorCardId=x0400':''}`);
    assert.equal(r.status,200,await r.clone().text());const data=(await r.json()as any).data;assert.equal(data.previousCardId,previous);assert.equal(data.nextCardId,next);
  }
  assert.ok(observed>0);assert.ok(maxRows<=2,`placement query returned ${maxRows} rows for a single neighbor read`);
});

test('boards lifecycle: card-page cursors reject another actor and changed access revision',async t=>{
  const f=await fixture(t);await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) SELECT 'p'||i,'ws','prj','brd','col2','Paged','none',i*10,'active',NOW(),NOW() FROM generate_series(1,15)i`);
  const get=async(actor:string)=>{const r=await f.request('GET','/boards/brd/cards?columnId=col2&limit=5',actor);assert.equal(r.status,200);return(await r.json()as any).nextCursor as string;};
  const ownerCursor=await get('owner');assert.ok(ownerCursor);
  const copied=await f.request('GET','/boards/brd/cards?columnId=col2&limit=5&cursor='+encodeURIComponent(ownerCursor),'manager');assert.equal(copied.status,409,await copied.clone().text());
  const own=await get('manager');const revision=async()=>String((await f.pool.query("SELECT access_revision FROM boards WHERE id='brd'")).rows[0].access_revision);
  assert.equal((await f.request('DELETE',`/boards/brd/grants/${f.actors.manager!.user.id}`,'owner',{expectedAccessRevision:await revision()})).status,200);
  assert.equal((await f.request('PUT',`/boards/brd/grants/${f.actors.manager!.user.id}`,'owner',{expectedAccessRevision:await revision()})).status,200);
  const stale=await f.request('GET','/boards/brd/cards?columnId=col2&limit=5&cursor='+encodeURIComponent(own),'manager');assert.equal(stale.status,409,await stale.clone().text());
});

test('boards lifecycle: explicit archived discovery is strict and scoped to current session administration',async t=>{
  const f=await fixture(t);await f.pool.query("UPDATE boards SET archived=TRUE WHERE id='brd'");
  const ordinary=await f.request('GET','/projects/prj/boards');assert.deepEqual((await ordinary.json()as any).data,[]);
  for(const actor of ['owner','manager']){const r=await f.request('GET','/projects/prj/boards?includeArchived=true',actor);assert.equal(r.status,200);const data=(await r.json()as any).data;assert.equal(data.length,1);assert.equal(data[0].isArchived,true);}
  for(const actor of ['member','viewer'])assert.equal((await f.request('GET','/projects/prj/boards?includeArchived=true',actor)).status,403);
  assert.equal((await f.request('GET','/projects/prj/boards?includeArchived=true','outsider')).status,404);
  for(const query of ['includeArchived=1','includeArchived=FALSE','includeArchived=true&extra=x'])assert.equal((await f.request('GET','/projects/prj/boards?'+query)).status,422);
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager!.user.id]);
  const hidden=await f.request('GET','/projects/prj/boards?includeArchived=true','manager');assert.deepEqual((await hidden.json()as any).data,[]);
});

test('boards lifecycle: PAT archive administration is refused without expanding default discovery projection',async t=>{
  const f=await fixture(t);const issued=await f.request('POST','/tokens','owner',{name:'Directory fixture',scopes:['boards:read'],projectId:'prj'});
  assert.equal(issued.status,201,await issued.clone().text());const token=(await issued.json()as any).data.token;
  const get=(query='')=>f.app.request('http://localhost/api/v1/projects/prj/boards'+query,{headers:{authorization:'Bearer '+token}});
  const ordinary=await get();assert.equal(ordinary.status,200);const row=(await ordinary.json()as any).data[0];assert.deepEqual(Object.keys(row).sort(),['id','name','structureVersion']);
  const denied=await get('?includeArchived=true');assert.equal(denied.status,403);assert.equal((await denied.json()as any).error.code,'TOKEN_OPERATION_FORBIDDEN');
});

test('boards lifecycle: database guard refuses active cards or final retirement and name reuse/cap count sees live rows only',async t=>{
  const f=await fixture(t);await f.removeColumn();
  await assert.rejects(f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('bad','ws','prj','brd','col','Bad retired destination','none',1000,'active',NOW(),NOW())`),{code:'23514'});
  await assert.rejects(f.pool.query("UPDATE columns SET deleted_at=NOW(),deleted_by=$1 WHERE id='col2'",[f.actors.owner!.user.id]),{code:'23514'});
  await assert.rejects(f.pool.query("UPDATE columns SET deleted_at=NULL WHERE id='col'"),{code:'23514'});
  for(let i=0;i<11;i++){const r=await f.request('POST','/boards/brd/columns','owner',{name:'Live '+i,color:'#64748b',category:'todo',expectedBoardVersion:await f.version()});assert.equal(r.status,201,await r.clone().text());}
  const full=await f.request('POST','/boards/brd/columns','owner',{name:'Too many',color:'#64748b',category:'todo',expectedBoardVersion:await f.version()});assert.equal(full.status,400);assert.equal((await full.json()as any).error.code,'COLUMN_LIMIT_EXCEEDED');
  assert.equal(Number((await f.pool.query("SELECT COUNT(*) AS n FROM columns WHERE board_id='brd' AND deleted_at IS NULL")).rows[0].n),12);
});

test('boards lifecycle: source columns remain readable in historical movement and undo rejects a retired destination',async t=>{
  const f=await fixture(t);await f.pool.query("UPDATE cards SET column_id='col' WHERE id='card'");
  const move=await f.request('POST','/cards/card/move','owner',{toColumnId:'col2',previousCardId:null,nextCardId:null,expectedVersion:1,expectedBoardVersion:await f.version()});assert.equal(move.status,200,await move.clone().text());
  const card=(await move.json()as any).data;assert.equal((await f.removeColumn()).status,200);
  const activity=await f.request('GET','/cards/card/activity');const body=await activity.text();assert.ok(body.includes('Old column'));assert.ok(body.includes('col'));
  const undo=await f.request('POST','/cards/card/move-undo','owner',{expectedVersion:card.version,expectedBoardVersion:await f.version()});assert.equal(undo.status,409);assert.equal((await undo.json()as any).error.code,'DESTINATION_COLUMN_MISSING');
});

test('boards lifecycle: retire makes import/restore destinations unavailable without discarding expired content',async t=>{
  const f=await fixture(t);await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,deleted_by,deleted_at,restore_until,created_at,updated_at) VALUES('expired','ws','prj','brd','col','Expired source','none',1000,'trashed',$1,NOW()-INTERVAL '25 hours',NOW()-INTERVAL '1 hour',NOW(),NOW())`,[f.actors.owner!.user.id]);
  assert.equal((await f.removeColumn()).status,200);
  const restore=await f.request('POST','/cards/expired/restore','owner',{toColumnId:'col2',expectedVersion:1,expectedBoardVersion:await f.version()});assert.equal(restore.status,410);assert.equal((await restore.json()as any).error.code,'RESTORE_WINDOW_EXPIRED');
  const source=(await f.pool.query("SELECT title,column_id FROM cards WHERE id='expired'")).rows[0];assert.equal(source.title,'Expired source');assert.equal(source.column_id,'col');
  const template=await f.request('GET','/import/template');const bytes=await template.arrayBuffer();
  const preview=await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/octet-stream'},body:bytes});assert.equal(preview.status,422,await preview.clone().text());
  const cards=await f.request('GET','/boards/brd/cards?columnId=col');assert.equal(cards.status,404);
});

test('boards lifecycle: pre0024 migration upgrade and rerun preserve source rows while live views retire them',async t=>{
  const f=await fixture(t,23);const fs=await import('node:fs/promises');const {runMigrations}=await import('../src/adapters/migrations.ts');
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('legacy','ws','prj','brd','col','Legacy tombstone','none',1000,'purged',NOW(),NOW())`);
  await runMigrations(f.pool);const sql=await fs.readFile(new URL('../../../database/migrations/0024_soft_columns.sql',import.meta.url),'utf8');await f.pool.query(sql);
  assert.equal((await f.pool.query("SELECT deleted_at FROM columns WHERE id='col'")).rows[0].deleted_at,null);
  assert.equal((await f.removeColumn()).status,200);await f.pool.query(sql);
  assert.equal((await f.pool.query("SELECT column_id FROM cards WHERE id='legacy'")).rows[0].column_id,'col');
  assert.ok((await f.pool.query("SELECT deleted_at FROM columns WHERE id='col'")).rows[0].deleted_at);
});

test('boards lifecycle: archive/reopen expected snapshot version rejects delayed transitions while exact retries replay',async t=>{
  const f=await fixture(t);const snapshot=async()=>Number((await f.pool.query("SELECT snapshot_version FROM boards WHERE id='brd'")).rows[0].snapshot_version);
  const initial=await snapshot();const stale=await f.request('POST','/boards/brd/archive','owner',{expectedVersion:initial+99});assert.equal(stale.status,409,await stale.clone().text());
  const key='archive_stable_fixture_key';const archived=await f.request('POST','/boards/brd/archive','owner',{expectedVersion:initial},key);assert.equal(archived.status,200);
  const afterArchive=await snapshot();const replay=await f.request('POST','/boards/brd/archive','owner',{expectedVersion:initial},key);assert.equal(replay.status,200);assert.equal((await replay.json()as any).replayed,true);assert.equal(await snapshot(),afterArchive);
  const reopen=await f.request('POST','/boards/brd/reopen','owner',{expectedVersion:afterArchive});assert.equal(reopen.status,200);
  const delayed=await f.request('POST','/boards/brd/archive','owner',{expectedVersion:initial});assert.equal(delayed.status,409);assert.equal((await f.pool.query("SELECT archived FROM boards WHERE id='brd'")).rows[0].archived,false);
});

test('boards lifecycle: paged summaries preserve human keys and bounded description excerpts',async t=>{
  const f=await fixture(t);await f.pool.query("UPDATE cards SET description='<b>Page</b> **excerpt**' WHERE id='card'");
  const r=await f.request('GET','/boards/brd/cards?columnId=col2&limit=1');assert.equal(r.status,200);const row=(await r.json()as any).data[0];
  assert.equal(typeof row.key,'string');assert.ok(row.key.length>0);assert.equal(typeof row.descriptionExcerpt,'string');assert.ok(row.descriptionExcerpt.includes('Page'));assert.equal(row.descriptionExcerpt.includes('<'),false);assert.ok(row.descriptionExcerpt.length<=160);
});

test('boards lifecycle: direct retirement uses a nonwaiting board guard rather than column-to-board deadlock',async t=>{
  const f=await fixture(t);await f.pool.query("DELETE FROM cards WHERE id='card'");
  const app=await f.pool.connect(),direct=await f.pool.connect();
  try{
    await app.query('BEGIN');const appPid=(await app.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await app.query("SELECT id FROM boards WHERE id='brd' FOR UPDATE");
    let finished=false;let directError:any;
    const directP=direct.query("UPDATE columns SET deleted_at=NOW(),deleted_by=$1 WHERE id='col'",[f.actors.owner!.user.id]).catch(e=>{directError=e;}).finally(()=>{finished=true;});
    const deadline=Date.now()+3000;while(!finished&&Date.now()<deadline){if((await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[appPid])).rowCount)break;await new Promise(r=>setTimeout(r,10));}
    const lock=app.query("SELECT id FROM columns WHERE id='col' FOR UPDATE").catch(e=>e);
    const result=await lock;await app.query('ROLLBACK');await directP;
    assert.equal(result?.code,undefined,'normal board-first writer must not become a deadlock victim');
    assert.equal(directError?.code,'55P03','direct operator must prelock board or receive an immediate retryable lock refusal');
    assert.equal((await f.pool.query("SELECT deleted_at FROM columns WHERE id='col'")).rows[0].deleted_at,null);
  }finally{await app.query('ROLLBACK');app.release();direct.release();}
});

test('boards lifecycle: repeatable-read direct writers cannot retire both final columns from stale snapshots',async t=>{
  const f=await fixture(t);await f.pool.query("DELETE FROM cards WHERE id='card'");const stale=await f.pool.connect();
  try{
    await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await stale.query("SELECT id FROM columns WHERE board_id='brd'");
    await f.pool.query("UPDATE columns SET deleted_at=NOW(),deleted_by=$1 WHERE id='col'",[f.actors.owner!.user.id]);
    let code:string|undefined;try{await stale.query("UPDATE columns SET deleted_at=NOW(),deleted_by=$1 WHERE id='col2'",[f.actors.owner!.user.id]);await stale.query('COMMIT');}catch(e){code=(e as any).code;await stale.query('ROLLBACK');}
    assert.equal(code,'40001','stale repeatable snapshot must serialize-fail after another retirement');
    assert.equal(Number((await f.pool.query("SELECT COUNT(*) AS n FROM columns WHERE board_id='brd' AND deleted_at IS NULL")).rows[0].n),1);
  }finally{await stale.query('ROLLBACK');stale.release();}
});

test('boards lifecycle: normalized legacy name conflicts abort migration diagnostically without dropping rows',async t=>{
  const f=await fixture(t,23);const {runMigrations}=await import('../src/adapters/migrations.ts');
  await f.pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('legacy_conflict','ws','prj','brd',' old column ','#64748b','todo',2,NOW(),NOW())`);
  await assert.rejects(runMigrations(f.pool),(e:any)=>e.code==='23505'&&/resolve.*before migration/i.test(e.message));
  assert.equal(Number((await f.pool.query("SELECT COUNT(*) AS n FROM columns WHERE board_id='brd'")).rows[0].n),3);
  assert.equal((await f.pool.query("SELECT version FROM schema_migrations WHERE version='0024'")).rowCount,0);
});
