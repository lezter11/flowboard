# Independent Reviewer Session Evidence: FND-01

## 1. Independence and Audit Metadata
- **Feature ID**: FND-01 (PostgreSQL migrations, relational integrity & constraints)
- **Reviewer Actor ID**: `independent-backend-reviewer`
- **Reviewer Session ID**: `b54e0975-7baf-4cac-99fe-0f396b9bb498`
- **Implementer Actor ID**: `builder`
- **Implementer Session ID**: `builder-session-id`
- **Reviewer Model**: `gemini-2.5-pro`
- **Fresh Context**: Yes, clean auditor session with no implementation crossover
- **Read-Only Audit**: Reviewer did not write or modify production code under audit
- **Environment**: macOS arm64, Node.js 24.15.0, PostgreSQL 17 isolated synthetic test database

## 2. Reachable Scope and Source Verification
- `apps/api/src/adapters/migrations.ts`:
  - `runMigrations(poolOrClient, options)`:
    - Connects to PostgreSQL and acquires a session-level advisory lock:
      `SELECT pg_advisory_lock(hashtext('flowboard_migrations'))`
    - Ensures `schema_migrations` tracking table exists.
    - Scans migration directory (`database/migrations`), sorts files in ascending version order (`0001_initial.sql`, `0002_sessions.sql`, `0003_constraints.sql`).
    - For each unapplied migration: opens a transaction (`BEGIN`), executes the SQL, records the version in `schema_migrations`, and commits (`COMMIT`).
    - If any error occurs, executes `ROLLBACK` immediately and rethrows, leaving the database clean and tracking table unpolluted.
    - In `finally`: releases the advisory lock via `SELECT pg_advisory_unlock(hashtext('flowboard_migrations'))`.
- `database/migrations/0001_initial.sql`, `0002_sessions.sql`, `0003_constraints.sql`:
  - `0001_initial.sql`: Sets up users, workspaces, projects, project_memberships, boards, columns, cards, etc.
  - `0002_sessions.sql`: Sets up sessions table.
  - `0003_constraints.sql`: Enforces foreign keys:
    - `fk_workspaces_owner`: `FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT`.
    - Composite unique and foreign key constraints enforcing matching `(project_id, workspace_id)` across project_memberships, project_invitations, boards, columns, cards, outbox_events, activity_log, and notifications.

## 3. Mandatory Criteria Evaluation
1. **PostgreSQL baseline**: Verified. Migrations apply cleanly and idempotently (subsequent runs detect all migrations are applied and execute 0 statements).
2. **Restricted foreign keys**: Verified. Deleting a user who owns an active workspace is blocked by PostgreSQL constraint `fk_workspaces_owner` with error code `23503` (foreign key violation). Inserting a workspace with non-existent owner is also rejected with `23503`.
3. **Advisory locks**: Verified. `executeMigrationsWithClient` serializes concurrent migration executions via `pg_advisory_lock(hashtext('flowboard_migrations'))`. Test 16 runs parallel `runMigrations` calls simultaneously and confirms clean serialized execution without deadlocks or races.
4. **Failure rollback**: Verified. Test 15 injects a migration with a deliberate syntax error. The runner executes `ROLLBACK`, leaving no partial tables or tracking table entries.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/migrations.test.ts`
All 17 tests passed:
- Runs migrations and records applied versions (pass)
- Migration runner is idempotent (pass)
- Relational integrity: inserting valid full hierarchy (pass)
- Negative foreign key test: card with invalid column_id throws 23503 (pass)
- Negative unique test: duplicate column name throws 23505 (pass)
- Negative unique test: duplicate project membership throws 23505 (pass)
- Restricted delete: deleting column with active card throws 23503 (pass)
- Negative foreign key test: workspace with non-existent owner throws 23503 (pass)
- Restricted delete: deleting user who owns active workspace blocked (pass)
- Tenant ancestry: mismatched workspace_id and project_id on membership, board, column, card, outbox (5 tests, all pass)
- Migration failure rollback evidence (pass)
- Migration concurrency evidence via advisory locks (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
When multiple instances of a backend service boot up simultaneously (e.g. in Kubernetes or auto-scaling clusters), they may all attempt to run database migrations at the exact same second.
- **The Problem**: If two servers execute `CREATE TABLE` or `ALTER TABLE` at the same time, PostgreSQL can suffer race conditions, lock deadlocks, or failed starts.
- **The Solution (PostgreSQL Advisory Locks)**:
  - Flowboard uses `pg_advisory_lock(hashtext('flowboard_migrations'))`.
  - Advisory locks are application-defined locks managed entirely by PostgreSQL's lock manager. They do not lock any physical rows or tables.
  - When Server 1 starts migrations, it acquires the advisory lock. When Server 2 starts, it waits patiently on the lock. Once Server 1 finishes and releases the lock, Server 2 enters, inspects `schema_migrations`, sees that all versions are applied, and exits cleanly in milliseconds.
- **Benefits**: Bulletproof coordination without needing external coordination tools like ZooKeeper or Redis.
- **Drawbacks**: Must ensure `pg_advisory_unlock` is always invoked in a `finally` block or on client disconnect.
- **Alternatives Considered**: File locks (useless across multiple containers/machines) or optimistic locks on a table (can produce dirty read races).
