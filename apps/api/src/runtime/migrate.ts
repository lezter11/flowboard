import pg from 'pg';
import { runMigrations } from '../adapters/migrations.ts';
import { localDatabaseUrl } from './local-config.ts';

async function main() {
  const rawUrl = process.env['DATABASE_URL'];
  if (!rawUrl) {
    console.error('Error: DATABASE_URL environment variable is required.');
    console.error('Example: ALLOW_REMOTE_DB=true DATABASE_URL="postgresql://..." npm run db:migrate');
    process.exit(1);
  }

  const connectionString = localDatabaseUrl(rawUrl);
  const parsed = new URL(connectionString);
  console.log(`Connecting to database at ${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}...`);

  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const startTime = Date.now();
    const result = await runMigrations(pool);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result.applied.length === 0) {
      console.log(`✓ Database is already up to date. (0 pending migrations, ${duration}s)`);
    } else {
      console.log(`✓ Successfully applied ${result.applied.length} migration(s) in ${duration}s:`);
      for (const m of result.applied) {
        console.log(`  + [${m.version}] ${m.name}`);
      }
    }
  } catch (error) {
    console.error('✗ Migration failed with error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
