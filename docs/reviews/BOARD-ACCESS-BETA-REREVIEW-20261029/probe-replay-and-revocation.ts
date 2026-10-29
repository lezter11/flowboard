import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `probe_replay_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });

try {
  await runMigrations(pool);

  const owner = await createDevUserAndSession('owner@replay.test', 'Owner', pool);
  const manager = await createDevUserAndSession('manager@replay.test', 'Manager', pool);
  await pool.query(`INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at) VALUES ('w', 'W', 'UTC', $1, NOW(), NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES ('p', 'w', 'P', NOW(), NOW())`);
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
     VALUES ('pm1', 'p', 'w', $1, 'manager', 'active', 1, NOW(), NOW())`,
    [manager.user.id]
  );

  const app = createApp(async () => {}, { pool });
  const as = (session: { id: string }, extra: Record<string, string> = {}) => ({
    cookie: `flowboard_session=${session.id}`,
    'content-type': 'application/json',
    'Idempotency-Key': 'k-' + crypto.randomUUID(),
    ...extra,
  });

  const bres = await app.request('/api/v1/projects/p/boards', {
    method: 'POST',
    headers: as(owner.session),
    body: JSON.stringify({ name: 'Replay Board' }),
  });
  const boardId = ((await bres.json()) as any).data.id as string;
  await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, {
    method: 'PUT',
    headers: as(owner.session),
    body: JSON.stringify({ expectedAccessRevision: '1' }),
  });

  const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map(
    (r) => r.id as string
  );
  const bv = async () =>
    Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);

  // 1. Create card before revocation with Idempotency-Key
  const cardKey = 'card-key-' + crypto.randomUUID();
  const cres = await app.request(`/api/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: { ...as(manager.session), 'Idempotency-Key': cardKey },
    body: JSON.stringify({ title: 'Top Secret Plan', columnId: cols[0], expectedBoardVersion: await bv() }),
  });
  assert.equal(cres.status, 201);
  const cardData = ((await cres.json()) as any).data;

  // 2. Post comment before revocation with Idempotency-Key
  const commentKey = 'comment-key-' + crypto.randomUUID();
  const comres = await app.request(`/api/v1/cards/${cardData.id}/comments`, {
    method: 'POST',
    headers: { ...as(manager.session), 'Idempotency-Key': commentKey },
    body: JSON.stringify({ body: 'Confidential Internal Note' }),
  });
  assert.equal(comres.status, 201);

  // 3. Owner revokes manager's board grant
  const revRes = await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, {
    method: 'DELETE',
    headers: as(owner.session),
    body: JSON.stringify({ expectedAccessRevision: '2' }),
  });
  assert.equal(revRes.status, 200);

  // 4. Test Replay after revocation
  console.log('Testing card creation replay after revocation...');
  const cardReplay = await app.request(`/api/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: { ...as(manager.session), 'Idempotency-Key': cardKey },
    body: JSON.stringify({ title: 'Top Secret Plan', columnId: cols[0], expectedBoardVersion: await bv() }),
  });
  assert.equal(cardReplay.status, 404, 'Card replay after revocation must return 404');
  const cardReplayText = await cardReplay.text();
  assert.ok(!cardReplayText.includes('Top Secret Plan'), 'Replay must not disclose card title');

  console.log('Testing comment replay after revocation...');
  const commentReplay = await app.request(`/api/v1/cards/${cardData.id}/comments`, {
    method: 'POST',
    headers: { ...as(manager.session), 'Idempotency-Key': commentKey },
    body: JSON.stringify({ body: 'Confidential Internal Note' }),
  });
  assert.equal(commentReplay.status, 404, 'Comment replay after revocation must return 404');
  const commentReplayText = await commentReplay.text();
  assert.ok(!commentReplayText.includes('Confidential Internal Note'), 'Replay must not disclose comment body');

  // 5. Direct read attempts after revocation
  console.log('Testing direct reads after revocation...');
  const boardGet = await app.request(`/api/v1/boards/${boardId}`, { headers: as(manager.session) });
  assert.equal(boardGet.status, 404, 'Board read after revocation must return 404');

  const cardComments = await app.request(`/api/v1/cards/${cardData.id}/comments`, { headers: as(manager.session) });
  assert.equal(cardComments.status, 404, 'Comments list after revocation must return 404');

  const cardActivity = await app.request(`/api/v1/cards/${cardData.id}/activity`, { headers: as(manager.session) });
  assert.equal(cardActivity.status, 404, 'Card activity after revocation must return 404');

  console.log('PASSED: All replay-after-revocation and direct-read gates strictly return 404 without data disclosure.');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
