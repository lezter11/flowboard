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
import { lockProjectQuota } from '../../adapters/quotas.ts';
import { limitsOf } from '../../services/limits.ts';

export const membersRoutes = new Hono();

async function authorizeMemberMutation(
  client: import('pg').ClientBase,
  projectId: string,
  actorId: string,
  targetUserId: string,
  newRole?: string,
  newStatus?: string,
) {
  const grant = await acquireWriteGrantLock(client, projectId, actorId, 'manager');
  const target = await client.query<{ role: string }>(
    `SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR UPDATE`,
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
  if (newRole !== undefined && (newStatus !== 'removed' || newRole !== target.rows[0].role)) {
    await acquireWritableProjectContextLock(client, projectId);
  }
  return { removalOnly: newStatus === 'removed' && newRole === target.rows[0].role };
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
    await lockProjectQuota(client, projectId);
    const authorization = await authorizeMemberMutation(client, projectId, actor.id, userId, body.role, body.status);

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
      const outcome = replay.responseBody as { data: Record<string, unknown> };
      const { state: classification, ...data } = outcome.data;
      // A mixed role-change/removal can look like a pure removal after it has run. The safe,
      // server-derived receipt marker preserves the original command classification. Legacy
      // receipts without it cannot authorize ambiguous removal replay on archived projects.
      if (classification !== 'member_access_removed') {
        await acquireWritableProjectContextLock(client, projectId);
      }
      await client.query('ROLLBACK');
      return c.json({ ...outcome, data, replayed: true }, replay.statusCode as any);
    }

    const membership = await updateProjectMember(
      client,
      actor,
      projectId,
      userId,
      body.role,
      body.status,
      body.expectedVersion,
      limitsOf(c),
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
      { data: { ...membership, state: authorization.removalOnly ? 'member_access_removed' : 'member_role_or_access_changed' } },
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      const outcome = saved.responseBody as { data: Record<string, unknown> };
      const { state: _classification, ...data } = outcome.data;
      return c.json({ ...outcome, data, replayed: true }, saved.statusCode as any);
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
    await lockProjectQuota(client, projectId);
    await authorizeMemberMutation(client, projectId, actor.id, userId);

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
