# Independent Backend Acceptance Review Session: NTF-01
**Feature**: Durable in-app mention inbox
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.445837+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `GET /api/v1/notifications (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Durable notification delivery: Mentioning active project reader creates durable notification record in notifications table
- **Verification**: Verified in apps/api/src/adapters/comments.ts:postComment inserting into notifications table. Tested in aud-ntf.test.ts step NTF-01.

### [PASS] Self-mention omission: Comments mentioning the author do not create notifications for the author
- **Verification**: Verified in postComment and processOutboxLease filtering out targetUserId === actorId. Tested in aud-ntf.test.ts step NTF-01.

### [PASS] Inbox query pagination: GET /api/v1/notifications returns user's notifications with limit and cursor pagination
- **Verification**: Implemented in listNotifications in apps/api/src/adapters/notifications.ts. Tested in aud-ntf.test.ts.

### [PASS] Revocation filtering: Notifications for projects where the user is no longer an active member are strictly filtered out
- **Verification**: Verified in listNotifications JOIN with project_memberships pm WHERE pm.status = 'active'. Tested in aud-ntf.test.ts step NTF-02.

### [PASS] Safe deep linking: Notifications contain direct deep link to project, board, and card context
- **Verification**: Verified link format /projects/:projectId/boards/:boardId?cardId=:cardId in notifications. Tested in aud-ntf.test.ts.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/NTF-01/test.log](docs/reviews/NTF-01/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Filter inbox notifications by joining live active project memberships on read rather than deleting notifications on revocation.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Instantly hides notifications the moment access is revoked, and cleanly restores access if the user is reinstated, without complex cascading deletes.
- **Drawbacks**: Inbox query includes a join to projects and project_memberships.
- **Alternatives Considered**: Deleting notifications upon member removal (rejected: complex cascading operations, unrecoverable if reinstatement occurs).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
