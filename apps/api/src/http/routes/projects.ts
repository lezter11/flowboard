import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  createProjectInputSchema,
  idempotencyKeySchema,
  parseOrThrow,
  type Project,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const projectsRoutes = new Hono();

// POST /api/v1/workspaces/:workspaceId/projects
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
      `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5)
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId, workspaceId, body.name, description, nowIso],
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
    await saveReceipt(
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
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/v1/projects/:projectId
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

// GET /api/v1/workspaces/:workspaceId/projects
projectsRoutes.get('/api/v1/workspaces/:workspaceId/projects', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const pool = getPool();

  const wsRes = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM workspaces WHERE id = $1`,
    [workspaceId],
  );
  if (!wsRes.rows[0]) {
    throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
  }

  const isOwner = wsRes.rows[0].owner_id === actor.id;

  let query: string;
  let params: unknown[];

  if (isOwner) {
    query = `SELECT id, workspace_id, name, description, archived, version, created_at, updated_at
             FROM projects
             WHERE workspace_id = $1
             ORDER BY name ASC, id ASC`;
    params = [workspaceId];
  } else {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at
             FROM projects p
             JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
             WHERE p.workspace_id = $1
             ORDER BY p.name ASC, p.id ASC`;
    params = [workspaceId, actor.id];
  }

  const res = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    archived: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  if (!isOwner && res.rows.length === 0) {
    throw HttpError.notFound('Workspace not found or unauthorized.', 'NOT_FOUND');
  }

  const projects: Project[] = res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return c.json({ data: projects, nextCursor: null }, 200);
});
