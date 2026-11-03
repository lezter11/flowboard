import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../errors.ts';
import { getSessionWithUser } from '../../adapters/session.ts';
import { verifyPersonalAccessToken } from '../../adapters/tokens.ts';
import { getPool } from '../../adapters/postgres.ts';
import type { SessionActor, TokenScope } from '@flowboard/contracts';
import { enforcePersonalAccessTokenPolicy } from './token-policy.ts';

declare module 'hono' {
  interface ContextVariableMap {
    actor?: SessionActor;
    sessionId?: string;
    tokenScopes?: TokenScope[];
    tokenId?: string;
    tokenProjectId?: string | null;
    authType?: 'session' | 'token';
  }
}

export const SESSION_COOKIE_NAME = 'flowboard_session';

/** Also mounted globally, so an explicit bearer cannot fall through to a public/UI route. */
export const personalAccessTokenMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader !== undefined) c.header('Cache-Control', 'no-store');
  if (authHeader !== undefined && c.get('authType') !== 'token') {
    const match = /^Bearer (flw_pat_[a-f0-9]{64})$/i.exec(authHeader);
    if (!match) throw HttpError.unauthorized('Invalid, expired or revoked API token.');
    const tokenData = await verifyPersonalAccessToken(getPool(), match[1]!);
    if (!tokenData) {
      throw HttpError.unauthorized('Invalid, expired or revoked API token.');
    }
    c.set('actor', tokenData.user);
    c.set('tokenScopes', tokenData.token.scopes);
    c.set('tokenId', tokenData.token.id);
    c.set('tokenProjectId', tokenData.token.projectId);
    c.set('authType', 'token');
  }
  if (c.get('authType') === 'token') await enforcePersonalAccessTokenPolicy(c);
  await next();
};

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  // Defense in depth when a route module is mounted without createApp (e.g. a focused harness).
  if (c.req.header('Authorization') !== undefined) {
    return personalAccessTokenMiddleware(c, next);
  }

  const sessionId = getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, 'session');
  if (!sessionId) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const sessionData = await getSessionWithUser(sessionId);
  if (!sessionData) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  c.set('actor', sessionData.user);
  c.set('sessionId', sessionData.session.id);
  c.set('authType', 'session');
  await next();
};

export function requireTokenScope(requiredScope: TokenScope): MiddlewareHandler {
  return async (c, next) => {
    const authType = c.get('authType');
    if (authType === 'token') {
      const scopes = c.get('tokenScopes') || [];
      if (!scopes.includes(requiredScope)) {
        throw HttpError.forbidden(`Token lacks required scope: ${requiredScope}`);
      }
    }
    await next();
  };
}

export const optionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.header('Authorization') !== undefined) {
    return personalAccessTokenMiddleware(c, next);
  }

  const sessionId = getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, 'session');
  if (sessionId) {
    const sessionData = await getSessionWithUser(sessionId);
    if (sessionData) {
      c.set('actor', sessionData.user);
      c.set('sessionId', sessionData.session.id);
      c.set('authType', 'session');
    }
  }
  await next();
};
