import assert from 'node:assert/strict';
import test from 'node:test';
import { boardSnapshotResponseSchema } from '@flowboard/contracts';
import { hashSessionToken } from '../src/adapters/session.ts';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

test('private board snapshot authenticates before existence lookup; outsiders receive consistent no-data refusal', async t => {
  const f = await lifecycleFixture(t);
  await f.pool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [hashSessionToken(f.actors.viewer!.session.id)]);
  const original = f.pool.query;
  const queries: string[] = [];
  t.mock.method(f.pool, 'query', function (this: typeof f.pool, ...args: unknown[]) {
    if (typeof args[0] === 'string') queries.push(args[0]);
    return Reflect.apply(original, this, args);
  });
  for (const [actor, expected] of [['anonymous', 401], ['viewer', 401], ['outsider', 404]] as const) {
    const bodies = [];
    for (const id of ['brd', 'missing_board']) {
      const headers = actor === 'anonymous' ? {} : { cookie: `flowboard_session=${f.actors[actor]!.session.id}` };
      const r = await f.app.request(`http://localhost/api/v1/boards/${id}`, { headers });
      const body = await r.json() as any;
      assert.equal(r.status, expected); assert.equal(body.data, undefined);
      bodies.push({ status: r.status, code: body.error.code, message: body.error.message });
    }
    assert.deepEqual(bodies[0], bodies[1]);
    if (actor !== 'outsider') assert.equal(queries.some(sql => /FROM\s+boards\b/i.test(sql)), false, 'Unauthenticated requests must not inspect private board existence');
  }
  const owner = await f.request('GET', '/boards/brd', 'owner');
  assert.equal(owner.status, 200);
  assert.equal(boardSnapshotResponseSchema.parse(await owner.json()).data.board.id, 'brd');
});
