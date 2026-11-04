// Builder-only launcher: fresh disposable PostgreSQL, no volumes or hosted access.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const directory = path.join(root, 'docs/reviews/HOSTED-MCP-20261104/ui');
const container = 'flowboard-hosted-ui-' + process.pid;
const image = 'postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const password = crypto.randomBytes(32).toString('hex');
const evidence = { kind: 'Disposable local UI test launcher', container, image, loopbackPort: null, exit: null, cleanup: false, events: [] };
const file = path.join(directory, `launcher-${Date.now()}.json`);
function docker(args, required = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (required && result.status !== 0) throw new Error('Disposable Docker operation failed.');
  return result.stdout?.trim() ?? '';
}
let started = false;
try {
  evidence.stage = 'docker-start';
  docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=flowboard_harness', '--env', 'POSTGRES_DB=flowboard_harness', '--env', 'POSTGRES_PASSWORD', image]);
  started = true;
  const port = Number(docker(['port', container, '5432/tcp']).split(':').at(-1));
  if (!port || [55432, 55479, 55931].includes(port)) throw new Error('Unsafe disposable test port.');
  evidence.loopbackPort = port;
  const deadline = Date.now() + 30_000;
  evidence.stage = 'database-readiness';
  for (;;) {
    const ready = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'flowboard_harness', '-d', 'flowboard_harness'], { stdio: 'ignore' });
    if (ready.status === 0) break;
    if (Date.now() > deadline) throw new Error('Disposable database startup deadline.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const address = `postgresql://flowboard_harness:${password}@127.0.0.1:${port}/`;
  const admin = new pg.Pool({ connectionString: address + 'flowboard_harness', max: 1 });
  try {
    for (;;) {
      try { await admin.query('SELECT 1'); break; }
      catch { if (Date.now() > deadline) throw new Error('Disposable TCP readiness deadline.'); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    evidence.stage = 'create-ui-database';
    await admin.query('CREATE DATABASE flowboard_ui_test OWNER flowboard_harness');
  }
  finally { await admin.end(); }
  const script = process.env.FLOWBOARD_UI_RUNNER ?? path.join(directory, 'browser-acceptance.draft.mjs');
  evidence.stage = 'browser-runner';
  const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env,
    NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false', FLOWBOARD_UI_TEST_DATABASE_URL: address + 'flowboard_ui_test',
    FLOWBOARD_HOSTED_UI_RUN: '1', FLOWBOARD_HOSTED_UI_BACKEND_ACCEPTED: 'yes',
    FLOWBOARD_HOSTED_UI_BACKEND_GATE: path.join(root, 'docs/reviews/HOSTED-MCP-20261104/independent-backend-review/803a0957353c6057c2003ed092122f92e6073f158538c37d18417732021bb675-round-2.json'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  child.stdout.on('data', chunk => {
    buffered += chunk.toString();
    const lines = buffered.split('\n'); buffered = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if ((typeof event.id === 'string' && ['pass', 'fail'].includes(event.status)) || (typeof event.output === 'string' && typeof event.cases === 'number')) {
          evidence.events.push(event); console.log(JSON.stringify(event));
        }
      } catch { /* Do not print arbitrary server or credential-bearing output. */ }
    }
  });
  child.stderr.on('data', () => { /* Test diagnostics are redacted by the runner's structured report. */ });
  evidence.exit = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
  process.exitCode = evidence.exit;
} catch (error) {
  evidence.failureType = error.name;
  if (/^[A-Z0-9_]{1,30}$/.test(error.code ?? '')) evidence.failureCode = error.code;
  process.exitCode = 1;
} finally {
  if (started) {
    docker(['stop', container], false); docker(['rm', '--force', container], false);
    for (let attempt = 0; attempt < 25; attempt++) {
      if (!docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}'], false)) { evidence.cleanup = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  await fs.writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ launcherEvidence: path.relative(root, file), exit: evidence.exit, cleanup: evidence.cleanup }));
}
