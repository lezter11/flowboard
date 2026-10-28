import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '/private/tmp/flowboard-stage2-resume-a37x7egs/apps/api/src/http/app.ts';
import { createPool } from '/private/tmp/flowboard-stage2-resume-a37x7egs/apps/api/src/adapters/postgres.ts';

const pool = createPool(process.env.DATABASE_URL, 4);
let boardId;
let projectId;
let userId;
let sessionId;
let oldBoardArchived;
let oldProjectArchived;
const createdIds = [];
try {
  const seed = await pool.query(`
    SELECT pm.project_id, pm.user_id, pm.status, s.id AS session_id,
           b.id AS board_id, b.archived AS board_archived,
           p.archived AS project_archived, c.id AS column_id, b.structure_version
    FROM project_memberships pm
    JOIN users u ON u.id = pm.user_id
    JOIN sessions s ON s.user_id = u.id AND s.expires_at > NOW()
    JOIN boards b ON b.project_id = pm.project_id
    JOIN projects p ON p.id = pm.project_id
    JOIN columns c ON c.board_id = b.id
    WHERE pm.project_id = 'prj_alpha_crd' AND pm.user_id = 'usr_charlie_member_crd'
      AND pm.status = 'active' AND b.id = 'brd_alpha_crd' AND c.id = 'col_todo_crd'
    ORDER BY s.created_at DESC LIMIT 1`);
  assert.equal(seed.rowCount, 1, 'expected isolated CRD fixture from group suite');
  ({ project_id: projectId, user_id: userId, session_id: sessionId, board_id: boardId,
    board_archived: oldBoardArchived, project_archived: oldProjectArchived } = seed.rows[0]);
  const columnId = seed.rows[0].column_id;
  const app = createApp(async () => {}, { pool });
  const cookie = `flowboard_session=${sessionId}`;
  const runSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 20);

  async function create(title, key, extra = {}) {
    const version = await pool.query('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    return app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'idempotency-key': key },
      body: JSON.stringify({ title, columnId, expectedBoardVersion: version.rows[0].structure_version, ...extra }),
    });
  }

  const unknown = await create('Unknown field probe', `resume-unknown-field-${runSuffix}`, { unexpectedPayloadField: 'discard-me' });
  const unknownBody = await unknown.json();
  if (unknown.status === 201) createdIds.push(unknownBody.data.id);

  await pool.query('UPDATE boards SET archived = TRUE WHERE id = $1', [boardId]);
  const boardArchivedCreate = await create('Archived board probe', `resume-archived-board-${runSuffix}`);
  const boardArchivedBody = await boardArchivedCreate.json();
  if (boardArchivedCreate.status === 201) createdIds.push(boardArchivedBody.data.id);
  await pool.query('UPDATE boards SET archived = $1 WHERE id = $2', [oldBoardArchived, boardId]);

  await pool.query('UPDATE projects SET archived = TRUE WHERE id = $1', [projectId]);
  const projectArchivedCreate = await create('Archived project probe', `resume-archived-project-${runSuffix}`);
  const projectArchivedBody = await projectArchivedCreate.json();
  if (projectArchivedCreate.status === 201) createdIds.push(projectArchivedBody.data.id);
  await pool.query('UPDATE projects SET archived = $1 WHERE id = $2', [oldProjectArchived, projectId]);

  const placed = await app.request(`/api/v1/boards/${boardId}/columns/${columnId}/placement?movingCardId=not-a-card&at=first`, {
    headers: { cookie },
  });

  const movingSeed = await pool.query(`SELECT id, version FROM cards WHERE board_id = $1 AND state = 'active' ORDER BY created_at DESC LIMIT 1`, [boardId]);
  assert.equal(movingSeed.rowCount, 1);
  const cardId = movingSeed.rows[0].id;
  const expectedVersion = movingSeed.rows[0].version;
  const parallel = await Promise.all(['A', 'B'].map((suffix) => app.request(`/api/v1/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie, 'idempotency-key': `resume-parallel-edit-${suffix}-${runSuffix}` },
    body: JSON.stringify({ description: `parallel-${suffix}`, expectedVersion }),
  })));
  const parallelStatuses = parallel.map((r) => r.status).sort((a, b) => a - b);

  const moveSeed = await pool.query(`
    SELECT c.id, c.version, b.structure_version
    FROM cards c JOIN boards b ON b.id = c.board_id
    WHERE c.board_id = $1 AND c.column_id = 'col_active_crd' AND c.state = 'active'
    ORDER BY c.position, c.id LIMIT 1`, [boardId]);
  assert.equal(moveSeed.rowCount, 1, 'expected populated destination column');
  const badEmptyPlacement = await app.request(`/api/v1/cards/${moveSeed.rows[0].id}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'idempotency-key': `resume-null-neighbor-${runSuffix}` },
    body: JSON.stringify({ toColumnId: 'col_active_crd', previousCardId: null, nextCardId: null,
      expectedVersion: moveSeed.rows[0].version, expectedBoardVersion: moveSeed.rows[0].structure_version }),
  });
  const duplicatePosition = await pool.query(`
    SELECT COUNT(*)::int AS n FROM cards
    WHERE board_id = $1 AND column_id = 'col_active_crd' AND state = 'active' AND position = 1000`, [boardId]);

  const raceKey = `resume-samekey-race-${runSuffix}`;
  const raceVersion = await pool.query('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
  const raceTitle = `Concurrent receipt probe ${runSuffix}`;
  const racePayload = { title: raceTitle, columnId, expectedBoardVersion: raceVersion.rows[0].structure_version };
  const sameKeyResponses = await Promise.all([0, 1].map(() => app.request(`/api/v1/boards/${boardId}/cards`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, 'idempotency-key': raceKey },
    body: JSON.stringify(racePayload),
  })));
  const sameKeyBodies = await Promise.all(sameKeyResponses.map((r) => r.json()));
  for (const body of sameKeyBodies) if (body?.data?.id) createdIds.push(body.data.id);
  const sameKeyCardCount = await pool.query('SELECT COUNT(*)::int AS n FROM cards WHERE title = $1', [raceTitle]);
  await pool.query('DELETE FROM idempotency_receipts WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3', [userId, projectId, raceKey]);
  const eventCount = createdIds.length
    ? await pool.query('SELECT COUNT(*)::int AS n FROM activity_log WHERE card_id = ANY($1::text[])', [createdIds])
    : { rows: [{ n: 0 }] };

  console.log(JSON.stringify({
    unknownFieldCreateStatus: unknown.status,
    unknownFieldDiscarded: unknownBody?.data?.unexpectedPayloadField === undefined,
    archivedBoardCreateStatus: boardArchivedCreate.status,
    archivedProjectCreateStatus: projectArchivedCreate.status,
    invalidMovingCardPlacementStatus: placed.status,
    actualParallelEditStatuses: parallelStatuses,
    nullNeighborsForNonemptyDestinationStatus: badEmptyPlacement.status,
    cardsAtSameRankAfterNullNeighborMove: duplicatePosition.rows[0].n,
    sameKeyParallelCreateStatuses: sameKeyResponses.map((r) => r.status).sort((a, b) => a - b),
    sameKeyParallelCreateReplayedFlags: sameKeyBodies.map((body) => body?.replayed === true),
    sameKeyParallelCreateEffectCount: sameKeyCardCount.rows[0].n,
    activityRowsForProbeCreates: eventCount.rows[0].n,
  }));
  assert.ok(unknown.status >= 400, 'unknown request fields should be rejected');
  assert.notEqual(boardArchivedCreate.status, 201, 'archived board should reject card creation');
  assert.notEqual(projectArchivedCreate.status, 201, 'archived project should reject card creation');
  assert.equal(placed.status, 404, 'placement should reject a missing moving card');
  assert.deepEqual(parallelStatuses, [200, 409], 'parallel OCC edits should serialize to one success and one stale conflict');
  assert.equal(badEmptyPlacement.status, 422, 'null neighbors are valid only for an empty destination');
} finally {
  if (boardId && oldBoardArchived !== undefined) await pool.query('UPDATE boards SET archived = $1 WHERE id = $2', [oldBoardArchived, boardId]);
  if (projectId && oldProjectArchived !== undefined) await pool.query('UPDATE projects SET archived = $1 WHERE id = $2', [oldProjectArchived, projectId]);
  if (createdIds.length) await pool.query('DELETE FROM cards WHERE id = ANY($1::text[])', [createdIds]);
  await pool.end();
}
