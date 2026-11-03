import path from 'node:path';
import os from 'node:os';
import { importTestDatabaseUrl } from './support/import-database.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { workbook, type Row } from './support/import-workbook.ts';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { MemoryStorageDriver, runWithStorageDriver } from '../src/adapters/storage.ts';

// These tests catch lost normalized fields, duplicate card effects after separately accepted
// previews, stale target/recipient authorization and copied preview content surviving cleanup.
// Test-only synthetic connection; never uses the primary harness or environment DATABASE_URL.
const connectionString = importTestDatabaseUrl();
const origin = 'http://localhost';
async function fixture(t: TestContext, legacy = false) {
  const schema = 'import_repair_' + crypto.randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({
    connectionString,
    max: 1
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString,
    max: 12,
    options: `-c search_path=${schema}`
  });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  if (legacy) {
    const fs = await import('node:fs/promises');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-import-migrations-'));
    t.after(() => fs.rm(dir, {
      recursive: true,
      force: true
    }));
    const source = new URL('../../../database/migrations/', import.meta.url);
    for (const file of await fs.readdir(source)) {
      if (/^\d{4}_.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 20) {
        await fs.copyFile(new URL(file, source), `${dir}/${file}`);
      }
    }
    await runMigrations(pool, {
      migrationsDir: dir
    });
  } else await runMigrations(pool);
  const owner = await createDevUserAndSession('import-owner@flowboard.example', 'Import Owner', pool);
  const member = await createDevUserAndSession('import-member@flowboard.example', 'Import Member', pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','Imports','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','Imports',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships(id,workspace_id,project_id,user_id,role,status,created_at,updated_at) VALUES('pm','ws','prj',$1,'member','active',NOW(),NOW())`, [member.user.id]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','Imports',NOW(),NOW())`);
  for (const [id, name, pos] of [['col', 'Todo', 0], ['col2', 'Done', 1]] as const) {
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES($1,'ws','prj','brd',$2,'#64748b','todo',$3,NOW(),NOW())`, [id, name, pos]);
  }
  const app = createApp(async () => {}, {
    pool,
    rateLimiter: () => ({
      limit: async () => ({
        success: true
      })
    }),
    windowCounter: () => ({
      consume: async () => ({
        count: 1,
        retryAfterSeconds: 60
      })
    })
  });
  const headers = (json = true) => ({
    cookie: `flowboard_session=${owner.session.id}`,
    origin,
    'idempotency-key': crypto.randomUUID(),
    'content-type': json ? 'application/json' : 'application/octet-stream'
  });
  const preview = async (rows: Row[], opts: Parameters<typeof workbook>[1] = {}) => {
    const response = await app.request(origin + '/api/v1/boards/brd/imports?defaultColumnId=col', {
      method: 'POST',
      headers: headers(false),
      body: new Uint8Array(workbook(rows, opts)).buffer
    });
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as any).data;
  };
  const commit = (p: any, extra: object = {}) => app.request(origin + `/api/v1/imports/${p.id}/commit`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      expectedVersion: p.version,
      previewDigest: p.previewDigest,
      defaultColumnId: p.defaultColumnId,
      ...extra
    })
  });
  const request = (path: string, method = 'GET', body?: object) => app.request(origin + '/api/v1' + path, {
    method,
    headers: headers(),
    ...(body ? {
      body: JSON.stringify(body)
    } : {})
  });
  return {
    pool,
    app,
    owner,
    member,
    headers,
    preview,
    commit,
    request,
    schema
  };
}
test('import repair: description survives mapping and commit; original row reimport skips after card edit', async t => {
  const f = await fixture(t);
  const row = {
    externalId: '001',
    title: 'Imported',
    description: 'Original\nUnicode सादा',
    status: 'Unmapped'
  };
  const p = await f.preview([row]);
  assert.equal(p.state, 'invalid');
  const mapped = await f.request(`/imports/${p.id}/mappings`, 'POST', {
    expectedVersion: p.version,
    mappings: {
      Unmapped: 'col'
    }
  });
  assert.equal(mapped.status, 200);
  const ready = ((await mapped.json()) as any).data;
  const result = await f.commit(ready);
  assert.equal(result.status, 200, await result.clone().text());
  const card = (await f.pool.query('SELECT id,description FROM cards')).rows[0];
  assert.equal(card.description, 'Original\nUnicode सादा');
  await f.pool.query("UPDATE cards SET title='Edited later',description='New description' WHERE id=$1", [card.id]);
  const again = await f.preview([row]);
  assert.equal(again.counts.existing, 1);
  assert.equal(again.counts.conflict, 0);
  const changed = await f.preview([{
    ...row,
    description: 'Different original'
  }]);
  assert.equal(changed.counts.conflict, 1);
});
test('import repair: two separately ready identical previews create one card under concurrent mounted confirmation', async t => {
  const f = await fixture(t);
  const row = {
    externalId: 'same',
    title: 'Exactly once'
  };
  const a = await f.preview([row]),
    b = await f.preview([row]);
  const res = await Promise.all([f.commit(a), f.commit(b)]);
  for (const r of res) assert.equal(r.status, 200, await r.clone().text());
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM cards')).rows[0].n), 1);
  assert.equal(Number((await f.pool.query("SELECT COUNT(*) AS n FROM activity_log WHERE action='card_created'")).rows[0].n), 1);
});
test('import repair: changed duplicate in a separately ready preview rolls back its whole batch', async t => {
  const f = await fixture(t);
  const a = await f.preview([{
    externalId: 'same',
    title: 'Original'
  }]);
  const b = await f.preview([{
    externalId: 'other',
    title: 'Must not partly save'
  }, {
    externalId: 'same',
    title: 'Changed'
  }]);
  assert.equal((await f.commit(a)).status, 200);
  const denied = await f.commit(b);
  assert.equal(denied.status, 409, await denied.clone().text());
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM cards')).rows[0].n), 1);
});
test('import repair: project member without target board grant is ineligible at preview and revocation invalidates ready preview', async t => {
  const f = await fixture(t);
  const row = {
    externalId: 'person',
    title: 'Assigned',
    assignees: 'import-member@flowboard.example'
  };
  const denied = await f.preview([row]);
  assert.equal(denied.counts.invalid, 1);
  await f.pool.query("INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)", [f.member.user.id, f.owner.user.id]);
  const ready = await f.preview([row]);
  assert.equal(ready.state, 'ready');
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1', [f.member.user.id]);
  const res = await f.commit(ready);
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM cards')).rows[0].n), 0);
});
test('import repair: commit cannot override preview default column and stale board structure rejects confirmation', async t => {
  const f = await fixture(t);
  const p = await f.preview([{
    externalId: 'target',
    title: 'Bound target'
  }]);
  const override = await f.commit(p, {
    defaultColumnId: 'col2'
  });
  assert.equal(override.status, 409, await override.clone().text());
  await f.pool.query("UPDATE boards SET structure_version=structure_version+1 WHERE id='brd'");
  const stale = await f.commit(p);
  assert.equal(stale.status, 409, await stale.clone().text());
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM cards')).rows[0].n), 0);
});
test('import repair: generic numeric date rejected while Excel date style and1904/ISO are accepted', async t => {
  const f = await fixture(t);
  const numeric = await f.preview([{
    externalId: 'numeric',
    title: 'Not a date',
    dueDate: 45000
  }]);
  assert.equal(numeric.counts.invalid, 1);
  const styled = await f.preview([{
    externalId: 'styled',
    title: 'Genuine date',
    dueDate: 45000
  }], {
    dateStyle: true
  });
  assert.equal(styled.rows[0].dueDate, '2023-03-15');
  const old = await f.preview([{
    externalId: 'old',
    title: '1904',
    dueDate: 43538
  }], {
    dateStyle: true,
    date1904: true
  });
  assert.equal(old.rows[0].dueDate, '2023-03-15');
  const iso = await f.preview([{
    externalId: 'iso',
    title: 'ISO',
    dueDate: '2024-02-29'
  }]);
  assert.equal(iso.rows[0].dueDate, '2024-02-29');
});
test('import repair: cancel and expired status remove staged titles/emails and prevent commit', async t => {
  const f = await fixture(t);
  const row = {
    externalId: 'private',
    title: 'Private staged title',
    description: 'Private staged description',
    assignees: 'import-owner@flowboard.example'
  };
  const p = await f.preview([row]);
  assert.equal((await f.request(`/imports/${p.id}`, 'DELETE')).status, 200);
  const stored = (await f.pool.query('SELECT title,assignee_emails FROM card_import_rows WHERE import_id=$1', [p.id])).rows[0];
  assert.equal(stored.title, '');
  assert.equal(stored.assignee_emails, null);
  const exp = await f.preview([{
    ...row,
    externalId: 'expired'
  }]);
  await f.pool.query("UPDATE card_imports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exp.id]);
  assert.equal((await f.request(`/imports/${exp.id}`)).status, 200);
  assert.equal((await f.pool.query('SELECT title FROM card_import_rows WHERE import_id=$1', [exp.id])).rows[0].title, '');
  assert.equal((await f.commit(exp)).status, 410);
});
test('import repair: purge removes imported card title/email copies but keeps duplicate identity', async t => {
  const f = await fixture(t);
  const p = await f.preview([{
    externalId: 'purged',
    title: 'Purge me',
    assignees: 'import-owner@flowboard.example'
  }]);
  assert.equal((await f.commit(p)).status, 200);
  await f.pool.query("UPDATE cards SET state='trashed',deleted_by=$1,deleted_at=NOW()-INTERVAL '25 hours',restore_until=NOW()-INTERVAL '1 hour'", [f.owner.user.id]);
  await runWithStorageDriver(new MemoryStorageDriver(), () => purgeExpiredTrash(f.pool));
  const row = (await f.pool.query('SELECT title,assignee_emails FROM card_import_rows WHERE import_id=$1', [p.id])).rows[0];
  assert.equal(row.title, '');
  assert.equal(row.assignee_emails, null);
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM card_import_duplicates')).rows[0].n), 1);
});
async function blockedBy(pool: pg.Pool, holderPid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const waiting = await pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [holderPid]);
    if (waiting.rowCount) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('Expected independent PostgreSQL connection to wait on held lock.');
}
test('import repair: target membership revocation winning its lock makes a concurrent mounted confirmation stale', async t => {
  const f = await fixture(t);
  await f.pool.query("INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)", [f.member.user.id, f.owner.user.id]);
  const p = await f.preview([{
    externalId: 'race',
    title: 'Race',
    assignees: 'import-member@flowboard.example'
  }]);
  const revoke = await f.pool.connect();
  try {
    await revoke.query('BEGIN');
    const pid = (await revoke.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await revoke.query("UPDATE project_memberships SET role='viewer' WHERE user_id=$1", [f.member.user.id]);
    const pending = f.commit(p);
    await blockedBy(f.pool, pid);
    await revoke.query('COMMIT');
    const res = await pending;
    assert.equal(res.status, 409, await res.clone().text());
    assert.equal((await f.pool.query('SELECT id FROM cards')).rowCount, 0);
  } finally {
    await revoke.query('ROLLBACK');
    revoke.release();
  }
});
test('import repair: confirmation holding recipient locks commits before waiting revocation with no deadlock', async t => {
  const f = await fixture(t);
  await f.pool.query("INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)", [f.member.user.id, f.owner.user.id]);
  const p = await f.preview([{
    externalId: 'write-first',
    title: 'Write first',
    assignees: 'import-member@flowboard.example'
  }]);
  const blocker = await f.pool.connect(),
    revoke = await f.pool.connect();
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query("SELECT id FROM boards WHERE id='brd' FOR UPDATE");
    const pending = f.commit(p);
    await blockedBy(f.pool, pid);
    await revoke.query('BEGIN');
    const revokePid = (await revoke.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const removing = revoke.query("UPDATE project_memberships SET role='viewer' WHERE user_id=$1", [f.member.user.id]);
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const r = await f.pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [revokePid]);
      if (r.rows[0].blocked) {
        blocked = true;
        break;
      }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(blocked, true, 'Revocation waits for confirmation recipient guard.');
    await blocker.query('COMMIT');
    const res = await pending;
    assert.equal(res.status, 200, await res.clone().text());
    await removing;
    await revoke.query('COMMIT');
    assert.equal((await f.pool.query('SELECT card_id FROM card_assignees WHERE user_id=$1', [f.member.user.id])).rowCount, 1);
  } finally {
    await blocker.query('ROLLBACK');
    await revoke.query('ROLLBACK');
    blocker.release();
    revoke.release();
  }
});
test('import repair: scheduled retention is bounded, repeatable, and preserves live previews/results/duplicate markers', async t => {
  const f = await fixture(t);
  const {
    cleanupExpiredImports
  } = await import('../src/services/import-retention.ts');
  const expired = await f.preview([{
    externalId: 'expires',
    title: 'Private expired'
  }]);
  const committed = await f.preview([{
    externalId: 'committed',
    title: 'Private committed',
    description: 'Private description'
  }]);
  assert.equal((await f.commit(committed)).status, 200);
  const live = await f.preview([{
    externalId: 'live',
    title: 'Keep live'
  }]);
  await f.pool.query("UPDATE card_imports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.id]);
  await f.pool.query("UPDATE card_imports SET cleanup_after=NOW()-INTERVAL '1 second' WHERE id=$1", [committed.id]);
  assert.equal((await cleanupExpiredImports(f.pool, {
    batchSize: 1
  })).cleanedCount, 1);
  assert.equal((await cleanupExpiredImports(f.pool, {
    batchSize: 1
  })).cleanedCount, 1);
  assert.equal((await cleanupExpiredImports(f.pool)).cleanedCount, 0);
  const rows = (await f.pool.query('SELECT import_id,title,description,assignee_emails FROM card_import_rows')).rows;
  assert.equal(rows.find(r => r.import_id === live.id).title, 'Keep live');
  for (const id of [expired.id, committed.id]) {
    const r = rows.find(r => r.import_id === id);
    assert.equal(r.title, '');
    assert.equal(r.description, null);
    assert.equal(r.assignee_emails, null);
  }
  const result = await f.request(`/imports/${committed.id}`);
  assert.equal(result.status, 200);
  assert.equal(((await result.json()) as any).data.counts.created, 1);
  assert.equal((await f.pool.query('SELECT external_id FROM card_import_duplicates')).rows[0].external_id, 'committed');
});
test('import repair: failure on final card insert rolls back all cards, external markers, activity and receipt', async t => {
  const f = await fixture(t);
  const p = await f.preview([{
    externalId: 'first',
    title: 'First'
  }, {
    externalId: 'last',
    title: 'Fail final'
  }]);
  await f.pool.query(`CREATE FUNCTION fail_final_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Fail final' THEN RAISE EXCEPTION 'synthetic final-row failure'; END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER fail_final_import BEFORE INSERT ON cards FOR EACH ROW EXECUTE FUNCTION fail_final_import()');
  const before = (await f.pool.query('SELECT COUNT(*)::int AS n FROM activity_log')).rows[0].n;
  const res = await f.commit(p);
  assert.equal(res.status, 500);
  for (const table of ['cards', 'idempotency_receipts']) assert.equal((await f.pool.query(`SELECT id FROM ${table}`)).rowCount, 0);
  assert.equal((await f.pool.query('SELECT external_id FROM card_import_duplicates')).rowCount, 0);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM activity_log')).rows[0].n, before);
});
test('import repair: migration0021 upgrades old previews conservatively and reruns without changing saved cards/markers', async t => {
  const f = await fixture(t, true);
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../../../database/migrations/0021_import_payload_retention.sql', import.meta.url), 'utf8');
  await f.pool.query(`INSERT INTO card_imports(id,workspace_id,project_id,board_id,default_column_id,uploader_id,state,expires_at,created_at,updated_at)
    VALUES('legacy','ws','prj','brd','col',$1,'ready',NOW()+INTERVAL '1 day',NOW(),NOW())`, [f.owner.user.id]);
  await f.pool.query(`INSERT INTO card_import_rows(id,import_id,row_number,external_id,title,assignee_emails,outcome,created_at)
    VALUES('legacy_row','legacy',2,'0001','Unrecoverable legacy title',ARRAY['import-owner@flowboard.example'],'new',NOW())`);
  await runMigrations(f.pool);
  await f.pool.query(sql);
  await f.pool.query(sql);
  assert.equal((await f.pool.query("SELECT state FROM card_imports WHERE id='legacy'")).rows[0].state, 'expired');
  const {
    cleanupExpiredImports
  } = await import('../src/services/import-retention.ts');
  // PostgreSQL timestamps retain microseconds; JavaScript Date rounds to milliseconds.
  // Use a deliberate database-clock cutoff after migration, without a timing race.
  const cleanupClock = (await f.pool.query("SELECT NOW()+INTERVAL '1 second' AS cutoff")).rows[0].cutoff;
  assert.equal((await cleanupExpiredImports(f.pool, { asOfDate: new Date(cleanupClock) })).cleanedCount, 1);
  assert.equal((await f.pool.query("SELECT title FROM card_import_rows WHERE id='legacy_row'")).rows[0].title, '');
  const real = await f.preview([{
    externalId: 'current',
    title: 'Current',
    description: '  preserve whitespace  '
  }]);
  await f.pool.query(sql);
  assert.equal((await f.pool.query('SELECT state FROM card_imports WHERE id=$1', [real.id])).rows[0].state, 'ready');
  assert.equal((await f.commit(real)).status, 200);
  assert.equal((await f.pool.query("SELECT description FROM cards WHERE title='Current'")).rows[0].description, '  preserve whitespace  ');
  const repeat = await f.preview([{
    externalId: 'current',
    title: 'Current',
    description: '  preserve whitespace  '
  }]);
  assert.equal(repeat.counts.existing, 1);
});
test('import repair: actual Worker scheduled entry cleans expired previews without a browser request', async t => {
  const f = await fixture(t);
  const p = await f.preview([{
    externalId: 'scheduled',
    title: 'Scheduled private title'
  }]);
  await f.pool.query("UPDATE card_imports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [p.id]);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${f.schema}`);
  const worker = (await import('../src/runtime/worker.ts')).default;
  await worker.scheduled({}, {
    HYPERDRIVE: {
      connectionString: url.toString()
    },
    IMAGES: {
      put: async () => {
        throw new Error('Unexpected image write');
      },
      get: async () => null,
      delete: async () => {}
    }
  });
  assert.equal((await f.pool.query('SELECT title FROM card_import_rows WHERE import_id=$1', [p.id])).rows[0].title, '');
  assert.equal((await f.pool.query('SELECT state FROM card_imports WHERE id=$1', [p.id])).rows[0].state, 'expired');
});
test('import repair: an unknown source mapping preserves original description/hash and literal inline strings parse', async t => {
  const f = await fixture(t);
  const p = await f.preview([{
    externalId: 'mapped',
    title: 'Mapped title',
    description: 'Description to preview',
    status: 'Needs mapping'
  }]);
  assert.equal(p.rows[0].description, 'Description to preview');
  const mapped = await f.request(`/imports/${p.id}/mappings`, 'POST', {
    expectedVersion: 1,
    mappings: {
      'Needs mapping': 'col2'
    }
  });
  assert.equal(mapped.status, 200);
  const ready = ((await mapped.json()) as any).data;
  assert.equal(ready.rows[0].description, 'Description to preview');
  assert.equal((await f.commit(ready)).status, 200);
  const same = await f.preview([{
    externalId: 'mapped',
    title: 'Mapped title',
    description: 'Description to preview',
    status: 'Needs mapping'
  }]);
  assert.equal(same.counts.existing, 1);
  const literal = await f.preview([{
    externalId: 'inline',
    title: 'Inline title',
    description: 'Inline literal'
  }], {
    inlineStrings: true
  });
  assert.equal(literal.rows[0].description, 'Inline literal');
  assert.equal((await f.commit(literal)).status, 200);
});
