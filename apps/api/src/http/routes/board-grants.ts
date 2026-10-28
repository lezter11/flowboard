import { Hono } from 'hono';
import type pg from 'pg';
import { getPool } from '../../adapters/postgres.ts';
import { changeBoardGrant } from '../../adapters/board-grants-foundation.ts';
import { acquireWritableProjectContextLock } from '../../adapters/rbac.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { HttpError } from '../errors.ts';
import {
  signBoardAccessCursor,
  verifyBoardAccessCursor,
  type BoardAccessCursor,
} from '../../services/board-access-cursor-draft.ts';

export const boardGrantsRoutes = new Hono();
export const boardGrantsDraftRoutes = boardGrantsRoutes;

const unavailable = () => HttpError.notFound('Board not found.', 'NOT_FOUND');
const maxRevision = 9223372036854775807n;
function parseRevision(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) {
    throw HttpError.badRequest('Provide a valid expected access revision.', 'INVALID_ACCESS_REVISION');
  }
  const revision = BigInt(value);
  if (revision > maxRevision) throw HttpError.badRequest('Provide a valid expected access revision.', 'INVALID_ACCESS_REVISION');
  return revision;
}

function getCursorSecret(env?: { CURSOR_SECRET?: string }): Uint8Array {
  const secret = env?.CURSOR_SECRET ?? (typeof process !== 'undefined' ? process.env['CURSOR_SECRET'] : undefined);
  const bytes = secret ? new TextEncoder().encode(secret) : null;
  if (!bytes || bytes.byteLength < 32) {
    throw new HttpError(503, 'CONFIG_ERROR', 'Board access is temporarily unavailable.');
  }
  return bytes;
}

async function lockOwnedBoard(client: pg.PoolClient, boardId: string, actorId: string) {
  const result = await client.query<{project_id: string; owner_id: string}>(
    `SELECT b.project_id, w.owner_id FROM boards b
       JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE b.id = $1 FOR SHARE OF w`, [boardId]);
  const row = result.rows[0];
  if (!row || row.owner_id !== actorId) throw unavailable();
  return row;
}

// Owners may inspect one board's active grants
boardGrantsRoutes.get('/boards/:boardId/access', authMiddleware, async c => {
  const actor = c.get('actor');
  if (!actor) throw HttpError.unauthorized();
  const cursorSecret = getCursorSecret(c.env as { CURSOR_SECRET?: string } | undefined);
  const boardId = c.req.param('boardId');
  const cursorToken = c.req.query('after');
  const client = await getPool().connect();
  try {
    // All fields and the revision come from the same PostgreSQL snapshot.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await lockOwnedBoard(client, boardId, actor.id);
    let cursor: BoardAccessCursor | null = null;
    if (cursorToken) {
      try {
        cursor = await verifyBoardAccessCursor(cursorToken, cursorSecret, { boardId, actorId: actor.id });
      } catch {
        throw HttpError.badRequest('Invalid access cursor.', 'INVALID_CURSOR');
      }
    }
    const revisionResult = await client.query<{access_revision: string}>('SELECT access_revision FROM boards WHERE id = $1', [boardId]);
    const revision = revisionResult.rows[0]?.access_revision;
    if (!revision) throw unavailable();
    if (cursor && revision !== cursor.revision) throw HttpError.conflict('Board access changed. Refresh and try again.', 'STALE_ACCESS_REVISION');
    const result = await client.query<{user_id: string}>(
      `SELECT g.user_id FROM board_grants g
       JOIN project_memberships m ON m.project_id = g.project_id AND m.user_id = g.user_id AND m.status = 'active'
       WHERE g.board_id = $1 AND g.user_id > $2 ORDER BY g.user_id LIMIT 101`, [boardId, cursor?.lastUserId ?? '']);
    await client.query('COMMIT');
    c.header('Cache-Control', 'no-store');
    const grants = result.rows.slice(0, 100).map(row => ({userId: row.user_id}));
    const nextCursor = result.rows.length > 100
      ? await signBoardAccessCursor({
          v: 1,
          boardId,
          actorId: actor.id,
          revision,
          lastUserId: grants.at(-1)!.userId,
        }, cursorSecret)
      : null;
    return c.json({data: {grants, accessRevision: revision, nextCursor}});
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
});

async function writeGrant(client: pg.PoolClient, boardId: string, actorId: string, userId: string, allow: boolean, expectedAccessRevision: bigint) {
  const { project_id } = await lockOwnedBoard(client, boardId, actorId);
  // Lock the project before the board revision update so concurrent project
  // archival cannot hold the project while this transaction holds the board.
  const project = await client.query<{archived: boolean}>('SELECT archived FROM projects WHERE id = $1 FOR SHARE', [project_id]);
  if (!project.rows[0]) throw unavailable();
  if (project.rows[0].archived) throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot write in an archived project.');
  const changed = await changeBoardGrant(client, boardId, actorId, userId, allow, expectedAccessRevision);
  await acquireWritableProjectContextLock(client, project_id, boardId);
  return changed;
}

boardGrantsRoutes.on(['PUT', 'DELETE'], '/boards/:boardId/grants/:userId', authMiddleware, async c => {
  const actor = c.get('actor');
  if (!actor) throw HttpError.unauthorized();
  const contentType = c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw HttpError.badRequest('Use application/json for this request.', 'INVALID_CONTENT_TYPE');
  const body: unknown = await c.req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'expectedAccessRevision')) {
    throw HttpError.badRequest('Provide a valid expected access revision.', 'INVALID_ACCESS_REVISION');
  }
  const expectedAccessRevision = parseRevision((body as {expectedAccessRevision: unknown}).expectedAccessRevision);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const changed = await writeGrant(client, c.req.param('boardId'), actor.id, c.req.param('userId'), c.req.method === 'PUT', expectedAccessRevision);
    await client.query('COMMIT');
    c.header('Cache-Control', 'no-store');
    return c.json({data: {changed}});
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
});
