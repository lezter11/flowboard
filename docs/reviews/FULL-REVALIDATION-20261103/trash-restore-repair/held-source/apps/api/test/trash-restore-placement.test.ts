import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';

type Fixture = Awaited<ReturnType<typeof lifecycleFixture>>;
async function call(f: Fixture, method: string, path: string, body?: object, actor = 'owner', key?: string) {
  const response = await f.request(method, path, actor, body, key);
  assert.ok(response.ok, await response.clone().text());
  return (await response.json() as any).data;
}
const create = async (f: Fixture, title: string, columnId = 'col') => call(f, 'POST', '/boards/brd/cards', { title, description: 'Retained restore content', priority: 'high', columnId, expectedBoardVersion: await f.version() });
const remove = async (f: Fixture, card: any) => call(f, 'POST', `/cards/${card.id}/delete`, { expectedVersion: card.version, expectedBoardVersion: await f.version() });
const ordered = async (f: Fixture, column = 'col') => (await f.pool.query("SELECT id,position::text,version FROM cards WHERE column_id=$1 AND state='active' ORDER BY cards.position,cards.id", [column])).rows;
const restore = async (f: Fixture, card: any, extras = {}) => call(f, 'POST', `/cards/${card.id}/restore`, { expectedVersion: card.version, expectedBoardVersion: await f.version(), ...extras });

// Catches the observed append-after-compaction bug using only mounted create/delete/move operations.
test('restore retains nearest surviving gap after normal moves exhaust rank spacing', async t => {
  const f = await lifecycleFixture(t);
  const target = await create(f, 'Restore nearest gap', 'col2');
  const right = await create(f, 'Right anchor', 'col2');
  const deleted = await remove(f, target);
  let nextId = right.id;
  for (let n = 0; n < 10; n++) {
    const card = await create(f, `Dense gap ${n}`, 'col2');
    await call(f, 'POST', `/cards/${card.id}/move`, { toColumnId: 'col2', previousCardId: 'card', nextCardId: nextId, expectedVersion: card.version, expectedBoardVersion: await f.version() });
    nextId = card.id;
  }
  const before = await ordered(f, 'col2');
  assert.deepEqual(before.slice(0, 2).map(c => c.position), ['1000', '1001']);
  const boardBefore = await f.version();
  const result = await restore(f, deleted);
  const after = await ordered(f, 'col2');
  assert.deepEqual(after.map(c => c.id), [before[0]!.id, target.id, ...before.slice(1).map(c => c.id)]);
  assert.equal(result.id, target.id);
  assert.equal(result.version, deleted.version + 1);
  assert.equal(result.description, 'Retained restore content');
  assert.equal(result.state, 'active');
  assert.equal(result.restoreUntil, null);
  assert.equal(await f.version(), boardBefore + 1);
  assert.deepEqual(after.filter(c => c.id !== target.id).map(c => c.version), before.map(c => c.version));
});

for (const mode of ['both', 'previous-only', 'next-only', 'neither', 'head', 'tail', 'empty'] as const) test(`restore placement control: ${mode}`, async t => {
  const f = await lifecycleFixture(t);
  const first = await create(f, 'First');
  const middle = await create(f, 'Middle');
  const last = await create(f, 'Last');
  const target = mode === 'head' ? first : mode === 'tail' ? last : middle;
  const deleted = await remove(f, target);
  if (mode === 'previous-only' || mode === 'neither' || mode === 'empty') await remove(f, last);
  if (mode === 'next-only' || mode === 'neither' || mode === 'empty') await remove(f, first);
  let expected: string[];
  if (mode === 'neither') {
    const x = await create(f, 'New first');
    const y = await create(f, 'New second');
    const z = await create(f, 'New third');
    expected = [x.id, target.id, y.id, z.id];
  } else if (mode === 'empty') expected = [target.id];
  else expected = mode === 'previous-only' ? [first.id, target.id] : mode === 'next-only' ? [target.id, last.id] : [first.id, middle.id, last.id];
  await restore(f, deleted);
  assert.deepEqual((await ordered(f)).map(c => c.id), expected);
});

test('restore preserves head insertion when normal moves exhaust the first rank', async t => {
  const f = await lifecycleFixture(t);
  const target = await create(f, 'Head');
  const right = await create(f, 'Surviving next anchor');
  const deleted = await remove(f, target);
  let next = right.id;
  for (let n = 0; n < 9; n++) {
    const card = await create(f, `New head ${n}`);
    await call(f, 'POST', `/cards/${card.id}/move`, { toColumnId: 'col', previousCardId: null, nextCardId: next, expectedVersion: card.version, expectedBoardVersion: await f.version() });
    next = card.id;
  }
  await call(f, 'POST', `/cards/${right.id}/move`, { toColumnId: 'col', previousCardId: null, nextCardId: next, expectedVersion: right.version, expectedBoardVersion: await f.version() });
  const before = await ordered(f);
  assert.equal(before[0]!.id, right.id);
  assert.equal(before[0]!.position, '1');
  const result = await restore(f, deleted);
  const after = await ordered(f);
  assert.equal(after[0]!.id, result.id);
  assert.deepEqual(after.filter(c => c.id !== result.id).map(c => c.id), before.map(c => c.id));
  assert.ok(new Set(after.map(c => c.position)).size === after.length);
});

test('restore replay is exactly once and stale/forbidden requests leave order and events unchanged', async t => {
  const f = await lifecycleFixture(t);
  const card = await create(f, 'Once');
  const deleted = await remove(f, card);
  const body = { expectedVersion: deleted.version, expectedBoardVersion: await f.version() };
  const before = await f.version();
  for (const actor of ['member', 'viewer', 'outsider']) {
    const r = await f.request('POST', `/cards/${card.id}/restore`, actor, body);
    assert.equal(r.status, actor === 'outsider' ? 404 : 403, await r.clone().text());
  }
  for (const wrong of [{ ...body, expectedVersion: body.expectedVersion - 1 }, { ...body, expectedBoardVersion: body.expectedBoardVersion - 1 }]) {
    const r = await f.request('POST', `/cards/${card.id}/restore`, 'owner', wrong);
    assert.equal(r.status, 409);
    assert.equal((await r.json() as any).error.code, 'STALE_VERSION');
  }
  assert.equal(await f.version(), before);
  const key = crypto.randomUUID();
  const [a, b] = await Promise.all([f.request('POST', `/cards/${card.id}/restore`, 'manager', body, key), f.request('POST', `/cards/${card.id}/restore`, 'manager', body, key)]);
  assert.equal(a.status, 200, await a.clone().text());
  assert.equal(b.status, 200, await b.clone().text());
  assert.equal([(await a.json() as any).replayed, (await b.json() as any).replayed].filter(Boolean).length, 1);
  assert.equal(await f.version(), before + 1);
  assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id=$1 AND action='card_restored'", [card.id])).rowCount, 1);
});

async function legacyDestination(f: Fixture) {
  const card = await create(f, 'Legacy same card');
  const deleted = await remove(f, card);
  // This represents existing legacy data; ordinary retirement remains guarded.
  // Only our random schema's retirement trigger is suspended, and only for setup.
  await f.pool.query('ALTER TABLE columns DISABLE TRIGGER columns_retirement_guard');
  try { await f.pool.query("UPDATE columns SET deleted_at=NOW() WHERE id='col'"); }
  finally { await f.pool.query('ALTER TABLE columns ENABLE TRIGGER columns_retirement_guard'); }
  return deleted;
}

test('legacy missing destination requires explicit active same-board choice and retains the same card content', async t => {
  const f = await lifecycleFixture(t);
  const deleted = await legacyDestination(f);
  const rows = await call(f, 'GET', '/projects/prj/trash');
  const row = rows.find((r: any) => r.id === deleted.id);
  assert.equal(row.canRestore, false);
  assert.equal(row.blockedReason, 'destination_missing');
  const missing = await f.request('POST', `/cards/${deleted.id}/restore`, 'manager', { expectedVersion: deleted.version, expectedBoardVersion: await f.version() });
  assert.equal(missing.status, 409);
  const problem = (await missing.json() as any).error;
  assert.equal(problem.code, 'RESTORE_DESTINATION_REQUIRED');
  assert.deepEqual(problem.details.columns.map((c: any) => c.id), ['col2']);
  await f.pool.query("INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('foreign_board','ws','prj','Other board',NOW(),NOW())");
  await f.pool.query("INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('foreign_column','ws','prj','foreign_board','Foreign','#64748b','todo',0,NOW(),NOW())");
  for (const toColumnId of ['col', 'foreign_column', 'does-not-exist']) {
    const refused = await f.request('POST', `/cards/${deleted.id}/restore`, 'manager', { expectedVersion: deleted.version, expectedBoardVersion: await f.version(), toColumnId });
    assert.equal(refused.status, 400, await refused.clone().text());
    assert.equal((await refused.json() as any).error.code, 'INVALID_DESTINATION');
  }
  const result = await restore(f, deleted, { toColumnId: 'col2' });
  assert.equal(result.id, deleted.id);
  assert.equal(result.title, 'Legacy same card');
  assert.equal(result.description, 'Retained restore content');
  assert.equal(result.priority, 'high');
  assert.equal(result.columnId, 'col2');
  assert.equal(result.state, 'active');
  assert.equal((await f.pool.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='columns'::regclass AND tgname='columns_retirement_guard'")).rows[0].tgenabled, 'O');
  const guarded = await f.request('DELETE', `/boards/brd/columns/col2?expectedBoardVersion=${await f.version()}`);
  assert.equal(guarded.status, 400); // final active column still cannot be retired
});

for (const context of ['project', 'board', 'revoked'] as const) test(`legacy destination cannot bypass ${context} context`, async t => {
  const f = await lifecycleFixture(t);
  const deleted = await legacyDestination(f);
  if (context === 'project') await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='prj'");
  if (context === 'board') await f.pool.query("UPDATE boards SET archived=TRUE WHERE id='brd'");
  if (context === 'revoked') await f.pool.query("DELETE FROM board_grants WHERE user_id=$1", [f.actors.manager!.user.id]);
  const response = await f.request('POST', `/cards/${deleted.id}/restore`, 'manager', { expectedVersion: deleted.version, expectedBoardVersion: await f.version(), toColumnId: 'col2' });
  assert.equal(response.status, context === 'revoked' ? 404 : 409, await response.clone().text());
  const rows = await call(f, 'GET', '/projects/prj/trash', undefined, 'manager');
  if (context === 'revoked') assert.equal(rows.some((r: any) => r.id === deleted.id), false);
  else assert.equal(rows.find((r: any) => r.id === deleted.id).blockedReason, `${context}_archived`);
  assert.equal((await f.pool.query('SELECT state FROM cards WHERE id=$1', [deleted.id])).rows[0].state, 'trashed');
});

for (const offset of [-1, 0] as const) test(`restore exact cutoff control at deadline ${offset}ms`, async t => {
  const f = await lifecycleFixture(t);
  const deleted = await legacyDestination(f);
  const cutoff = Date.now() + 60_000;
  await f.pool.query('UPDATE cards SET restore_until=$2 WHERE id=$1', [deleted.id, new Date(cutoff)]);
  t.mock.timers.enable({ apis: ['Date'], now: cutoff + offset });
  try {
    const response = await f.request('POST', `/cards/${deleted.id}/restore`, 'owner', { expectedVersion: deleted.version, expectedBoardVersion: await f.version(), toColumnId: 'col2' });
    assert.equal(response.status, offset < 0 ? 200 : 410, await response.clone().text());
    if (offset === 0) {
      const error = (await response.json() as any).error;
      assert.equal(error.code, 'RESTORE_WINDOW_EXPIRED');
      assert.equal(error.details.serverNow, error.details.restoreUntil);
      const rows = await call(f, 'GET', '/projects/prj/trash');
      assert.equal(rows.find((r: any) => r.id === deleted.id).blockedReason, 'window_expired');
    }
  } finally { t.mock.timers.reset(); }
});

async function waitForBlock(f: Fixture, holderPid: number) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const blocked = (await f.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [holderPid])).rows[0];
    if (blocked) return Number(blocked.pid);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Real independent PostgreSQL connection never reached the held lock');
}

for (const winner of ['restore', 'purge'] as const) test(`real mounted restore and purge overlap: ${winner} wins the card lock`, async t => {
  const f = await lifecycleFixture(t);
  const storage = new MemoryStorageDriver();
  setStorageDriver(storage);
  t.after(() => setStorageDriver(null));
  const card = await create(f, 'Race content');
  const mention = '@' + f.actors.manager!.user.displayName;
  const comment = await call(f, 'POST', `/cards/${card.id}/comments`, { body: `Race private comment ${mention}`, mentions: [{ userId: f.actors.manager!.user.id, start: 21, end: 21 + mention.length }] }, 'member');
  // A cleanup-only legacy finalized-object sentinel, not image-upload validation evidence.
  const storageKey = `synthetic-restore-race/${card.id}/cleanup-sentinel`;
  const bytes = new Uint8Array([1]);
  await storage.put(storageKey, bytes, 'image/png');
  await f.pool.query("INSERT INTO card_images(id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,created_at,updated_at) VALUES('race_image','ws','prj',$1,$2,'cleanup-sentinel.png',1,'image/png',$3,$4,NOW(),NOW())", [card.id, f.actors.owner!.user.id, storageKey, crypto.createHash('sha256').update(bytes).digest('hex')]);
  const deleted = await remove(f, card);
  const key = Number.parseInt(crypto.randomBytes(3).toString('hex'), 16);
  await f.pool.query(`CREATE FUNCTION pause_card_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state='trashed' AND NEW.state='${winner === 'restore' ? 'active' : 'purged'}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER pause_card_transition BEFORE UPDATE OF state ON cards FOR EACH ROW EXECUTE FUNCTION pause_card_transition()');
  const holder = await f.pool.connect();
  try {
    await holder.query('BEGIN');
    const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await holder.query('SELECT pg_advisory_xact_lock($1)', [key]);
    const body = { expectedVersion: deleted.version, expectedBoardVersion: await f.version() };
    const restoreKey = crypto.randomUUID();
    const doRestore = () => f.request('POST', `/cards/${deleted.id}/restore`, 'owner', body, restoreKey);
    // A future asOfDate makes the purge eligible while restore's actual clock is still before its deadline.
    const doPurge = () => purgeExpiredTrash(f.pool, { asOfDate: new Date(Date.now() + 48 * 3_600_000) });
    if (winner === 'restore') {
      const restoring = doRestore();
      await waitForBlock(f, pid);
      const purge = await doPurge();
      assert.equal(purge.purgedCardIds.includes(deleted.id), false);
      await holder.query('COMMIT');
      const response = await restoring;
      assert.equal(response.status, 200, await response.clone().text());
    } else {
      const purging = doPurge();
      const purgePid = await waitForBlock(f, pid);
      const restoring = doRestore();
      const restorePid = await waitForBlock(f, purgePid);
      console.log('purge-first wait graph', JSON.stringify((await f.pool.query('SELECT pid,wait_event,pg_blocking_pids(pid) AS blockers,query FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() ORDER BY pid', [f.schema])).rows));
      await holder.query('COMMIT');
      await waitForBlock(f, restorePid);
      console.log('purge-first actual cycle', JSON.stringify((await f.pool.query('SELECT pid,wait_event,pg_blocking_pids(pid) AS blockers,query FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() ORDER BY pid', [f.schema])).rows));
      assert.equal((await purging).purgedCardIds.includes(deleted.id), true);
      const response = await restoring;
      // 40P01/40001 is deliberately mapped to a safe retryable503. Verify the
      // losing transaction has no effect, then replay the ORIGINAL command/key.
      assert.equal(response.status, 503, await response.clone().text());
      const failure = (await response.json() as any).error;
      assert.equal(failure.code, 'SERVICE_UNAVAILABLE');
      assert.equal(failure.message, 'The request conflicted with another update. Retry shortly.');
      assert.equal(response.headers.get('retry-after'), '1');
      assert.equal((await f.pool.query('SELECT id FROM idempotency_receipts WHERE idempotency_key=$1', [restoreKey])).rowCount, 0);
      const retry = await doRestore();
      assert.equal(retry.status, 404, await retry.clone().text());
      assert.equal((await retry.json() as any).error.code, 'NOT_FOUND');
      assert.equal((await f.pool.query('SELECT id FROM idempotency_receipts WHERE idempotency_key=$1', [restoreKey])).rowCount, 0);
      console.log('purge-first recovery', JSON.stringify({ firstStatus: response.status, firstError: failure.code, firstMessage: failure.message, retryStatus: retry.status, identicalCommandAndKey: true, losingRestoreReceipts: 0 }));
    }
    const stored = (await f.pool.query('SELECT state,title,description FROM cards WHERE id=$1', [deleted.id])).rows[0];
    assert.equal(stored.state, winner === 'restore' ? 'active' : 'purged');
    assert.equal(stored.title, winner === 'restore' ? 'Race content' : '[Purged card]');
    assert.equal(stored.description, winner === 'restore' ? 'Retained restore content' : null);
    assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id=$1 AND action='card_restored'", [deleted.id])).rowCount, winner === 'restore' ? 1 : 0);
    assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id=$1 AND action='card_purged'", [deleted.id])).rowCount, winner === 'purge' ? 1 : 0);
    assert.equal((await f.pool.query('SELECT body FROM comments WHERE id=$1', [comment.id])).rows[0].body, winner === 'purge' ? '' : `Race private comment ${mention}`);
    const notifications = (await f.pool.query('SELECT body,link FROM notifications WHERE card_id=$1', [deleted.id])).rows;
    assert.equal(notifications.length, 1);
    if (winner === 'purge') assert.deepEqual(notifications, [{ body: '[Card content purged]', link: '#' }]);
    else assert.ok(notifications[0].body.includes('Race private comment'));
    assert.equal((await f.pool.query('SELECT id FROM card_images WHERE card_id=$1', [deleted.id])).rowCount, winner === 'purge' ? 0 : 1);
    assert.equal(await storage.get(storageKey) === null, winner === 'purge');
    const repeatedPurge = await doPurge();
    assert.equal(repeatedPurge.purgedCardIds.includes(deleted.id), false);
  } finally { await holder.query('ROLLBACK'); holder.release(); }
});

test('failed restore commit rolls back compaction, lifecycle, board version, receipt and activity together', async t => {
  const f = await lifecycleFixture(t);
  const target = await create(f, 'Atomic restore', 'col2');
  let nextId = (await create(f, 'Atomic right anchor', 'col2')).id;
  const deleted = await remove(f, target);
  for (let n = 0; n < 10; n++) {
    const card = await create(f, `Atomic dense gap ${n}`, 'col2');
    await call(f, 'POST', `/cards/${card.id}/move`, { toColumnId: 'col2', previousCardId: 'card', nextCardId: nextId, expectedVersion: card.version, expectedBoardVersion: await f.version() });
    nextId = card.id;
  }
  const before = await ordered(f, 'col2');
  assert.deepEqual(before.slice(0, 2).map(c => c.position), ['1000', '1001']);
  const board = (await f.pool.query("SELECT structure_version,snapshot_version FROM boards WHERE id='brd'")).rows[0];
  const receipts = Number((await f.pool.query('SELECT COUNT(*)::int AS n FROM idempotency_receipts')).rows[0].n);
  await f.pool.query(`CREATE FUNCTION fail_restore_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state='trashed' AND NEW.state='active' THEN RAISE EXCEPTION 'synthetic restore commit failure'; END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE CONSTRAINT TRIGGER fail_restore_commit AFTER UPDATE ON cards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_restore_commit()');
  const key = crypto.randomUUID();
  const body = { expectedVersion: deleted.version, expectedBoardVersion: await f.version() };
  const response = await f.request('POST', `/cards/${deleted.id}/restore`, 'owner', body, key);
  assert.equal(response.status, 500);
  assert.deepEqual(await ordered(f, 'col2'), before);
  assert.deepEqual((await f.pool.query("SELECT structure_version,snapshot_version FROM boards WHERE id='brd'")).rows[0], board);
  assert.equal((await f.pool.query('SELECT state,version FROM cards WHERE id=$1', [deleted.id])).rows[0].state, 'trashed');
  assert.equal((await f.pool.query('SELECT state,version FROM cards WHERE id=$1', [deleted.id])).rows[0].version, deleted.version);
  assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id=$1 AND action='card_restored'", [deleted.id])).rowCount, 0);
  assert.equal(Number((await f.pool.query('SELECT COUNT(*)::int AS n FROM idempotency_receipts')).rows[0].n), receipts);
  await f.pool.query('DROP TRIGGER fail_restore_commit ON cards');
  const retry = await f.request('POST', `/cards/${deleted.id}/restore`, 'owner', body, key);
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.deepEqual((await ordered(f, 'col2')).map(c => c.id), [before[0]!.id, deleted.id, ...before.slice(1).map(c => c.id)]);
});
