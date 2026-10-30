import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// FB-AUD-07 regression. Each run migrates a new schema from empty, so nothing else shares its tables.
const url = localDatabaseUrl(process.env['DATABASE_URL']);
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0015_project_links_workspace_fk.sql', import.meta.url));

async function freshSchema() {
  const schema = `b7_m15_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
  return {
    schema,
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

test('B-7 migration 0015: 0001 to 0015 migrate clean from empty, and a second run changes nothing', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const applied = await db.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    assert.equal(applied.rows.at(-1)!.version, '0015');
    assert.equal(applied.rows.length, 15, 'migrations 0001 to 0015 are all recorded');
    await runMigrations(db.pool);
    const again = await db.pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM schema_migrations');
    assert.equal(again.rows[0]!.n, '15');
  } finally {
    await db.close();
  }
});

test('B-7 migration 0015: the SQL file runs twice without error', async () => {
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

test('B-7 migration 0015: a link cannot name a workspace other than its project\'s', async () => {
  const db = await freshSchema();
  try {
    await runMigrations(db.pool);
    const s = crypto.randomBytes(4).toString('hex');
    const now = 'now()';
    await db.pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('u_${s}','u${s}@flowboard.example','U',${now},${now})`);
    for (const ws of ['wsA', 'wsB']) {
      await db.pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,${now},${now})`, [`${ws}_${s}`, `u_${s}`]);
    }
    await db.pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',${now},${now})`, [`pB_${s}`, `wsB_${s}`]);

    const insert = (workspaceId: string, projectId: string, id: string) =>
      db.pool.query(
        `INSERT INTO project_links (id,workspace_id,project_id,title,url,position,created_at,updated_at)
         VALUES ($1,$2,$3,'Docs','https://example.com',0,${now},${now})`,
        [id, workspaceId, projectId],
      );

    await assert.rejects(insert(`wsA_${s}`, `pB_${s}`, `link_bad_${s}`), (err: any) => {
      assert.equal(err.code, '23503', 'foreign_key_violation');
      assert.equal(err.constraint, 'project_links_project_workspace_fk');
      return true;
    });
    const mismatched = await db.pool.query('SELECT 1 FROM project_links WHERE id = $1', [`link_bad_${s}`]);
    assert.equal(mismatched.rowCount, 0);

    // The same project with its own workspace is accepted.
    await insert(`wsB_${s}`, `pB_${s}`, `link_ok_${s}`);
    const ok = await db.pool.query('SELECT 1 FROM project_links WHERE id = $1', [`link_ok_${s}`]);
    assert.equal(ok.rowCount, 1);
  } finally {
    await db.close();
  }
});
