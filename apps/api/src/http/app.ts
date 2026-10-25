import { Hono } from 'hono';
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
import { sessionRoutes } from './routes/session.ts';
import { workspacesRoutes } from './routes/workspaces.ts';
import { projectsRoutes } from './routes/projects.ts';
import { invitationsRoutes } from './routes/invitations.ts';
import { membersRoutes } from './routes/members.ts';
import { setGlobalPool } from '../adapters/postgres.ts';

export interface CreateAppOptions {
  bodyLimitBytes?: number;
  deadlineMs?: number;
  pool?: pg.Pool;
}

export function createApp(probeDatabase: () => Promise<void> = async () => {}, options?: CreateAppOptions) {
  if (options?.pool) {
    setGlobalPool(options.pool);
  }

  const app = new Hono<{ Variables: { requestId: string } }>();

  // 1. Correlation middleware: assigns or validates x-request-id and sets requestId in context
  app.use('*', correlationMiddleware);

  // 2. Timing middleware: measures request duration and attaches Server-Timing header
  app.use('*', timingMiddleware);

  // 3. Body limit middleware: rejects bodies > 1 MiB (configurable) with 413 PAYLOAD_TOO_LARGE
  app.use('*', bodyLimitMiddleware(options?.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));

  // 4. Deadline middleware: aborts requests exceeding deadline (default 5000ms) with 504 DEADLINE_EXCEEDED
  app.use('*', deadlineMiddleware(options?.deadlineMs ?? DEFAULT_DEADLINE_MS));

  // Default no-store cache policy for private application endpoints
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
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
  app.route('', workspacesRoutes);
  app.route('', projectsRoutes);
  app.route('/api/v1', invitationsRoutes);
  app.route('/api/v1', membersRoutes);

  // Central not-found and error handling
  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
