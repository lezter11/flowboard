import { createDatabase, queryDatabase } from '../adapters/postgres.ts';
import { createApp } from '../http/app.ts';

export type WorkerBindings = { HYPERDRIVE: { connectionString: string } };

export default {
  fetch(request: Request, env: WorkerBindings) {
    // A request-scoped pool owns at most one pg connection; never shared across
    // Worker requests. Real Hyperdrive pooling is a later hosted verification.
    const app = createApp(async () => {
      const db = createDatabase(env.HYPERDRIVE.connectionString, 1);
      try { await queryDatabase(db); }
      finally { await db.destroy(); }
    });
    return app.fetch(request);
  },
};
