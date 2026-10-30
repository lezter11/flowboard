import pg from 'pg';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
const pool = new pg.Pool({ connectionString: 'postgres://flowaudit@127.0.0.1:55634/flowaudit', max: 2, connectionTimeoutMillis: 3000 });
try {
  const result = await runMigrations(pool, { migrationsDir: new URL('../../../../database/migrations', import.meta.url).pathname });
  console.log('APPLIED', JSON.stringify(result.applied));
  const rows = await pool.query('SELECT version, name FROM schema_migrations ORDER BY version');
  console.log('TRACKED', rows.rowCount, JSON.stringify(rows.rows));
} finally { await pool.end(); }
