# Independent Backend Acceptance Review Session: CRD-07

**Feature ID**: CRD-07 (Card movement & relative ranking)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-07:
- `docs/reviews/CRD-07/criteria.json` (frozen criteria)
- `docs/reviews/CRD-07/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-07/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Card movement: POST /api/v1/cards/:cardId/move moves card to destination column and position**:
   - Mounted in `apps/api/src/http/routes/cards.ts:207-276`. Requires Idempotency-Key. Executes `moveCard` in `apps/api/src/adapters/cards.ts:597-805` to update column and position atomically. Verified in test step 7.

2. **Relative neighbor calculation: Computes new position rank between previousCardId and nextCardId**:
   - `moveCard` calculates `position = Math.floor((prevPos + nextPos) / 2)` between neighbors (lines 769). Handles top placement as `Math.floor(nextPos / 2)` and bottom as `prevPos + 1000`. Detects compressed gaps (`gap <= 1`) and automatically calls `recompactColumnPositions` before assigning position. Verified in test step 7.

3. **Empty column handling: Handles null previousCardId and null nextCardId for empty column**:
   - When moving to an empty column with `previousCardId: null` and `nextCardId: null`, position defaults to 1000 (`apps/api/src/adapters/cards.ts:678-680`). Verified in test step 7 when moving card to Active column.

4. **Dual version check: Validates both expectedVersion (card) and expectedBoardVersion (board structure)**:
   - `moveCard` checks `card.version !== input.expectedVersion` (returning 409 STALE_VERSION) and `board.structure_version !== input.expectedBoardVersion` (returning 409 STALE_BOARD_VERSION) in lines 648-661. Atomically bumps both versions on success. Verified in test step 7.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-07/reviewer-session.md`, `docs/reviews/CRD-07/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Card movement & relative ranking according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-07/reviewer-session.md`, `docs/reviews/CRD-07/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-07/reviewer-session.md`, `docs/reviews/CRD-07/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-07/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-07/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-07/reviewer-session.md`, `docs/reviews/CRD-07/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Fractional Ranking, Column Recompaction, and Dual OCC Coordinates
Suppose cards A and B in the Todo column have positions 1000 and 2000. Moving card C between them assigns position 1500 without updating cards A or B. If many moves compress the gap to 1 (e.g. positions 1500 and 1501), Flowboard automatically recompacts the column with spacing 1000, 2000, 3000.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Enables O(1) single-row updates for card moves in the common case while dual OCC prevents race conditions between moving a card and concurrent column restructuring.
- **Drawback**: Recompaction locks the column cards for the duration of the re-indexing update.
- **Alternatives**: Full-column position rewriting on every move (causes high write amplification and database lock contention).
