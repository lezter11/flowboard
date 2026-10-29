#!/usr/bin/env node
// Local Worker development. Wrangler refuses to start a Hyperdrive binding without a local
// connection string, so the one from DATABASE_URL is passed through wrangler's documented
// CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING> variable. Nothing is written to disk
// and the production Hyperdrive id in wrangler.jsonc is not used.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Resolve wrangler from this package so the script works without npm's PATH setup.
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Point it at a local PostgreSQL, for example the harness in ' +
      'database/compose.local.yaml. See apps/api/README.md.',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [wranglerBin, 'dev', '--local', '--ip', '127.0.0.1'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
  },
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
