import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authMiddleware, optionalAuthMiddleware, SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import { getOwnedWorkspaces, getAccessibleProjects } from '../../adapters/rbac.ts';
import { createDevUserAndSession, revokeSession } from '../../adapters/session.ts';
import { HttpError } from '../errors.ts';
import { getSessionResponseSchema, logoutResponseSchema } from '@flowboard/contracts';

const devLoginRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(100).optional(),
});

export const sessionRoutes = new Hono<{
  Variables: {
    requestId: string;
    actor?: import('@flowboard/contracts').SessionActor;
    sessionId?: string;
  };
}>();

// 1. GET /api/v1/session
sessionRoutes.get('/', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Authentication required.');
  }

  const ownedWorkspaces = await getOwnedWorkspaces(actor.id);
  const accessibleProjects = await getAccessibleProjects(actor.id);

  const response = getSessionResponseSchema.parse({
    data: {
      actor,
      ownedWorkspaces,
      accessibleProjects,
    },
  });

  return c.json(response);
});

// 2. POST /api/v1/session/logout
sessionRoutes.post('/logout', optionalAuthMiddleware, async (c) => {
  const sessionId = c.get('sessionId');
  if (sessionId) {
    await revokeSession(sessionId);
  }

  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
  });

  const response = logoutResponseSchema.parse({
    data: { success: true },
  });

  return c.json(response);
});

// 3. POST /api/v1/session/dev-login
sessionRoutes.post('/dev-login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.');
  }

  const parsed = devLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw HttpError.badRequest('Invalid login payload: valid email is required.', {
      issues: parsed.error.issues,
    });
  }

  const { email, displayName } = parsed.data;
  const name = displayName?.trim() || email.split('@')[0] || 'User';

  const { session, user } = await createDevUserAndSession(email, name);

  setCookie(c, SESSION_COOKIE_NAME, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 7 * 24 * 3600,
  });

  return c.json({
    data: {
      actor: user,
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    },
  });
});
