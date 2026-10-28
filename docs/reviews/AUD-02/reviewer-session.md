# Independent Backend Acceptance Review Session: AUD-02
**Feature**: Field and movement history
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.428375+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `GET /api/v1/cards/:cardId/activity safe_changes projection (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Safe before/after diff projection: Captures old and new values for title, priority, due date, and assignees.added/removed
- **Verification**: Verified in apps/api/src/adapters/cards.ts:updateCard recording safe_changes. Tested in apps/api/test/aud-ntf.test.ts step AUD-02.

### [PASS] Column movement details: Captures fromColumnId, toColumnId, fromColumnTitle, toColumnTitle, fromPosition, and toPosition
- **Verification**: Verified in apps/api/src/adapters/cards.ts:moveCard recording column names and ranks. Tested in aud-ntf.test.ts.

### [PASS] Historical identity preservation: Historical name changes and removed people remain understandable via getHistoricalPersonDisplay
- **Verification**: Verified in getHistoricalPersonDisplay returning activeInProject=false for removed members while preserving identity. Tested in aud-ntf.test.ts.

### [PASS] Sensitive data protection: No private secret tokens, raw file contents, or session credentials appear in safe_changes
- **Verification**: Verified in activity.ts and cards.ts sanitization.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/AUD-02/test.log](docs/reviews/AUD-02/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Snapshot human-readable from/to column titles and safe before/after diffs at the moment of mutation.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Historical card moves remain fully understandable even if a destination column is later renamed or deleted.
- **Drawbacks**: Requires an extra column title lookup during the move transaction.
- **Alternatives Considered**: Storing only column IDs and resolving current titles on query (rejected: renames or deletions would corrupt historical understanding).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
