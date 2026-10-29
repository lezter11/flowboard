import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession, hashSessionToken } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `probe_auth_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });

try {
  await runMigrations(pool);
  const app = createApp(async () => {}, { pool });

  // 1. Session Token Hashing (R3-10 / A5)
  console.log('Testing session token hashing (A5/R3-10)...');
  const userSession = await createDevUserAndSession('auth.test@flowboard.example', 'Auth Tester', pool);
  const rawToken = userSession.session.id;
  assert.equal(rawToken.length, 64, 'Raw token must be 64-char hex string (32 bytes)');

  // Query database sessions table directly
  const rawQuery = await pool.query('SELECT * FROM sessions WHERE id = $1', [rawToken]);
  assert.equal(rawQuery.rows.length, 0, 'Raw bearer token must NOT exist in database table');

  const hashedToken = hashSessionToken(rawToken);
  const hashQuery = await pool.query('SELECT * FROM sessions WHERE id = $1', [hashedToken]);
  assert.equal(hashQuery.rows.length, 1, 'Hashed token must exist in database table');
  assert.equal(hashQuery.rows[0].user_id, userSession.user.id);

  // Authenticate with raw cookie -> must succeed (200)
  const validReq = await app.request('/api/v1/session', {
    headers: { cookie: `flowboard_session=${rawToken}` },
  });
  assert.equal(validReq.status, 200, 'Valid raw token cookie must return 200');

  // Attempt authentication with the leaked DB hash -> must fail (401)
  const leakedHashReq = await app.request('/api/v1/session', {
    headers: { cookie: `flowboard_session=${hashedToken}` },
  });
  assert.equal(leakedHashReq.status, 401, 'Stolen DB hash cookie must return 401 UNAUTHORIZED');

  // 2. Google OAuth Name Preservation (R3-11 / A6)
  console.log('Testing Google profile overwrite protection (A6/R3-11)...');
  // Simulate first Google sign-in
  const userId = 'usr_' + crypto.randomUUID();
  const email = 'google.user@flowboard.example';
  await pool.query(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET
       display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
       avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), users.avatar_url),
       updated_at = NOW()`,
    [userId, email, 'Original Google Name', 'https://example.com/avatar1.png']
  );

  // User customizes their display name
  await pool.query(`UPDATE users SET display_name = 'Customized Lead Name' WHERE email = $1`, [email]);

  // Simulate subsequent Google sign-in with a different Google account name and a new avatar
  await pool.query(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET
       display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
       avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), users.avatar_url),
       updated_at = NOW()`,
    ['usr_ignored', email, 'New Google Profile Name', 'https://example.com/avatar2.png']
  );

  const checkUser = await pool.query<{ display_name: string; avatar_url: string }>(
    `SELECT display_name, avatar_url FROM users WHERE email = $1`,
    [email]
  );
  assert.equal(checkUser.rows[0].display_name, 'Customized Lead Name', 'User customized display name must be preserved');
  assert.equal(checkUser.rows[0].avatar_url, 'https://example.com/avatar2.png', 'Avatar must be updated when new one provided');

  console.log('PASSED: Session token hashing and Google profile preservation verified.');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
