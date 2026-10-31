import { lockUserQuota } from '../../adapters/quotas.ts';
import { ensurePersonalWorkspace } from '../../adapters/personal-workspace.ts';
import { assertOwnedProjectRoom, consumeProjectCreateWindows, insertProjectRow } from '../../adapters/own-projects.ts';
import { limitsOf } from '../../services/limits.ts';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  createOwnProjectInputSchema,
  createProjectInputSchema,
  updateProjectInputSchema,
  idempotencyKeySchema,
  parseOrThrow,
  projectPeopleQuerySchema,
  type Project,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { readableDefaultBoardJoin } from '../../adapters/default-board.ts';
import { getProjectOverview } from '../../adapters/project-overview.ts';
import { lockBoardAccess, lockProjectBoardReadScope } from '../../adapters/board-grants-foundation.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  resolveProjectRole,
  getProjectPeople,
  getProjectAccessSummary,
  acquireWriteGrantLock,
  acquireWritableProjectContextLock,
} from '../../adapters/rbac.ts';
import {
  getWorkspaceProjects,
  getAllAccessibleProjects,
  updateProjectSettings,
  getProjectMembers,
  getProjectLinks,
} from '../../adapters/projects.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

/** Same rule as migration 0009: first three letters/digits of the name, uppercased; PRJ if none. */
function projectKeyPrefix(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  return letters || 'PRJ';
}

export const projectsRoutes = new Hono();

async function lockProjectOwner(
  client: import('pg').ClientBase,
  projectId: string,
  actorId: string,
  action: 'archive' | 'reopen' = 'archive',
) {
  const res = await client.query<{ owner_id: string; role: string | null }>(
    `SELECT w.owner_id, pm.role
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId, actorId],
  );
  const row = res.rows[0];
  if (!row) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }
  if (row.owner_id === actorId) {
    return;
  }
  if (row.role) {
    throw HttpError.forbidden(`Only workspace owner can ${action} projects.`, 'FORBIDDEN');
  }
  throw HttpError.notFound('Project not found.', 'NOT_FOUND');
}

function parseLimit(limitParam?: string): number {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

// 1. GET /api/v1/projects: List all accessible projects across workspaces for current user session
projectsRoutes.get('/api/v1/projects', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const queryParams = c.req.query();
  const limit = parseLimit(queryParams.limit);
  const cursor = queryParams.cursor;

  const pool = getPool();
  const result = await getAllAccessibleProjects(pool, actor, { limit, cursor });
  return c.json(result, 200);
});

// 2. POST /api/v1/workspaces/:workspaceId/projects: Create project in workspace (Owner only)
projectsRoutes.post('/api/v1/workspaces/:workspaceId/projects', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const pool = getPool();

  // Validate that actor is the workspace owner (query workspaces table: id = :workspaceId AND owner_id = actor.id)
  const wsRes = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM workspaces WHERE id = $1 AND owner_id = $2`,
    [workspaceId, actor.id],
  );
  if (!wsRes.rows[0]) {
    throw HttpError.notFound('Workspace not found or unauthorized.', 'NOT_FOUND');
  }

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(createProjectInputSchema, rawBody);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Quota lock before any row lock (B-18, F-01, F-03).
    await lockUserQuota(client, actor.id);

    const methodPath = `/api/v1/workspaces/${workspaceId}/projects`;
    const currentOwner = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM workspaces WHERE id = $1 FOR SHARE', [workspaceId],
    );
    if (currentOwner.rows[0]?.owner_id !== actor.id) {
      throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
    }
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'workspace',
      workspaceId,
      idempotencyKey,
      methodPath,
      body,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    await consumeProjectCreateWindows(client, actor.id);
    await assertOwnedProjectRoom(client, actor.id, limitsOf(c));
    const project = await insertProjectRow(client, workspaceId, body.name, body.description ?? null);

    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      'workspace',
      workspaceId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload,
    );

    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 2b. POST /api/v1/projects (B-17, B-18): create a project in the caller's own personal workspace.
// The caller never names a workspace. Idempotency is scoped to the actor. Quotas are checked after the
// replay, so a replay at the cap returns the original response (edge-case review rule 11).
projectsRoutes.post('/api/v1/projects', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(createOwnProjectInputSchema, rawBody);
  const limits = limitsOf(c);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Quota lock first, before any row lock. ensurePersonalWorkspace takes the same lock again, which is allowed.
    await lockUserQuota(client, actor.id);
    const workspaceId = await ensurePersonalWorkspace(client, actor.id);

    const methodPath = '/api/v1/projects';
    const replay = await checkOrReplayReceipt(client, actor.id, 'actor', actor.id, idempotencyKey, methodPath, body);
    if (replay) {
      await client.query('ROLLBACK');
      return c.json({ ...(replay.responseBody as object), replayed: true }, replay.statusCode as any);
    }

    await consumeProjectCreateWindows(client, actor.id);
    await assertOwnedProjectRoom(client, actor.id, limits);
    const project = await insertProjectRow(client, workspaceId, body.name, body.description ?? null);

    const responsePayload = { data: project };
    const saved = await saveReceipt(client, actor.id, 'actor', actor.id, idempotencyKey, methodPath, body, 201, responsePayload);
    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json({ ...(saved.responseBody as object), replayed: true }, saved.statusCode as any);
    }
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 3. GET /api/v1/workspaces/:workspaceId/projects: Scoped project list for workspace
projectsRoutes.get('/api/v1/workspaces/:workspaceId/projects', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const queryParams = c.req.query();
  const limit = parseLimit(queryParams.limit);
  const cursor = queryParams.cursor;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const workspace = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM workspaces WHERE id = $1 FOR SHARE', [workspaceId],
    );
    if (!workspace.rows[0]) throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
    if (workspace.rows[0].owner_id !== actor.id) {
      const memberships = await client.query<{ id: string }>(
        `SELECT id FROM project_memberships WHERE workspace_id = $1 AND user_id = $2
         AND status = 'active' ORDER BY project_id FOR SHARE`, [workspaceId, actor.id],
      );
      if (memberships.rows.length === 0) throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
    }
    const result = await getWorkspaceProjects(client, actor, workspaceId, { limit, cursor });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
});

// 4. GET /api/v1/projects/:projectId: Single project details
projectsRoutes.get('/api/v1/projects/:projectId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const pool = getPool();

  const res = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    archived: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
    workspace_owner_id: string;
    member_role: string | null;
    default_board_id: string | null;
    brief: string | null;
  }>(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.brief, p.archived, p.version, p.created_at, p.updated_at,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role,
            dbd.id AS default_board_id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     ${readableDefaultBoardJoin('$2')}
     WHERE p.id = $1`,
    [projectId, actor.id],
  );

  const row = res.rows[0];
  if (!row || (row.workspace_owner_id !== actor.id && !row.member_role)) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const links = await getProjectLinks(pool, projectId);

  const project: Project = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
    brief: row.brief,
    links,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };

  return c.json({ data: project }, 200);
});

// 4b. GET /api/v1/projects/:projectId/overview: real counts over readable boards (any member)
projectsRoutes.get('/api/v1/projects/:projectId/overview', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }
  const overview = await getProjectOverview(getPool(), c.req.param('projectId'), actor.id);
  return c.json({ data: overview }, 200);
});

// 5. PATCH /api/v1/projects/:projectId: Update project settings (Owner & PM)
projectsRoutes.patch('/api/v1/projects/:projectId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(updateProjectInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
    await acquireWritableProjectContextLock(client, projectId);

    const methodPath = `/api/v1/projects/${projectId}`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const project = await updateProjectSettings(client, actor, projectId, body);

    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 6. GET /api/v1/projects/:projectId/members: Project people directory (PRJ-05)
projectsRoutes.get('/api/v1/projects/:projectId/members', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getProjectMembers(client, actor, projectId);
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
});

// 7. GET /api/v1/projects/:projectId/people: Project people picker
projectsRoutes.get('/api/v1/projects/:projectId/people', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const pool = getPool();

  // Authorize actor in this project
  const queryParams = c.req.query();
  const parsedQuery = parseOrThrow(projectPeopleQuerySchema, queryParams);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockProjectBoardReadScope(client, projectId, actor.id);

    // Mentions are limited to people who can read the card's board (B-11). A card the caller cannot
    // read gets the same 404 as a card that does not exist, so card ids are not probed.
    let boardId = parsedQuery.boardId;
    if (parsedQuery.purpose === 'mention') {
      if (parsedQuery.cardId) {
        const cardRes = await client.query<{ board_id: string }>(
          `SELECT board_id FROM cards WHERE id = $1 AND project_id = $2 AND state = 'active'`,
          [parsedQuery.cardId, projectId],
        );
        const card = cardRes.rows[0];
        if (!card) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
        const access = await lockBoardAccess(client, card.board_id, actor.id).catch(() => null);
        if (!access || access.projectId !== projectId) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
        boardId = card.board_id;
      } else if (!boardId) {
        await client.query('COMMIT');
        return c.json({ data: [], nextCursor: null }, 200);
      }
    }

    if (boardId) {
      const access = await lockBoardAccess(client, boardId, actor.id);
      if (access.projectId !== projectId) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const result = await getProjectPeople(
    client,
    projectId,
    parsedQuery.purpose ?? 'display',
    parsedQuery.query,
    parsedQuery.cursor,
    parsedQuery.limit ?? 50,
    boardId,
    actor.id,
  );
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
});

// 8. GET /api/v1/projects/:projectId/access-summary: Project access summary
projectsRoutes.get('/api/v1/projects/:projectId/access-summary', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const pool = getPool();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const summary = await getProjectAccessSummary(client, projectId, actor.id, boardIds);
    await client.query('COMMIT');
    return c.json({ data: summary }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 9. POST /api/v1/projects/:projectId/archive (PRJ-04: Owner only)
projectsRoutes.post('/api/v1/projects/:projectId/archive', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/projects/${projectId}/archive`;
    await lockProjectOwner(client, projectId, actor.id, 'archive');
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      {},
    );

    if (replay) {
      const role = await resolveProjectRole(projectId, actor.id, client);
      if (!role) {
        throw HttpError.notFound('Project not found.', 'NOT_FOUND');
      }
      if (role !== 'owner') {
        throw HttpError.forbidden('Only workspace owner can archive projects.', 'FORBIDDEN');
      }
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const role = await resolveProjectRole(projectId, actor.id, client);
    if (!role) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }
    if (role !== 'owner') {
      throw HttpError.forbidden('Only workspace owner can archive projects.', 'FORBIDDEN');
    }

    const updateRes = await client.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      archived: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE projects
       SET archived = TRUE, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId],
    );

    const row = updateRes.rows[0]!;
    const project = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      isArchived: true,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload,
    );

    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 10. POST /api/v1/projects/:projectId/reopen (PRJ-04: Owner only)
projectsRoutes.post('/api/v1/projects/:projectId/reopen', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/projects/${projectId}/reopen`;
    // Quota lock before the row locks (B-18, F-09).
    await lockUserQuota(client, actor.id);
    await lockProjectOwner(client, projectId, actor.id, 'reopen');
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      {},
    );

    if (replay) {
      const role = await resolveProjectRole(projectId, actor.id, client);
      if (!role) {
        throw HttpError.notFound('Project not found.', 'NOT_FOUND');
      }
      if (role !== 'owner') {
        throw HttpError.forbidden('Only workspace owner can reopen projects.', 'FORBIDDEN');
      }
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const role = await resolveProjectRole(projectId, actor.id, client);
    if (!role) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }
    if (role !== 'owner') {
      throw HttpError.forbidden('Only workspace owner can reopen projects.', 'FORBIDDEN');
    }

    const archivedNow = await client.query<{ archived: boolean }>('SELECT archived FROM projects WHERE id = $1', [projectId]);
    if (archivedNow.rows[0]?.archived) {
      await assertOwnedProjectRoom(client, actor.id, limitsOf(c));
    }

    const updateRes = await client.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      archived: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE projects
       SET archived = FALSE, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId],
    );

    const row = updateRes.rows[0]!;
    const project = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      isArchived: false,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload,
    );

    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
