import { Hono } from 'hono';
import {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  idempotencyKeySchema,
  invitationSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, saveReceipt } from '../../adapters/idempotency.ts';
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

    const { invitation, rawToken } = await createInvitation(
      client,
      actor,
      projectId,
      body.email,
      body.role,
      idempotencyKey,
    );

    await client.query('COMMIT');

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

  const invitations = await listInvitations(pool, actor, projectId);

  return c.json(
    {
      data: invitations,
      nextCursor: null,
    },
    200,
  );
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

      const { invitation, rawToken } = await resendInvitation(
        client,
        actor,
        projectId,
        invitationId,
        idempotencyKey,
      );

      await client.query('COMMIT');

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

