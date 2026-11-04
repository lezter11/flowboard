import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const inspected = spawnSync('docker', ['inspect', 'flowboard-full-revalidation-20261103'], { encoding: 'utf8' });
if (inspected.status !== 0) throw new Error('Authorized synthetic test container not available.');
const container = JSON.parse(inspected.stdout)[0], binding = container.HostConfig.PortBindings['5432/tcp'][0];
const values = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
if (!container.State.Running || binding.HostIp !== '127.0.0.1' || binding.HostPort !== '55931' || values.POSTGRES_USER !== 'flowboard_harness') throw new Error('Unexpected fixture identity.');
const url = new URL('postgres://127.0.0.1:55931/flowboard_harness');
url.username = values.POSTGRES_USER; url.password = values.POSTGRES_PASSWORD;
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
console.log(JSON.stringify({ fixture: container.Name, host: '127.0.0.1', port: 55931, database: url.pathname.slice(1), version: (await pool.query('SHOW server_version')).rows[0].server_version, synthetic: true }));
await pool.end();
// All selected tests create and drop unique schemas. No public/shared reset suites.
const files = ['import-xml-text', 'import-xml-parser', 'import-xml-cell-parser', 'import-database-safety', 'import-xml-mounted', 'import-repair', 'import-response-contract', 'import-receipt-mapping', 'import-marker-validation', 'import-worker-template'].map(name => 'apps/api/test/' + name + '.test.ts');
const ownOnly = process.argv.includes('--own-only');
const args = ['--test-concurrency=1', '--test', ...(ownOnly ? [path.join(dir, 'authority.test.mjs')] : files)];
console.log(JSON.stringify({ command: process.execPath + ' ' + args.join(' ') }));
const child = spawn(process.execPath, args, { stdio: 'inherit', env: { PATH: process.env.PATH, NODE_ENV: 'test', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '/private/tmp/flowboard-independent-import-mounted.log', FLOWBOARD_IMPORT_TEST_DATABASE_URL: url.toString(), DATABASE_URL: url.toString() } });
const code = await new Promise(resolve => child.on('exit', resolve));
await fs.writeFile(path.join(dir, ownOnly ? 'authority-command-result.json' : 'mounted-command-result.json'), JSON.stringify({ command: 'node ' + args.join(' '), exitCode: code, environment: 'Node24.15.0; local actual workerd; authorized loopback PostgreSQL17.11; per-test unique synthetic schema; no hosted data' }, null, 2) + '\n');
console.log(JSON.stringify({ exitCode: code })); process.exitCode = code ?? 1;
