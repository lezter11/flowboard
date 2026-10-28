# Flowboard Test Suite & Board-Access Test Inventory

Updated: 2026-10-28  
Owner: Backend & QA Verification (Handoff H11)

---

## 1. Executive Summary & Test Counts

Flowboard employs a multi-tiered test harness spanning shared Zod contract schemas (`@flowboard/contracts`) and HTTP/adapter integration suites (`@flowboard/api`).

| Test Suite | Baseline (Default Harness) | Full Suite (with `FLOWBOARD_ACCESS_TEST_DATABASE_URL`) | Status |
|:---|:---:|:---:|:---:|
| **Contracts** (`@flowboard/contracts`) | **41 passed** / 0 skipped | **41 passed** / 0 skipped | 100% Pass |
| **API** (`@flowboard/api`) | **310 passed** / **13 skipped** (323 total) | **397 passed** / **0 skipped** (397 total) | 100% Pass |
| **Total Test Assertions** | **351 passed** / **13 skipped** (364 total) | **438 passed** / **0 skipped** (438 total) | 100% Pass |

> **Note on Test Counts**: Counts were re-measured on 2026-10-28 with `npm test` in `apps/api` (DATABASE_URL on an isolated synthetic container). Without `FLOWBOARD_ACCESS_TEST_DATABASE_URL`, the Node test runner reports 323 root tests: 310 pass and 13 skipped. With it set to a disposable `flowboard_access_test` database, all 397 pass and 0 are skipped. Node counts each skipped `test()` once, so the skipped group is not the same as the number of nested `t.test` assertions. The earlier 395 figure is out of date.

---

## 2. Safety Gate Rationale: Why 13 Tests Skip by Default

The 13 board-access tests are intensive concurrency, lock-ordering, and mounted authorization tests. They execute:
- Dynamic schema creation (`access_test_*`, `board_acc_*`, `conc_*`, `lo_*`) to ensure clean test isolation.
- Full DDL migration runs (0001 through 0008) inside each isolated schema.
- High connection concurrency (allocating up to 16 PostgreSQL connections simultaneously).
- Lock-order inversion and deadlock probes inspecting `pg_stat_database` and `pg_stat_activity`.
- Destructive schema cascade drops on teardown.

### Why an Explicit Environment Variable is Required

```typescript
const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
test('...', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async () => {
  const url = new URL(testUrl!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') {
    throw new Error('Use only the disposable local board-access database.');
  }
  // ...
});
```

1. **Isolation & Concurrency Protection**: Running forced lock-contention or deadlock probes against a shared local database (such as the default `flowboard_harness` on port 55432) or a remote development/UAT branch could exhaust connections, induce transaction rollbacks, or clobber state.
2. **Double-Fence Safety Gate**:
   - Gate 1: The test runner skips unless `FLOWBOARD_ACCESS_TEST_DATABASE_URL` is explicitly declared.
   - Gate 2: The test code verifies that the target hostname is strictly loopback (`localhost`, `127.0.0.1`, or `[::1]`) and the database name is strictly `flowboard_access_test`. It aborts immediately if pointed at any other database name or remote host.

---

## 3. Inventory of the 13 Board-Access Tests

Below is the complete inventory of the 13 board-access test suites across 11 test files in `apps/api/test/`:

| # | File | Line | Test Name | Key Verifications & Assertions |
|---|---|---|---|---|
| 1 | `apps/api/test/board-access-activity-notifications.test.ts` | 12 | `mounted activity and notifications enforce board access` | **Activity & Mention Privacy**: Verifies mounted activity and notification endpoints redact boards where user lacks grant; revoking board grant immediately invalidates pagination cursors; serializes read and mark operations against concurrent grant revocation. |
| 2 | `apps/api/test/board-access-boards-imports-trash.test.ts` | 12 | `mounted board, import and trash routes require current board access` | **Route Protection**: Verifies mounted HTTP routes for board details (`GET /boards/:id`), column updates, card imports (`POST /boards/:id/imports`), and trash viewing (`GET /projects/:id/trash`). Non-owners without an active board grant receive consistent 404s without leaking board existence. |
| 3 | `apps/api/test/comment-move-replay.test.ts` | 40 | `comment POST and card move on one card interleave without deadlock (review R2-01)` | **Deadlock Prevention (R2-01)**: Exercises 8 consecutive rounds of concurrent comment creations (4 parallel requests) and card moves across columns. Asserts zero deadlock increments via `pg_stat_database.deadlocks`. |
| 4 | `apps/api/test/comment-move-replay.test.ts` | 69 | `a board-scoped replay after the grant is revoked returns 404 and no saved body (review R2-04)` | **Idempotent Replay Gate (R2-04)**: Ensures an idempotent request (`Idempotency-Key`) submitted before grant revocation returns 404 with no cached response body when replayed after revocation. |
| 5 | `apps/api/test/comment-move-replay.test.ts` | 131 | `replay after revocation: comment edit, comment delete, card trash and import commit (review R3-03)` | **Revocation Replay Gates (R3-03)**: Subtests verifying post-revocation replays fail closed with 404 across comment edits (`PATCH /comments/:id`), comment deletion (`DELETE /comments/:id`), card trashing (`DELETE /cards/:id`), and import commit (`POST /imports/:id/commit`). |
| 6 | `apps/api/test/board-access-cards-images.test.ts` | 14 | `mounted card discovery and image routes require a current board grant` | **Card & Image Security**: Verifies card search, card retrieval, image upload staging (`POST /cards/:id/images`), thumbnail fetching, and proxy delivery enforce board grants. Cards on non-granted boards remain hidden from project members. |
| 7 | `apps/api/test/board-grants-foundation.test.ts` | 10 | `unmounted board-grant foundation on isolated PostgreSQL` | **Core Adapter Logic**: Verifies `changeBoardGrant` and `lockBoardAccess`. Confirms Owner implicit access, blocks Manager self-elevation, verifies member removal clears grants without resurrection upon re-addition, validates `access_revision` OCC increments, and tests transactional DDL rollback. |
| 8 | `apps/api/test/board-access.test.ts` | 17 | `board access comprehensive integration on isolated PostgreSQL` | **End-to-End Specification (27 subtests)**: Comprehensive suite verifying Owner implicit rights, Manager board creation without auto-grant, Owner-only grant administration, member removal grant clearance, people picker disclosure, in-flight read authorization gates, and migration DDL rollback. |
| 9 | `apps/api/test/board-activity-scope-draft.test.ts` | 10 | `unmounted activity scope draft on isolated PostgreSQL` | **Activity Query Scoping**: Verifies `listScopedProjectActivityDraft` filters event logs by board grant prior to SQL `LIMIT`/pagination, preserves microsecond ordering, invalidates cursor on grant revocation, and prevents fabricated audit ancestry. |
| 10 | `apps/api/test/board-notification-scope-draft.test.ts` | 11 | `unmounted notification visibility draft on disposable PostgreSQL` | **Notification Visibility**: Verifies `listDraftNotifications` and mark read/all operations filter by board grant before pagination, hide legacy unclassified notifications, and ensure outbox lease worker checks board grants prior to delivering mention notifications. |
| 11 | `apps/api/test/board-grants-route-draft.test.ts` | 14 | `draft board grant routes on isolated PostgreSQL` | **Grant Administration Routes**: Verifies `GET /boards/:id/access` and `PUT /boards/:id/grants/:userId`. Tests 404 rejection for non-owners, optimistic concurrency control via `expectedAccessRevision`, and cursor pagination binding board, actor, and revision. |
| 12 | `apps/api/test/board-concurrency.test.ts` | 16 | `parallel writes on one board never deadlock into 500` | **Parallel Write Safety**: Executes parallel card creations and card movements under heavy concurrency. Verifies requests either succeed or return clean OCC conflicts (409) or retryable 503, never unhandled deadlocks or 500 server errors. |
| 13 | `apps/api/test/lock-order-interleave.test.ts` | 18 | `comment PATCH/DELETE, import commit and their controls never return a server error under forced interleaving` | **Forced Interleaving Probes (P1-P6)**: Uses helper connections holding board locks while HTTP requests queue; verifies that lock-order inversion deadlocks are resolved cleanly without 500 server errors. |

---

## 4. Reproducible Execution Guide

Follow these exact steps to run the complete, unskipped test suite:

### Step 1: Start Disposable PostgreSQL 17 Container

Choose an unused port (e.g. `55488`; do NOT use `55432`, `55479`, or `55492` which are reserved):

```bash
docker run -d \
  --name flowboard-test-h11 \
  -p 127.0.0.1:55488:5432 \
  -e POSTGRES_PASSWORD=test_only \
  -e POSTGRES_DB=flowboard_access_test \
  postgres:17-alpine
```

Verify the container is accepting connections:

```bash
docker exec flowboard-test-h11 pg_isready -U postgres
```

### Step 2: Execute Full Test Suite

Run the full API test suite with the database URL configured:

```bash
FLOWBOARD_ACCESS_TEST_DATABASE_URL=postgres://postgres:test_only@127.0.0.1:55488/flowboard_access_test \
  npm test --workspace @flowboard/api
```

Expected result:
```
ℹ tests 397
ℹ suites 9
ℹ pass 397
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Also run the contracts test suite:

```bash
npm test --workspace @flowboard/contracts
```

Expected result:
```
ℹ tests 41
ℹ suites 19
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### Step 3: Tear Down the Test Container

Clean up the disposable container after verification:

```bash
docker rm -f flowboard-test-h11
```
