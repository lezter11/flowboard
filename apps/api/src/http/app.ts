import { imageVerifierStorage, type ImageVerifier } from '../services/image-verifier.ts';
import { imageAdmissionMiddleware, isImageMemoryWrite } from './middleware/image-admission.ts';
import { DEFAULT_LIMITS, type Limits } from '../services/limits.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type pg from 'pg';
import {
  correlationMiddleware,
  timingMiddleware,
  routeBodyLimitMiddleware,
  deadlineMiddleware,
  errorHandler,
  notFoundHandler,
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_DEADLINE_MS,
} from './middleware/index.ts';
import { originCheckMiddleware, isTrustedOrigin } from './middleware/origin.ts';
import { personalAccessTokenMiddleware } from './middleware/auth.ts';
import { rateLimitMiddleware, windowRateLimitMiddleware, type RateLimiterResolver, type WindowCounterResolver } from './middleware/rate-limit.ts';
import { cloudflareRateLimiter } from '../adapters/rate-limit-cloudflare.ts';
import { postgresWindowCounter } from '../adapters/rate-limit-postgres.ts';
import { getPool } from '../adapters/postgres.ts';
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
import { tokensRoutes } from './routes/tokens.ts';
import { setGlobalPool, poolStorage, createPool } from '../adapters/postgres.ts';
import { runWithStorageDriver, type StorageDriver } from '../adapters/storage.ts';

declare module 'hono' {
  interface ContextVariableMap {
    pool?: pg.Pool;
  }
}

export interface CreateAppOptions {
  bodyLimitBytes?: number;
  deadlineMs?: number;
  imageDeadlineMs?: number;
  imageBodyReadDeadlineMs?: number;
  // Runtime cleanup follows real retained work, even after a caller timeout.
  onImageWorkLifetime?: (work: Promise<void>) => void;
  pool?: pg.Pool;
  // Defaults to the Cloudflare binding lookup; tests inject a fake limiter.
  rateLimiter?: RateLimiterResolver;
  // Defaults to the request's PostgreSQL pool; tests inject a fake counter.
  windowCounter?: WindowCounterResolver;
  // Deployed Worker only: absent Cloudflare bindings are logged as deployment faults.
  rateLimitBindingsRequired?: boolean;
  // Image bytes for this app. Pass null when no bucket is bound: image routes then return 503 CONFIG_ERROR.
  // Omit to use the process default (tests set MemoryStorageDriver).
  storage?: StorageDriver | null;
  imageVerifier?: ImageVerifier | null;
  // Own-projects limits (B-17). Pass limitsFromEnv(env) on the Worker. Omit for the defaults.
  limits?: Limits;
}

export function createApp(probeDatabase: () => Promise<void> = async () => {}, options?: CreateAppOptions) {
  if (options?.pool) {
    setGlobalPool(options.pool);
  }

  const app = new Hono<{ Variables: { requestId: string; pool?: pg.Pool; limits?: Limits } }>();
  const limits: Limits = options?.limits ?? { ...DEFAULT_LIMITS };
  app.use('*', async (c, next) => {
    c.set('limits', limits);
    await next();
  });

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

  if (options?.storage !== undefined) {
    const scopedStorage = options.storage;
    app.use('*', (_c, next) => runWithStorageDriver(scopedStorage, () => next()));
  }

  app.use('*', (_c, next) => imageVerifierStorage.run(options?.imageVerifier ?? null, () => next()));

  // 1. Correlation middleware: assigns or validates x-request-id and sets requestId in context
  app.use('*', correlationMiddleware);

  // Explicit bearer credentials never inherit cookie/public route authority.
  app.use('*', personalAccessTokenMiddleware);

  // 1b. CSRF defence for cookie-authenticated state changes (same-site Origin/Referer required)
  app.use('*', originCheckMiddleware);

  // 1c. Per-client-IP rate limits on auth, writes, invitations, imports and uploads (health excluded)
  const rateLimitOptions = { bindingsRequired: options?.rateLimitBindingsRequired ?? false };
  app.use('*', rateLimitMiddleware(options?.rateLimiter ?? cloudflareRateLimiter, rateLimitOptions));
  // Exact limits on sign-in, invitations, imports and uploads: counted in PostgreSQL, fail closed.
  app.use('*', windowRateLimitMiddleware(
    options?.windowCounter ?? ((c) => postgresWindowCounter(getPool(c))),
    rateLimitOptions,
  ));

  // 2. Timing middleware: measures request duration and attaches Server-Timing header
  app.use('*', timingMiddleware);

  // A single isolate owns one buffered image write/full decode at a time. This
  // precedes Hono's body buffer and bounds slow streamed bodies independently.
  app.use('*', imageAdmissionMiddleware(options?.bodyLimitBytes,options?.imageBodyReadDeadlineMs,options?.onImageWorkLifetime));

  // 3. Body limit middleware: 1 MiB by default; 5 MiB XLSX imports and 10 MiB image content only for
  // a signed-in request on those routes (B-7). Refused with 413 PAYLOAD_TOO_LARGE.
  app.use('*', routeBodyLimitMiddleware(options?.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));

  // 4. Full image verification has a bounded10s HTTP budget; ordinary Node
  // requests keep5s. Explicit deadlineMs remains a focused-test override unless
  // imageDeadlineMs is supplied (Worker ordinary25s/image10s are explicit).
  const ordinaryDeadline=deadlineMiddleware(options?.deadlineMs??DEFAULT_DEADLINE_MS);
  const imageDeadline=deadlineMiddleware(options?.imageDeadlineMs??options?.deadlineMs??10_000);
  app.use('*',(c,next)=>isImageMemoryWrite(c.req.method,c.req.path)?imageDeadline(c,next):ordinaryDeadline(c,next));

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
  app.route('', tokensRoutes);

  // Central not-found and error handling
  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
