import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// The fallback is the previously authorized disposable local harness. Never print it.
const privateValues = process.env.DATABASE_URL ? {} : JSON.parse(fs.readFileSync('/private/tmp/flowboard-hosted-mcp-test-env.json', 'utf8'));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
  'apps/api/test/hosted-mcp-mounted.test.ts',
  'apps/api/test/hosted-mcp-transport.test.ts',
  'apps/api/test/hosted-mcp-worker.test.ts',
], { env: { ...process.env, ...privateValues, NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8' });
const output = (result.stdout ?? '') + (result.stderr ?? '');
if (process.argv.includes('--record')) {
  fs.mkdirSync('docs/reviews/HOSTED-MCP-20261104/transport/logs', { recursive: true });
  fs.writeFileSync('docs/reviews/HOSTED-MCP-20261104/transport/logs/focused.log', output);
}
process.stdout.write(output);
process.exitCode = result.status ?? 1;
