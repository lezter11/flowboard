import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../errors.ts';
import { getSessionWithUser } from '../../adapters/session.ts';
import type { SessionActor } from '@flowboard/contracts';

declare module 'hono' {
  interface ContextVariableMap {
    actor?: SessionActor;
    sessionId?: string;
  }
}

export const SESSION_COOKIE_NAME = 'flowboard_session';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
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
  await next();
};

export const optionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, 'session');
  if (sessionId) {
    const sessionData = await getSessionWithUser(sessionId);
    if (sessionData) {
      c.set('actor', sessionData.user);
      c.set('sessionId', sessionData.session.id);
    }
  }
  await next();
};
