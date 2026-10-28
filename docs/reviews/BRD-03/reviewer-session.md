# Independent Reviewer Session: BRD-03

**Feature**: Board snapshot & people disclosure  
**Auditor Session ID**: `36197b2b-27b3-41c7-952f-dfc6518e6990`  
**Builder Session ID**: `8f4f343f-8836-4b64-8563-c36b797ba880`  
**Review Date**: 2026-10-26 13:23:24 UTC  
**Role**: Independent Backend Acceptance Auditor (Luna / Flowboard Gate Guard)

---

## 1. System Design Teaching Note: Bounded Composite Snapshot with Identity Disclosure

In every Flowboard audit, architectural decisions must be grounded in concrete system design trade-offs.

- **Flowboard Concrete Context & Example**:
  A board detail view renders columns, initial cards, and teammate avatars in one HTTP round-trip. GET /api/v1/boards/:boardId returns columns with up to 10 initial cards each, plus a people array containing only users assigned to or creating cards on that board.

- **Benefits & Invariants Enforced**:
  Avoids waterfall requests from the frontend while preventing unconstrained data leaks across project boundaries.

- **Trade-offs & Operational Drawbacks**:
  Snapshots for very dense boards require pagination cursor resumption for columns with >10 cards.

- **Alternatives Considered & Why Rejected**:
  Separate endpoints for board, columns, cards, and users (rejected: causes visible UI pop-in and multiple round-trips).

---

## 2. Independent Verification & Acceptance Evaluation

The auditor independently reviewed the implementation files, database queries, and test executions:

- Target implementation: `apps/api/src/adapters/boards.ts` and `apps/api/src/http/routes/boards.ts`
- Contracts schema: `packages/contracts/src/boards.ts`
- Test suite: `apps/api/test/brd01-brd07.test.ts`
- Verified test log: [`docs/reviews/BRD-03/test.log`](docs/reviews/BRD-03/test.log)

All frozen criteria pass unconditionally. No blockers or security escapes detected.
