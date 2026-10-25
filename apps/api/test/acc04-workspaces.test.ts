import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { workspaceSchema, workspaceListResponseSchema } from '@flowboard/contracts';

test('ACC-04: Create workspace and owner & Idempotency Replay Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceUserId = 'usr_alice_acc04';
  let aliceCookie = '';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships CASCADE;');

      // Seed Alice user
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [aliceUserId, 'alice.owner@flowboard.example', 'Alice Owner', null],
      );

      // Create session for Alice
      const session = await createSession(aliceUserId, 24, client);
      aliceCookie = `flowboard_session=${session.id}`;
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  const validKey = 'idem_key_ws_create_001_test';
  let createdWorkspaceId = '';

  await t.test('1. Unauthenticated requests to /api/v1/workspaces return 401 UNAUTHORIZED', async () => {
    const postRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': validKey,
      },
      body: JSON.stringify({ name: 'Acme Corp', timezone: 'UTC' }),
    });
    assert.equal(postRes.status, 401);
    const postBody = await postRes.json();
    assert.equal(postBody.error.code, 'UNAUTHORIZED');

    const getRes = await app.request('/api/v1/workspaces');
    assert.equal(getRes.status, 401);
    const getBody = await getRes.json();
    assert.equal(getBody.error.code, 'UNAUTHORIZED');
  });

  await t.test('2. Missing or invalid Idempotency-Key header returns 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    // Missing header
    const missingRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({ name: 'Acme Corp', timezone: 'UTC' }),
    });
    assert.equal(missingRes.status, 400);
    const missingBody = await missingRes.json();
    assert.equal(missingBody.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    // Too short header (< 16 chars)
    const shortRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'short_key_123',
      },
      body: JSON.stringify({ name: 'Acme Corp', timezone: 'UTC' }),
    });
    assert.equal(shortRes.status, 400);
    const shortBody = await shortRes.json();
    assert.equal(shortBody.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  await t.test('3. Validation error on invalid body (empty name or invalid timezone) returns 422', async () => {
    const emptyNameRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'idem_key_validation_001',
      },
      body: JSON.stringify({ name: '', timezone: 'UTC' }),
    });
    assert.equal(emptyNameRes.status, 422);
    const emptyNameBody = await emptyNameRes.json();
    assert.equal(emptyNameBody.error.code, 'VALIDATION_ERROR');

    const emptyTzRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'idem_key_validation_002',
      },
      body: JSON.stringify({ name: 'Valid Name', timezone: '' }),
    });
    assert.equal(emptyTzRes.status, 422);
    const emptyTzBody = await emptyTzRes.json();
    assert.equal(emptyTzBody.error.code, 'VALIDATION_ERROR');
  });

  await t.test('4. Workspace creation succeeds and sets owner_id = actor.id', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': validKey,
      },
      body: JSON.stringify({ name: 'Acme Global', timezone: 'America/New_York' }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.replayed, false);

    const parsed = workspaceSchema.parse(body.data);
    assert.ok(parsed.id.startsWith('ws_'));
    assert.equal(parsed.name, 'Acme Global');
    assert.equal(parsed.timezone, 'America/New_York');
    assert.equal(parsed.ownerId, aliceUserId);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.createdAt.endsWith('Z'));
    assert.ok(parsed.updatedAt.endsWith('Z'));

    createdWorkspaceId = parsed.id;

    // Verify in DB directly
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT * FROM workspaces WHERE id = $1', [createdWorkspaceId]);
      assert.equal(q.rows.length, 1);
      assert.equal(q.rows[0].owner_id, aliceUserId);
      assert.equal(q.rows[0].name, 'Acme Global');
      assert.equal(q.rows[0].timezone, 'America/New_York');

      // Verify idempotency receipt in DB
      const rcp = await client.query(
        'SELECT * FROM idempotency_receipts WHERE actor_id = $1 AND idempotency_key = $2',
        [aliceUserId, validKey],
      );
      assert.equal(rcp.rows.length, 1);
      assert.equal(rcp.rows[0].status_code, 201);
      assert.equal(rcp.rows[0].scope_type, 'actor');
      assert.equal(rcp.rows[0].scope_id, aliceUserId);
    } finally {
      client.release();
    }
  });

  await t.test('5. Idempotency replay: same key + same payload returns replayed: true and no duplicate workspace', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': validKey,
      },
      body: JSON.stringify({ name: 'Acme Global', timezone: 'America/New_York' }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.replayed, true);
    assert.equal(body.data.id, createdWorkspaceId);
    assert.equal(body.data.name, 'Acme Global');
    assert.equal(body.data.ownerId, aliceUserId);

    // Verify row count in DB is still 1
    const client = await pool.connect();
    try {
      const countRes = await client.query(
        'SELECT COUNT(*)::integer AS count FROM workspaces WHERE owner_id = $1',
        [aliceUserId],
      );
      assert.equal(countRes.rows[0].count, 1);
    } finally {
      client.release();
    }
  });

  await t.test('6. Idempotency conflict: same key + different payload returns 409 IDEMPOTENCY_CONFLICT', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': validKey,
      },
      body: JSON.stringify({ name: 'Different Corporation', timezone: 'America/New_York' }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.match(body.error.message, /Idempotency key collision/);
  });

  await t.test('7. GET /api/v1/workspaces lists owned workspace', async () => {
    const res = await app.request('/api/v1/workspaces', {
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const parsed = workspaceListResponseSchema.parse(body);

    assert.equal(parsed.data.length, 1);
    assert.equal(parsed.data[0]?.id, createdWorkspaceId);
    assert.equal(parsed.data[0]?.name, 'Acme Global');
    assert.equal(parsed.data[0]?.ownerId, aliceUserId);
    assert.equal(parsed.nextCursor, null);
  });
});
