# Independent Backend Acceptance Review Session: CRD-10

**Feature ID**: CRD-10 (Concurrent move/edit conflict handling)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-10:
- `docs/reviews/CRD-10/criteria.json` (frozen criteria)
- `docs/reviews/CRD-10/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-10/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Concurrent edit conflict handling: Rejects stale card edits with 409 STALE_VERSION**:
   - `updateCard` checks `card.version !== input.expectedVersion` in `apps/api/src/adapters/cards.ts:470-475`. Throws `HttpError.conflict('STALE_VERSION', ...)` with currentVersion in error details. Verified in test step 10.

2. **Concurrent move conflict handling: Rejects stale card moves with 409 STALE_VERSION or 409 STALE_BOARD_VERSION**:
   - `moveCard` evaluates both card version and board structure version in `apps/api/src/adapters/cards.ts:648-661`. Rejects stale moves with either `409 STALE_VERSION` or `409 STALE_BOARD_VERSION` and attaches current version coordinates. Verified in test step 10.

3. **Preserve client data: Error envelope provides current version details allowing client to re-read and preserve unsaved draft**:
   - `HttpError` serializer formats structured error payload `{ error: { code: 'STALE_VERSION', message, details: { currentVersion, expectedVersion } } }`. Clients receive exact current version metadata allowing background refresh without losing local draft text. Verified in test step 10.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-10/reviewer-session.md`, `docs/reviews/CRD-10/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Concurrent move/edit conflict handling according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-10/reviewer-session.md`, `docs/reviews/CRD-10/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-10/reviewer-session.md`, `docs/reviews/CRD-10/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-10/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-10/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-10/reviewer-session.md`, `docs/reviews/CRD-10/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Structured Conflict Envelopes for Seamless Client Draft Recovery
If Alice is writing a lengthy card description while Bob changes the card's priority, Alice's subsequent save is rejected with 409 STALE_VERSION. The response body includes `details: { currentVersion: 3, expectedVersion: 2 }`.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Rather than wiping out Alice's unsaved text, the client uses `currentVersion: 3` to fetch Bob's update in the background and prompt Alice with a non-destructive merge diff.
- **Drawback**: Requires frontend UI logic to render conflict notifications and preserve form state.
- **Alternatives**: Blind overwriting (silent data loss) or generic 400 Bad Request (lacks version context for automated recovery).
