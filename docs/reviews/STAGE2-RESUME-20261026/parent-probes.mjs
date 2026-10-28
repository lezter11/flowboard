// Independent local reproductions. Never points at the development database.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

assert.equal(new URL(process.env.DATABASE_URL).port, '55435');
assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
const source = process.env.FLOWBOARD_AUDIT_SOURCE;
assert.equal(source, '/private/tmp/flowboard-stage2-resume-a37x7egs');
const load = (path) => import(pathToFileURL(`${source}/${path}`).href);
const { createApp } = await load('apps/api/src/http/app.ts');
const { getPool, closePool } = await load('apps/api/src/adapters/postgres.ts');
const { runMigrations } = await load('apps/api/src/adapters/migrations.ts');
const { createSession } = await load('apps/api/src/adapters/session.ts');
const pool = getPool();
const app = createApp(() => Promise.resolve(), { pool });
const prefix = `resume_${randomUUID()}`;
const owner = `${prefix}_owner`, actor = `${prefix}_manager`;
const ws = `${prefix}_ws`, project = `${prefix}_project`;
const board = `${prefix}_board`, column = `${prefix}_column`;
let cookie;
const call = async (path, method = 'GET', body, key) => {
  const headers = { Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await app.request(path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const results = [];
try {
  await runMigrations(pool);
  for (const id of [owner, actor]) await pool.query(
    'INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,$3,NOW(),NOW())', [id, `${id}@example.invalid`, 'Synthetic review actor']);
  await pool.query('INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW())', [ws, 'Synthetic audit', 'UTC', owner]);
  await pool.query('INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,$3,NOW(),NOW())', [project, ws, 'Synthetic project']);
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES($1,$2,$3,$4,'manager','active',NOW(),NOW())`, [`${prefix}_grant`,project,ws,actor]);
  await pool.query('INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW())', [board,ws,project,'Synthetic board']);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,category,color,position,created_at,updated_at)
    VALUES($1,$2,$3,$4,'Todo','todo','#64748b',0,NOW(),NOW())`, [column,ws,project,board]);
  cookie = `flowboard_session=${(await createSession(actor,24,pool)).id}`;
  const boardVersion = (await pool.query('SELECT structure_version FROM boards WHERE id=$1',[board])).rows[0].structure_version;
  const createBody = {title:'Synthetic private marker',description:'Synthetic receipt content',columnId:column,expectedBoardVersion:boardVersion};
  const created = await call(`/api/v1/boards/${board}/cards`,'POST',createBody,`${prefix}_create`);
  assert.equal(created.status,201);
  const card = created.body.data.id;
  const commentBody = {body:'Synthetic private comment',mentions:[]};
  const comments = [];
  for (let i=0;i<3;i++) {
    const posted = await call(`/api/v1/cards/${card}/comments`,'POST',commentBody,`${prefix}_comment_${i}`);
    assert.equal(posted.status,201);
    comments.push(posted.body.data);
  }
  const first = await call(`/api/v1/cards/${card}/comments?limit=1`);
  const next = await call(`/api/v1/cards/${card}/comments?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
  assert.equal(first.status,200); assert.equal(next.status,200);
  results.push({case:'comment_cursor',expected:'next page advances',firstId:first.body.data[0]?.id,nextId:next.body.data[0]?.id,
    contractPassed:first.body.data[0]?.id!==next.body.data[0]?.id});
  await pool.query('UPDATE boards SET archived=true WHERE id=$1',[board]);
  const version = (await pool.query('SELECT version FROM cards WHERE id=$1',[card])).rows[0].version;
  const archivedWrite = await call(`/api/v1/cards/${card}`,'PATCH',{title:'Changed inside archived board',expectedVersion:version},`${prefix}_archive_edit`);
  results.push({case:'archived_board_card_patch',expected:'read-only rejection',actualStatus:archivedWrite.status,contractPassed:archivedWrite.status>=400});
  await pool.query('UPDATE boards SET archived=false WHERE id=$1',[board]);
  await pool.query(`UPDATE cards SET state='trashed',deleted_at=NOW(),restore_until=NOW()+INTERVAL '24 hours' WHERE id=$1`,[card]);
  const trashedCommentDelete = await call(`/api/v1/comments/${comments[0].id}`,'DELETE',{expectedVersion:comments[0].version},`${prefix}_comment_delete`);
  results.push({case:'delete_comment_on_trashed_card',expected:'unavailable rejection',actualStatus:trashedCommentDelete.status,contractPassed:trashedCommentDelete.status>=400});
  await pool.query(`UPDATE cards SET state='active',deleted_at=null,restore_until=null WHERE id=$1`,[card]);
  await pool.query(`UPDATE project_memberships SET status='removed',version=version+1 WHERE project_id=$1 AND user_id=$2`,[project,actor]);
  const denied = await call(`/api/v1/cards/${card}`);
  assert.equal(denied.status,404);
  const replay = await call(`/api/v1/boards/${board}/cards`,'POST',createBody,`${prefix}_create`);
  results.push({case:'revoked_card_receipt_replay',normalReadStatus:denied.status,expected:'private 404',actualStatus:replay.status,
    replayed:replay.body.replayed===true,privateContentReturned:replay.body.data?.description===createBody.description,contractPassed:replay.status===404});
  const commentReplay = await call(`/api/v1/cards/${card}/comments`,'POST',commentBody,`${prefix}_comment_1`);
  results.push({case:'revoked_comment_receipt_replay',expected:'private 404',actualStatus:commentReplay.status,
    replayed:commentReplay.body.replayed===true,privateContentReturned:commentReplay.body.data?.body===commentBody.body,contractPassed:commentReplay.status===404});
  console.log(JSON.stringify({source,isolatedPort:55435,results},null,2));
  // Reproduction succeeds only when all five predicted contract failures occur.
  assert.equal(results.length,5);
  assert.ok(results.every(result=>result.contractPassed===false),'Source behavior changed: independently investigate counterevidence');
} finally {
  await closePool();
}
