import { SharpImageVerifier } from '../services/image-verifier-node.ts';
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { createPool, queryDatabase } from '../adapters/postgres.ts';
import { createApp } from '../http/app.ts';
import { limitsFromEnv } from '../services/limits.ts';
import { localDatabaseUrl } from './local-config.ts';
import { IMAGE_BODY_LIMIT_BYTES } from '../http/middleware/limits.ts';

// An early error can leave an incomplete HTTP/1 request on a keepalive socket.
// Consume only a small, explicitly framed refusal body before sending it, then
// close that connection. A larger/unknown/locked input stays with the adapter's
// existing bounded cleanup; this must never become an unlimited discard loop.
async function discardRejectedBody(request: Request): Promise<void> {
  const length = request.headers.get('content-length');
  const declared = length && /^(?:0|[1-9]\d*)$/.test(length) ? Number(length) : NaN;
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > IMAGE_BODY_LIMIT_BYTES + 1
    || request.headers.has('transfer-encoding') || request.signal.aborted) return;
  const body = request.body;
  if (!body || body.locked || request.bodyUsed) return;
  const reader = body.getReader();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt!: () => void;
  const reading = (async () => {
    let discarded = 0;
    while (!stopped) {
      const next = await reader.read();
      if (next.done || stopped) return;
      discarded += next.value.byteLength;
      if (discarded > declared) return;
    }
  })();
  const interrupted = new Promise<void>(resolve => {
    interrupt = resolve;
    timer = setTimeout(resolve, 1_000);
    request.signal.addEventListener('abort', interrupt, { once: true });
    if (request.signal.aborted) resolve();
  });
  try {
    await Promise.race([reading, interrupted]);
  } catch {
    // The request was already refused. No body bytes/error text are retained.
  } finally {
    stopped = true;
    clearTimeout(timer);
    request.signal.removeEventListener('abort', interrupt);
    void reader.cancel().catch(() => {}).then(() => {
      try { reader.releaseLock(); } catch { /* A pending read may already own cleanup. */ }
    });
  }
}

export interface NodeRuntime {
  server: ReturnType<typeof serve>;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function startNode(
  port = 3000,
  connectionString = localDatabaseUrl(process.env['DATABASE_URL']),
): NodeRuntime {
  const resolvedConnectionString = localDatabaseUrl(connectionString);
  const pool = createPool(resolvedConnectionString, 4);
  const app = createApp(() => queryDatabase(pool), { pool, limits: limitsFromEnv(process.env), imageVerifier: new SharpImageVerifier() });
  const server = serve({
    fetch: async (request, bindings) => {
      const response = await app.fetch(request, bindings);
      const hasFramedBody = Number(request.headers.get('content-length') ?? 0) > 0
        || request.headers.has('transfer-encoding');
      if (response.status >= 400 && hasFramedBody && !bindings.incoming.readableEnded) {
        await discardRejectedBody(request);
        response.headers.set('Connection', 'close');
      }
      return response;
    },
    hostname: '127.0.0.1', port,
  });
  return {
    server,
    pool,
    async close() {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await pool.end();
      }
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
