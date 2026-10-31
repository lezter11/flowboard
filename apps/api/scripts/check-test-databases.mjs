// Preflight for `npm test`. A test database URL that names a database the server does not have makes
// about 20 board-access tests fail with "database does not exist". This fails first, with the fix.
// It prints the database name and the error code only. The URL, and so the password, is never printed.
import pg from 'pg';

const CREATE_HINT =
  'Create it on that server, for example: CREATE DATABASE flowboard_access_test OWNER flowboard_harness;';

const checks = [['FLOWBOARD_ACCESS_TEST_DATABASE_URL', process.env.FLOWBOARD_ACCESS_TEST_DATABASE_URL]]
  .filter(([, value]) => value);

let failed = false;
for (const [name, connectionString] of checks) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3_000 });
  const database = new URL(connectionString).pathname.replace(/^\//, '') || '(none)';
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    failed = true;
    const code = error?.code ?? 'unknown';
    if (code === '3D000') {
      console.error(`${name} names database "${database}", which this server does not have. ${CREATE_HINT}`);
    } else {
      console.error(`${name} cannot connect to database "${database}" (code ${code}). Check that the server is running and the port matches.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (failed) process.exit(1);
