import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  createWorkspaceInputSchema,
  updateWorkspaceInputSchema,
  transferWorkspaceOwnershipInputSchema,
  idempotencyKeySchema,
  parseOrThrow,
  type Workspace,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const workspacesRoutes = new Hono();

// POST /api/v1/workspaces
workspacesRoutes.post('/api/v1/workspaces', authMiddleware, async (c) => {
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
  const body = parseOrThrow(createWorkspaceInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = '/api/v1/workspaces';
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'actor',
      actor.id,
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

    const id = 'ws_' + crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const insertRes = await client.query<{
      id: string;
      name: string;
      timezone: string;
      owner_id: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)
       RETURNING id, name, timezone, owner_id, version, created_at, updated_at`,
      [id, body.name, body.timezone, actor.id, nowIso],
    );

    const row = insertRes.rows[0];
    if (!row) {
      throw new Error('Failed to insert workspace row');
    }

    const workspace: Workspace = {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      ownerId: row.owner_id,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    const responsePayload = { data: workspace };
    const saved = await saveReceipt(
      client,
      actor.id,
      'actor',
      actor.id,
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

// GET /api/v1/workspaces
workspacesRoutes.get('/api/v1/workspaces', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const pool = getPool();
  const res = await pool.query<{
    id: string;
    name: string;
    timezone: string;
    owner_id: string;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT DISTINCT w.id, w.name, w.timezone, w.owner_id, w.version, w.created_at, w.updated_at
     FROM workspaces w
     LEFT JOIN projects p ON p.workspace_id = w.id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
     WHERE w.owner_id = $1 OR pm.user_id IS NOT NULL
     ORDER BY w.name ASC, w.id ASC`,
    [actor.id],
  );

  const workspaces: Workspace[] = res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    ownerId: row.owner_id,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return c.json({ data: workspaces, nextCursor: null }, 200);
});

// PATCH /api/v1/workspaces/:workspaceId (ACC-05)
workspacesRoutes.patch('/api/v1/workspaces/:workspaceId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateWorkspaceInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock workspace for update
    const wsRes = await client.query<{
      id: string;
      name: string;
      timezone: string;
      owner_id: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, timezone, owner_id, version, created_at, updated_at
       FROM workspaces
       WHERE id = $1
       FOR UPDATE`,
      [workspaceId],
    );

    if (wsRes.rows.length === 0 || !wsRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
    }

    const current = wsRes.rows[0];

    // 2. Only owner can update workspace preferences (ACC-05)
    if (current.owner_id !== actor.id) {
      await client.query('ROLLBACK');
      throw HttpError.forbidden('Only workspace owner can update workspace preferences.');
    }

    // 3. OCC check
    if (current.version !== body.expectedVersion) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('STALE_VERSION', 'Workspace version does not match expected version.');
    }

    const newName = body.name ?? current.name;
    const newTimezone = body.timezone ?? current.timezone;
    const newVersion = current.version + 1;
    const nowIso = new Date().toISOString();

    const updateRes = await client.query<{
      id: string;
      name: string;
      timezone: string;
      owner_id: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE workspaces
       SET name = $1, timezone = $2, version = $3, updated_at = $4
       WHERE id = $5
       RETURNING id, name, timezone, owner_id, version, created_at, updated_at`,
      [newName, newTimezone, newVersion, nowIso, workspaceId],
    );

    await client.query('COMMIT');

    const updatedRow = updateRes.rows[0]!;
    const workspace: Workspace = {
      id: updatedRow.id,
      name: updatedRow.name,
      timezone: updatedRow.timezone,
      ownerId: updatedRow.owner_id,
      version: updatedRow.version,
      createdAt: new Date(updatedRow.created_at).toISOString(),
      updatedAt: new Date(updatedRow.updated_at).toISOString(),
    };

    return c.json({ data: workspace }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/v1/workspaces/:workspaceId/transfer-ownership (ACC-07)
workspacesRoutes.post('/api/v1/workspaces/:workspaceId/transfer-ownership', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(transferWorkspaceOwnershipInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/workspaces/${workspaceId}/transfer-ownership`;
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

    // 1. Lock workspace for update
    const wsRes = await client.query<{
      id: string;
      name: string;
      timezone: string;
      owner_id: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, timezone, owner_id, version, created_at, updated_at
       FROM workspaces
       WHERE id = $1
       FOR UPDATE`,
      [workspaceId],
    );

    if (wsRes.rows.length === 0 || !wsRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
    }

    const current = wsRes.rows[0];

    // 2. Only current owner can transfer ownership (ACC-07)
    if (current.owner_id !== actor.id) {
      await client.query('ROLLBACK');
      throw HttpError.forbidden('Only the current workspace owner can transfer ownership.');
    }

    // 3. Target user cannot be current owner
    if (body.targetUserId === actor.id) {
      await client.query('ROLLBACK');
      throw HttpError.badRequest('Cannot transfer ownership to yourself.');
    }

    // 4. Validate target user exists
    const userCheck = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1',
      [body.targetUserId],
    );
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Target user not found.', 'NOT_FOUND');
    }

    // 5. OCC check
    if (current.version !== body.expectedVersion) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('STALE_VERSION', 'Workspace version does not match expected version.');
    }

    const newVersion = current.version + 1;
    const nowIso = new Date().toISOString();

    // 6. Atomically update owner: guaranteed exactly one owner at all times
    const updateRes = await client.query<{
      id: string;
      name: string;
      timezone: string;
      owner_id: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE workspaces
       SET owner_id = $1, version = $2, updated_at = $3
       WHERE id = $4
       RETURNING id, name, timezone, owner_id, version, created_at, updated_at`,
      [body.targetUserId, newVersion, nowIso, workspaceId],
    );

    const updatedRow = updateRes.rows[0]!;
    const workspace: Workspace = {
      id: updatedRow.id,
      name: updatedRow.name,
      timezone: updatedRow.timezone,
      ownerId: updatedRow.owner_id,
      version: updatedRow.version,
      createdAt: new Date(updatedRow.created_at).toISOString(),
      updatedAt: new Date(updatedRow.updated_at).toISOString(),
    };

    const responsePayload = { data: workspace };
    const saved = await saveReceipt(
      client,
      actor.id,
      'workspace',
      workspaceId,
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
