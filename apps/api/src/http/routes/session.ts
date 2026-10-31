import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authMiddleware, optionalAuthMiddleware, SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import { getOwnedWorkspaces, getAccessibleProjects } from '../../adapters/rbac.ts';
import { readLastLocation, writeLastLocation } from '../../adapters/last-location.ts';
import {
  createDevUserAndSession,
  getClearSessionCookieOptions,
  getSessionCookieOptions,
  getUserByEmail,
  readNameState,
  revokeSession,
  saveUserName,
  updateUserProfile,
} from '../../adapters/session.ts';
import { HttpError } from '../errors.ts';
import { adminSecretMatches } from '../admin-secret.ts';
import {
  getSessionResponseSchema,
  parseOrThrow,
  saveNameInputSchema,
  updateLastLocationInputSchema,
  updateProfileInputSchema,
} from '@flowboard/contracts';

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
  // Re-checked on every read: a revoked, archived or deleted target comes back as null.
  const lastLocation = await readLastLocation(actor.id);
  // B-16: whether a first and last name is still needed, with Google's suggestions while it is.
  const names = await readNameState(actor.id);

  const response = getSessionResponseSchema.parse({
    data: {
      actor,
      ownedWorkspaces,
      accessibleProjects,
      lastLocation,
      needsName: names.needsName,
      suggestedFirstName: names.suggestedFirstName,
      suggestedLastName: names.suggestedLastName,
    },
  });

  return c.json(response);
});

// 1b. PUT /api/v1/session/last-location: remember where the user is (no-op when unchanged)
sessionRoutes.put('/last-location', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Authentication required.');
  }

  const rawBody = await c.req.json();
  const input = parseOrThrow(updateLastLocationInputSchema, rawBody);
  const lastLocation = await writeLastLocation(actor.id, input.projectId, input.boardId ?? null);
  return c.json({ data: lastLocation }, 200);
});

// 2. PATCH /api/v1/session/profile (ACC-03)
sessionRoutes.patch('/profile', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Authentication required.');
  }

  // Display name only (B-9). Unknown fields, including avatarUrl, are refused with 422.
  const rawBody = await c.req.json();
  const parsed = parseOrThrow(updateProfileInputSchema, rawBody);
  const updatedActor = await updateUserProfile(actor.id, parsed);
  return c.json({ data: updatedActor }, 200);
});

// 2b. PATCH /api/v1/session/name (B-16): save the first and last name. Both are required. Saving
// again changes only the names; name_confirmed_at is set the first time. Origin and rate limits
// apply as for every write.
sessionRoutes.patch('/name', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Authentication required.');
  }

  const rawBody = await c.req.json();
  const input = parseOrThrow(saveNameInputSchema, rawBody);
  const saved = await saveUserName(actor.id, input.firstName, input.lastName);
  return c.json({
    data: { actor: saved, firstName: input.firstName, lastName: input.lastName, needsName: false },
  }, 200);
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
    if (!adminSecretMatches(c.req.header('x-dev-secret'))) {
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
