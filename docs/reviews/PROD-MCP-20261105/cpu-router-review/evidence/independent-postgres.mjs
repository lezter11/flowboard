import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const fixture = JSON.parse(fs.readFileSync('/private/tmp/flowboard-cpu-gate-private.json', 'utf8'));
assert.equal(fixture.port, 60488);
for (const value of Object.values(fixture.values)) {
  const url = new URL(value); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '60488');
  assert.equal(url.username, 'flowboard_harness'); assert.equal(url.search, '');
  assert.ok(url.pathname.startsWith('/flowboard_'));
}
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ['HOME', 'PATH', 'TMPDIR', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR'].includes(key))),
  ...fixture.values, NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', NODE_OPTIONS: '--dns-result-order=ipv4first' };
console.log('Independent serial mounted boundary/MCP/PAT regression; dedicated PostgreSQL17.11 loopback:60488; sanitized environment, synthetic data only.');
const exit = await new Promise(resolve => {
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'apps/api/test/router-boundaries.test.ts', 'apps/api/test/hosted-mcp-mounted.test.ts', 'apps/api/test/token-boundaries.test.ts'], { env, stdio: 'inherit' });
  child.on('error', () => resolve(1)); child.on('exit', code => resolve(code ?? 1));
});
console.log(JSON.stringify({ exitCode: exit })); process.exitCode = exit;
