// Reviewer R3 small probes (read-only against the repository; writes only to a throwaway schema on the
// isolated synthetic PostgreSQL). Checks: (1) anonymous board GET for an existing vs missing board
// (carried finding R2-02), (2) owner and member GET /boards/:id/access with CURSOR_SECRET unset
// (503 CONFIG_ERROR expected: the deployed wrangler config sets no CURSOR_SECRET), (3) a cross-site
// cookie POST on a mounted write route, (4) /api/v1/system/status with no secret in NODE_ENV=test
// (accepted only through the test-only fallback) and with a wrong secret.
// Run: node docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/reviewer-r3-small-probes.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');
delete process.env['CURSOR_SECRET'];
delete process.env['DEV_LOGIN_SECRET'];

const schema = `r3small_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};

try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('owner@r3small.test', 'Owner', pool);
  const member = await createDevUserAndSession('member@r3small.test', 'Member', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
                    VALUES ('pm1','p','w',$1,'member','active',1,NOW(),NOW())`, [member.user.id]);
  const app = createApp(async () => {}, { pool });
  const bres = await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: {
    cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() },
    body: JSON.stringify({ name: 'B' }) });
  const boardId = ((await bres.json()) as any).data.id as string;

  // (1) Anonymous GET: existing vs missing board.
  const anonExisting = await app.request(`/api/v1/boards/${boardId}`);
  const anonMissing = await app.request(`/api/v1/boards/brd_${crypto.randomUUID()}`);
  out['P1_anonymous_GET_existing_board_status'] = anonExisting.status;
  out['P1_anonymous_GET_missing_board_status'] = anonMissing.status;

  // (2) Board access list with CURSOR_SECRET unset: owner and member (no grant).
  const access = (s: { id: string }) => app.request(`/api/v1/boards/${boardId}/access`, { headers: { cookie: `flowboard_session=${s.id}` } });
  const ownerAccess = await access(owner.session);
  const memberAccess = await access(member.session);
  out['P2_owner_GET_access_without_CURSOR_SECRET_status'] = ownerAccess.status;
  out['P2_owner_GET_access_body'] = (await ownerAccess.text()).slice(0, 160);
  out['P2_member_GET_access_without_CURSOR_SECRET_status'] = memberAccess.status;
  out['P2_member_GET_access_body'] = (await memberAccess.text()).slice(0, 160);

  // (3) Cross-site cookie POST (Origin from a hostile site) on a mounted write route.
  const cross = await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: {
    cookie: `flowboard_session=${owner.session.id}`, origin: 'https://evil.example', 'content-type': 'application/json',
    'Idempotency-Key': 'k-' + crypto.randomUUID() }, body: JSON.stringify({ name: 'X' }) });
  out['P3_cross_site_cookie_POST_status'] = cross.status;

  // (4) System status: wrong secret, and no secret, in NODE_ENV=test (test-only fallback allowed).
  const wrong = await app.request('/api/v1/system/status', { headers: { 'x-dev-secret': 'wrong' } });
  const none = await app.request('/api/v1/system/status');
  out['P4_system_status_wrong_secret_status'] = wrong.status;
  out['P4_system_status_no_secret_status'] = none.status;
  out['P4_NODE_ENV'] = process.env['NODE_ENV'];
} finally {
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
