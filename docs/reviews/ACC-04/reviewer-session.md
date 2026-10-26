# Independent Backend Reviewer Session Evidence: ACC-04

- **Feature ID**: ACC-04 (Workspace Creation and Owner Atomicity Suite)
- **Reviewer Identity**:
  - **Actor ID**: `independent-backend-auditor`
  - **Session ID**: `263f7d31-5f0e-47eb-a161-7e0ed9504854`
  - **Model**: `antigravity-independent-reviewer`
  - **Independent**: `true`
  - **Fresh Context**: `true`
  - **Implemented Target**: `false`
- **Builder Identity**:
  - **Actor ID**: `flowboard-builder`
  - **Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
  - **Model**: `gpt-6.1-sol-medium`
- **Audit Date**: 2026-10-26
- **Criteria Reference**: `docs/reviews/ACC-04/criteria.json` (`criteriaVersion`: `backend-review-v1`)

---

## 1. Scope and Target Manifest Verification

Reachable source files audited in read-only mode:
- `docs/reviews/ACC-04/criteria.json`
- `docs/reviews/ACC-04/reviewer-session.md`
- `docs/reviews/ACC-04/test.log`
- `apps/api/src/adapters/idempotency.ts`
- `apps/api/src/http/routes/workspaces.ts`
- `apps/api/src/http/middleware/auth.ts`
- `apps/api/src/adapters/session.ts`
- `apps/api/test/acc04-workspaces.test.ts`

---

## 2. Security and Correctness Invariant Verification

### Criterion 1: Single-owner workspace atomicity
- `apps/api/src/http/routes/workspaces.ts`: Creation executes inside a PostgreSQL transaction (`BEGIN ... COMMIT`). The workspace record is created with `owner_id = actor.id`, ensuring the authenticated actor is the sole initial owner. Zero uncommitted or orphan records on failure. Verified by test #4 in `acc04-workspaces.test.ts`.

### Criterion 2: Mandatory Idempotency-Key
- `POST /api/v1/workspaces`: Checks `c.req.header('idempotency-key')` with `idempotencyKeySchema.safeParse`. Missing or keys < 16 chars or > 128 chars return HTTP 400 `IDEMPOTENCY_KEY_REQUIRED` with a structured error envelope. Verified by test #2 in `acc04-workspaces.test.ts`.

### Criterion 3: Idempotency replay
- `checkOrReplayReceipt` checks for an existing active receipt (`expires_at > NOW()`). If matching method path and canonical body hash, returns HTTP 201 with `replayed: true` and the identical response payload. The transaction is rolled back so no duplicate workspace is inserted. Verified by test #5 in `acc04-workspaces.test.ts`.

### Criterion 4: Idempotency conflict
- `checkOrReplayReceipt` detects duplicate key with differing body or path hash and raises HTTP 409 `IDEMPOTENCY_CONFLICT` (`Idempotency key collision with different request payload.`). Verified by test #6 in `acc04-workspaces.test.ts`.

### Criterion 5: Concurrent duplicate-key safety
- When two requests with the same key race concurrently, `saveReceipt` uses `ON CONFLICT (actor_id, scope_id, idempotency_key) DO UPDATE SET ... WHERE expires_at <= NOW() RETURNING id`. If 0 rows return, the losing transaction re-reads the winner's receipt and returns `replayed: true` without throwing an unhandled PostgreSQL 500 error. Verified by tests #8 and #9 in `acc04-workspaces.test.ts`.

### Criterion 6: Receipt expiration
- Receipts past TTL (`expires_at <= NOW()`) are excluded from `checkOrReplayReceipt` and overwritten by `saveReceipt`'s conditional `DO UPDATE WHERE expires_at <= NOW()`. This allows keys to be safely reused after expiration. Verified by test #10 in `acc04-workspaces.test.ts`.

### Criterion 7: Authentication enforcement
- Unauthenticated requests are rejected by `authMiddleware` before any database queries with HTTP 401 `UNAUTHORIZED`. Verified by test #1 in `acc04-workspaces.test.ts`.

### Criterion 8: Input validation
- Empty name or invalid timezone is caught by `createWorkspaceInputSchema` via `parseOrThrow`, returning HTTP 422 `VALIDATION_ERROR` with structured issues. Verified by test #3 in `acc04-workspaces.test.ts`.

---

## 3. Test Execution and Evidence

- **Commands Run**:
  1. `npm run typecheck`
     - Result: Clean pass, exit code 0 (`tsc --noEmit`).
  2. `WRANGLER_SEND_METRICS=false node --test apps/api/test/acc04-workspaces.test.ts`
     - Result: 11 tests passed, 0 failed, 0 skipped, exit code 0.
- **Evidence Path**: `docs/reviews/ACC-04/test.log`

---

## 4. Category Scoring and Rationale

| Category | Weight | Minimum | Score | Rationale |
|---|---:|---:|---:|---|
| **Security and authority boundaries** | 30 | 9.0 | **9.6** | Authentication required on all workspace endpoints; single-owner assignment guarantees no workspace created without an owner; idempotency keys scoped by actor_id prevents cross-tenant replay collision attacks. |
| **Functional and API correctness** | 25 | 8.5 | **9.8** | Strict enforcement of `docs/API.md v0.3`; clean 201 Created (with `replayed: false` or `true`), 400 IDEMPOTENCY_KEY_REQUIRED, 401 UNAUTHORIZED, 409 IDEMPOTENCY_CONFLICT, and 422 VALIDATION_ERROR responses; canonical JSON serialization with sorted keys guarantees deterministic body hashes. |
| **Data integrity and concurrency** | 15 | 8.5 | **9.7** | Full transactional atomicity (`BEGIN ... COMMIT`); parallel concurrent requests tested with Promise.all and direct multi-client saveReceipt races; no duplicate workspaces and no 500 unique violation errors. |
| **Test quality and independent evidence** | 15 | 8.5 | **9.7** | Comprehensive 11-test suite with real PostgreSQL database; covers validation, unauthenticated calls, happy-path creation, exact replays, body conflicts, concurrent racing clients, and expired receipt key reuse. |
| **Maintainability and portability** | 10 | 7.5 | **9.4** | Clean separation between workspace routes and idempotency adapter; reusable across all mutating endpoints (projects, cards, etc.); fully typed with TypeScript strict mode. |
| **Operations, performance and failure recovery** | 5 | 7.0 | **9.2** | 7-day TTL on receipts with clean index-backed queries; graceful transaction rollbacks on conflicts and replays prevent resource leaks and database bloat. |

### Weighted Score Computation
- Total: `(9.6 * 30 + 9.8 * 25 + 9.7 * 15 + 9.7 * 15 + 9.4 * 10 + 9.2 * 5) / 100`
- `(288.0 + 245.0 + 145.5 + 145.5 + 94.0 + 46.0) / 100 = 964.0 / 100 = 9.64`
- Unrounded score: `9.64` (> 8.5 threshold). All category minimums met.

---

## 5. Findings, Blockers, and Verdict

- **Hard Blockers**: None (`[]`).
- **Coverage Gaps**: None (`[]`).
- **Findings**:
  - Finding `ACC-04-F01`: Background worker cleanup job for expired idempotency receipts is scheduled for future background task as noted in frozen criteria scope. Disposition: `resolved` (nonblocking, matches frozen criteria scope exclusions).
- **Verdict**: `pass`
