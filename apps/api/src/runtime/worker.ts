import { createPool, queryDatabase } from '../adapters/postgres.ts';
import { createApp } from '../http/app.ts';
import { purgeExpiredTrash } from '../services/trash-purge.ts';
import { processOutboxLease } from '../adapters/notifications.ts';
import { purgeEndedWindows } from '../adapters/rate-limit-postgres.ts';
import { R2StorageDriver, runWithStorageDriver, type R2BucketBinding } from '../adapters/storage.ts';

export type WorkerBindings = {
  HYPERDRIVE: { connectionString: string };
  DATABASE_URL?: string;
  CURSOR_SECRET?: string;
  // Private R2 bucket for image bytes (no public access). Absent means image routes return 503 CONFIG_ERROR.
  IMAGES?: R2BucketBinding;
};

function imageStorage(env: WorkerBindings): R2StorageDriver | null {
  return env.IMAGES ? new R2StorageDriver(env.IMAGES) : null;
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    // A request-scoped pool owns at most one pg connection; never shared across
    // Worker requests. Real Hyperdrive pooling is a later hosted verification.
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'CONFIG_ERROR',
            message: 'Missing HYPERDRIVE or DATABASE_URL binding in Worker environment.',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const pool = createPool(connectionString, 1);
    const app = createApp(() => queryDatabase(pool), {
      pool,
      deadlineMs: 25_000,
      rateLimitBindingsRequired: true,
      storage: imageStorage(env),
    });
    try {
      return await app.fetch(request, env);
    } finally {
      await pool.end();
    }
  },

  async scheduled(_event: unknown, env: WorkerBindings): Promise<void> {
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) return;
    const pool = createPool(connectionString, 1);
    try {
      // A failed trash purge (for example no image bucket bound) must not stop the outbox and
      // rate-window cleanup, so the purge error is rethrown only after those have run.
      const purgeError = await runWithStorageDriver(imageStorage(env), () => purgeExpiredTrash(pool)).then(
        () => null,
        (err: unknown) => err,
      );
      await processOutboxLease(pool);
      await purgeEndedWindows(pool);
      if (purgeError) throw purgeError;
    } finally {
      await pool.end();
    }
  },
};
