import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-14 migration 0017. Each run migrates a fresh schema, so nothing else shares its tables.
const url = localDatabaseUrl(process.env['DATABASE_URL']);
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0017_audit_round_b14.sql', import.meta.url));

async function freshSchema() {
  const schema = `b14_m17_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

test('B-14 migration 0017: 0001 to 0017 migrate from empty and the file runs twice without error', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const sql = readFileSync(migrationPath, 'utf8');
    await db.pool.query(sql);
    await db.pool.query(sql);
  } finally {
    await db.close();
  }
});

test('B-14 migration 0017: rate_limit_windows rejects a negative request_count and accepts zero', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    await assert.rejects(
      db.pool.query(
        `INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count)
         VALUES ('invite-inviter', 'usr_x', 1, -1)`,
      ),
      (err: any) => {
        assert.equal(err.code, '23514', 'check_violation');
        assert.equal(err.constraint, 'rate_limit_windows_request_count_nonnegative');
        return true;
      },
    );
    await db.pool.query(
      `INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count)
       VALUES ('invite-inviter', 'usr_x', 2, 0)`,
    );
  } finally {
    await db.close();
  }
});

test('B-14 migration 0017: the child-side indexes exist', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const names = await db.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname IN ('project_links_workspace_idx', 'board_grants_granted_by_idx')
       ORDER BY indexname`,
    );
    assert.deepEqual(
      names.rows.map((r) => r.indexname),
      ['board_grants_granted_by_idx', 'project_links_workspace_idx'],
    );
  } finally {
    await db.close();
  }
});

test('B-14 migration 0017: a settled outbox row without settled_at is backfilled from created_at on re-run; pending rows stay unsettled', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const s = crypto.randomBytes(4).toString('hex');
    const createdAt = '2026-01-01T00:00:00Z';
    await db.pool.query(
      `INSERT INTO users (id, email, display_name, created_at, updated_at)
       VALUES ($1, $2, 'U', $3, $3)`,
      [`u_${s}`, `u${s}@flowboard.example`, createdAt],
    );
    await db.pool.query(
      `INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at)
       VALUES ($1, 'WS', 'UTC', $2, $3, $3)`,
      [`ws_${s}`, `u_${s}`, createdAt],
    );
    await db.pool.query(
      `INSERT INTO projects (id, workspace_id, name, created_at, updated_at)
       VALUES ($1, $2, 'P', $3, $3)`,
      [`p_${s}`, `ws_${s}`, createdAt],
    );
    await db.pool.query(
      `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, next_retry_at, created_at)
       VALUES ($1, $2, $3, 'invitation.created', '{}', 'delivered', $4, $4),
              ($5, $2, $3, 'invitation.created', '{}', 'pending', $4, $4)`,
      [`out_done_${s}`, `ws_${s}`, `p_${s}`, createdAt, `out_wait_${s}`],
    );

    await db.pool.query(readFileSync(migrationPath, 'utf8'));

    const rows = await db.pool.query<{ id: string; settled_at: Date | null }>(
      'SELECT id, settled_at FROM outbox WHERE id = ANY($1) ORDER BY id',
      [[`out_done_${s}`, `out_wait_${s}`]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.settled_at]));
    assert.equal(byId.get(`out_done_${s}`)?.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(byId.get(`out_wait_${s}`), null);
  } finally {
    await db.close();
  }
});
