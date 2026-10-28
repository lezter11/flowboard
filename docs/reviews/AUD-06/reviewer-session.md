# Independent Backend Acceptance Review Session: AUD-06
**Feature**: Append-only history and redaction
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.442525+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `Append-only immutability & redactCardActivity (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Append-only immutability: No user-facing endpoints exist to modify or delete activity log records
- **Verification**: Verified in apps/api/src/http/routes/activity.ts exposing strictly GET endpoints. Tested in aud-ntf.test.ts step AUD-06 with POST/DELETE returning 404.

### [PASS] Retention redaction: Scrubbing safe_changes for purged cards replaces content with minimal tombstone { cardId, purged: true }
- **Verification**: Implemented in redactCardActivity in apps/api/src/adapters/activity.ts and trash-purge.ts. Tested in aud-ntf.test.ts step AUD-06.

### [PASS] Fact persistence: Activity log ID, actor_id, action, card_id, and created_at persist permanently after redaction
- **Verification**: Verified in aud-ntf.test.ts step AUD-06 inspecting activity rows after redaction.

### [PASS] No data leaks: Redacted records reveal zero private titles, descriptions, or comment bodies
- **Verification**: Verified in aud-ntf.test.ts checking safeChanges content.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/AUD-06/test.log](docs/reviews/AUD-06/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Implement retention redaction by scrubbing safe_changes payloads rather than deleting activity_log rows.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Maintains an unbroken audit record of who took what action at what time, while honoring privacy and retention policies by removing sensitive purged text.
- **Drawbacks**: Activity log table grows monotonically over time.
- **Alternatives Considered**: Hard-deleting activity log entries when a card is purged (rejected: destroys compliance auditability and actor attribution).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
