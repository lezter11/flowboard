import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type pg from 'pg';
import {
  correlationMiddleware,
  timingMiddleware,
  bodyLimitMiddleware,
  deadlineMiddleware,
  errorHandler,
  notFoundHandler,
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_DEADLINE_MS,
} from './middleware/index.ts';
import { originCheckMiddleware, isTrustedOrigin } from './middleware/origin.ts';
import { rateLimitMiddleware, type RateLimiterResolver } from './middleware/rate-limit.ts';
import { cloudflareRateLimiter } from '../adapters/rate-limit-cloudflare.ts';
import { sessionRoutes } from './routes/session.ts';
import { googleAuthRoutes } from './routes/google-auth.ts';
import { workspacesRoutes } from './routes/workspaces.ts';
import { projectsRoutes } from './routes/projects.ts';
import { invitationsRoutes } from './routes/invitations.ts';
import { membersRoutes } from './routes/members.ts';
import { boardsRoutes } from './routes/boards.ts';
import { boardGrantsRoutes } from './routes/board-grants.ts';
import { cardsRoutes } from './routes/cards.ts';
import { commentsRoutes } from './routes/comments.ts';
import { trashRoutes } from './routes/trash.ts';
import { imagesRoutes } from './routes/images.ts';
import { importsRoutes } from './routes/imports.ts';
import { activityRoutes } from './routes/activity.ts';
import { notificationsRoutes } from './routes/notifications.ts';
import { systemRoutes } from './routes/system.ts';
import { setGlobalPool, poolStorage, createPool } from '../adapters/postgres.ts';

declare module 'hono' {
  interface ContextVariableMap {
    pool?: pg.Pool;
  }
}

export interface CreateAppOptions {
  bodyLimitBytes?: number;
  deadlineMs?: number;
  pool?: pg.Pool;
  // Defaults to the Cloudflare binding lookup; tests inject a fake limiter.
  rateLimiter?: RateLimiterResolver;
}

export function createApp(probeDatabase: () => Promise<void> = async () => {}, options?: CreateAppOptions) {
  if (options?.pool) {
    setGlobalPool(options.pool);
  }

  const app = new Hono<{ Variables: { requestId: string; pool?: pg.Pool } }>();

  // 0. CORS middleware for browser frontend integration & preflight handling
  app.use('*', cors({
    origin: (origin, c) => (!origin ? origin : isTrustedOrigin(origin, c) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      'If-Match',
      'X-Dev-Secret',
    ],
    exposeHeaders: ['X-Request-Id', 'Server-Timing', 'Content-Disposition', 'ETag'],
    maxAge: 86400,
  }));

  // 0b. Database pool injection middleware: binds injected pool or request-scoped worker pool to context and AsyncLocalStorage
  if (options?.pool) {
    const injectedPool = options.pool;
    app.use('*', async (c, next) => {
      c.set('pool', injectedPool);
      return poolStorage.run(injectedPool, () => next());
    });
  } else {
    app.use('*', async (c, next) => {
      const env = c.env as { HYPERDRIVE?: { connectionString?: string }; DATABASE_URL?: string } | undefined;
      const connStr = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
      if (connStr) {
        const requestPool = createPool(connStr, 1);
        c.set('pool', requestPool);
        try {
          return await poolStorage.run(requestPool, () => next());
        } finally {
          await requestPool.end();
        }
      }
      await next();
    });
  }

  // 1. Correlation middleware: assigns or validates x-request-id and sets requestId in context
  app.use('*', correlationMiddleware);

  // 1b. CSRF defence for cookie-authenticated state changes (same-site Origin/Referer required)
  app.use('*', originCheckMiddleware);

  // 1c. Per-client-IP rate limits on auth, writes, invitations, imports and uploads (health excluded)
  app.use('*', rateLimitMiddleware(options?.rateLimiter ?? cloudflareRateLimiter));

  // 2. Timing middleware: measures request duration and attaches Server-Timing header
  app.use('*', timingMiddleware);

  // 3. Body limit middleware: rejects bodies > 1 MiB (configurable) with 413 PAYLOAD_TOO_LARGE
  app.use('*', bodyLimitMiddleware(options?.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));

  // 4. Deadline middleware: aborts requests exceeding deadline (default 5000ms) with 504 DEADLINE_EXCEEDED
  app.use('*', deadlineMiddleware(options?.deadlineMs ?? DEFAULT_DEADLINE_MS));

  // Default no-store cache policy for private application endpoints
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', 'no-store');
    }
  });

  // Health and readiness probes
  app.get('/health/live', (c) => c.json({ data: { status: 'ok' } }));
  app.get('/health/ready', async (c) => {
    try {
      await probeDatabase();
      return c.json({ data: { status: 'ready' } });
    } catch {
      return c.json(
        {
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database is unavailable.',
            requestId: c.get('requestId'),
          },
        },
        503,
      );
    }
  });

  // Mount API v1 routes
  app.route('/api/v1/session', sessionRoutes);
  app.route('/api/v1/auth', googleAuthRoutes);
  app.route('', workspacesRoutes);
  app.route('', projectsRoutes);
  app.route('/api/v1', invitationsRoutes);
  app.route('/api/v1', membersRoutes);
  app.route('', boardsRoutes);
  app.route('/api/v1', boardGrantsRoutes);
  app.route('', cardsRoutes);
  app.route('/api/v1', commentsRoutes);
  app.route('/api/v1', trashRoutes);
  app.route('', imagesRoutes);
  app.route('/api/v1', importsRoutes);
  app.route('/api/v1', activityRoutes);
  app.route('/api/v1', notificationsRoutes);
  app.route('/api/v1/system', systemRoutes);

  // Central not-found and error handling
  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
