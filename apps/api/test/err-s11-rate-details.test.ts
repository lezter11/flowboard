import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import { rateLimitDetailsSchema } from '@flowboard/contracts';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import worker from '../src/runtime/worker.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { scopeForBucket, scopeForPath } from '../src/services/rate-limit.ts';

// ERR-R1 S11: a 429 says what was limited and how long to wait, in details as well as the Retry-After header.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 8);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });
const ORIGIN = 'http://localhost';

before(async () => {
  await runMigrations(pool);
});
after(async () => {
  await pool.end();
});

test('ERR-R1 S11: the scope is named from the path and the bucket', () => {
  assert.equal(scopeForPath('/api/v1/projects'), 'projects');
  assert.equal(scopeForPath('/api/v1/workspaces/ws_1/projects'), 'projects');
  assert.equal(scopeForPath('/api/v1/projects/prj_1/invitations'), 'invitations');
  assert.equal(scopeForPath('/api/v1/cards/c1/comments'), 'general');
  assert.equal(scopeForBucket('invite-inviter'), 'invitations');
  assert.equal(scopeForBucket('project-create-hour'), 'projects');
  assert.equal(scopeForBucket('board-create'), 'general');
});

test('ERR-R1 S11: the sixth project create in a minute is 429 with retryAfterSeconds and scope in details and header', async () => {
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`s11.${s}@flowboard.example`, 'Rate Owner', pool);
  const cookie = `flowboard_session=${owner.session.id}`;
  // The owned-project cap would refuse first, so the actor's current 60-second window is filled directly.
  // The counter then answers with the rate limit, which is the path under test.
  const windowStart = (await pool.query<{ w: string }>(`SELECT (floor(extract(epoch FROM now()) / 60) * 60)::bigint::text AS w`)).rows[0]!.w;
  await pool.query(
    `INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count) VALUES ('project-create', $1, $2::bigint, 5)
     ON CONFLICT (bucket, client_key, window_start) DO UPDATE SET request_count = 5`,
    [owner.user.id, windowStart],
  );
  const refused = await app.request(`${ORIGIN}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': `s11-${crypto.randomUUID()}` },
    body: JSON.stringify({ name: 'Burst' }),
  });
  assert.equal(refused.status, 429);
  assert.ok(refused, 'a refusal was reached');
  const body = (await refused.json()) as { error: { code: string; details: unknown } };
  assert.equal(body.error.code, 'RATE_LIMITED');
  const parsed = rateLimitDetailsSchema.safeParse(body.error.details);
  assert.ok(parsed.success, 'details match the rate-limit schema');
  assert.equal((body.error.details as { scope: string }).scope, 'projects');
  const header = refused.headers.get('retry-after');
  assert.equal(String((body.error.details as { retryAfterSeconds: number }).retryAfterSeconds), header, 'the header agrees with the details');
});

test('ERR-R1 S11: the edge limiter refusal names the scope and the 60-second hint', async () => {
  const env = {
    DATABASE_URL: localDatabaseUrl(process.env['DATABASE_URL']),
    FB_RL_WRITES: { limit: async () => ({ success: false }) },
  };
  const res = await worker.fetch(new Request('http://localhost/api/v1/projects/prj_x/invitations', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
    body: '{}',
  }), env as never);
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: { code: string; details: unknown } };
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.deepEqual(body.error.details, { retryAfterSeconds: 60, scope: 'invitations' });
  assert.equal(res.headers.get('retry-after'), '60');
});
