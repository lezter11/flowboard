import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
const migrationsDir = new URL('../../../database/migrations/', import.meta.url);

test('migration 0009 numbers existing cards and derives project prefixes without changing data', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async () => {
  const schema = `m9_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 2, options: `-c search_path=${schema}` });
  try {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const before = files.filter((f) => f < '0009');
    for (const f of before) await pool.query(fs.readFileSync(new URL(f, migrationsDir), 'utf8'));

    // Two projects with different names; cards inserted before the migration.
    await pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('u','u@m9.test','U',NOW(),NOW())`);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC','u',NOW(),NOW())`);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p1','w','Brand Fashion',NOW(),NOW()), ('p2','w','!!',NOW(),NOW())`);
    await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ('b1','w','p1','B',NOW(),NOW())`);
    await pool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,category,color,position,created_at,updated_at) VALUES ('c1','w','p1','b1','Todo','todo','#fff',0,NOW(),NOW())`);
    await pool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,version,state,created_at,updated_at)
      VALUES ('k1','w','p1','b1','c1','first','none',1,1,'active','2026-01-01T00:00:00Z',NOW()),
             ('k2','w','p1','b1','c1','second','none',2,1,'active','2026-01-02T00:00:00Z',NOW())`);
    const cardsBefore = (await pool.query(`SELECT id, title, position FROM cards ORDER BY id`)).rows;

    await pool.query(fs.readFileSync(new URL('0009_card_keys_and_key_prefix.sql', migrationsDir), 'utf8'));

    const prefixes = Object.fromEntries((await pool.query(`SELECT id, key_prefix FROM projects`)).rows.map((r) => [r.id, r.key_prefix]));
    assert.equal(prefixes['p1'], 'BRA', 'letters of the name, first three, uppercased');
    assert.equal(prefixes['p2'], 'PRJ', 'name without letters or digits falls back to PRJ');

    const numbers = Object.fromEntries((await pool.query(`SELECT id, card_number FROM cards`)).rows.map((r) => [r.id, Number(r.card_number)]));
    assert.ok(numbers['k1']! < numbers['k2']!, 'older card gets the lower number');

    const cardsAfter = (await pool.query(`SELECT id, title, position FROM cards ORDER BY id`)).rows;
    assert.deepEqual(cardsAfter, cardsBefore, 'existing card data unchanged');

    const next = Number((await pool.query(`SELECT nextval('card_key_seq') AS n`)).rows[0].n);
    assert.ok(next > Math.max(numbers['k1']!, numbers['k2']!), 'the sequence continues past backfilled numbers');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
