# Independent Backend Acceptance Review Session: CRD-05

**Feature ID**: CRD-05 (Priority & due date validation)  
**Reviewer Actor ID**: `independent-backend-auditor`  
**Reviewer Session ID**: `5a01873c-03fc-4d41-a899-50666318b657`  
**Reviewer Model**: `antigravity-independent-reviewer`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for CRD-05:
- `docs/reviews/CRD-05/criteria.json` (frozen criteria)
- `docs/reviews/CRD-05/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/CRD-05/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/cards.ts` (card adapter operations and queries)
- `apps/api/src/http/routes/cards.ts` (card HTTP routing and idempotency)
- `apps/api/test/crd01-crd11.test.ts` (isolated PostgreSQL integration test suite)
- `packages/contracts/src/cards.ts` (Zod schemas and contracts)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Priority and due date editing: PATCH /api/v1/cards/:cardId updates priority (none/low/medium/high/urgent) and dueDate**:
   - `prioritySchema` (`packages/contracts/src/cards.ts:9-11`) and `nullableDateOnlySchema` (`packages/contracts/src/common.ts:38-42`) validate fields. Adapter updates `priority` and `due_date` in `apps/api/src/adapters/cards.ts:499-550`. Verified in test step 5.

2. **Gregorian date validation: Due date validated as YYYY-MM-DD Gregorian date, rejecting invalid leap years and dates**:
   - `isValidGregorianDate` in `packages/contracts/src/common.ts:18-36` and adapter check in `apps/api/src/adapters/cards.ts:503-507` validates leap years and calendar days. Rejects '2026-02-29' (non-leap year) and '2025-04-31' with 422 VALIDATION_ERROR, accepts '2028-02-29' (leap year). Verified in test step 5.

3. **OCC version enforcement: Enforces expectedVersion check on update**:
   - `updateCard` verifies `card.version === input.expectedVersion` before applying priority or dueDate updates, bumping version on success. Verified in test step 5.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict role-based authorization enforced via `acquireWriteGrantLock` and `resolveProjectRole`. Anti-enumeration privacy returns 404 NOT_FOUND to sibling and outsider users, preventing metadata leakage.
  *Evidence*: `docs/reviews/CRD-05/reviewer-session.md`, `docs/reviews/CRD-05/test.log`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Complete implementation of Priority & due date validation according to contracts in `packages/contracts/src/cards.ts`. Accurate status codes (200, 201, 400, 403, 404, 409, 422) and structured error envelopes.
  *Evidence*: `docs/reviews/CRD-05/reviewer-session.md`, `docs/reviews/CRD-05/test.log`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Atomic transactions with row-level locking (`FOR UPDATE`), strict OCC checks on card version and board structure version, and transactional idempotency receipts preventing duplicate side-effects.
  *Evidence*: `docs/reviews/CRD-05/reviewer-session.md`, `docs/reviews/CRD-05/test.log`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Comprehensive node:test integration suite covering positive cases, negative cases, boundary conditions, and concurrent race scenarios against real isolated PostgreSQL 17 test database. All 12 suite tests pass.
  *Evidence*: `apps/api/test/crd01-crd11.test.ts`, `docs/reviews/CRD-05/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean architecture cleanly decoupling HTTP routes, database adapters, and shared contracts. Strict TypeScript typechecking with 0 errors.
  *Evidence*: `npm run typecheck`, `docs/reviews/CRD-05/test.log`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Efficient indexing, batch count aggregations avoiding N+1 queries, bounded body sizes, and guaranteed connection release via finally blocks.
  *Evidence*: `docs/reviews/CRD-05/reviewer-session.md`, `docs/reviews/CRD-05/test.log`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Deterministic Calendar Validation vs. Lexical Date Formats
A naive regex `^\d{4}-\d{2}-\d{2}$` permits dates like '2026-02-29' or '2025-04-31'. Flowboard parses year, month, and day against the astronomical Gregorian calendar, checking leap year conditions `(year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)`.

#### Benefits, Drawbacks and Alternatives
- **Benefit**: Prevents downstream database cast errors, timezone conversion anomalies, and silent deadline corruption in calendar views and notification engines.
- **Drawback**: Requires comprehensive unit test matrices for February 28/29 across century and quadrennial leap years.
- **Alternatives**: Full ISO 8601 timestamps with times (introduces user timezone ambiguity for whole-day deadlines).
