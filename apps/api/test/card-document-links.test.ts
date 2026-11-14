import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.deepEqual(migrated.applied, [{ version: '0029', name: '0029_card_document_links.sql' }]);
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
