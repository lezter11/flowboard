import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  idempotencyKeySchema,
  parseOrThrow,
  projectPeopleQuerySchema,
  type Project,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
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

    const projectId = 'prj_' + crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const description = body.description ?? null;

    const insertRes = await client.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      archived: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at, key_prefix)
       VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5, $6)
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId, workspaceId, body.name, description, nowIso, projectKeyPrefix(body.name)],
    );

    const row = insertRes.rows[0];
    if (!row) {
      throw new Error('Failed to insert project row');
    }

    const project: Project = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      isArchived: Boolean(row.archived),
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

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
  }>(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     WHERE p.id = $1`,
    [projectId, actor.id],
  );

  const row = res.rows[0];
  if (!row || (row.workspace_owner_id !== actor.id && !row.member_role)) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const project: Project = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };

  return c.json({ data: project }, 200);
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
    if (parsedQuery.boardId) {
      const access = await lockBoardAccess(client, parsedQuery.boardId, actor.id);
      if (access.projectId !== projectId) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const result = await getProjectPeople(
    client,
    projectId,
    parsedQuery.purpose ?? 'display',
    parsedQuery.query,
    parsedQuery.cursor,
    parsedQuery.limit ?? 50,
    parsedQuery.boardId,
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
