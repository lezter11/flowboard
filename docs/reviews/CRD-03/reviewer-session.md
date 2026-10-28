# Independent Backend Acceptance Review Session: CRD-03

**Feature ID**: CRD-03 (Independent card detail query)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-03:
- `docs/reviews/CRD-03/criteria.json` (frozen criteria)
- `docs/reviews/CRD-03/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-03/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Card detail query: GET /api/v1/cards/:cardId returns full card entity including description and state**:
   - Mounted in `apps/api/src/http/routes/cards.ts:112-132`. Handler invokes `getCard` in `apps/api/src/adapters/cards.ts:380-433`. Returns complete `Card` entity including full description, state ('active'), restoreUntil, and counts. Verified in test step 3.

2. **Access verification: Granted project members can view card detail; ungranted users receive 404 NOT_FOUND**:
   - `getCard` checks `cardRow.state !== 'active'` and calls `resolveProjectRole(cardRow.project_id, actorId, poolOrClient)` in lines 404-412. If the user has no active grant in the card's project, it returns 404 NOT_FOUND. Sibling project member Eve and outsider Frank both receive 404. Verified in test step 3.

3. **Referenced people display: Response includes PersonDisplay for card assignees**:
   - For each assignee in `assigneeIds`, `getCard` fetches `PersonDisplay` via `getHistoricalPersonDisplay` in lines 420-427, returning display name, email, avatar, and active status in `response.people`. Verified in test step 3.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-03/reviewer-session.md`, `docs/reviews/CRD-03/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Independent card detail query according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-03/reviewer-session.md`, `docs/reviews/CRD-03/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-03/reviewer-session.md`, `docs/reviews/CRD-03/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-03/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-03/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-03/reviewer-session.md`, `docs/reviews/CRD-03/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Independent Authorization and Anti-Enumeration Sibling Privacy
Charlie is a member of Project Alpha. Eve is a member of Project Beta within the same workspace. If Eve attempts to access `GET /api/v1/cards/crd_alpha_123`, the API returns `404 NOT_FOUND`, not `403 FORBIDDEN`.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Returning 404 prevents IDOR (Insecure Direct Object Reference) and prevents attackers or sibling team members from guessing card IDs and verifying their existence.
- **Drawback**: Client developers troubleshooting authorization bugs cannot distinguish between a mistyped ID and a missing project grant without reviewing server audit logs.
- **Alternatives**: Hierarchical URL routing `/projects/:pid/boards/:bid/cards/:cid` (leaks hierarchy and still requires independent ID verification) or returning 403 (confirms resource existence).
