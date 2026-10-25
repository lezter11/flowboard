import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

// No product tables exist in FND-01. Typed domain tables arrive in FND-03.
export type HarnessDatabase = Kysely<Record<string, never>>;

export function createDatabase(connectionString: string, maxConnections: number): HarnessDatabase {
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 5_000,
    statement_timeout: 3_000,
    query_timeout: 4_000,
    application_name: 'flowboard-fnd01',
  });
  // An idle connection error must not crash the local process or log its URL.
  pool.on('error', () => console.error('Idle PostgreSQL connection failed'));
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}

export async function queryDatabase(db: HarnessDatabase): Promise<void> {
  const result = await sql<{ value: number }>`select ${1}::integer as value`.execute(db);
  if (result.rows[0]?.value !== 1) throw new Error('Unexpected database probe result');
}
