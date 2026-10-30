# Coverage and evidence

Independent read-only audit, frozen at HEAD `8cc31e26065b3351b68296a48163778744bd2f6c`. All database activity used the disposable PostgreSQL 17 Alpine container `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, bound only to `127.0.0.1:55634`; no hosted service was accessed. Raw command logs and outputs are in `raw/`.

## A. Migrations — PASS for application/data survival; FAIL for rollback/production-scale safety

- `database/migrations/0001`–`0016` applied through the application migration runner to an empty database. Output lists all 16 recorded migrations: `raw/db-migrations-0001-0016.out`.
- A second database was migrated through 0010, seeded with synthetic workspaces, projects, boards, cards, memberships, an invitation, and comment, then upgraded through 0016. Counts were unchanged (1 workspace, 2 projects, 2 boards, 3 cards, 2 members, 1 invitation, 1 comment); all 16 versions tracked: `raw/db-migrations-seeded.out`.
- Constraint probes rejected invalid URL (`23514`), duplicate project link position (`23505`), and a corrected cross-workspace project link (`23503`). An earlier cross-workspace fixture accidentally used the same workspace and printed `INVALID_LINK_ACCEPTED`; it was a bad test fixture, corrected and recorded in `raw/post-migration-checks.out`. Do not count the initial result as product evidence.
- Direct reruns of 0011–0016 succeeded on the upgraded database. This checks reapplication only; no down migrations or rollback scripts exist. Per-migration rollback/data-loss notes are in C-08 and the findings report.
- Destructive/rewrite/lock review: 0004 redacts every receipt row; 0008 backfills matching activity rows; 0009 backfills all project prefixes and all card numbers with a window sort, then enforces NOT NULL and builds a unique index. These steps were applied successfully on small fixtures but lock duration/WAL at production scale was **not covered**. 0013 unique/FK creation and 0015 FK validation also need production-sized lock planning.
- Earlier non-idempotent migrations 0003, 0004, 0006–0009 are not generally safe to re-run as raw SQL. Runner-based application is version-tracked; only 0011–0016 were directly rerun here.

## B. Privileges and constraints — FAIL for runtime role/index completeness

- Local compose sets the app/test database user as `POSTGRES_USER`, which is the local PostgreSQL bootstrap superuser. The exact role probe returned `rolsuper=true`, `rolcreatedb=true`, `rolcreaterole=true`, database CREATE=true, and allowed CREATE/ALTER/TRUNCATE/DROP inside a rollback transaction: `raw/db-runtime-role-ddl.log`. This is evidence about the local setup only; the production role/grants were **not covered**.
- New tables inspected from `pg_constraint`, `information_schema.columns`, and `pg_indexes`: `board_grants`, `pending_storage_deletions`, `project_links`, `rate_limit_windows`. All have primary keys and NOT NULL on required columns. FK delete actions are mostly deliberate RESTRICT for access/ancestry and no FKs for queue/limiter keys. `pending_storage_deletions.attempts` and `project_links` fields have checks; `rate_limit_windows.request_count` lacks a nonnegative check.
- Missing child-side/filter indexes: `project_links.workspace_id`, `board_grants.granted_by`. `project_links(project_id, position)` covers project-leading lookup. Existing project_id/board_id indexes serve the other single-column child references. User last-location FKs in 0012 have no child index; this can make target deletion scan users. Evidence: `raw/db-constraint-inspection.out`.
- Production minimum role split: non-owner runtime DML login (table-specific SELECT/INSERT/UPDATE/DELETE, schema USAGE, required sequence privileges only); separate migration owner/DDL principal; no superuser, role creation, database creation, TRUNCATE, arbitrary DDL, or `BYPASSRLS` on app/Worker runtime. Production grants and RLS behavior are **not covered**.

## C. Query plans — FAIL for broad scans/N+1; no observed query exceeded 100 ms

- Seeded 5,000 cards across 20 boards, 60 columns, with 5,000 comments, 500 images, 2,500 card-assignee rows, 5,000 activity rows, and 5,000 notifications; ran `ANALYZE`: `raw/db-seed-query-plans.out`.
- `EXPLAIN (ANALYZE, BUFFERS)` board-load listing: 2.407 ms; uses `idx_cards_board`, but aggregates scan comments, images and assignees across all boards before restricting to the selected board/page.
- Project overview plans: board count 0.028 ms; card counts 1.654 ms; assignee counts 1.549 ms; recent activity 0.043 ms. Project activity feed plan 0.045 ms. Small-table sequential scans are expected at this data size; no measured query exceeded 100 ms.
- Notification feed with 5,000 notifications: all feed 11.688 ms, unread-only 7.852 ms; both scan notifications and sort for the page. Full JSON plans: `raw/db-notification-plans-retry.out`.
- Source inspection found activity actor N+1 fanout up to page limit 100; query-count instrumentation and larger multi-tenant load test were **not covered**. Findings C-04/C-05 describe measured scans and source-evident N+1 separately.

## D. Orphan data — FAIL for direct hard-delete privacy; partial coverage for external objects

- Removed member via adapter: membership becomes `removed`, grants are removed, pending invite is revoked but retains recipient email; `listNotifications` hides the removed member's notifications, but rows remain: `raw/db-orphan-lifecycle-retry.out`.
- Direct card hard-delete SQL cascades image metadata, comments and mentions, but leaves notification private title/body and stale card URL, activity `safe_changes` title, and outbox entity IDs. No pending storage-delete row is created by a raw hard delete. This is the reproducible C-02 finding.
- Supported application purge path: card becomes a redacted purged tombstone; comment row/mention identity remain but comment body is blank; notification is redacted; activity payload is reduced to card ID/purged marker; image/upload rows disappear and two storage deletion keys are queued. A failing fake storage driver left retries; a successful fake driver processed both keys and emptied the queue. The external object bytes and real R2 behavior were **not covered**.
- Outbox rows remain after purge/delivery with card, author, comment and mention IDs. Project and board hard-delete attempts were blocked by RESTRICT FKs; user deletion was blocked by membership FK. No supported project/board/user hard-delete API was found in the inspected paths. External backup retention and physical privacy-erasure requirements were **not covered**.

## E. Invitation email — PASS for template injection/config/retry tests; FAIL for provider/DB exactly-once guarantee

- Reviewed current source and `git show` for commits `1eda522` and `8cc31e2` (B-12 theme and B-13 layout updates). User-controlled project/inviter text is bounded/control-character-stripped for subject/plain text and HTML-escaped in HTML contexts; role is mapped to static labels. Invite email is not inserted into template content and is JSON-serialized into Brevo's `to` field. API validation/normalization occurs in invitation routes/adapters.
- Accept links are built by delivery from validated configured `APP_ORIGIN` plus URL-encoded token. Sender/header values use JSON fields; the API endpoint is a fixed HTTPS Brevo URL. Brevo body, key, and recipient are not logged in inspected paths.
- Missing/incomplete mail settings disable send and leave the invitation outbox pending. Retry classification is 429/5xx/network retry; other non-2xx permanent; retry count/backoff and token removal on settled rows were exercised by the focused email suite. Provider acceptance followed by DB commit failure was not injected; see C-03.
- Ran `apps/api/test/b10-invitation-email.test.ts` against the disposable database: 17 passed, 0 failed (`raw/db-invitation-test.log`). Fake Brevo only; no live provider send or hosted template-client rendering.

## F. Cron safety — PASS for job isolation/row-claim design by code inspection; FAIL for exactly-once overlap guarantees; partial runtime coverage

- `worker.ts` runs trash purge, orphan upload cleanup, storage deletion, outbox, and rate-window cleanup sequentially within one invocation. `runIsolated` catches an error for each job, continues through remaining jobs, logs failed job names, then rethrows the first error. Thus one task's error does not block later tasks, but earlier successful work can commit before the overall run reports failure.
- Row-level locks/leases and `SKIP LOCKED` protect concurrent workers from processing the same DB row at the same time. There is no global scheduled-run lock. Email remains at-least-once if provider acceptance precedes a DB commit failure. No overlapping scheduled callbacks or commit-failure injection were run.
- Existing worker test exercises a clean scheduled callback, not overlap/failure isolation. Focused runtime failure/overlap tests and hosted Worker scheduling behavior are **not covered**.

## Attempts that failed and were corrected

- Sandbox Docker/loopback operations were denied (`permission denied` / `EPERM`); repeated the authorized local-only database work with escalation. No hosted resource was involved.
- `psql --version` failed with exit 127 because `psql` is not installed; all DB commands used the repository's Node `pg` dependency.
- Initial query-plan SQL and notification-plan SQL each had a missing closing parenthesis (PostgreSQL 42601); corrected query files succeeded. Initial board plan set is still usable for its five successful plans, but notifications were rerun separately.
- Initial orphan seed bound its `position`/title values in the wrong order (22P02); corrected fixture rerun succeeded.
- Initial email test attempt lacked the harness's `flowboard_harness` URL and failed its local guard; reran with explicit permission for the disposable audit URL (`ALLOW_REMOTE_DB=true`, port 55634), 17/17 passed.
- Initial cross-workspace link fixture reused the same workspace; corrected to a different workspace and observed the intended FK rejection.
- A final sandbox Docker version query could read the client but not the server API; earlier elevated Docker evidence is recorded in `raw/docker-version-elevated.out`.

