import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Context } from 'hono';
import { localDatabaseUrl } from '../runtime/local-config.ts';

// No product tables exist in FND-01. Typed domain tables arrive in FND-03.
export type HarnessDatabase = Kysely<Record<string, never>>;

let globalPool: pg.Pool | null = null;
export const poolStorage = new AsyncLocalStorage<pg.Pool>();

export function createPool(connectionString: string, maxConnections = 4): pg.Pool {
  const isLocal = connectionString.includes('127.0.0.1') || connectionString.includes('localhost');
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: isLocal ? 2_000 : 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: isLocal ? 3_000 : 15_000,
    query_timeout: isLocal ? 4_000 : 15_000,
    application_name: 'flowboard-api',
  });
  pool.on('error', () => console.error('Idle PostgreSQL connection failed'));
  return pool;
}

export function getPool(target?: pg.Pool | pg.ClientBase | Context | string): pg.Pool {
  if (target && typeof target === 'object') {
    if ('query' in target && typeof (target as { query: unknown }).query === 'function') {
      return target as pg.Pool;
    }
    if ('get' in target && typeof (target as { get: unknown }).get === 'function') {
      const contextPool = (target as Context).get('pool') as pg.Pool | undefined;
      if (contextPool) return contextPool;
    }
  }
  const contextPool = poolStorage.getStore();
  if (contextPool) return contextPool;
  if (globalPool) return globalPool;
  const connStr = localDatabaseUrl(typeof target === 'string' ? target : process.env['DATABASE_URL']);
  globalPool = createPool(connStr, 4);
  return globalPool;
}

export function setGlobalPool(pool: pg.Pool | null): void {
  globalPool = pool;
}

export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
}

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

export async function queryDatabase(db: HarnessDatabase | pg.Pool | pg.ClientBase): Promise<void> {
  if ('query' in db && typeof db.query === 'function') {
    const result = await db.query<{ value: number }>('select 1::integer as value');
    if (result.rows[0]?.value !== 1) throw new Error('Unexpected database probe result');
    return;
  }
  const result = await sql<{ value: number }>`select ${1}::integer as value`.execute(db as HarnessDatabase);
  if (result.rows[0]?.value !== 1) throw new Error('Unexpected database probe result');
}
