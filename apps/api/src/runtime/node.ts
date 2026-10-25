import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { createDatabase, queryDatabase } from '../adapters/postgres.ts';
import { createApp } from '../http/app.ts';
import { localDatabaseUrl } from './local-config.ts';

export function startNode(port = 3000, connectionString = localDatabaseUrl(process.env['DATABASE_URL'])) {
  const db = createDatabase(localDatabaseUrl(connectionString), 4);
  const app = createApp(() => queryDatabase(db));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  return {
    server,
    async close() {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally { await db.destroy(); }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const runtime = startNode(port);
  console.log(`Flowboard local API: http://127.0.0.1:${port}`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10_000).unref();
      void runtime.close().then(() => clearTimeout(deadline), () => process.exit(1));
    });
  }
}
