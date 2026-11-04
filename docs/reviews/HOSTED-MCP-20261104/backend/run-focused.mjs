import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// The file contains only disposable local harness configuration. Never print it.
// CI/reviewers may instead supply DATABASE_URL through their environment.
let privateValues = {};
if (!process.env.DATABASE_URL) {
  privateValues = JSON.parse(fs.readFileSync('/private/tmp/flowboard-hosted-mcp-test-env.json', 'utf8'));
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'apps/api/test/hosted-oauth.test.ts', 'apps/api/test/hosted-oauth-cleanup.test.ts', 'apps/api/test/hosted-oauth-body.test.ts'], {
  env: { ...process.env, ...privateValues, NODE_ENV: 'test' },
  encoding: 'utf8',
});
const output = (result.stdout ?? '') + (result.stderr ?? '');
if (process.argv.includes('--record')) {
  fs.mkdirSync('docs/reviews/HOSTED-MCP-20261104/backend/logs', { recursive: true });
  fs.writeFileSync('docs/reviews/HOSTED-MCP-20261104/backend/logs/focused.log', output);
}
process.stdout.write(output);
process.exitCode = result.status ?? 1;
