# Independent Backend Acceptance Review Session: CRD-11

**Feature ID**: CRD-11 (Card mutation idempotency)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-11:
- `docs/reviews/CRD-11/criteria.json` (frozen criteria)
- `docs/reviews/CRD-11/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-11/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Idempotent card mutations: POST /boards/:boardId/cards and POST /cards/:cardId/move enforce mandatory Idempotency-Key**:
   - `requireIdempotencyKey` in `apps/api/src/http/routes/cards.ts:28-36` validates header on POST create and move. Missing key immediately returns `400 IDEMPOTENCY_KEY_REQUIRED`. Verified in test step 11.

2. **Replay handling: Replayed identical requests return original receipt without duplicate side-effects**:
   - `checkOrReplayReceipt` and `saveReceipt` in `apps/api/src/adapters/idempotency.ts` store SHA-256 request payload hash and response JSON inside the same DB transaction. Replays return original 201/200 response with `replayed: true`. Replay with changed body returns `409 IDEMPOTENCY_CONFLICT`. Verified in test step 11.

3. **Field validation error formatting: Invalid fields return 422 VALIDATION_ERROR with structured issues**:
   - Zod schema validation failures return `422 VALIDATION_ERROR` with structured issues array containing path and message. Verified in test step 11.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-11/reviewer-session.md`, `docs/reviews/CRD-11/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Card mutation idempotency according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-11/reviewer-session.md`, `docs/reviews/CRD-11/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-11/reviewer-session.md`, `docs/reviews/CRD-11/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-11/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-11/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-11/reviewer-session.md`, `docs/reviews/CRD-11/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Transactional Idempotency Receipts with Request Fingerprinting
A mobile client dispatches `POST /api/v1/boards/brd_1/cards` with `Idempotency-Key: idem_abc123`. The database inserts the card and saves an idempotency receipt containing the request body's SHA-256 hash. If the cellular connection drops before the HTTP response reaches the phone, the phone retries with the same key. Flowboard detects the receipt, skips card insertion, and returns the previous response with `replayed: true`.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Guarantees exactly-once mutation semantics even across transient network drops and aggressive client retries.
- **Drawback**: Requires storage for idempotency receipts and periodic cleanup of expired keys.
- **Alternatives**: Client-generated UUIDs without receipt hashing (fails to detect duplicate keys submitted with conflicting payloads).
