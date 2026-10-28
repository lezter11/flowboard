import { Hono } from 'hono';
import {
  idempotencyKeySchema,
  parseOrThrow,
  updateProjectMemberInputSchema,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import { updateProjectMember, removeProjectMember } from '../../adapters/members.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from '../../adapters/rbac.ts';

export const membersRoutes = new Hono();

async function authorizeMemberReplay(
  client: import('pg').ClientBase,
  projectId: string,
  actorId: string,
  targetUserId: string,
  newRole?: string,
) {
  const grant = await acquireWriteGrantLock(client, projectId, actorId, 'manager');
  await acquireWritableProjectContextLock(client, projectId);

  const target = await client.query<{ role: string }>(
    `SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
    [projectId, targetUserId],
  );
  if (!target.rows[0]) {
    throw HttpError.notFound('Member not found.', 'NOT_FOUND');
  }

  if (!grant.isOwner) {
    if (targetUserId === actorId) {
      throw HttpError.forbidden('Cannot modify own membership.', 'FORBIDDEN');
    }
    if (targetUserId === grant.ownerId) {
      throw HttpError.forbidden('Project managers cannot modify workspace owner.', 'FORBIDDEN');
    }
    if (target.rows[0].role === 'manager') {
      throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
    }
    if (newRole === 'manager') {
      throw HttpError.forbidden('Only workspace owners can appoint managers.', 'FORBIDDEN');
    }
  }
}

// PATCH /api/v1/projects/:projectId/members/:userId (mounted under /api/v1)
membersRoutes.patch('/projects/:projectId/members/:userId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(updateProjectMemberInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/projects/${projectId}/members/${userId}`;
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
      await authorizeMemberReplay(client, projectId, actor.id, userId, body.role);
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const membership = await updateProjectMember(
      client,
      actor,
      projectId,
      userId,
      body.role,
      body.status,
      body.expectedVersion,
    );

    const responsePayload = { data: membership };
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

// DELETE /api/v1/projects/:projectId/members/:userId (mounted under /api/v1)
membersRoutes.delete('/projects/:projectId/members/:userId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

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

    const methodPath = `/api/v1/projects/${projectId}/members/${userId}`;
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
      await authorizeMemberReplay(client, projectId, actor.id, userId);
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    await removeProjectMember(client, actor, projectId, userId);

    const responsePayload = { data: { success: true } };
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
