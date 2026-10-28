# Independent Backend Acceptance Review Session: AUD-01
**Feature**: Card activity timeline
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.423920+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `GET /api/v1/cards/:cardId/activity (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Chronological timeline retrieval: GET /api/v1/cards/:cardId/activity returns card events ordered chronologically (created_at ASC, id ASC)
- **Verification**: Verified in apps/api/src/adapters/activity.ts:listCardActivity. Tested in apps/api/test/aud-ntf.test.ts step AUD-01 with card_created, card_updated, card_moved, and comment_created returned in strict chronological sequence.

### [PASS] Comprehensive event coverage: Timeline captures card creation, field edits, assignees, movements, and comments with actor PersonDisplay hydration
- **Verification**: Verified in listCardActivity hydrating actor display via getHistoricalPersonDisplay with users table fallback. Tested in aud-ntf.test.ts with full actor and action verification.

### [PASS] Stable cursor pagination: Cursor encoding and decoding (timestamp + ID) guarantees pagination with limit without duplication or missing events
- **Verification**: Implemented via encodeActivityCursor/decodeActivityCursor. Tested in aud-ntf.test.ts with limit=2 pagination across multiple pages.

### [PASS] Project reader authorization: Workspace owner, manager, member, and viewer in granted project can read card activity; trashed/purged cards hidden
- **Verification**: Verified via resolveProjectRole check in listCardActivity. Tested in aud-ntf.test.ts with viewer succeeding and outsiders blocked with 404.

### [PASS] Sibling project and outsider isolation: Requests across sibling projects or by outsiders return 404 NOT_FOUND
- **Verification**: Verified in listCardActivity. Sibling member and complete outsider rejections tested in aud-ntf.test.ts returning 404 NOT_FOUND.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/AUD-01/test.log](docs/reviews/AUD-01/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Store structured, immutable timeline facts in activity_log alongside core entities rather than attempting full event sourcing.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Provides simple SQL append-only auditability and fast card detail timeline queries without the complexity of state rebuilding or event replay schemas.
- **Drawbacks**: Mutations must write both the entity state and the audit record atomically within the same transaction.
- **Alternatives Considered**: Full Event Sourcing where state is only derived from events (rejected: high complexity and unnecessary for board CRUD requirements).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
