import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

test('PostgreSQL Migrations & Relational Integrity Suite', async (t) => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env['DATABASE_URL']),
    max: 2,
    connectionTimeoutMillis: 2_000,
  });

  before(async () => {
    // Reset schema to ensure migration is tested from a clean state.
    const client = await pool.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
  });

  await t.test('1. Runs migrations and records applied versions', async () => {
    const result = await runMigrations(pool);
    assert.equal(result.applied.length >= 3, true);
    assert.equal(result.applied[0]?.version, '0001');
    assert.equal(result.applied[0]?.name, '0001_initial.sql');
    assert.equal(result.applied[1]?.version, '0002');
    assert.equal(result.applied[1]?.name, '0002_sessions.sql');
    assert.equal(result.applied[2]?.version, '0003');
    assert.equal(result.applied[2]?.name, '0003_constraints.sql');

    // Verify schema_migrations table has the record
    const client = await pool.connect();
    try {
      const queryRes = await client.query('SELECT version, name FROM schema_migrations WHERE version = $1', ['0001']);
      assert.equal(queryRes.rows.length, 1);
      assert.equal(queryRes.rows[0].version, '0001');
      assert.equal(queryRes.rows[0].name, '0001_initial.sql');

      const queryRes2 = await client.query('SELECT version, name FROM schema_migrations WHERE version = $1', ['0002']);
      assert.equal(queryRes2.rows.length, 1);
      assert.equal(queryRes2.rows[0].version, '0002');
      assert.equal(queryRes2.rows[0].name, '0002_sessions.sql');

      const queryRes3 = await client.query('SELECT version, name FROM schema_migrations WHERE version = $1', ['0003']);
      assert.equal(queryRes3.rows.length, 1);
      assert.equal(queryRes3.rows[0].version, '0003');
      assert.equal(queryRes3.rows[0].name, '0003_constraints.sql');
    } finally {
      client.release();
    }
  });

  await t.test('2. Migration runner is idempotent: subsequent runs apply 0 migrations', async () => {
    const result = await runMigrations(pool);
    assert.equal(result.applied.length, 0);
  });

  await t.test('3. Relational integrity: inserting valid full hierarchy', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      // 1. user
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['usr_alice', 'alice@example.com', 'Alice Owner', 'https://example.com/avatar.png', now, now]
      );

      // 2. workspace
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['ws_acme', 'Acme Corp', 'UTC', 'usr_alice', 1, now, now]
      );

      // 3. project
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['prj_flowboard', 'ws_acme', 'Flowboard Core', 'Core development project', false, 1, now, now]
      );

      // 4. project membership
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['pm_alice_flowboard', 'prj_flowboard', 'ws_acme', 'usr_alice', 'manager', 'active', 1, now, now]
      );

      // 5. board
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['brd_sprint1', 'ws_acme', 'prj_flowboard', 'Sprint 1', 1, 1, false, now, now]
      );

      // 6. column
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        ['col_todo', 'ws_acme', 'prj_flowboard', 'brd_sprint1', 'To Do', '#3b82f6', 'todo', 0, 1, now, now]
      );

      // 7. card
      await client.query(
        `INSERT INTO cards (
           id, workspace_id, project_id, board_id, column_id, title, description,
           priority, due_date, position, version, state, deleted_at, deleted_by,
           restore_until, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          'crd_task1', 'ws_acme', 'prj_flowboard', 'brd_sprint1', 'col_todo',
          'Implement PostgreSQL migrations', 'DDL and migration runner',
          'urgent', '2026-11-01', 1000, 1, 'active', null, null,
          null, now, now
        ]
      );

      // 8. comment
      await client.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        ['cmt_comment1', 'ws_acme', 'prj_flowboard', 'crd_task1', 'usr_alice', 'Initial implementation ready', 1, null, now, now]
      );

      // 9. image (card_images)
      await client.query(
        `INSERT INTO card_images (
           id, workspace_id, project_id, card_id, uploader_id, filename,
           byte_length, content_type, storage_key, sha256, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          'img_diagram1', 'ws_acme', 'prj_flowboard', 'crd_task1', 'usr_alice', 'schema.png',
          4096, 'image/png', 'keys/schema.png', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          now, now
        ]
      );

      // 10. receipt (idempotency_receipts)
      await client.query(
        `INSERT INTO idempotency_receipts (
           id, actor_id, scope_type, scope_id, idempotency_key,
           method_path_hash, body_hash, status_code, response_body, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'rcp_mutation1', 'usr_alice', 'project', 'prj_flowboard', 'idem_key_hier_001',
          'path_hash_val', 'body_hash_val', 201, JSON.stringify({ data: { id: 'crd_task1' } }),
          expiresAt, now
        ]
      );

      // 11. outbox
      await client.query(
        `INSERT INTO outbox (
           id, workspace_id, project_id, event_type, payload, status,
           retry_count, next_retry_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'obx_event1', 'ws_acme', 'prj_flowboard', 'card.created',
          JSON.stringify({ cardId: 'crd_task1' }), 'pending', 0, now, now
        ]
      );

      // Verify all 11 records exist
      const countChecks = [
        ['workspaces', 'ws_acme'],
        ['users', 'usr_alice'],
        ['projects', 'prj_flowboard'],
        ['project_memberships', 'pm_alice_flowboard'],
        ['boards', 'brd_sprint1'],
        ['columns', 'col_todo'],
        ['cards', 'crd_task1'],
        ['comments', 'cmt_comment1'],
        ['card_images', 'img_diagram1'],
        ['idempotency_receipts', 'rcp_mutation1'],
        ['outbox', 'obx_event1'],
      ];

      for (const [table, id] of countChecks) {
        const checkRes = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
        assert.equal(checkRes.rows.length, 1, `Expected record in ${table} with id ${id}`);
      }
    } finally {
      client.release();
    }
  });

  await t.test('4. Negative foreign key test: card with invalid column_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO cards (
               id, workspace_id, project_id, board_id, column_id, title, description,
               priority, due_date, position, version, state, deleted_at, deleted_by,
               restore_until, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              'crd_bad_col', 'ws_acme', 'prj_flowboard', 'brd_sprint1', 'col_non_existent',
              'Orphan card', null, 'none', null, 2000, 1, 'active', null, null,
              null, now, now
            ]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('5. Negative unique test: duplicate column name on same board throws error code 23505', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            ['col_todo_dup', 'ws_acme', 'prj_flowboard', 'brd_sprint1', 'To Do', '#10b981', 'todo', 1, 1, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string };
          assert.equal(pgError.code, '23505', 'Expected unique violation code 23505');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('6. Negative unique test: duplicate project membership throws error code 23505', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            ['pm_alice_dup', 'prj_flowboard', 'ws_acme', 'usr_alice', 'member', 'active', 1, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string };
          assert.equal(pgError.code, '23505', 'Expected unique violation code 23505');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('7. Restricted delete: deleting a column with active card throws error code 23503', async () => {
    const client = await pool.connect();

    try {
      await assert.rejects(
        async () => {
          await client.query('DELETE FROM columns WHERE id = $1', ['col_todo']);
        },
        (err: unknown) => {
          const pgError = err as { code?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key restriction code 23503');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('8. Negative foreign key test: inserting workspace with non-existent owner_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            ['ws_orphan', 'Orphan Workspace', 'UTC', 'usr_non_existent', 1, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_workspaces_owner');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('9. Restricted delete: deleting a user who owns an active workspace is blocked (ON DELETE RESTRICT)', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      // Create a user who only owns a workspace (no project memberships or other references)
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['usr_owner_only', 'owner_only@example.com', 'Owner Only', null, now, now]
      );
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['ws_owner_only', 'Owner Only Corp', 'UTC', 'usr_owner_only', 1, now, now]
      );

      await assert.rejects(
        async () => {
          await client.query('DELETE FROM users WHERE id = $1', ['usr_owner_only']);
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key restriction code 23503');
          assert.equal(pgError.constraint, 'fk_workspaces_owner');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('10. Tenant ancestry: inserting project_memberships with mismatched workspace_id and project_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      // Create a second workspace owned by Alice
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['ws_second', 'Second Corp', 'UTC', 'usr_alice', 1, now, now]
      );

      // Create a separate user who is not already a member of prj_flowboard
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['usr_carol', 'carol@example.com', 'Carol Member', null, now, now]
      );

      // Attempt to link project from ws_acme (prj_flowboard) with ws_second
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            ['pm_mismatch', 'prj_flowboard', 'ws_second', 'usr_carol', 'member', 'active', 1, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_project_memberships_project_workspace');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('11. Tenant ancestry: inserting board with mismatched workspace_id and project_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      // Attempt to link board to prj_flowboard (which belongs to ws_acme) but with workspace ws_second
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            ['brd_mismatch', 'ws_second', 'prj_flowboard', 'Mismatched Board', 1, 1, false, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_boards_project_workspace');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('12. Tenant ancestry: inserting column with mismatched board_id, project_id, and workspace_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      // Create project 2 in ws_second
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['prj_second', 'ws_second', 'Project 2', null, false, 1, now, now]
      );

      // Attempt to link column with board from prj_flowboard (brd_sprint1) but under prj_second
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            ['col_mismatch', 'ws_second', 'prj_second', 'brd_sprint1', 'Cross Column', '#3b82f6', 'todo', 0, 1, now, now]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_columns_board_project_workspace');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('13. Relational integrity: inserting card with mismatched column_id and board_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      // Create board 2 in prj_second (ws_second)
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['brd_second', 'ws_second', 'prj_second', 'Sprint 2', 1, 1, false, now, now]
      );

      // Create column on board 2
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        ['col_second_todo', 'ws_second', 'prj_second', 'brd_second', 'To Do', '#3b82f6', 'todo', 0, 1, now, now]
      );

      // Attempt to insert card on brd_sprint1 referencing col_second_todo (from brd_second)
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO cards (
               id, workspace_id, project_id, board_id, column_id, title, description,
               priority, due_date, position, version, state, deleted_at, deleted_by,
               restore_until, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              'crd_mismatch_col', 'ws_acme', 'prj_flowboard', 'brd_sprint1', 'col_second_todo',
              'Cross Board Card', null, 'none', null, 3000, 1, 'active', null, null,
              null, now, now
            ]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_cards_column_board');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('14. Tenant ancestry: inserting outbox event with mismatched project_id and workspace_id throws error code 23503', async () => {
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO outbox (
               id, workspace_id, project_id, event_type, payload, status,
               retry_count, next_retry_at, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              'obx_mismatch', 'ws_second', 'prj_flowboard', 'card.created',
              JSON.stringify({ cardId: 'crd_task1' }), 'pending', 0, now, now
            ]
          );
        },
        (err: unknown) => {
          const pgError = err as { code?: string; constraint?: string };
          assert.equal(pgError.code, '23503', 'Expected foreign key violation code 23503');
          assert.equal(pgError.constraint, 'fk_outbox_project_workspace');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  await t.test('15. Migration failure rollback evidence: failed migration leaves schema and tracking table unpolluted', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-test-mig-'));
    try {
      const failingSql = `
        CREATE TABLE temp_fail_rollback_test (id TEXT PRIMARY KEY);
        THIS IS DELIBERATELY INVALID SQL SCRIPT SYNTAX;
      `;
      await fs.writeFile(path.join(tempDir, '9999_failing_migration.sql'), failingSql, 'utf8');

      // Executing migration should fail and throw
      await assert.rejects(async () => {
        await runMigrations(pool, { migrationsDir: tempDir });
      });

      // Verify transaction rollback: table was NOT created, version was NOT recorded
      const client = await pool.connect();
      try {
        const tableCheck = await client.query(
          "SELECT to_regclass('public.temp_fail_rollback_test') as tbl;"
        );
        assert.equal(tableCheck.rows[0]?.tbl, null, 'Expected rolled-back table to not exist');

        const migrationCheck = await client.query(
          'SELECT version FROM schema_migrations WHERE version = $1',
          ['9999']
        );
        assert.equal(migrationCheck.rows.length, 0, 'Expected failed migration to not be recorded in schema_migrations');
      } finally {
        client.release();
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('16. Migration concurrency evidence: concurrent runMigrations calls serialize cleanly via advisory lock', async () => {
    // Run three concurrent migration runs against the same pool
    const results = await Promise.all([
      runMigrations(pool),
      runMigrations(pool),
      runMigrations(pool),
    ]);

    // All should resolve without lock deadlocks or errors
    for (const res of results) {
      assert.ok(Array.isArray(res.applied));
      // Since migrations were already applied, all concurrent runs should report 0 applied migrations
      assert.equal(res.applied.length, 0);
    }
  });
});
