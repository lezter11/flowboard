import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestHarness } from 'wrangler';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

test('local workerd: shared HTTP routes, real pg/Kysely query and transaction rollback',
  { timeout: 60_000 }, async () => {
    // Do not accept remote DB URLs in this synthetic test suite.
    process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] =
      localDatabaseUrl(process.env['DATABASE_URL']);
    const harness = createTestHarness({ workers: [{ configPath: 'test/wrangler.jsonc' }] });
    try {
      await harness.listen();
      const worker = harness.getWorker('flowboard-api-test');
      for (const [path, status] of [['/health/live', 'ok'], ['/health/ready', 'ready']]) {
        const response = await worker.fetch(`http://localhost${path}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { data: { status } });
      }
      const response = await worker.fetch('http://localhost/__test/rollback');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { seenInside: 1, afterRollback: 0, afterCommit: 1 });
      const missing = await worker.fetch('http://localhost/api/v1/boards/not-implemented');
      assert.equal(missing.status, 404);
      assert.equal((await missing.json() as { error: { code: string } }).error.code, 'NOT_FOUND');
    } finally { await harness.close(); }
  });
