import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  createWorkspaceInputSchema,
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
    await saveReceipt(
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
