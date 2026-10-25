import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export interface MigrationRecord {
  version: string;
  name: string;
}

export interface RunMigrationsOptions {
  migrationsDir?: string;
}

export interface RunMigrationsResult {
  applied: MigrationRecord[];
}

function resolveDefaultMigrationsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate1 = path.resolve(currentDir, '../../../../database/migrations');
  if (fsSync.existsSync(candidate1)) {
    return candidate1;
  }
  const candidate2 = path.resolve(process.cwd(), 'database/migrations');
  if (fsSync.existsSync(candidate2)) {
    return candidate2;
  }
  return candidate1;
}

function isPool(target: pg.Pool | pg.ClientBase): target is pg.Pool {
  return typeof (target as pg.Pool).connect === 'function' && typeof (target as pg.Pool).totalCount === 'number';
}

async function executeMigrationsWithClient(
  client: pg.ClientBase,
  migrationsDir: string
): Promise<RunMigrationsResult> {
  const applied: MigrationRecord[] = [];

  // Acquire an advisory lock to serialize concurrent migration attempts across instances.
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['flowboard_migrations']);

  try {
    // Ensure the schema_migrations tracking table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
      );
    `);

    // Fetch already applied migrations.
    const existing = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    );
    const appliedVersions = new Set(existing.rows.map((row) => row.version));

    // Discover and sort migration files.
    const dirEntries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const migrationFiles = dirEntries
      .filter((entry) => entry.isFile() && /^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    // Execute each pending migration within its own ACID transaction.
    for (const file of migrationFiles) {
      const match = /^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.exec(file);
      if (!match) continue;
      const version = match[1]!;

      if (appliedVersions.has(version)) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sqlContent = await fs.readFile(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
          [version, file]
        );
        await client.query('COMMIT');
        applied.push({ version, name: file });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['flowboard_migrations']);
  }
}

/**
 * Runs pending PostgreSQL migrations in database/migrations in version order.
 * Tracks applied migrations in `schema_migrations`.
 *
 * @param poolOrClient A pg.Pool or pg.ClientBase instance.
 * @param options Optional configuration including custom migrations directory.
 */
export async function runMigrations(
  poolOrClient: pg.Pool | pg.ClientBase,
  options?: RunMigrationsOptions
): Promise<RunMigrationsResult> {
  const migrationsDir = options?.migrationsDir ?? resolveDefaultMigrationsDir();

  if (isPool(poolOrClient)) {
    const client = await poolOrClient.connect();
    try {
      return await executeMigrationsWithClient(client, migrationsDir);
    } finally {
      client.release();
    }
  }

  return await executeMigrationsWithClient(poolOrClient, migrationsDir);
}
