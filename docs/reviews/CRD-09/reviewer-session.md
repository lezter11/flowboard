# Independent Backend Acceptance Review Session: CRD-09

**Feature ID**: CRD-09 (Filter-aware placement calculation)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-09:
- `docs/reviews/CRD-09/criteria.json` (frozen criteria)
- `docs/reviews/CRD-09/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-09/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Filtered movement compatibility: Placement calculations operate against full canonical column order even when UI is filtered**:
   - `getPlacement` in `apps/api/src/adapters/cards.ts:844-855` queries all active column cards from the database ordered by `position ASC, id ASC`. It ignores transient UI filters (e.g. assignee, priority, keyword search), ensuring neighbor coordinates are canonical. Verified in test step 8.

2. **Move menu bounds: Ensures keyboard/tap move operations target valid canonical positions**:
   - By resolving against canonical column records, keyboard/tap move menus receive valid neighbor IDs that exist in the database, avoiding dangling pointer errors on `POST .../move`. Verified in test step 8.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-09/reviewer-session.md`, `docs/reviews/CRD-09/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Filter-aware placement calculation according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-09/reviewer-session.md`, `docs/reviews/CRD-09/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-09/reviewer-session.md`, `docs/reviews/CRD-09/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-09/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-09/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-09/reviewer-session.md`, `docs/reviews/CRD-09/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Canonical Database Ordering vs. Ephemeral Filtered Views
A developer filters the board to view only 'High Priority' cards. In the Todo column, there are 5 cards: cards 1 (low), 2 (high), 3 (medium), 4 (high), 5 (low). The UI only displays cards 2 and 4. When the developer moves card 4 'before card 2', the placement query calculates neighbors against the full 5-card list, placing card 4 at the true top before card 1.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Guarantees data integrity across team members: moving a card in a filtered view will not accidentally jump over hidden cards or corrupt column structure.
- **Drawback**: The moving card's final position relative to hidden cards may surprise users if they do not realize the view is filtered.
- **Alternatives**: Relative placement against visible cards only (distorts true column ranking for other users who are viewing the full board).
