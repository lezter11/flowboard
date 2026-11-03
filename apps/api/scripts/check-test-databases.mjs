// Preflight for `npm test`. A test database URL that names a database the server does not have makes
// about 20 board-access tests fail with "database does not exist". This fails first, with the fix.
// It prints the database name and the error code only. The URL, and so the password, is never printed.
import pg from 'pg';

const CREATE_HINT =
  'Create it on that server, for example: CREATE DATABASE flowboard_access_test OWNER flowboard_harness;';

const checks = ['DATABASE_URL','FLOWBOARD_ACCESS_TEST_DATABASE_URL','FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL','FLOWBOARD_IMPORT_TEST_DATABASE_URL']
  .map(name=>[name,process.env[name]])
  .filter(([, value]) => value);

let failed = false;
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must explicitly select the disposable local test harness.');
  process.exit(1);
}
// Validate the complete configured set before opening even one connection.
const expected={DATABASE_URL:'flowboard_harness',FLOWBOARD_ACCESS_TEST_DATABASE_URL:'flowboard_access_test',FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL:'flowboard_identity_extra_test',FLOWBOARD_IMPORT_TEST_DATABASE_URL:'flowboard_import_test'};
for (const [name,value] of checks) {
  let url;
  try { url=new URL(value); } catch { console.error(`${name} must be a valid disposable local test URL.`);process.exit(1); }
  if (!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      ||!url.port||['55432','55479'].includes(url.port)||url.username!=='flowboard_harness'||url.pathname!==`/${expected[name]}`||url.search) {
    console.error(`${name} must name its exact disposable local test database on an explicit non-shared port.`);process.exit(1);
  }
}
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
      console.error(`${name} names database "${database}", which this server does not have. Create that disposable database with owner flowboard_harness. ${name==='FLOWBOARD_ACCESS_TEST_DATABASE_URL'?CREATE_HINT:''}`);
    } else {
      console.error(`${name} cannot connect to database "${database}" (code ${code}). Check that the server is running and the port matches.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (failed) process.exit(1);
