# Independent Backend Acceptance Review Session: CRD-06

**Feature ID**: CRD-06 (Teammate assignment bounds)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-06:
- `docs/reviews/CRD-06/criteria.json` (frozen criteria)
- `docs/reviews/CRD-06/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-06/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Teammate assignment: PATCH /api/v1/cards/:cardId updates assigneeIds array**:
   - Handled in `apps/api/src/http/routes/cards.ts:135-204` and `apps/api/src/adapters/cards.ts:512-526`. Atomic sync deletes old assignees from `card_assignees` and inserts new entries in a single transaction. Verified in test step 6.

2. **Active project member verification: All assigned user IDs must be active project members; rejects non-members or sibling users with 400 or 422**:
   - `validateAssigneeIds` in `apps/api/src/adapters/cards.ts:109-161` verifies each user ID is either the workspace owner or has an active project membership (`pm.status = 'active'`). Rejects sibling member Eve, outsider Frank, and removed member Grace with 422 VALIDATION_ERROR containing `invalidAssigneeIds`. Verified in test step 6.

3. **Assignee limit: Enforces maximum 20 assignees per card and uniqueness**:
   - Contracts enforce `.max(20)` and unique items in `packages/contracts/src/cards.ts:27-34, 50-56`. Adapter re-enforces check in `validateAssigneeIds:117-128`. Assigning 21 users rejected with 422 VALIDATION_ERROR. Verified in test step 6.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-06/reviewer-session.md`, `docs/reviews/CRD-06/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Teammate assignment bounds according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-06/reviewer-session.md`, `docs/reviews/CRD-06/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-06/reviewer-session.md`, `docs/reviews/CRD-06/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-06/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-06/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-06/reviewer-session.md`, `docs/reviews/CRD-06/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Project-Scoped Relational Invariants for Card Assignees
In a company workspace with multiple teams, Alice manages 'Project Alpha' and David manages 'Project Beta'. If a member of Alpha attempts to assign Eve (who only belongs to Beta) to a card in Alpha, Flowboard blocks the assignment with 422 VALIDATION_ERROR.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Enforces strict principle of least privilege, preventing accidental project data leakage and ensuring notifications are only dispatched to authorized project members.
- **Drawback**: Assigning cross-functional collaborators requires first granting them membership in the project.
- **Alternatives**: Workspace-wide assignment (breaks confidentiality between departments) or free-text assignee fields (lacks foreign key integrity).
