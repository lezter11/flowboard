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
workspacesRoutes.post('/api/v1/workspaces', authMiddleware, async () => {
  // B-20: retired. Every person has one personal workspace, created by the sign-in and project-create
  // paths. Authentication still comes first, so an anonymous caller gets 401 (edge-case review F-20).
  throw new HttpError(410, 'WORKSPACE_CREATE_RETIRED', 'Creating workspaces is no longer available. Projects are created in your personal workspace with POST /api/v1/projects.');
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
    // B-20: owned workspaces only. A membership in someone else's project does not list their workspace.
    `SELECT w.id, w.name, w.timezone, w.owner_id, w.version, w.created_at, w.updated_at
     FROM workspaces w
     WHERE w.owner_id = $1
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
workspacesRoutes.post('/api/v1/workspaces/:workspaceId/transfer-ownership', authMiddleware, async () => {
  // B-20 (edge-case review F-06): retired for the beta. A transfer moved whole workspaces without the
  // target's consent or any limit, so the route is closed rather than reachable. The code stays out.
  throw new HttpError(410, 'TRANSFER_OWNERSHIP_RETIRED', 'Ownership transfer is not available in this beta.');
});
