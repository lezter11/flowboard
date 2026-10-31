import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { ensurePersonalWorkspace } from '../src/adapters/personal-workspace.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-21: migration 0019. Backfill of a personal workspace per user, idempotence (a second run inserts
// nothing), existing data survives, the owner index and boards.created_by, and that the backfill waits for
// a live sign-in that holds the same per-user lock. Each run uses a fresh schema of the configured database.

const url = localDatabaseUrl(process.env['DATABASE_URL']);
const migration = fileURLToPath(new URL('../../../database/migrations/0019_personal_workspace_backfill.sql', import.meta.url));
const sql = readFileSync(migration, 'utf8');

async function freshSchema() {
  const schema = `b21_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

async function user(pool: pg.Pool, label: string) {
  const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
  await pool.query(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`, [id, `${label}.${id}@flowboard.example`, label]);
  return id;
}

async function ownedCount(pool: pg.Pool, userId: string) {
  return Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM workspaces WHERE owner_id = $1', [userId])).rows[0]!.n);
}

async function totalWorkspaces(pool: pg.Pool) {
  return Number((await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM workspaces')).rows[0]!.n);
}

test('B-21 0019: a user with no workspace gets one fixed-name personal workspace, and a second run inserts nothing', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const userId = await user(db.pool, 'backfill');
    assert.equal(await ownedCount(db.pool, userId), 0);

    await db.pool.query(sql);
    const rows = await db.pool.query<{ id: string; name: string; timezone: string }>(
      'SELECT id, name, timezone FROM workspaces WHERE owner_id = $1', [userId],
    );
    assert.equal(rows.rows.length, 1, 'one workspace after the first run');
    assert.equal(rows.rows[0]!.name, 'Personal workspace', 'the fixed internal name, never the person name');
    assert.equal(rows.rows[0]!.id, `ws_${crypto.createHash('md5').update(userId).digest('hex')}`, 'the id is derived from the user');
    assert.equal(rows.rows[0]!.timezone, 'UTC');

    const before = await totalWorkspaces(db.pool);
    await db.pool.query(sql);
    await db.pool.query(sql);
    assert.equal(await totalWorkspaces(db.pool), before, 'a second and third run insert 0 rows');
    assert.equal(await ownedCount(db.pool, userId), 1);
  } finally {
    await db.close();
  }
});

test('B-21 0019: existing workspaces and their projects survive the migration unchanged', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const owner = await user(db.pool, 'kept');
    await db.pool.query(
      `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
       VALUES ('ws_kept', 'Kept Workspace', 'Europe/Paris', $1, 4, NOW(), NOW())`, [owner],
    );
    await db.pool.query(
      `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
       VALUES ('prj_kept', 'ws_kept', 'Kept', NULL, FALSE, 1, NOW(), NOW())`,
    );
    await db.pool.query(sql);
    await db.pool.query(sql);
    const ws = await db.pool.query<{ name: string; timezone: string; version: number }>('SELECT name, timezone, version FROM workspaces WHERE id = $1', ['ws_kept']);
    assert.deepEqual(ws.rows[0], { name: 'Kept Workspace', timezone: 'Europe/Paris', version: 4 });
    assert.equal(await ownedCount(db.pool, owner), 1, 'no second workspace for a person who already has one');
    assert.equal((await db.pool.query('SELECT 1 FROM projects WHERE id = $1', ['prj_kept'])).rowCount, 1);
  } finally {
    await db.close();
  }
});

test('B-21 0019: the owner index exists, and boards.created_by is nullable with a foreign key to users', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    await db.pool.query(sql);
    await db.pool.query(sql);
    const idx = await db.pool.query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_workspaces_owner'`);
    assert.equal(idx.rowCount, 1);
    const col = await db.pool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'boards' AND column_name = 'created_by'`,
    );
    assert.equal(col.rows[0]?.is_nullable, 'YES');
    const fk = await db.pool.query(`SELECT 1 FROM pg_constraint WHERE conname = 'boards_created_by_fkey' AND conrelid = 'boards'::regclass`);
    assert.equal(fk.rowCount, 1);
  } finally {
    await db.close();
  }
});

test('B-21 0019: the backfill waits for a live sign-in that holds the same user lock, and creates no second workspace', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const userId = await user(db.pool, 'racing');
    // The sign-in helper takes the user lock and inserts, but has not committed yet.
    const signIn = await db.pool.connect();
    await signIn.query('BEGIN');
    await ensurePersonalWorkspace(signIn, userId);

    const migrating = db.pool.query(sql);
    let finished = false;
    migrating.then(() => { finished = true; }, () => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(finished, false, 'the backfill waits while the sign-in holds the lock');

    await signIn.query('COMMIT');
    signIn.release();
    await migrating;
    assert.equal(await ownedCount(db.pool, userId), 1, 'exactly one workspace: the one the sign-in made');
    const row = await db.pool.query<{ name: string }>('SELECT name FROM workspaces WHERE owner_id = $1', [userId]);
    assert.equal(row.rows[0]!.name, 'Personal workspace');
  } finally {
    await db.close();
  }
});
