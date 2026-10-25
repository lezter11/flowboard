import { Hono } from 'hono';
import {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  idempotencyKeySchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt } from '../../adapters/idempotency.ts';
import { createInvitation, acceptInvitation } from '../../adapters/invitations.ts';
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

    return c.json(
      {
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          token: rawToken,
        },
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

  const rawBody = await c.req.json();
  const body = parseOrThrow(acceptInvitationInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await acceptInvitation(client, actor, body.token);

    await client.query('COMMIT');

    return c.json(
      {
        data: {
          success: true,
          projectId: result.projectId,
          workspaceId: result.workspaceId,
          role: result.role,
        },
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
