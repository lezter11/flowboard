import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { workbook } from './support/import-workbook.ts';

for (const changed of [{ priority: 'not-a-priority' }, { dueDate: '2026-02-31' }, { externalId: 1 }]) {
  test(`matching import marker preserves malformed source errors: ${JSON.stringify(changed)}`, async t => {
    const f = await lifecycleFixture(t);
    const original = { externalId: '1', title: 'Stable original title' };
    const preview = async (rows: unknown[]) => {
      // Deliberately includes an XLSX numeric-ID cell for the negative case.
      const bytes = Reflect.apply(workbook, undefined, [rows]);
      const r = await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2', {
        method: 'POST', headers: { cookie: `flowboard_session=${f.actors.owner!.session.id}`, origin: 'http://localhost', 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer,
      });
      assert.equal(r.status, 201);
      return (await r.json() as any).data;
    };
    const commit = (p: any) => f.request('POST', `/imports/${p.id}/commit`, 'owner', { expectedVersion: p.version, previewDigest: p.previewDigest, defaultColumnId: 'col2' });
    const first = await preview([original]);
    assert.equal((await commit(first)).status, 200);
    const before = await f.pool.query('SELECT id,title,version FROM cards ORDER BY id');
    const mixed = await preview([{ ...original, ...changed }, { externalId: 'new-row', title: 'Must not create alongside malformed input' }]);
    assert.equal(mixed.state, 'invalid');
    assert.equal(mixed.rows[0].outcome, 'invalid');
    assert.ok(mixed.rows[0].errors.length > 0);
    assert.equal(mixed.canCommit, false);
    assert.equal((await commit(mixed)).status, 409);
    assert.deepEqual((await f.pool.query('SELECT id,title,version FROM cards ORDER BY id')).rows, before.rows);
  });
}

test('matching import markers cannot hide duplicate IDs within the same workbook', async t => {
  const f = await lifecycleFixture(t);
  const row = { externalId: 'same', title: 'Previously imported' };
  const preview = async (rows: Parameters<typeof workbook>[0]) => {
    const r = await f.app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col2', { method: 'POST', headers: { cookie: `flowboard_session=${f.actors.owner!.session.id}`, origin: 'http://localhost', 'content-type': 'application/octet-stream' }, body: new Uint8Array(workbook(rows)).buffer });
    assert.equal(r.status, 201); return (await r.json() as any).data;
  };
  const p = await preview([row]);
  assert.equal((await f.request('POST', `/imports/${p.id}/commit`, 'owner', { expectedVersion: p.version, previewDigest: p.previewDigest, defaultColumnId: 'col2' })).status, 200);
  const duplicate = await preview([row, row]);
  assert.equal(duplicate.state, 'invalid');
  assert.equal(duplicate.rows[0].outcome, 'already_imported');
  assert.equal(duplicate.rows[1].outcome, 'invalid');
  assert.ok(duplicate.rows[1].errors.some((e: any) => e.code === 'DUPLICATE_IN_BATCH'));
});
