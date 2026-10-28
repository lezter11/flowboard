# Independent Backend Acceptance Review Session: CRD-01

**Feature ID**: CRD-01 (Quick card creation & ranking)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-01:
- `docs/reviews/CRD-01/criteria.json` (frozen criteria)
- `docs/reviews/CRD-01/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-01/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Card quick creation: POST /api/v1/boards/:boardId/cards creates card with title and columnId, defaulting priority=none, dueDate=null, assigneeIds=[]**:
   - Endpoint mounted in `apps/api/src/http/routes/cards.ts:39-109`. Validates `createCardInputSchema` from `packages/contracts/src/cards.ts:17-37`. Defaults `priority='none'`, `dueDate=null`, and `assigneeIds=[]`. Insert verified in `apps/api/src/adapters/cards.ts:324-351` with database defaults. Verified in test step 1 of `apps/api/test/crd01-crd11.test.ts`.

2. **Permission check: Workspace owner, project manager, or project member can create cards; viewers receive 403 FORBIDDEN**:
   - `createCard` calls `acquireWriteGrantLock(client, board.project_id, actorId, 'member')` in `apps/api/src/adapters/cards.ts:263`. Owners, project managers, and project members pass; viewers and outsiders are rejected with 403 FORBIDDEN. Verified in test step 1: Alice (owner), Bob (manager), and Charlie (member) succeed; Diana (viewer) receives 403 FORBIDDEN.

3. **Position rank allocation: Assigns unique position integer at the bottom of the target column**:
   - Column position query `SELECT COALESCE(MAX(position), 0)::TEXT AS max_pos FROM cards WHERE column_id = $1 AND state = 'active'` in `apps/api/src/adapters/cards.ts:309-316` allocates `position = maxPos + 1000`. Verified in test step 1 where successive cards in Todo column obtain positions 1000, 2000, and 3000.

4. **Board version check: Verifies expectedBoardVersion matches board structure_version; increments structure_version on success**:
   - Board structure version checked in `apps/api/src/adapters/cards.ts:266-271` returning `409 STALE_BOARD_VERSION` on mismatch. Atomic increment `structure_version = structure_version + 1, snapshot_version = snapshot_version + 1` executed in lines 365-372. Verified in test step 1 where stale board version is rejected with 409.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-01/reviewer-session.md`, `docs/reviews/CRD-01/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Quick card creation & ranking according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-01/reviewer-session.md`, `docs/reviews/CRD-01/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-01/reviewer-session.md`, `docs/reviews/CRD-01/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-01/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-01/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-01/reviewer-session.md`, `docs/reviews/CRD-01/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Column Bottom Position Allocation and Board Structure Versioning
When Alice quick-adds a card 'Setup CI' to the Todo column, Flowboard reads the current highest position rank in that column (e.g. 2000) and writes the new card with position 3000. Simultaneously, it increments the parent board's `structure_version` from 1 to 2 within the same transaction.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Using 1000-based integer increments permits amortized O(1) bottom appends without scanning or rebalancing existing cards. Updating `structure_version` provides an atomic version coordinate that lets connected clients detect column topology changes.
- **Drawback**: Continuous insertions between adjacent items can eventually exhaust integer gaps, requiring a recompaction routine when gap <= 1.
- **Alternatives**: Linked lists (require sequential traversal and multi-row pointer locks) or fractional floating-point positions (suffer from floating-point precision loss in JavaScript engines).
