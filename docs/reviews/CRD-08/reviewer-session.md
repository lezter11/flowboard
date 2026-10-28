# Independent Backend Acceptance Review Session: CRD-08

**Feature ID**: CRD-08 (Placement calculation)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-08:
- `docs/reviews/CRD-08/criteria.json` (frozen criteria)
- `docs/reviews/CRD-08/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-08/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Placement query: GET /api/v1/boards/:boardId/columns/:columnId/placement computes canonical neighbors for moving card**:
   - Mounted in `apps/api/src/http/routes/cards.ts:279-294`. Handled by `getPlacement` in `apps/api/src/adapters/cards.ts:810-905`. Resolves target column and returns `previousCardId`, `nextCardId`, and `structureVersion`. Verified in test step 8.

2. **Placement positions: Supports at=first, at=last, at=before, at=after with anchorCardId**:
   - Tested and verified in `apps/api/src/adapters/cards.ts:862-896` for all 4 placement targets: `first` (prev: null, next: head), `last` (prev: tail, next: null), `before` (prev: predecessor, next: anchor), `after` (prev: anchor, next: successor). Missing or foreign anchor cards return 422 VALIDATION_ERROR. Verified in test step 8.

3. **Neighbor exclusion: Excludes the moving card itself from neighbor calculation**:
   - `getPlacement` filters out `movingCardId` in line 854 (`const columnCards = cardsRes.rows.filter((c) => c.id !== input.movingCardId)`). Ensures moving a card within its own column computes correct relative neighbors without self-referential cycles. Verified in test step 8.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-08/reviewer-session.md`, `docs/reviews/CRD-08/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Placement calculation according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-08/reviewer-session.md`, `docs/reviews/CRD-08/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-08/reviewer-session.md`, `docs/reviews/CRD-08/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-08/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-08/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-08/reviewer-session.md`, `docs/reviews/CRD-08/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Server-Side Canonical Placement Resolution for Accessible and Drag-and-Drop UIs
When a user drags a card in the Kanban UI or uses keyboard navigation (e.g. 'Move to top of In Progress'), the client calls `GET .../placement?movingCardId=crd_1&at=first`. The server determines the true current head of the column and returns `{ previousCardId: null, nextCardId: 'crd_2', structureVersion: 4 }`.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Eliminates client-side ordering guesswork, synchronizes with the server's authoritative board topology, and provides the exact board structure version required for the subsequent move mutation.
- **Drawback**: Requires an HTTP round-trip prior to dispatching the move mutation.
- **Alternatives**: Client computes neighbors from local memory (fails when other users move cards concurrently, leading to 409 collisions).
