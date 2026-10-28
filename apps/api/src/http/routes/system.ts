import { Hono } from 'hono';
import { runMigrations } from '../../adapters/migrations.ts';
import { getPool } from '../../adapters/postgres.ts';
import { adminSecretMatches } from '../admin-secret.ts';

export const systemRoutes = new Hono<{ Variables: { requestId: string } }>();

systemRoutes.get('/status', async (c) => {
  const env = c.env as { DEV_LOGIN_SECRET?: string; HYPERDRIVE?: unknown; DATABASE_URL?: string } | undefined;
  const deployed = Boolean(env?.HYPERDRIVE || env?.DATABASE_URL);
  if (!adminSecretMatches(c.req.header('x-dev-secret'), env?.DEV_LOGIN_SECRET, deployed)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);
  }

  const pool = getPool(c);
  const rows = await pool.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC');
  return c.json({ data: { migrations: rows.rows } });
});

systemRoutes.post('/migrate', async (c) => {
  const env = c.env as { DEV_LOGIN_SECRET?: string; HYPERDRIVE?: unknown; DATABASE_URL?: string } | undefined;
  const deployed = Boolean(env?.HYPERDRIVE || env?.DATABASE_URL);
  if (!adminSecretMatches(c.req.header('x-dev-secret'), env?.DEV_LOGIN_SECRET, deployed)) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Invalid or missing administrative secret.',
          requestId: c.get('requestId'),
        },
      },
      403
    );
  }

  let pool;
  try {
    pool = getPool(c);
  } catch {
    pool = null;
  }
  if (!pool) {
    return c.json(
      {
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'No database connection pool available.',
          requestId: c.get('requestId'),
        },
      },
      503
    );
  }

  try {
    const result = await runMigrations(pool);
    return c.json({
      data: {
        status: 'ok',
        appliedCount: result.applied.length,
        applied: result.applied,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'MIGRATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          requestId: c.get('requestId'),
        },
      },
      500
    );
  }
});
