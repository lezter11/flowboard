import type { ExecutionContext } from 'hono';
import { createPool, queryDatabase } from '../adapters/postgres.ts';
import { createApp } from '../http/app.ts';
import { processPendingStorageDeletions, purgeExpiredTrash } from '../services/trash-purge.ts';
import { cleanupOrphanUploads } from '../adapters/images.ts';
import { processOutboxLease } from '../adapters/notifications.ts';
import { mailerFromEnv, type MailEnv } from '../services/mailer.ts';
import { purgeEndedWindows } from '../adapters/rate-limit-postgres.ts';
import { purgeSettledOutbox } from '../services/outbox-retention.ts';
import { R2StorageDriver, runWithStorageDriver, type R2BucketBinding } from '../adapters/storage.ts';

export type WorkerBindings = MailEnv & {
  HYPERDRIVE: { connectionString: string };
  DATABASE_URL?: string;
  CURSOR_SECRET?: string;
  // Private R2 bucket for image bytes (no public access). Absent means image routes return 503 CONFIG_ERROR.
  IMAGES?: R2BucketBinding;
};

export interface ScheduledJob {
  name: string;
  run: () => Promise<unknown>;
}

/**
 * Runs each scheduled job in turn. A job that throws does not stop the others. The first error is
 * rethrown at the end, so the run is still reported as failed. Only job names are logged.
 */
export async function runIsolated(jobs: ScheduledJob[]): Promise<void> {
  const failures: Array<{ name: string; error: unknown }> = [];
  for (const job of jobs) {
    try {
      await job.run();
    } catch (error) {
      failures.push({ name: job.name, error });
    }
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ event: 'scheduled_job_failed', jobs: failures.map((f) => f.name) }));
    throw failures[0]!.error;
  }
}

function imageStorage(env: WorkerBindings): R2StorageDriver | null {
  return env.IMAGES ? new R2StorageDriver(env.IMAGES) : null;
}

export default {
  // The ExecutionContext is passed to Hono so routes can call waitUntil (the immediate invitation send).
  async fetch(request: Request, env: WorkerBindings, ctx?: ExecutionContext): Promise<Response> {
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
      return await app.fetch(request, env, ctx);
    } finally {
      await pool.end();
    }
  },

  async scheduled(_event: unknown, env: WorkerBindings): Promise<void> {
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) return;
    const pool = createPool(connectionString, 1);
    const storage = imageStorage(env);
    try {
      await runIsolated([
        { name: 'trash-purge', run: () => runWithStorageDriver(storage, () => purgeExpiredTrash(pool)) },
        { name: 'orphan-uploads', run: () => runWithStorageDriver(storage, () => cleanupOrphanUploads(pool)) },
        { name: 'pending-storage', run: () => runWithStorageDriver(storage, () => processPendingStorageDeletions(pool)) },
        // Invitation mail is sent only when the mail configuration is complete (see mailerFromEnv).
        { name: 'outbox', run: () => processOutboxLease(pool, { mailer: mailerFromEnv(env) }) },
        // Settled outbox rows past the 30-day retention window (B-14, FB-AUD-11).
        { name: 'outbox-retention', run: () => purgeSettledOutbox(pool) },
        { name: 'rate-windows', run: () => purgeEndedWindows(pool) },
      ]);
    } finally {
      await pool.end();
    }
  },
};
