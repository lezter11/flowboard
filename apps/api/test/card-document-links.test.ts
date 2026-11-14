import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { MemoryStorageDriver, runWithStorageDriver } from '../src/adapters/storage.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPersonalAccessToken } from '../src/adapters/tokens.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

const path = '/cards/card';
const links = [
  { title: 'Synthetic budget', url: 'https://docs.google.com/spreadsheets/d/FakeBudget/edit?usp=sharing#gid=1' },
  { title: 'Synthetic agreement', url: 'https://drive.google.com/file/d/FakeAgreement/view?resourcekey=0-fakeKey&usp=drive_link' },
];
const data = async (response: Response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return (await response.json() as { data: Record<string, unknown> }).data;
};

test('Drive links migrate independently, follow card access, save atomically and keep receipts private', async t => {
  const f = await lifecycleFixture(t, 27);
  const migrated = await runMigrations(f.pool);
  assert.deepEqual(migrated.applied[0], { version: '0029', name: '0029_card_document_links.sql' });
  assert.deepEqual((await runMigrations(f.pool)).applied, []);
  assert.deepEqual((await data(await f.request('GET', path, 'viewer'))).documentLinks, []);
  const initialVersion = Number((await data(await f.request('GET', path))).version);

  for (const [actor,status] of [['viewer',403],['outsider',404]] as const) {
    assert.equal((await f.request('PATCH', path, actor, { expectedVersion: initialVersion, documentLinks: links })).status, status);
  }
  assert.equal((await f.request('PATCH', path, 'member', { expectedVersion: initialVersion, documentLinks: [{ title: 'Invalid', url: 'javascript:alert(1)' }] })).status, 422);

  const request = { expectedVersion: initialVersion, documentLinks: links };
  const crossSite = await f.app.request('http://localhost/api/v1' + path, {
    method: 'PATCH',
    headers: {
      cookie: `flowboard_session=${f.actors.member!.session.id}`,
      origin: 'https://untrusted.test',
      'content-type': 'application/json',
      'idempotency-key': 'synthetic-cross-site-key',
    },
    body: JSON.stringify(request),
  });
  assert.equal(crossSite.status, 403);
  const mutations = await Promise.all([
    f.request('PATCH', path, 'member', request, 'test-links-save-key'),
    f.request('PATCH', path, 'member', request, 'test-links-save-key'),
  ]);
  assert.ok(mutations.every(response => response.status === 200));
  const outcomes = await Promise.all(mutations.map(async response => await response.json() as {data: Record<string, unknown>; replayed?: boolean }));
  const original = outcomes.find(outcome => !outcome.replayed);
  const replay = outcomes.find(outcome => outcome.replayed);
  assert.deepEqual(original?.data.documentLinks, links);
  assert.equal(replay?.data.version, initialVersion + 1);
  assert.equal(Object.hasOwn(replay!.data, 'documentLinks'), false);
  assert.equal((await f.request('PATCH', path, 'member', { expectedVersion: initialVersion + 1, documentLinks: [] }, 'test-links-save-key')).status, 409);
  assert.equal((await f.request('PATCH', path, 'manager', request)).status, 409);
  assert.deepEqual((await data(await f.request('GET', path, 'viewer'))).documentLinks, links);

  const receipt = await f.pool.query('SELECT response_body FROM idempotency_receipts WHERE idempotency_key=$1', ['test-links-save-key']);
  const log = await f.pool.query("SELECT safe_changes FROM activity_log WHERE card_id='card' AND action='card_updated'");
  assert.deepEqual(log.rows.map(row => row.safe_changes), [{ documentLinks: { old: 0, new: 2 } }]);
  assert.equal(JSON.stringify(receipt.rows).includes('FakeAgreement'), false);
  assert.equal(JSON.stringify(receipt.rows).includes('Synthetic budget'), false);

  const pat = await createPersonalAccessToken(f.pool, { userId: f.actors.owner!.user.id, name: 'Link exposure check', scopes: ['cards:read'], projectId: 'prj' });
  const bearer = { authorization: `Bearer ${pat.token}` };
  const tokenCard = await data(await f.app.request('http://localhost/api/v1' + path, { headers: bearer }));
  assert.equal(tokenCard.id, 'card');
  assert.equal(Object.hasOwn(tokenCard, 'documentLinks'), false);
  assert.equal((await f.app.request('http://localhost/api/v1' + path, { method: 'PATCH', headers: bearer })).status, 403);
  await f.pool.query("UPDATE boards SET archived=TRUE WHERE id='brd'");
  assert.deepEqual((await data(await f.request('GET', path, 'viewer'))).documentLinks, links);
  assert.equal((await f.request('PATCH', path, 'member', { expectedVersion: initialVersion + 1, documentLinks: [] })).status, 409);
  await f.pool.query("UPDATE boards SET archived=FALSE WHERE id='brd'");
  await f.pool.query("DELETE FROM board_grants WHERE board_id='brd' AND user_id=$1", [f.actors.member!.user.id]);
  assert.equal((await f.request('GET', path, 'member')).status, 404);
  assert.equal((await f.request('PATCH', path, 'member', request, 'test-links-save-key')).status, 404);

  const edited = await data(await f.request('PATCH', path, 'manager', { expectedVersion: initialVersion + 1, title: 'Renamed card' }));
  assert.deepEqual(edited.documentLinks, links);
  const cleared = await data(await f.request('PATCH', path, 'owner', { expectedVersion: edited.version as number, documentLinks: [] }));
  assert.deepEqual(cleared.documentLinks, []);
  assert.deepEqual((await data(await f.request('GET', path, 'viewer'))).documentLinks, []);

  for (const invalid of [{}, Array.from({ length: 11 }, () => links[0])]) {
    await assert.rejects(f.pool.query("UPDATE cards SET document_links=$1::JSONB WHERE id='card'", [JSON.stringify(invalid)]), { code: '23514' });
  }
});

test('Drive links remain across moves and restore and are wiped on final purge', async t => {
  const f = await lifecycleFixture(t);
  const initial = await data(await f.request('GET', path));
  const saved = await data(await f.request('PATCH', path, 'owner', { expectedVersion: initial.version as number, documentLinks: links }));
  const moved = await data(await f.request('POST', path + '/move', 'owner', {
    toColumnId: 'col', previousCardId: null, nextCardId: null, expectedVersion: saved.version as number, expectedBoardVersion: await f.version(),
  }));
  assert.equal(Object.hasOwn(moved, 'documentLinks'), false);
  assert.deepEqual((await data(await f.request('GET', path))).documentLinks, links);
  const deleted = await data(await f.request('POST', path + '/delete', 'owner', {
    expectedVersion: moved.version as number, expectedBoardVersion: await f.version(),
  }));
  assert.equal(Object.hasOwn(deleted, 'documentLinks'), false);
  assert.equal((await f.request('GET', path, 'viewer')).status, 404);
  const restored = await data(await f.request('POST', path + '/restore', 'owner', {
    expectedVersion: deleted.version as number, expectedBoardVersion: await f.version(),
  }));
  assert.equal(Object.hasOwn(restored, 'documentLinks'), false);
  assert.deepEqual((await data(await f.request('GET', path, 'viewer'))).documentLinks, links);

  await data(await f.request('POST', path + '/delete', 'owner', {
    expectedVersion: restored.version as number, expectedBoardVersion: await f.version(),
  }));
  const result = await runWithStorageDriver(new MemoryStorageDriver(), () =>
    purgeExpiredTrash(f.pool, { asOfDate: new Date(Date.now() + 48 * 3_600_000) }),
  );
  assert.deepEqual(result.purgedCardIds, ['card']);
  assert.deepEqual((await f.pool.query("SELECT state, document_links FROM cards WHERE id='card'")).rows, [{ state: 'purged', document_links: [] }]);
  await assert.rejects(f.pool.query("UPDATE cards SET document_links=$1::JSONB WHERE id='card'", [JSON.stringify(links)]), { code: '23514' });
});


async function waitForBlockedQuery(
  fixture: Awaited<ReturnType<typeof lifecycleFixture>>,
  blockerPid: number,
): Promise<number> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = await fixture.pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))`,
      [fixture.schema, blockerPid],
    );
    if (result.rows[0]) return result.rows[0].pid;
    await delay(10);
  }
  assert.fail(`Expected a PostgreSQL query blocked by backend ${blockerPid}`);
}

test('mounted card detail holds the board grant through response assembly', async t => {
  const f = await lifecycleFixture(t);
  await data(await f.request('PATCH', path, 'owner', { expectedVersion: 1, documentLinks: links }));
  const blocker = await f.pool.connect();
  let read: Promise<Response> | undefined;
  let revoke: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    // Card creator is read after the other detail fields have been assembled.
    await blocker.query('LOCK TABLE activity_log IN ACCESS EXCLUSIVE MODE');
    read = Promise.resolve(f.request('GET', path, 'member'));
    const readerPid = await waitForBlockedQuery(f, blockerPid);

    const member = f.actors.member!.user.id;
    revoke = Promise.resolve(f.request('DELETE', `/boards/brd/grants/${member}`, 'owner', { expectedAccessRevision: '1' }));
    await waitForBlockedQuery(f, readerPid);

    await blocker.query('COMMIT');
    assert.deepEqual((await data(await read)).documentLinks, links);
    assert.equal((await data(await revoke)).changed, true);
    assert.equal((await f.request('GET', path, 'member')).status, 404);
  } finally {
    await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    await Promise.allSettled([read, revoke]);
  }
});

test('mounted card detail reads current links when new access follows link removal', async t => {
  const f = await lifecycleFixture(t);
  const member = f.actors.member!.user.id;
  await data(await f.request('PATCH', path, 'owner', { expectedVersion: 1, documentLinks: links }));
  assert.equal((await data(await f.request('DELETE', `/boards/brd/grants/${member}`, 'owner', { expectedAccessRevision: '1' }))).changed, true);
  const blocker = await f.pool.connect();
  let read: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await blocker.query('LOCK TABLE board_grants IN ACCESS EXCLUSIVE MODE');
    read = Promise.resolve(f.request('GET', path, 'member'));
    // The original handler fetched the old link by the time it encountered this lock.
    await waitForBlockedQuery(f, blockerPid);

    await blocker.query("UPDATE cards SET document_links = '[]'::jsonb WHERE id = 'card'");
    await blocker.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
       VALUES ('brd', 'prj', 'ws', $1, $2)`,
      [member, f.actors.owner!.user.id],
    );
    await blocker.query('COMMIT');
    assert.deepEqual((await data(await read)).documentLinks, []);
    assert.deepEqual((await data(await f.request('GET', path, 'member'))).documentLinks, []);
  } finally {
    await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    await Promise.allSettled([read]);
  }
});

test('mounted card detail waits for a preceding revocation and returns the concealed 404', async t => {
  const f = await lifecycleFixture(t);
  await data(await f.request('PATCH', path, 'owner', { expectedVersion: 1, documentLinks: links }));
  const revoker = await f.pool.connect();
  let read: Promise<Response> | undefined;
  try {
    await revoker.query('BEGIN');
    const revokerPid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await revoker.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', ['brd', f.actors.member!.user.id]);
    read = Promise.resolve(f.request('GET', path, 'member'));
    await waitForBlockedQuery(f, revokerPid);

    await revoker.query('COMMIT');
    const result = await read;
    const missing = await f.request('GET', '/cards/missing', 'member');
    assert.equal(result.status, 404);
    assert.equal(missing.status, 404);
    const parseError = async (response: Response) => {
      const { error } = await response.json() as { error: { code: string; message: string; requestId: string } };
      assert.ok(error.requestId);
      return { code: error.code, message: error.message };
    };
    assert.deepEqual(await parseError(result), await parseError(missing));
  } finally {
    await revoker.query('ROLLBACK').catch(() => {});
    revoker.release();
    await Promise.allSettled([read]);
  }
});
