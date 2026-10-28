import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authMiddleware, optionalAuthMiddleware, SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import { getOwnedWorkspaces, getAccessibleProjects } from '../../adapters/rbac.ts';
import {
  createDevUserAndSession,
  getClearSessionCookieOptions,
  getSessionCookieOptions,
  getUserByEmail,
  revokeSession,
  updateUserProfile,
} from '../../adapters/session.ts';
import { HttpError } from '../errors.ts';
import { getSessionResponseSchema, parseOrThrow } from '@flowboard/contracts';

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

// 2. PATCH /api/v1/session/profile (ACC-03)
sessionRoutes.patch('/profile', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Authentication required.');
  }

  const rawBody = await c.req.json();
  const schema = z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      avatarUrl: z.string().url().nullable().optional(),
    })
    .refine((data) => data.displayName !== undefined || data.avatarUrl !== undefined, {
      message: 'At least one field (displayName or avatarUrl) must be provided',
    });

  const parsed = parseOrThrow(schema, rawBody);
  const updatedActor = await updateUserProfile(actor.id, parsed);
  return c.json({ data: updatedActor }, 200);
});

// 3. POST /api/v1/session/logout
sessionRoutes.post('/logout', optionalAuthMiddleware, async (c) => {
  const sessionId = c.get('sessionId');
  if (sessionId) {
    await revokeSession(sessionId);
  }

  const host = c.req.header('host') || (c.req.url ? new URL(c.req.url).hostname : undefined);
  const clearOpts = getClearSessionCookieOptions(host);

  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: clearOpts.path,
    secure: clearOpts.secure,
  });

  return c.body(null, 204);
});

// 3. POST /api/v1/session/dev-login
// Dev-login is strictly for non-production environments; returns 404 NOT_FOUND in production.
sessionRoutes.post('/dev-login', async (c) => {
  const workerBindings = c.env as { HYPERDRIVE?: unknown; DATABASE_URL?: string } | undefined;
  const testMode = process.env.NODE_ENV === 'test';
  const localDevelopmentMode = process.env.NODE_ENV === 'development'
    && process.env.DEV_LOGIN_ENABLED === 'true'
    && typeof process.env.DEV_LOGIN_SECRET === 'string'
    && process.env.DEV_LOGIN_SECRET.length >= 32;
  // A deployed Worker must never expose email-only session issuance. The Node
  // route is opt-in for local development and is available to synthetic tests.
  if (workerBindings?.HYPERDRIVE || workerBindings?.DATABASE_URL || (!testMode && !localDevelopmentMode)) {
    throw HttpError.notFound('Route not found.');
  }

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

  // Prevent unauthorized impersonation of existing users in development/test
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    const devSecret = c.req.header('x-dev-secret') || c.req.header('X-Dev-Secret');
    const configuredSecret = process.env.DEV_LOGIN_SECRET || 'flowboard-dev-secret';
    if (!devSecret || devSecret !== configuredSecret) {
      throw HttpError.forbidden('Cannot sign in to existing account without development secret.');
    }
  }

  const name = displayName?.trim() || email.split('@')[0] || 'User';
  const { session, user } = await createDevUserAndSession(email, name);

  const host = c.req.header('host') || (c.req.url ? new URL(c.req.url).hostname : undefined);
  const cookieOpts = getSessionCookieOptions(host);

  setCookie(c, SESSION_COOKIE_NAME, session.id, {
    path: cookieOpts.path,
    httpOnly: cookieOpts.httpOnly,
    sameSite: cookieOpts.sameSite,
    secure: cookieOpts.secure,
    maxAge: cookieOpts.maxAge,
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
