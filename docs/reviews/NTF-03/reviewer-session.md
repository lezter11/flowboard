# Independent Backend Acceptance Review Session: NTF-03
**Feature**: Outbox retry and failed-work recovery
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.452830+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `processOutboxLease & POST /api/v1/notifications/outbox/process (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Concurrency leasing with SKIP LOCKED: Leases pending/processing outbox jobs without contention across concurrent workers
- **Verification**: Implemented in apps/api/src/adapters/notifications.ts:processOutboxLease using SELECT ... FOR UPDATE SKIP LOCKED. Tested in aud-ntf.test.ts step NTF-03.

### [PASS] Idempotent notification delivery: Processing comment.created delivery ensures no duplicate notifications are created
- **Verification**: Verified in processOutboxLease checking existing notifications before insert. Tested in aud-ntf.test.ts step NTF-03 with repeat runs.

### [PASS] Exponential backoff retries: Failing jobs are rescheduled with exponential backoff interval based on retry_count
- **Verification**: Verified in processOutboxLease setting next_retry_at = NOW() + (2^retry * 1 second). Tested in aud-ntf.test.ts step NTF-03.

### [PASS] Dead-letter quarantine: Jobs exceeding maxRetries are quarantined with status='failed' for inspection
- **Verification**: Verified in processOutboxLease transitioning to status='failed' when retry_count >= maxRetries. Tested in aud-ntf.test.ts step NTF-03.

### [PASS] Worker endpoint mounting: POST /api/v1/notifications/outbox/process enables scheduled worker execution
- **Verification**: Mounted in apps/api/src/http/routes/notifications.ts. Tested in aud-ntf.test.ts step NTF-03.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/NTF-03/test.log](docs/reviews/NTF-03/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Use PostgreSQL transactional outbox with SELECT ... FOR UPDATE SKIP LOCKED for asynchronous notifications instead of direct in-memory message queues.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Guarantees zero lost notification intents on server restart by writing outbox records atomically in the same database transaction as the comment mutation.
- **Drawbacks**: Requires a background leasing worker to poll the outbox table.
- **Alternatives Considered**: Synchronous HTTP delivery or uncommitted in-memory message queues (rejected: risk of data loss on restart or network failure).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
