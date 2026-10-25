// Test entry point only; NOT imported by src or the normal Wrangler config.
import worker from '../src/runtime/worker.ts';
import type { WorkerBindings } from '../src/runtime/worker.ts';
import { createDatabase } from '../src/adapters/postgres.ts';
import { rollbackProbe } from './rollback-probe.ts';

export default {
  async fetch(request: Request, env: WorkerBindings) {
    if (new URL(request.url).pathname !== '/__test/rollback') return worker.fetch(request, env);
    const db = createDatabase(env.HYPERDRIVE.connectionString, 1);
    try { return Response.json(await rollbackProbe(db)); }
    finally { await db.destroy(); }
  },
};
