import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `probe_sec_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });

try {
  await runMigrations(pool);
  const app = createApp(async () => {}, { pool });

  const owner = await createDevUserAndSession('sec.owner@flowboard.example', 'Sec Owner', pool);
  await pool.query(`INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at) VALUES ('w', 'W', 'UTC', $1, NOW(), NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES ('p', 'w', 'P', NOW(), NOW())`);

  // 1. Cross-site Origin Check on Cookie Requests (A7)
  console.log('Testing Origin / CSRF protection (A7)...');
  const crossSiteRes = await app.request('/api/v1/projects/p/boards', {
    method: 'POST',
    headers: {
      cookie: `flowboard_session=${owner.session.id}`,
      'content-type': 'application/json',
      origin: 'https://malicious-attacker.com',
      'Idempotency-Key': 'k-' + crypto.randomUUID(),
    },
    body: JSON.stringify({ name: 'Malicious Board' }),
  });
  assert.equal(crossSiteRes.status, 403, 'Foreign origin with cookie must return 403 FORBIDDEN');

  // 2. System routes protection (A8)
  console.log('Testing /api/v1/system/* protection (A8)...');
  const systemNoSecret = await app.request('/api/v1/system/status');
  assert.equal(systemNoSecret.status, 403, '/system/status without secret must return 403');

  const systemBadSecret = await app.request('/api/v1/system/status', {
    headers: { 'x-dev-secret': 'short' },
  });
  assert.equal(systemBadSecret.status, 403, '/system/status with short/invalid secret must return 403');

  // 3. CURSOR_SECRET requirement (A8 / R3-07)
  console.log('Testing CURSOR_SECRET enforcement on board access list (A8/R3-07)...');
  const bres = await app.request('/api/v1/projects/p/boards', {
    method: 'POST',
    headers: {
      cookie: `flowboard_session=${owner.session.id}`,
      'content-type': 'application/json',
      'Idempotency-Key': 'k-' + crypto.randomUUID(),
    },
    body: JSON.stringify({ name: 'Cursor Board' }),
  });
  assert.equal(bres.status, 201);
  const boardId = ((await bres.json()) as any).data.id as string;

  // With CURSOR_SECRET deleted from env
  const savedSecret = process.env['CURSOR_SECRET'];
  delete process.env['CURSOR_SECRET'];
  try {
    const accessRes = await app.request(`/api/v1/boards/${boardId}/access`, {
      headers: { cookie: `flowboard_session=${owner.session.id}` },
    });
    assert.equal(accessRes.status, 503, 'GET /boards/:id/access without CURSOR_SECRET must return 503 CONFIG_ERROR');
    const err = (await accessRes.json()) as any;
    assert.equal(err.error?.code, 'CONFIG_ERROR');
  } finally {
    if (savedSecret) process.env['CURSOR_SECRET'] = savedSecret;
  }

  console.log('PASSED: Origin enforcement, system secrets, and CURSOR_SECRET verified.');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
