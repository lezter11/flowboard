import { lifecycleFixture as fixture } from './support/lifecycle-fixture.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { importTestDatabaseUrl } from './support/import-database.ts';
import { createEmptyImport } from './support/import-fixture.ts';

// Catch raw FK failures/history loss and deleted text surviving copied mention notifications.
const connectionString = importTestDatabaseUrl();
for (const state of ['expired', 'purged'] as const) test(`lifecycle retention: column with only ${state} card reference retires live column and preserves tombstone/history`, async t => {
  const f = await fixture(t);
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,deleted_by,deleted_at,restore_until,created_at,updated_at)
    VALUES('historical','ws','prj','brd','col','Historical',NULL,'none',1000,$1,$2,NOW()-INTERVAL '25 hours',NOW()-INTERVAL '1 hour',NOW(),NOW())`, [state === 'expired' ? 'trashed' : 'purged', f.actors.owner!.user.id]);
  const before = await f.version();
  const response = await f.removeColumn();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await f.pool.query("SELECT column_id FROM cards WHERE id='historical'")).rows[0].column_id, 'col');
  assert.equal((await f.pool.query("SELECT id FROM columns WHERE id='col'")).rowCount, 1);
  assert.equal(await f.version(), before + 1);
  assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE action='column_deleted'")).rowCount, 1);
});
for (const terminal of [false, true]) test(`lifecycle retention: ${terminal ? 'terminal' : 'ready'} import default-column context survives live column retirement`, async t => {
  const f = await fixture(t);
  const preview = await createEmptyImport(f.pool, 'brd', 'col', f.actors.owner!.user.id);
  if (terminal) assert.equal((await f.request('DELETE', `/imports/${preview.id}`)).status, 200);
  const response = await f.removeColumn();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await f.pool.query('SELECT default_column_id FROM card_imports WHERE id=$1', [preview.id])).rows[0].default_column_id, 'col');
});
test('lifecycle retention: tombstoning own and moderated comments removes copied inbox snippets while retaining facts', async t => {
  const f = await fixture(t);
  for (const moderator of ['member', 'owner']) {
    const secret = `Private retained text ${moderator}`;
    const c = await f.post(secret);
    const before = await f.request('GET', '/notifications', 'manager');
    assert.ok((await before.text()).includes(secret));
    const r = await f.request('DELETE', `/comments/${c.id}`, moderator, {
      expectedVersion: c.version
    });
    assert.equal(r.status, 200, await r.clone().text());
    const inbox = await f.request('GET', '/notifications', 'manager');
    assert.equal((await inbox.text()).includes(secret), false);
    const stored = (await f.pool.query('SELECT body,deleted_at FROM comments WHERE id=$1', [c.id])).rows[0];
    assert.equal(stored.body, '');
    assert.ok(stored.deleted_at);
    assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE action='comment_deleted' AND safe_changes->>'commentId'=$1", [c.id])).rowCount, 1);
  }
});
test('lifecycle retention: copied legacy comment outbox fields are scrubbed on deletion and recovery cannot recreate them', async t => {
  const f = await fixture(t);
  const secret = 'Legacy private comment payload';
  const c = await f.post(secret);
  await f.pool.query("UPDATE outbox SET payload=payload || jsonb_build_object('body',$2::text,'raw',jsonb_build_object('content',$2::text)) WHERE payload->>'commentId'=$1", [c.id, secret]);
  const r = await f.request('DELETE', `/comments/${c.id}`, 'owner', {
    expectedVersion: c.version
  });
  assert.equal(r.status, 200);
  const payloads = JSON.stringify((await f.pool.query('SELECT payload FROM outbox')).rows);
  assert.equal(payloads.includes(secret), false);
  await processOutboxLease(f.pool);
  const inbox = await f.request('GET', '/notifications', 'manager');
  assert.equal((await inbox.text()).includes(secret), false);
});
test('lifecycle retention: recovery distinguishes two comment events on the same card and repeats neither', async t => {
  const f = await fixture(t);
  await f.post('First event');
  await f.post('Second event');
  // Exercise durable recovery intent independently of the normal transaction's direct inbox rows.
  await f.pool.query('DELETE FROM notifications');
  await processOutboxLease(f.pool, {
    batchSize: 50
  });
  const count = async () => Number((await f.pool.query('SELECT COUNT(*) AS n FROM notifications')).rows[0].n);
  assert.equal(await count(), 2);
  await f.pool.query("UPDATE outbox SET status='pending',next_retry_at=NOW() WHERE event_type='comment.created'");
  await processOutboxLease(f.pool, {
    batchSize: 50
  });
  assert.equal(await count(), 2);
});
async function waitForBlock(pool: pg.Pool, pid: number): Promise<number> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows[0];
    if (row) return Number(row.pid);
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('Expected real independent PostgreSQL connection to wait on held row.');
}
test('lifecycle retention: unreferenced column deletes once while final/active/restorable guards remain', async t => {
  const f = await fixture(t);
  const response = await f.removeColumn();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await f.pool.query("SELECT id FROM columns WHERE id='col' AND deleted_at IS NULL")).rowCount, 0);
  const last = await f.request('DELETE', `/boards/brd/columns/col2?expectedBoardVersion=${await f.version()}`);
  assert.equal(last.status, 400);
  await f.pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('extra','ws','prj','brd','Extra','#64748b','todo',1,NOW(),NOW())`);
  const active = await f.request('DELETE', `/boards/brd/columns/col2?expectedBoardVersion=${await f.version()}`);
  assert.equal(active.status, 409);
  assert.equal(((await active.json()) as any).error.code, 'COLUMN_HAS_ACTIVE_CARDS');
  await f.pool.query("UPDATE cards SET state='trashed',restore_until=NOW()+INTERVAL '1 hour' WHERE id='card'");
  const restorable = await f.request('DELETE', `/boards/brd/columns/col2?expectedBoardVersion=${await f.version()}`);
  assert.equal(restorable.status, 409);
  assert.equal(((await restorable.json()) as any).error.code, 'COLUMN_HAS_RESTORABLE_CARDS');
});
for (const first of ['create', 'delete'] as const) test(`lifecycle retention: concurrent column delete/card create ${first} wins without partial history`, async t => {
  const f = await fixture(t);
  const holder = await f.pool.connect();
  try {
    await holder.query('BEGIN');
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await holder.query("SELECT id FROM boards WHERE id='brd' FOR UPDATE");
    const version = await f.version();
    const create = () => f.request('POST', '/boards/brd/cards', 'owner', {
      title: 'Racing task',
      columnId: 'col',
      expectedBoardVersion: version
    });
    const remove = () => f.request('DELETE', `/boards/brd/columns/col?expectedBoardVersion=${version}`);
    const a = first === 'create' ? create() : remove();
    await waitForBlock(f.pool, pid);
    const b = first === 'create' ? remove() : create();
    await holder.query('COMMIT');
    const [winner, loser] = await Promise.all([a, b]);
    assert.equal(winner.status, first === 'create' ? 201 : 200, await winner.clone().text());
    assert.equal(loser.status, 409, await loser.clone().text());
    const cards = (await f.pool.query("SELECT id FROM cards WHERE title='Racing task'")).rowCount;
    assert.equal(cards, first === 'create' ? 1 : 0);
    assert.equal((await f.pool.query("SELECT id FROM columns WHERE id='col' AND deleted_at IS NULL")).rowCount, first === 'create' ? 1 : 0);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
});
test('lifecycle retention: delete winning comment lock does not deadlock with an in-flight outbox consumer or resurrect text', async t => {
  const f = await fixture(t);
  const secret = 'Consumer race private text';
  const c = await f.post(secret);
  await f.pool.query("UPDATE outbox SET payload=payload||jsonb_build_object('body',$2::text) WHERE payload->>'commentId'=$1", [c.id, secret]);
  const out = (await f.pool.query("SELECT id FROM outbox WHERE payload->>'commentId'=$1", [c.id])).rows[0].id;
  const holder = await f.pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM outbox WHERE id=$1 FOR UPDATE', [out]);
    const deletion = await f.request('DELETE', `/comments/${c.id}`, 'owner', {
      expectedVersion: c.version
    });
    assert.equal(deletion.status, 200, await deletion.clone().text());
    // Busy outbox claim was skipped, but its consumer must sanitize even a retry/quarantine path.
    await holder.query('COMMIT');
    await processOutboxLease(f.pool);
    const payload = JSON.stringify((await f.pool.query('SELECT payload FROM outbox WHERE id=$1', [out])).rows);
    assert.equal(payload.includes(secret), false);
    const inbox = await f.request('GET', '/notifications', 'manager');
    assert.equal((await inbox.text()).includes(secret), false);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
});
test('lifecycle retention: actual consumer holds source share lock and completes before waiting comment deletion', async t => {
  const f = await fixture(t);
  const c = await f.post('Consumer first private text');
  await f.pool.query('DELETE FROM notifications');
  const key = Number.parseInt(crypto.randomBytes(3).toString('hex'), 16);
  await f.pool.query(`CREATE FUNCTION pause_recovery_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW;END $$`);
  await f.pool.query('CREATE TRIGGER pause_recovery_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION pause_recovery_notification()');
  const holder = await f.pool.connect();
  try {
    await holder.query('BEGIN');
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await holder.query('SELECT pg_advisory_xact_lock($1)', [key]);
    const consuming = processOutboxLease(f.pool);
    const consumerPid = await waitForBlock(f.pool, pid);
    const deleting = f.request('DELETE', `/comments/${c.id}`, 'owner', {
      expectedVersion: c.version
    });
    await waitForBlock(f.pool, consumerPid);
    await holder.query('COMMIT');
    await consuming;
    const response = await deleting;
    assert.equal(response.status, 200, await response.clone().text());
    const notifications = (await f.pool.query('SELECT body,comment_id FROM notifications')).rows;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].comment_id, c.id);
    assert.equal(notifications[0].body, '[Comment deleted]');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
});
test('lifecycle retention: failed tombstone commit rolls back comment, inbox redaction, event and receipt', async t => {
  const f = await fixture(t);
  const secret = 'Must stay on failed delete';
  const c = await f.post(secret);
  const before = (await f.pool.query('SELECT COUNT(*)::int AS n FROM activity_log')).rows[0].n;
  await f.pool.query(`CREATE FUNCTION fail_tombstone_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'synthetic commit failure'; END IF;RETURN NEW;END $$`);
  await f.pool.query('CREATE CONSTRAINT TRIGGER fail_tombstone_commit AFTER UPDATE ON comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_tombstone_commit()');
  const r = await f.request('DELETE', `/comments/${c.id}`, 'owner', {
    expectedVersion: c.version
  });
  assert.equal(r.status, 500);
  assert.ok((await f.pool.query('SELECT body FROM comments WHERE id=$1', [c.id])).rows[0].body.includes(secret));
  assert.ok(JSON.stringify((await f.pool.query('SELECT body FROM notifications')).rows).includes(secret));
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM activity_log')).rows[0].n, before);
});
test('lifecycle retention: legacy migration redacts unknown sources honestly and preserves exact known source/recipient on rerun', async t => {
  const f = await fixture(t, true);
  const stamp = '2026-10-20T12:00:00.000Z';
  await f.pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,version,created_at,updated_at) VALUES('legacy_comment','ws','prj','card',$1,'Active legacy text',1,$2,$2)`, [f.actors.member!.user.id, stamp]);
  await f.pool.query(`INSERT INTO comment_mentions(id,comment_id,user_id,start_offset,end_offset,created_at) VALUES('legacy_span','legacy_comment',$1,0,5,$2)`, [f.actors.manager!.user.id, stamp]);
  await f.pool.query(`INSERT INTO notifications(id,workspace_id,project_id,card_id,user_id,type,title,body,link,read,created_at)
    VALUES('known','ws','prj','card',$1,'mention','Legacy','Known live copy','/card',TRUE,$2),
          ('unknown','ws','prj','card',$1,'mention','Legacy','Secret already deleted legacy copy','/card',FALSE,NOW())`, [f.actors.manager!.user.id, stamp]);
  await runMigrations(f.pool);
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../../../database/migrations/0023_comment_notification_sources.sql', import.meta.url), 'utf8');
  await f.pool.query(sql);
  const rows = (await f.pool.query('SELECT id,comment_id,body,read FROM notifications ORDER BY id')).rows;
  assert.equal(rows[0].id, 'known');
  assert.equal(rows[0].comment_id, 'legacy_comment');
  assert.equal(rows[0].read, true);
  assert.equal(rows[1].comment_id, null);
  assert.equal(rows[1].body.includes('Secret'), false);
  assert.equal(rows[1].read, false);
  await assert.rejects(f.pool.query(`INSERT INTO notifications(id,workspace_id,project_id,card_id,comment_id,user_id,type,title,body,link,read,created_at) VALUES('duplicate','ws','prj','card','legacy_comment',$1,'mention','x','x','x',FALSE,NOW())`, [f.actors.manager!.user.id]), {
    code: '23505'
  });
  await assert.rejects(f.pool.query(`INSERT INTO notifications(id,workspace_id,project_id,card_id,comment_id,user_id,type,title,body,link,read,created_at) VALUES('null_card','ws','prj',NULL,'legacy_comment',$1,'mention','x','x','x',FALSE,NOW())`, [f.actors.owner!.user.id]), {
    code: '23514'
  });
  await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('other_card','ws','prj','brd','col2','Other card','none',2000,'active',NOW(),NOW())`);
  await f.pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,created_at,updated_at) VALUES('other_comment','ws','prj','other_card',$1,'Other',NOW(),NOW())`, [f.actors.member!.user.id]);
  await assert.rejects(f.pool.query(`INSERT INTO notifications(id,workspace_id,project_id,card_id,comment_id,user_id,type,title,body,link,read,created_at) VALUES('wrong_source','ws','prj','card','other_comment',$1,'mention','x','x','x',FALSE,NOW())`, [f.actors.manager!.user.id]), {
    code: '23503'
  });
});
