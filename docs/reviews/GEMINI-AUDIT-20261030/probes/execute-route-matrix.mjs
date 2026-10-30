import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../../apps/api/src/adapters/session.ts';
import { createPool, setGlobalPool } from '../../../../apps/api/src/adapters/postgres.ts';
import { MemoryStorageDriver, setStorageDriver } from '../../../../apps/api/src/adapters/storage.ts';

const DB_URL = process.env.FLOWBOARD_AUDIT_DATABASE_URL || 'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55633/flowboard_harness';
process.env.CURSOR_SECRET = 'flowboard_test_cursor_secret_2026';
process.env.GOOGLE_CLIENT_ID = 'test_google_client_id_for_audit';
process.env.GOOGLE_CLIENT_SECRET = 'test_google_client_secret_for_audit';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/v1/auth/google/callback';

const storage = new MemoryStorageDriver();
setStorageDriver(storage);

const pool = createPool(DB_URL, 8);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool, deadlineMs: 30000 });

async function setupFixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const who = async (label) => createDevUserAndSession(`${label}.${s}@matrix.test`, label, pool);

  const owner = await who('owner');
  const manager = await who('manager');
  const member = await who('member');
  const viewer = await who('viewer');
  const noGrant = await who('nogrant');
  const otherMember = await who('othermember');
  const stranger = await who('stranger');
  const revoked = await who('revoked');
  const targetUser = await who('targetuser');

  const ws = `ws_${s}`;
  const wsForeign = `ws_for_${s}`;
  const proj = `prj_${s}`;
  const projOther = `prj_oth_${s}`;
  const projForeign = `prj_for_${s}`;
  const board = `brd_${s}`;
  const col = `col_${s}`;
  const card = `crd_${s}`;
  const comment = `cmt_${s}`;
  const upload = `upl_${s}`;
  const image = `img_${s}`;
  const cardImport = `imp_${s}`;
  const invitation = `inv_${s}`;
  const notif = `not_${s}`;

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Workspaces
    await c.query(`INSERT INTO workspaces(id, name, timezone, owner_id, version, created_at, updated_at) VALUES
      ($1, 'Matrix WS', 'UTC', $2, 1, NOW(), NOW()),
      ($3, 'Foreign WS', 'UTC', $4, 1, NOW(), NOW())`,
      [ws, owner.user.id, wsForeign, stranger.user.id]);

    // Projects
    await c.query(`INSERT INTO projects(id, workspace_id, name, archived, version, created_at, updated_at) VALUES
      ($1, $2, 'Matrix Project', FALSE, 1, NOW(), NOW()),
      ($3, $2, 'Other Project', FALSE, 1, NOW(), NOW()),
      ($4, $5, 'Foreign Project', FALSE, 1, NOW(), NOW())`,
      [proj, ws, projOther, projForeign, wsForeign]);

    // Memberships
    const addMem = (pmId, pId, wId, uId, role, status = 'active') =>
      c.query(`INSERT INTO project_memberships(id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())`, [pmId, pId, wId, uId, role, status]);

    await addMem(`pm_mgr_${s}`, proj, ws, manager.user.id, 'manager');
    await addMem(`pm_mbr_${s}`, proj, ws, member.user.id, 'member');
    await addMem(`pm_vwr_${s}`, proj, ws, viewer.user.id, 'viewer');
    await addMem(`pm_nog_${s}`, proj, ws, noGrant.user.id, 'member');
    await addMem(`pm_rev_${s}`, proj, ws, revoked.user.id, 'member', 'removed');
    await addMem(`pm_tgt_${s}`, proj, ws, targetUser.user.id, 'member');
    await addMem(`pm_oth_${s}`, projOther, ws, otherMember.user.id, 'member');

    // Boards
    await c.query(`INSERT INTO boards(id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at) VALUES
      ($1, $2, $3, 'Matrix Board', 1, 1, FALSE, NOW(), NOW())`, [board, ws, proj]);

    // Grants
    const addGrant = (bId, pId, wId, uId) =>
      c.query(`INSERT INTO board_grants(board_id, project_id, workspace_id, user_id, granted_by, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())`, [bId, pId, wId, uId, owner.user.id]);

    await addGrant(board, proj, ws, manager.user.id);
    await addGrant(board, proj, ws, member.user.id);
    await addGrant(board, proj, ws, viewer.user.id);
    await addGrant(board, proj, ws, targetUser.user.id);

    // Columns
    await c.query(`INSERT INTO columns(id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at) VALUES
      ($1, $2, $3, $4, 'Active', '#3b82f6', 'active', 1000, 1, NOW(), NOW())`,
      [col, ws, proj, board]);

    // Cards
    await c.query(`INSERT INTO cards(id, workspace_id, project_id, board_id, column_id, title, priority, position, state, version, created_at, updated_at) VALUES
      ($1, $2, $3, $4, $5, 'Matrix Card', 'medium', 1000, 'active', 1, NOW(), NOW())`,
      [card, ws, proj, board, col]);

    // Comments
    await c.query(`INSERT INTO comments(id, workspace_id, project_id, card_id, author_id, body, version, created_at, updated_at) VALUES
      ($1, $2, $3, $4, $5, 'Initial Comment', 1, NOW(), NOW())`,
      [comment, ws, proj, card, manager.user.id]);

    // Image Upload Staging
    await c.query(`INSERT INTO card_image_uploads(id, workspace_id, project_id, card_id, uploader_id, filename, content_type, byte_length, sha256, state, expires_at, created_at, updated_at) VALUES
      ($1, $2, $3, $4, $5, 'test.png', 'image/png', 100, $6, 'content_received', NOW() + INTERVAL '1 hour', NOW(), NOW())`,
      [upload, ws, proj, card, manager.user.id, crypto.createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex')]);

    await storage.put(`staging/${upload}/test.png`, new Uint8Array([1, 2, 3]), 'image/png');

    // Finalized Image
    await c.query(`INSERT INTO card_images(id, workspace_id, project_id, card_id, uploader_id, filename, content_type, byte_length, sha256, storage_key, version, created_at, updated_at) VALUES
      ($1, $2, $3, $4, $5, 'perm.png', 'image/png', 100, $6, $7, 1, NOW(), NOW())`,
      [image, ws, proj, card, manager.user.id, crypto.createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'), `images/${image}/perm.png`]);

    await storage.put(`images/${image}/perm.png`, new Uint8Array([1, 2, 3]), 'image/png');

    // Card Import
    await c.query(`INSERT INTO card_imports(id, workspace_id, project_id, board_id, default_column_id, uploader_id, state, version, created_at, updated_at) VALUES
      ($1, $2, $3, $4, $5, $6, 'ready', 1, NOW(), NOW())`,
      [cardImport, ws, proj, board, col, manager.user.id]);

    // Invitation
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await c.query(`INSERT INTO project_invitations(id, workspace_id, project_id, email, role, token_hash, status, invited_by, expires_at, created_at, updated_at) VALUES
      ($1, $2, $3, 'invitee@matrix.test', 'member', $4, 'pending', $5, NOW() + INTERVAL '7 days', NOW(), NOW())`,
      [invitation, ws, proj, tokenHash, manager.user.id]);

    // Notifications
    await c.query(`INSERT INTO notifications(id, workspace_id, project_id, user_id, card_id, type, title, body, link, read, created_at) VALUES
      ($1, $2, $3, $4, $5, 'mention', 'Mentioned', 'You were mentioned', '/board', FALSE, NOW())`,
      [notif, ws, proj, viewer.user.id, card]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  const actors = {
    unauthenticated: null,
    stranger,
    other_project_member: otherMember,
    same_project_no_board_grant: noGrant,
    viewer,
    member,
    manager,
    owner,
    revoked_member: revoked,
    foreign_or_guessed_id: owner,
  };

  const entities = {
    workspaceId: ws,
    projectId: proj,
    boardId: board,
    columnId: col,
    cardId: card,
    commentId: comment,
    uploadId: upload,
    imageId: image,
    importId: cardImport,
    invitationId: invitation,
    userId: targetUser.user.id,
    id: notif,
  };

  const foreignEntities = {
    workspaceId: `ws_foreign_${s}`,
    projectId: `prj_foreign_${s}`,
    boardId: `brd_foreign_${s}`,
    columnId: `col_foreign_${s}`,
    cardId: `crd_foreign_${s}`,
    commentId: `cmt_foreign_${s}`,
    uploadId: `upl_foreign_${s}`,
    imageId: `img_foreign_${s}`,
    importId: `imp_foreign_${s}`,
    invitationId: `inv_foreign_${s}`,
    userId: `usr_foreign_${s}`,
    id: `not_foreign_${s}`,
  };

  return { actors, entities, foreignEntities, s };
}

async function resetEntities(entities, targetUserId) {
  await pool.query(`UPDATE projects SET archived = FALSE, version = 1 WHERE id = $1`, [entities.projectId]);
  await pool.query(`UPDATE boards SET archived = FALSE, snapshot_version = 1, structure_version = 1 WHERE id = $1`, [entities.boardId]);
  await pool.query(`UPDATE columns SET version = 1 WHERE id = $1`, [entities.columnId]);
  await pool.query(`UPDATE cards SET state = 'active', version = 1 WHERE id = $1`, [entities.cardId]);
  await pool.query(`UPDATE comments SET deleted_at = NULL, version = 1 WHERE id = $1`, [entities.commentId]);
  await pool.query(`UPDATE card_image_uploads SET state = 'content_received' WHERE id = $1`, [entities.uploadId]);
  await pool.query(`UPDATE card_images SET version = 1 WHERE id = $1`, [entities.imageId]);
  await pool.query(`UPDATE card_imports SET state = 'ready', version = 1 WHERE id = $1`, [entities.importId]);
  await pool.query(`UPDATE project_invitations SET status = 'pending' WHERE id = $1`, [entities.invitationId]);
  await pool.query(`UPDATE project_memberships SET status = 'active', role = 'member', version = 1 WHERE project_id = $1 AND user_id = $2`, [entities.projectId, targetUserId]);
}

function resolvePath(routePath, entities) {
  let p = routePath;
  for (const [key, val] of Object.entries(entities)) {
    p = p.replace(`:${key}`, val);
  }
  if (routePath.includes('/me/tasks')) p += `?projectId=${entities.projectId}`;
  if (routePath.includes('/cards/search')) p += `?query=test`;
  return p;
}

function samplePayload(method, routePath, entities) {
  if (method === 'GET' || method === 'DELETE') return null;
  if (routePath.includes('/boards/:boardId/cards')) return { title: 'New Matrix Card', columnId: entities.columnId };
  if (routePath.includes('/boards/:boardId/columns/reorder')) return { columnIds: [entities.columnId], expectedVersion: 1 };
  if (routePath.includes('/boards/:boardId/columns/:columnId')) return { name: 'Col Renamed', expectedVersion: 1 };
  if (routePath.includes('/boards/:boardId/columns')) return { name: 'New Col', color: '#6366f1', category: 'todo' };
  if (routePath.includes('/boards/:boardId')) return { name: 'Board Renamed', description: 'desc' };
  if (routePath.includes('/cards/:cardId/comments')) return { body: 'A test comment' };
  if (routePath.includes('/cards/:cardId/move-undo')) return { expectedVersion: 1 };
  if (routePath.includes('/cards/:cardId/move')) return { targetColumnId: entities.columnId, targetPosition: 2000, expectedVersion: 1 };
  if (routePath.includes('/cards/:cardId/delete') || routePath.includes('/cards/:cardId/restore')) return { expectedVersion: 1 };
  if (routePath.includes('/cards/:cardId/image-uploads')) return { filename: 'upload.png', contentType: 'image/png', byteLength: 100 };
  if (routePath.includes('/cards/:cardId')) return { title: 'Card Renamed', expectedVersion: 1 };
  if (routePath.includes('/comments/:commentId')) return { body: 'Updated comment body', expectedVersion: 1 };
  if (routePath.includes('/image-uploads/:uploadId/content')) return new Uint8Array([1, 2, 3]);
  if (routePath.includes('/image-uploads/:uploadId/finalize')) return {};
  if (routePath.includes('/images/:imageId')) return { expectedVersion: 1 };
  if (routePath.includes('/invitations/accept')) return { token: 'sample_token_32_bytes_long_string' };
  if (routePath.includes('/notifications/:id/read')) return { read: true };
  if (routePath.includes('/projects/:projectId/boards')) return { name: 'Another Board' };
  if (routePath.includes('/projects/:projectId/invitations')) return { email: 'probe@test.local', role: 'member' };
  if (routePath.includes('/projects/:projectId/members/:userId')) return { role: 'manager', status: 'active', expectedVersion: 1 };
  if (routePath.includes('/projects/:projectId')) return { name: 'Renamed Project', expectedVersion: 1 };
  if (routePath.includes('/session/last-location')) return { projectId: entities.projectId, boardId: entities.boardId };
  if (routePath.includes('/session/profile')) return { displayName: 'Updated Tester' };
  if (routePath.includes('/session/dev-login')) return { email: 'dev@flowboard.example' };
  if (routePath.includes('/workspaces/:workspaceId/projects')) return { name: 'New Proj' };
  if (routePath.includes('/workspaces/:workspaceId/transfer-ownership')) return { newOwnerUserId: entities.userId };
  if (routePath.includes('/workspaces/:workspaceId')) return { name: 'WS Renamed', expectedVersion: 1 };
  if (routePath === '/api/v1/workspaces') return { name: 'Brand New WS', timezone: 'UTC' };
  if (routePath.includes('/mappings')) return { statusMapping: {} };
  if (routePath.includes('/commit')) return { dryRun: true };
  return {};
}

async function run() {
  const { actors, entities, foreignEntities } = await setupFixture();
  const matrixPath = path.resolve('docs/reviews/CODEX-AUDIT-20261030/route-authorization-matrix.json');
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));

  let totalCells = 0;
  let code401 = 0;
  let code403 = 0;
  let code404 = 0;
  let code2xx = 0;
  let code3xx = 0;
  let codeOther = 0;

  const unexpectedFindings = [];

  for (const route of matrix.routes) {
    await resetEntities(entities, entities.userId);

    for (const role of matrix.roles) {
      totalCells++;
      const isForeign = role === 'foreign_or_guessed_id';
      const actor = actors[role];
      const ent = isForeign ? foreignEntities : entities;
      const requestPath = resolvePath(route.path, ent);

      const headers = {
        origin: 'http://localhost',
        'idempotency-key': `matrix-${crypto.randomUUID()}`,
      };

      if (actor && actor.session) {
        headers['cookie'] = `flowboard_session=${actor.session.id}`;
      }

      const bodyData = samplePayload(route.method, route.path, ent);
      let body = undefined;
      if (bodyData instanceof Uint8Array) {
        body = bodyData;
        headers['content-type'] = 'image/png';
      } else if (bodyData !== null) {
        body = JSON.stringify(bodyData);
        headers['content-type'] = 'application/json';
      }

      const res = await app.request(`http://localhost${requestPath}`, {
        method: route.method,
        headers,
        body,
      });

      const status = res.status;
      let bodyJson = null;
      try {
        bodyJson = await res.json();
      } catch {
        bodyJson = null;
      }

      const summary = bodyJson ? (bodyJson.error ? `${bodyJson.error.code}: ${bodyJson.error.message}` : (bodyJson.data ? 'ok_data' : 'ok')) : `status_${status}`;

      route.roleCases[role] = {
        status,
        body: summary.slice(0, 150),
      };

      if (status === 401) code401++;
      else if (status === 403) code403++;
      else if (status === 404) code404++;
      else if (status >= 200 && status < 300) code2xx++;
      else if (status >= 300 && status < 400) code3xx++;
      else {
        codeOther++;
        unexpectedFindings.push({ route: `${route.method} ${route.path}`, role, status, summary });
      }
    }
  }

  matrix.executionSummary = {
    totalCells,
    code401,
    code403,
    code404,
    code2xx,
    code3xx,
    codeOther,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(matrixPath, JSON.stringify(matrix, null, 2) + '\n');
  console.log(JSON.stringify(matrix.executionSummary, null, 2));
  console.log('Total non-401/403/404 cells:', code2xx + code3xx + codeOther);
  if (unexpectedFindings.length > 0) {
    console.log('Other status findings count:', unexpectedFindings.length);
    console.log('Sample other findings:', JSON.stringify(unexpectedFindings.slice(0, 15), null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
