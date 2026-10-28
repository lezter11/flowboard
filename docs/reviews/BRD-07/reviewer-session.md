# Independent Reviewer Session: BRD-07

**Feature**: Paginated cards query with bound cursors & filters  
**Auditor Session ID**: `36197b2b-27b3-41c7-952f-dfc6518e6990`  
**Builder Session ID**: `8f4f343f-8836-4b64-8563-c36b797ba880`  
**Review Date**: 2026-10-26 13:23:24 UTC  
**Role**: Independent Backend Acceptance Auditor (Luna / Flowboard Gate Guard)

---

## 1. System Design Teaching Note: Cryptographically Bound Keyset Pagination with Topology Versioning

In every Flowboard audit, architectural decisions must be grounded in concrete system design trade-offs.

- **Flowboard Concrete Context & Example**:
  Client fetches page 1 of board cards filtered by priority=urgent. Flowboard returns 50 cards and nextCursor encoding { boardId, filterHash: sha256('||urgent||'), structureVersion: 4, position: 5000, id: 'c50' }. If another user moves a card (bumping structureVersion to 5) or if the client alters filters to priority=high, the next request with that cursor returns 409 STALE_CURSOR.

- **Benefits & Invariants Enforced**:
  Prevents silent data corruption, skipped cards, or duplicate cards when clients page through mutating boards.

- **Trade-offs & Operational Drawbacks**:
  Clients must handle 409 STALE_CURSOR by resetting pagination to page 1.

- **Alternatives Considered & Why Rejected**:
  Offset-based pagination (causes duplicate/omitted rows when items are added/removed) or unbound cursors (silently miss cards when ordering changes).

---

## 2. Independent Verification & Acceptance Evaluation

The auditor independently reviewed the implementation files, database queries, and test executions:

- Target implementation: `apps/api/src/adapters/boards.ts` and `apps/api/src/http/routes/boards.ts`
- Contracts schema: `packages/contracts/src/boards.ts`
- Test suite: `apps/api/test/brd01-brd07.test.ts`
- Verified test log: [`docs/reviews/BRD-07/test.log`](docs/reviews/BRD-07/test.log)

All frozen criteria pass unconditionally. No blockers or security escapes detected.
