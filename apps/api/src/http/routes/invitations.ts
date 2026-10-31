import { Hono } from 'hono';
import {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  idempotencyKeySchema,
  invitationSchema,
  parseOrThrow,
  NAME_REQUIRED_CODE,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import { consumeInvitationScopeLimits } from '../../adapters/rate-limit-postgres.ts';
import { sendInvitationEmailSoon } from '../../adapters/invitation-delivery.ts';
import { readNameState } from '../../adapters/session.ts';
import {
  createInvitation,
  acceptInvitation,
  resendInvitation,
  revokeInvitation,
  listInvitations,
  leaveProject,
} from '../../adapters/invitations.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from '../../adapters/rbac.ts';

export const invitationsRoutes = new Hono();

// POST /api/v1/projects/:projectId/invitations
invitationsRoutes.post('/projects/:projectId/invitations', authMiddleware, async (c) => {
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
  const body = parseOrThrow(createInvitationInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
    await acquireWritableProjectContextLock(client, projectId);

    if (!grant.isOwner && body.role === 'manager') {
      throw HttpError.forbidden('Only workspace owners can invite managers.', 'FORBIDDEN');
    }

    const methodPath = `/api/v1/projects/${projectId}/invitations`;
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

    // Per inviter and per project limits, after the grant and replay checks (B-7, FB-AUD-05).
    await consumeInvitationScopeLimits(client, actor.id, projectId);

    const { invitation, rawToken, outboxId } = await createInvitation(
      client,
      actor,
      projectId,
      body.email,
      body.role,
      idempotencyKey,
    );

    await client.query('COMMIT');
    sendInvitationEmailSoon(c, outboxId);

    const responseData = {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken,
    };
    invitationSchema.parse(responseData);

    return c.json(
      {
        data: responseData,
        replayed: false,
      },
      201,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/v1/invitations/accept
invitationsRoutes.post('/invitations/accept', authMiddleware, async (c) => {
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
  const body = parseOrThrow(acceptInvitationInputSchema, rawBody);

  // B-16: the name is collected before an invitation can be accepted, so the UI cannot skip it.
  if ((await readNameState(actor.id)).needsName) {
    throw HttpError.conflict(NAME_REQUIRED_CODE, 'Save your first and last name before you accept an invitation.');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = '/api/v1/invitations/accept';
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
      const respData = (replay.responseBody as any)?.data;
      if (respData?.projectId) {
        const checkRes = await client.query<{ owner_id: string; member_status: string | null }>(
          `SELECT w.owner_id, pm.status AS member_status
           FROM projects p
           JOIN workspaces w ON p.workspace_id = w.id
           LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
           WHERE p.id = $1
           FOR SHARE OF w`,
          [respData.projectId, actor.id],
        );
        const check = checkRes.rows[0];
        if (!check || (check.owner_id !== actor.id && check.member_status !== 'active')) {
          throw HttpError.notFound('Project not found or access revoked.', 'NOT_FOUND');
        }
      }
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await acceptInvitation(client, actor, body.token);

    const responsePayload = {
      data: {
        success: true,
        projectId: result.projectId,
        workspaceId: result.workspaceId,
        role: result.role,
      },
    };

    const saved = await saveReceipt(
      client,
      actor.id,
      'actor',
      actor.id,
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

    return c.json(
      {
        ...responsePayload,
        replayed: false,
      },
      200,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/v1/projects/:projectId/invitations
invitationsRoutes.get('/projects/:projectId/invitations', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await acquireWriteGrantLock(client, projectId, actor.id, 'manager');

    const invitations = await listInvitations(client, actor, projectId);
    await client.query('COMMIT');

    return c.json(
      {
        data: invitations,
        nextCursor: null,
      },
      200,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/v1/projects/:projectId/invitations/:invitationId/resend
invitationsRoutes.post(
  '/projects/:projectId/invitations/:invitationId/resend',
  authMiddleware,
  async (c) => {
    const actor = c.get('actor');
    if (!actor) {
      throw HttpError.unauthorized('Invalid or missing authentication session.');
    }

    const projectId = c.req.param('projectId');
    const invitationId = c.req.param('invitationId');

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

      const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
      await acquireWritableProjectContextLock(client, projectId);

      const targetInv = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM project_invitations WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [invitationId, projectId],
      );
      if (!targetInv.rows[0]) {
        throw HttpError.notFound('Invitation not found.', 'NOT_FOUND');
      }
      if (!grant.isOwner && targetInv.rows[0].role === 'manager') {
        throw HttpError.forbidden('Only workspace owners can resend invitations for managers.', 'FORBIDDEN');
      }

      const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/resend`;
      const replay = await checkOrReplayReceipt(
        client,
        actor.id,
        'project',
        projectId,
        idempotencyKey,
        methodPath,
        { invitationId },
      );

      if (replay) {
        await client.query('ROLLBACK');
        return c.json(
          { ...(replay.responseBody as object), replayed: true },
          replay.statusCode as any,
        );
      }

      const { invitation, rawToken, outboxId } = await resendInvitation(
        client,
        actor,
        projectId,
        invitationId,
        idempotencyKey,
      );

      await client.query('COMMIT');
      sendInvitationEmailSoon(c, outboxId);

      const responseData = {
        id: invitation.id,
        projectId: invitation.projectId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        invitedBy: invitation.invitedBy,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        updatedAt: invitation.updatedAt,
        token: rawToken,
      };
      invitationSchema.parse(responseData);

      return c.json(
        {
          data: responseData,
          replayed: false,
        },
        200,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
);

// POST /api/v1/projects/:projectId/invitations/:invitationId/revoke
invitationsRoutes.post(
  '/projects/:projectId/invitations/:invitationId/revoke',
  authMiddleware,
  async (c) => {
    const actor = c.get('actor');
    if (!actor) {
      throw HttpError.unauthorized('Invalid or missing authentication session.');
    }

    const projectId = c.req.param('projectId');
    const invitationId = c.req.param('invitationId');

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

      const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
      await acquireWritableProjectContextLock(client, projectId);

      const targetInv = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM project_invitations WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [invitationId, projectId],
      );
      if (!targetInv.rows[0]) {
        throw HttpError.notFound('Invitation not found.', 'NOT_FOUND');
      }
      if (!grant.isOwner && targetInv.rows[0].role === 'manager') {
        throw HttpError.forbidden('Only workspace owners can revoke invitations for managers.', 'FORBIDDEN');
      }

      const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/revoke`;
      const replay = await checkOrReplayReceipt(
        client,
        actor.id,
        'project',
        projectId,
        idempotencyKey,
        methodPath,
        { invitationId },
      );

      if (replay) {
        await client.query('ROLLBACK');
        return c.json(
          { ...(replay.responseBody as object), replayed: true },
          replay.statusCode as any,
        );
      }

      const result = await revokeInvitation(
        client,
        actor,
        projectId,
        invitationId,
        idempotencyKey,
      );

      await client.query('COMMIT');

      return c.json(
        {
          data: {
            success: result.success,
            id: result.id,
            status: result.status,
          },
          replayed: false,
        },
        200,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
);

// POST /api/v1/projects/:projectId/leave
invitationsRoutes.post('/projects/:projectId/leave', authMiddleware, async (c) => {
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

    const methodPath = `/api/v1/projects/${projectId}/leave`;
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
      const prj = await client.query<{ owner_id: string }>(
        `SELECT w.owner_id FROM projects p JOIN workspaces w ON p.workspace_id = w.id WHERE p.id = $1 FOR SHARE OF w`,
        [projectId],
      );
      if (!prj.rows[0]) {
        throw HttpError.notFound('Project not found.', 'NOT_FOUND');
      }
      if (prj.rows[0].owner_id === actor.id) {
        throw HttpError.forbidden('Workspace owners cannot leave their project.', 'FORBIDDEN');
      }
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await leaveProject(client, actor, projectId, idempotencyKey);

    await client.query('COMMIT');

    return c.json(
      {
        data: {
          success: result.success,
        },
        replayed: false,
      },
      200,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

