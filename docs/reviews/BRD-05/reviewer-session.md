# Independent Reviewer Session: BRD-05

**Feature**: Reorder columns & placement neighbor calculation  
**Auditor Session ID**: `36197b2b-27b3-41c7-952f-dfc6518e6990`  
**Builder Session ID**: `8f4f343f-8836-4b64-8563-c36b797ba880`  
**Review Date**: 2026-10-26 13:23:24 UTC  
**Role**: Independent Backend Acceptance Auditor (Luna / Flowboard Gate Guard)

---

## 1. System Design Teaching Note: Full-Set Column Reordering and Relative Placement Calculation

In every Flowboard audit, architectural decisions must be grounded in concrete system design trade-offs.

- **Flowboard Concrete Context & Example**:
  To reorder columns, the client sends `columnIds: [colC, colA, colB]`. Flowboard verifies that this array is an exact permutation of all active columns on the board. For card placement, GET .../placement?movingCardId=c1&at=before&anchorCardId=c3 returns `{ previousCardId: c2, nextCardId: c3 }`.

- **Benefits & Invariants Enforced**:
  Prevents dropped columns during reorder and decouples frontend UI drag-and-drop mechanics from internal rank algorithms.

- **Trade-offs & Operational Drawbacks**:
  Reorder requests must supply all column IDs rather than partial diffs.

- **Alternatives Considered & Why Rejected**:
  Pairwise column swaps (rejected: suffers from race conditions when multiple users reorder concurrently).

---

## 2. Independent Verification & Acceptance Evaluation

The auditor independently reviewed the implementation files, database queries, and test executions:

- Target implementation: `apps/api/src/adapters/boards.ts` and `apps/api/src/http/routes/boards.ts`
- Contracts schema: `packages/contracts/src/boards.ts`
- Test suite: `apps/api/test/brd01-brd07.test.ts`
- Verified test log: [`docs/reviews/BRD-05/test.log`](docs/reviews/BRD-05/test.log)

All frozen criteria pass unconditionally. No blockers or security escapes detected.
