import assert from 'node:assert/strict';
import { createApp } from '/private/tmp/flowboard-stage2-resume-a37x7egs/apps/api/src/http/app.ts';
import { createPool } from '/private/tmp/flowboard-stage2-resume-a37x7egs/apps/api/src/adapters/postgres.ts';

const pool = createPool(process.env.DATABASE_URL, 4);
let membershipStatus;
let projectId;
let userId;
let sessionId;
try {
  const seed = await pool.query(`
    SELECT pm.project_id, pm.user_id, pm.status, s.id AS session_id, b.id AS board_id, c.id AS column_id, b.structure_version
    FROM project_memberships pm
    JOIN users u ON u.id = pm.user_id
    JOIN sessions s ON s.user_id = u.id AND s.expires_at > NOW()
    JOIN boards b ON b.project_id = pm.project_id
    JOIN columns c ON c.board_id = b.id
    WHERE pm.project_id = 'prj_alpha_crd' AND pm.user_id = 'usr_charlie_member_crd'
      AND b.id = 'brd_alpha_crd' AND c.id = 'col_todo_crd'
    ORDER BY s.created_at DESC LIMIT 1`);
  assert.equal(seed.rowCount, 1, 'expected isolated CRD fixture from group suite');
  ({ project_id: projectId, user_id: userId, status: membershipStatus, session_id: sessionId } = seed.rows[0]);
  assert.equal(membershipStatus, 'active');
  const { board_id: boardId, column_id: columnId, structure_version: expectedBoardVersion } = seed.rows[0];
  const app = createApp(async () => {}, { pool });
  const cookie = `flowboard_session=${sessionId}`;
  const key = 'resume-replay-auth-audit-20261026';
  const payload = { title: 'Private replay repro', columnId, expectedBoardVersion };
  const first = await app.request(`/api/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'idempotency-key': key },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 201, 'authorized first create must succeed');
  const firstBody = await first.json();
  assert.equal(firstBody.data.title, payload.title);

  await pool.query(`UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
  const replay = await app.request(`/api/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'idempotency-key': key },
    body: JSON.stringify(payload),
  });
  const replayBody = await replay.json();
  const result = {
    firstStatus: first.status,
    membershipAfterRevoke: 'removed',
    replayStatus: replay.status,
    replayed: replayBody.replayed === true,
    replayBodyContainsPrivateTitle: replayBody?.data?.title === payload.title,
  };
  console.log(JSON.stringify(result));
  assert.equal(replay.status, 404, 'revoked project membership should deny receipt replay');
} finally {
  if (projectId && userId && membershipStatus) {
    await pool.query('UPDATE project_memberships SET status = $1 WHERE project_id = $2 AND user_id = $3', [membershipStatus, projectId, userId]);
  }
  await pool.end();
}
