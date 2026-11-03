import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, 'Explicit isolated primary harness required');
const url = new URL(connectionString);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55931');
assert.equal(url.username, 'flowboard_harness');
assert.equal(url.pathname, '/flowboard_harness');
const schema = `trash_restore_gate_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString, max: 1 });
let status = 1;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  console.log(JSON.stringify({ evidence: 'Nearest existing suites use their own disposable primary-database schema; random fixture schemas remain independent', schema, database: url.pathname.slice(1), port: url.port }));
  status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'apps/api/test/com-del.test.ts', 'apps/api/test/lifecycle-undo.test.ts', 'apps/api/test/lifecycle-retention-repair.test.ts', 'apps/api/test/board-access-boards-imports-trash.test.ts'], {
      env: { ...process.env, NODE_ENV: 'test', PGOPTIONS: `-c search_path=${schema}` }, stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
console.log(`EXIT:${status}`);
process.exitCode = status;
