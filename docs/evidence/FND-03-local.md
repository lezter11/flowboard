# FND-03 — PostgreSQL Schema and Migrations Evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for FND-03**.

## Scope and Files

- Schema Migration: `database/migrations/0001_initial.sql` (PostgreSQL 17-compatible initial schema defining all 21 canonical Flowboard tables).
  - `workspaces`: Versioning, timezone, owner reference.
  - `users`: Unique email, display name, avatar URL.
  - `projects`: Workspace foreign key with `ON DELETE RESTRICT`, archived flag.
  - `project_memberships`: Scoped roles (`manager`, `member`, `viewer`), status (`active`, `removed`), `UNIQUE(project_id, user_id)`.
  - `project_invitations`: Scoped role, token hash, expiry timestamp, status.
  - `boards`: Project foreign key, `structure_version`, `snapshot_version`, archived flag.
  - `columns`: Category (`todo`, `active`, `done`), color, position, `UNIQUE(board_id, name)`.
  - `cards`: Calendar-only `due_date` (`DATE`), fractional rank position (`BIGINT`), priority, `state` (`active`, `trashed`, `purged`), exact 24-hour restore deadline `restore_until`, `ON DELETE RESTRICT` on column.
  - `card_assignees`: Composite PK `(card_id, user_id)`, `ON DELETE CASCADE` on card.
  - `comments`: Author reference, markdown body, version, soft delete timestamp.
  - `comment_mentions`: UTF-16 code unit offset bounds, user reference, `ON DELETE CASCADE`.
  - `activity_log`: Actor reference, action, safe changes `JSONB`, `card_id ON DELETE SET NULL`.
  - `notifications`: Actor-scoped, unread flag, payload metadata.
  - `card_images`: Storage key, MIME type, byte length, SHA-256 digest.
  - `card_image_uploads`: Upload lifecycle state machine, digest, expiry.
  - `card_imports`: 7-column Excel import session state, preview digest, expiry.
  - `card_import_rows`: Row number, external ID, title, outcome enum, error `JSONB`.
  - `card_import_duplicates`: Composite PK `(board_id, external_id)`, row hash, card reference.
  - `idempotency_receipts`: Unique `(actor_id, scope_id, idempotency_key)`, status code, response `JSONB`.
  - `outbox`: Transactional outbox events, status, retry count, next retry instant.
  - `schema_migrations`: Version PK, migration name, applied timestamp.
- Migration Runner Adapter: `apps/api/src/adapters/migrations.ts`.
  - Implements session advisory locking via `pg_advisory_lock(hashtext('flowboard_migrations'))` to serialize concurrent multi-instance boots.
  - Executes pending migrations inside atomic `BEGIN ... COMMIT` blocks.
  - Records applied versions in `schema_migrations`.
  - Idempotent: subsequent runs detect applied migrations and apply 0 migrations.
- Automated Test Suite: `apps/api/test/migrations.test.ts`.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors across monorepo.

2. **Automated Migration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/migrations.test.ts
   ```
   Result: **7 passed, 0 failed, 0 skipped** across 7 test cases (~110ms):
   - Migration `0001_initial.sql` applied cleanly and recorded in `schema_migrations`.
   - Idempotent rerun applied 0 migrations without error.
   - Relational integrity: full hierarchy insert succeeded across all 21 tables.
   - Negative foreign key test: invalid `column_id` on card threw error code `23503`.
   - Negative unique test: duplicate column name on same board threw error code `23505`.
   - Negative unique test: duplicate project membership threw error code `23505`.
   - Negative delete restrict test: deleting a column with an active card threw error code `23503`.

3. **Subagent Independent Audit**:
   - Evaluated by `FND-03 Validation Auditor` against 4 pre-established criteria:
     - 1. Schema & Model Completeness: 2.5 / 2.5
     - 2. Relational Integrity & Constraints: 2.5 / 2.5
     - 3. Migration Runner Adapter: 2.5 / 2.5
     - 4. Automated Verification Test Suite: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Passed with distinction.

## Limitations

- Verified against local PostgreSQL 17.11 container. Cloud migrations and remote connection pools (Hyperdrive / Neon) are evaluated during deployment tasks.
- Forward-only migrations; down-migrations are not implemented per Flowboard forward-migration policy.
