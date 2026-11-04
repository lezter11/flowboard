import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';

// Only the known disposable container supplies credentials; never print them.
const inspected = spawnSync('docker', ['inspect', 'flowboard-full-revalidation-20261103'], { encoding: 'utf8' });
if (inspected.status !== 0) throw new Error('Cannot inspect authorized synthetic test container.');
const container = JSON.parse(inspected.stdout)[0];
const binding = container.HostConfig.PortBindings['5432/tcp'][0];
const values = Object.fromEntries(container.Config.Env.map(value => {
  const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
}));
if (binding.HostIp !== '127.0.0.1' || binding.HostPort !== '55931' || values.POSTGRES_USER !== 'flowboard_harness') throw new Error('Unexpected disposable fixture identity.');
const url = new URL('postgres://127.0.0.1:55931/flowboard_harness');
url.username = values.POSTGRES_USER; url.password = values.POSTGRES_PASSWORD;
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
console.log(JSON.stringify({ container: 'flowboard-full-revalidation-20261103', loopbackPort: 55931, database: 'flowboard_harness', version: (await pool.query('SHOW server_version')).rows[0].server_version }));
await pool.end();
const files = [
  'import-xml-text', 'import-xml-parser', 'import-xml-cell-parser', 'import-xml-mounted',
  'import-repair', 'import-response-contract', 'import-receipt-mapping', 'import-marker-validation', 'import-worker-template',
].map(name => 'apps/api/test/' + name + '.test.ts');
const child = spawn(process.execPath, ['--test-concurrency=1', '--test', ...files], {
  stdio: 'inherit', env: {
    PATH: process.env.PATH,
    NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: '/private/tmp/flowboard-ci-xlsx-mounted-wrangler.log',
    FLOWBOARD_IMPORT_TEST_DATABASE_URL: url.toString(), DATABASE_URL: url.toString(),
  },
});
const code = await new Promise(resolve => child.on('exit', resolve));
console.log(JSON.stringify({ command: 'node --test-concurrency=1 --test ' + files.join(' '), exitCode: code }));
process.exitCode = code ?? 1;
