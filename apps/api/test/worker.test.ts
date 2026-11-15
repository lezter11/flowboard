import assert from 'node:assert/strict';
import { insertWorkspaceForUser } from './support/workspace-fixture.ts';
import crypto from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { getPool } from '../src/adapters/postgres.ts';
import worker from '../src/runtime/worker.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';

const configPath = fileURLToPath(new URL('wrangler.jsonc', import.meta.url));

test('Worker rejects plaintext before reading bindings, regardless of forwarded headers', async () => {
  const inaccessibleBindings = new Proxy({} as Parameters<typeof worker.fetch>[1], {
    get() { assert.fail('Insecure request read a Worker binding'); },
  });
  const request = new Request('http://localhost/api/v1/session', {
    headers: {
      authorization: 'Bearer synthetic-transport-test',
      cookie: 'flowboard_session=synthetic-transport-test',
      forwarded: 'proto=https',
      'x-forwarded-proto': 'https',
      'cf-visitor': '{"scheme":"https"}',
    },
  });
  const response = await worker.fetch(request, inaccessibleBindings);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), {
    error: { code: 'HTTPS_REQUIRED', message: 'Use HTTPS to access Flowboard.' },
  });
});

test('local workerd: shared HTTP routes, real pg/Kysely query, transaction rollback, and authenticated product routes',
  { timeout: 60_000 }, async () => {
    // Ensure migrations are applied to the local test database
    const setupPool = getPool();
    await runMigrations(setupPool);

    const runId = crypto.randomUUID().slice(0, 8);
    const testEmail = `worker-r4-${runId}@flowboard.example`;
    const wsKey = `idemp-worker-r4-ws-${runId}`;
    const prjKey = `idemp-worker-r4-prj-${runId}`;

    // Do not accept remote DB URLs in this synthetic test suite.
    process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] =
      localDatabaseUrl(process.env['DATABASE_URL']);
    const harness = createTestHarness({ workers: [{ configPath }] });
    try {
      await harness.listen();
      const worker = harness.getWorker('flowboard-api-test');

      const insecure = await worker.fetch('http://flowboard-app-uat.pages.dev/api/v1/session', {
        headers: { authorization: 'Bearer synthetic-transport-test', 'x-forwarded-proto': 'https' },
      });
      assert.equal(insecure.status, 400);
      assert.equal(((await insecure.json()) as { error: { code: string } }).error.code, 'HTTPS_REQUIRED');

      // 1. Health and readiness probes through the scheme and URL supplied by Pages.
      for (const [path, status] of [['/health/live', 'ok'], ['/health/ready', 'ready']]) {
        const response = await worker.fetch(`https://flowboard-app-uat.pages.dev${path}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { data: { status } });
      }

      // 2. Transaction rollback probe
      const rollbackResponse = await worker.fetch('https://localhost/__test/rollback');
      assert.equal(rollbackResponse.status, 200);
      assert.deepEqual(await rollbackResponse.json(), { seenInside: 1, afterRollback: 0, afterCommit: 1 });

      // 3. 404 handling
      const missing = await worker.fetch('https://localhost/api/v1/not-implemented');
      assert.equal(missing.status, 404);
      assert.equal(((await missing.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
      const privateBoard = await worker.fetch('https://localhost/api/v1/boards/not-implemented');
      assert.equal(privateBoard.status, 401);
      assert.equal(((await privateBoard.json()) as { error: { code: string } }).error.code, 'UNAUTHORIZED');

      // 4. Unauthenticated product routes reject with 401 UNAUTHORIZED
      const unauthSession = await worker.fetch('https://localhost/api/v1/session');
      assert.equal(unauthSession.status, 401);
      const unauthSessionBody = (await unauthSession.json()) as { error: { code: string } };
      assert.equal(unauthSessionBody.error.code, 'UNAUTHORIZED');

      const unauthWorkspaces = await worker.fetch('https://localhost/api/v1/workspaces');
      assert.equal(unauthWorkspaces.status, 401);

      // 5. The deployed Worker entry point cannot issue email-only sessions.
      const loginRes = await worker.fetch('https://localhost/api/v1/session/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-secret': 'flowboard-dev-secret',
        },
        body: JSON.stringify({
          email: testEmail,
          displayName: 'Worker R4 User',
        }),
      });
      assert.equal(loginRes.status, 404);

      // Seed a synthetic session directly in the disposable test database so
      // the mounted Worker can still prove authenticated route behavior.
      const seeded = await createDevUserAndSession(testEmail, 'Worker R4 User', setupPool);
      const sessionCookie = `flowboard_session=${seeded.session.id}`;
      const userId = seeded.user.id;

      // 6. Authenticated GET /api/v1/session via Worker
      const sessionRes = await worker.fetch('https://localhost/api/v1/session', {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(sessionRes.status, 200);
      const sessionData = (await sessionRes.json()) as {
        data: {
          actor: { id: string; email: string };
          ownedWorkspaces: Array<{ id: string; name: string }>;
          accessibleProjects: unknown[];
        };
      };
      assert.equal(sessionData.data.actor.id, userId);
      assert.equal(sessionData.data.actor.email, testEmail);
      assert.ok(Array.isArray(sessionData.data.ownedWorkspaces));

      // 7. B-20: POST /api/v1/workspaces is retired. Authenticated callers get 410 through the Worker.
      const retiredWsRes = await worker.fetch('https://localhost/api/v1/workspaces', {
        method: 'POST',
        headers: { Cookie: sessionCookie, 'Content-Type': 'application/json', 'Idempotency-Key': wsKey },
        body: JSON.stringify({ name: 'Worker R4 Cloud Workspace', timezone: 'America/New_York' }),
      });
      assert.equal(retiredWsRes.status, 410);
      assert.equal(((await retiredWsRes.json()) as { error: { code: string } }).error.code, 'WORKSPACE_CREATE_RETIRED');

      // 8. The personal workspace is inserted by the fixture; the Worker lists it in step 9.
      const fixtureWs = await insertWorkspaceForUser(userId, { name: 'Worker R4 Cloud Workspace', timezone: 'America/New_York' });
      const workspaceId = fixtureWs.id;

      // 9. Authenticated GET /api/v1/workspaces via Worker lists the workspace
      const listWsRes = await worker.fetch('https://localhost/api/v1/workspaces', {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(listWsRes.status, 200);
      const listWsBody = (await listWsRes.json()) as {
        data: Array<{ id: string; name: string; ownerId: string }>;
      };
      const foundWs = listWsBody.data.find((w) => w.id === workspaceId);
      assert.ok(foundWs, 'Expected created workspace to be listed');
      assert.equal(foundWs.name, 'Worker R4 Cloud Workspace');
      assert.equal(foundWs.ownerId, userId);

      // 10. Authenticated project creation & listing via Worker
      const createPrjRes = await worker.fetch(`https://localhost/api/v1/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': prjKey,
        },
        body: JSON.stringify({
          name: 'Worker Database Pipeline',
          description: 'Verified through Worker runtime',
        }),
      });
      assert.equal(createPrjRes.status, 201);
      const prjBody = (await createPrjRes.json()) as {
        data: { id: string; name: string; workspaceId: string };
      };
      assert.equal(prjBody.data.name, 'Worker Database Pipeline');
      assert.equal(prjBody.data.workspaceId, workspaceId);

      const listPrjRes = await worker.fetch('https://localhost/api/v1/projects', {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(listPrjRes.status, 200);
      const listPrjBody = (await listPrjRes.json()) as {
        data: Array<{ id: string; name: string }>;
      };
      const foundPrj = listPrjBody.data.find((p) => p.id === prjBody.data.id);
      assert.ok(foundPrj, 'Expected created project in accessible projects');

      // 11. Authenticated POST /api/v1/session/logout via Worker revokes session in DB
      const logoutRes = await worker.fetch('https://localhost/api/v1/session/logout', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
      });
      assert.equal(logoutRes.status, 204);

      // 12. Subsequent request with revoked cookie returns 401 UNAUTHORIZED
      const postRevokeRes = await worker.fetch('https://localhost/api/v1/session', {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(postRevokeRes.status, 401);

    } finally {
      await harness.close();
    }
  });

test('local workerd: Google account linking uses native requests and refuses provider redirects', { timeout: 30_000 }, async () => {
  const setupPool = getPool();
  await runMigrations(setupPool);
  const connection = localDatabaseUrl(process.env['DATABASE_URL']);
  process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] = connection;
  const origin = 'https://flowboard-app-uat.pages.dev';
  const auth = origin + '/api/v1/auth/google';
  const harness = createTestHarness({ workers: [{ configPath, vars: {
    GOOGLE_CLIENT_ID: 'synthetic-worker-client', GOOGLE_CLIENT_SECRET: 'synthetic-worker-secret',
    GOOGLE_REDIRECT_URI: auth + '/callback', FRONTEND_URL: origin, CORS_ORIGIN: origin,
  } }] });
  try {
    await harness.listen();
    const runtime = harness.getWorker('flowboard-api-test');
    const id = crypto.randomUUID().replaceAll('-', '');
    const fixture = await createDevUserAndSession(`worker-google-${id}@flowboard.example`, 'Synthetic Worker', setupPool);
    const oldSession = `flowboard_session=${fixture.session.id}`;
    async function callback(mode: string) {
      const start = await runtime.fetch(auth + '/link', { method: 'POST', headers: { Origin: origin, Cookie: oldSession } });
      assert.equal(start.status, 200);
      const { data } = await start.json() as { data: { authorizationUrl: string } };
      const state = new URL(data.authorizationUrl).searchParams.get('state')!;
      const attemptCookie = start.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-flowboard_oauth_link='))?.split(';')[0];
      assert.ok(attemptCookie);
      return runtime.fetch(auth + '/callback?' + new URLSearchParams({ state, code: `${mode}-${id}` }), {
        redirect: 'manual', headers: { Cookie: `${oldSession}; ${attemptCookie}` },
      });
    }
    for (const [mode, code] of [['token-redirect', 'TOKEN_EXCHANGE_FAILED'], ['profile-redirect', 'USERINFO_FAILED']] as const) {
      harness.clearLogs();
      const result = await callback(mode);
      assert.equal(result.status, 302);
      assert.equal(result.headers.get('location'), origin + '/settings?tab=account&google=failed');
      assert.ok(!result.headers.getSetCookie().some(cookie => cookie.startsWith('flowboard_session=')));
      assert.ok(JSON.stringify(harness.getLogs()).includes(code), `Provider redirect must fail at ${code}`);
      assert.equal((await setupPool.query('SELECT google_subject FROM users WHERE id = $1', [fixture.user.id])).rows[0].google_subject, null);
    }
    const linked = await callback('success');
    assert.equal(linked.status, 302);
    assert.equal(linked.headers.get('location'), origin + '/settings?tab=account&google=linked');
    const session = linked.headers.getSetCookie().find(cookie => cookie.startsWith('flowboard_session='))?.split(';')[0];
    assert.ok(session);
    const me = await runtime.fetch(origin + '/api/v1/session', { headers: { Cookie: session } });
    assert.equal(me.status, 200);
    const { data } = await me.json() as { data: { actor: { id: string }; googleAccountStatus: string } };
    assert.equal(data.actor.id, fixture.user.id);
    assert.equal(data.googleAccountStatus, 'linked');
  } finally {
    await harness.close();
  }
});

test('local workerd: scheduled callback runs purge and outbox jobs against the isolated DB binding',
  { timeout: 30_000 }, async () => {
    const setupPool = getPool();
    await runMigrations(setupPool);
    // The API suites intentionally create malformed and expired trash rows to
    // exercise failure paths. Give the scheduled-worker check a clean synthetic
    // database so it verifies the callback itself, not another suite's fixtures.
    await setupPool.query('TRUNCATE workspaces CASCADE');
    // B-14: the scheduled retention job deletes a row that settled over 30 days ago, and keeps a recent one.
    await setupPool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('usr_wkr','wkr@flowboard.example','W',now(),now())`);
    await setupPool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('ws_wkr','WS','UTC','usr_wkr',now(),now())`);
    await setupPool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p_wkr','ws_wkr','P',now(),now())`);
    await setupPool.query(`INSERT INTO outbox (id,workspace_id,project_id,event_type,payload,status,next_retry_at,created_at,settled_at) VALUES
      ('out_old','ws_wkr','p_wkr','invitation.created','{"providerMessageId":"m"}','delivered',now(),now() - interval '40 days',now() - interval '31 days'),
      ('out_new','ws_wkr','p_wkr','invitation.created','{"providerMessageId":"m"}','delivered',now(),now(),now() - interval '2 days')`);
    // A deployed Worker always has the IMAGES bucket bound; an empty fake stands in for it here.
    const emptyBucket = { put: async () => undefined, get: async () => null, delete: async () => undefined };
    await worker.scheduled(
      { scheduledTime: Date.now() },
      { HYPERDRIVE: { connectionString: localDatabaseUrl(process.env['DATABASE_URL']) }, IMAGES: emptyBucket },
    );
    const kept = await setupPool.query<{ id: string }>('SELECT id FROM outbox ORDER BY id');
    assert.deepEqual(kept.rows.map((r) => r.id), ['out_new'], 'the 40-day-old settled row was purged by the scheduled job');
  });
