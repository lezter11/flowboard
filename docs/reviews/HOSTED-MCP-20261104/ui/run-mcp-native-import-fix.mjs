// Bounded native Node regression execution against a fresh, task-owned PostgreSQL.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const base = path.join(root, 'docs/reviews/HOSTED-MCP-20261104/ui/checks');
const container = `flowboard-ui-native-${process.pid}`;
const image = 'postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const password = crypto.randomBytes(32).toString('hex');
const report = { command: 'npm run test:mcp-integration', image, container, loopbackPort: null, database: 'flowboard_mcp_probe', exitCode: null, cleanup: false, stage: 'start' };
const docker = (args, required = true) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (required && result.status !== 0) throw new Error('Task-owned PostgreSQL operation failed.');
  return result.stdout?.trim() ?? '';
};
let started = false;
try {
  docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=flowboard_harness', '--env', 'POSTGRES_DB=flowboard_harness', '--env', 'POSTGRES_PASSWORD', image]);
  started = true;
  const port = Number(docker(['port', container, '5432/tcp']).split(':').at(-1));
  if (!port || [55432, 55479, 55931, 56585].includes(port)) throw new Error('Unsafe test port.');
  report.loopbackPort = port;
  const address = `postgresql://flowboard_harness:${password}@127.0.0.1:${port}/`;
  const admin = new pg.Pool({ connectionString: address + 'flowboard_harness', max: 1, connectionTimeoutMillis: 2000 });
  const deadline = Date.now() + 30_000;
  report.stage = 'readiness';
  try {
    for (;;) {
      try { await admin.query('SELECT 1'); break; }
      catch { if (Date.now() > deadline) throw new Error('Task-owned database readiness deadline.'); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    await admin.query('CREATE DATABASE flowboard_mcp_probe OWNER flowboard_harness');
  } finally { await admin.end(); }
  report.stage = 'actual-npm-command';
  const child = spawn('npm', ['run', 'test:mcp-integration'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false', FLOWBOARD_MCP_TEST_DATABASE_URL: address + 'flowboard_mcp_probe', FLOWBOARD_PROBE_REPORT: path.join(base, 'mcp-integration-native-result.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  report.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
  const safe = output.replaceAll(address + 'flowboard_mcp_probe', '[DISPOSABLE_DB_URL]').replaceAll(password, '[DISPOSABLE_DB_SECRET]');
  await fs.writeFile(path.join(base, 'mcp-integration-native.log'), safe);
  process.exitCode = report.exitCode;
} catch (error) { report.failureType = error.name; process.exitCode = 1; }
finally {
  if (started) {
    docker(['stop', container], false); docker(['rm', '--force', container], false);
    for (let attempt = 0; attempt < 25; attempt++) {
      if (!docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}'], false)) { report.cleanup = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  await fs.writeFile(path.join(base, 'mcp-integration-native-launcher.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ exitCode: report.exitCode, cleanup: report.cleanup, port: report.loopbackPort, database: report.database }));
}
