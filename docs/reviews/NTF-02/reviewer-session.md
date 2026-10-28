# Independent Backend Acceptance Review Session: NTF-02
**Feature**: Inbox read state and deep link
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.449160+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `PATCH /api/v1/notifications/:id/read & POST /api/v1/notifications/mark-all-read (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Individual mark-read: PATCH /api/v1/notifications/:id/read updates read=true for owned, accessible notification
- **Verification**: Implemented in markNotificationRead in apps/api/src/adapters/notifications.ts. Tested in aud-ntf.test.ts step NTF-02.

### [PASS] Ownership enforcement: Attempting to mark another user's notification as read returns 404 NOT_FOUND
- **Verification**: Verified in markNotificationRead checking user_id = $2. Tested in aud-ntf.test.ts step NTF-02.

### [PASS] Revoked access denial: Attempting to mark a notification from a revoked project returns 404 NOT_FOUND
- **Verification**: Verified in markNotificationRead joining active memberships. Tested in aud-ntf.test.ts step NTF-02.

### [PASS] Batch mark-all-read: POST /api/v1/notifications/mark-all-read marks all accessible unread notifications as read
- **Verification**: Implemented in markAllNotificationsRead in apps/api/src/adapters/notifications.ts. Tested in aud-ntf.test.ts step NTF-02.

### [PASS] Unread filter support: GET /api/v1/notifications?unreadOnly=true returns unread notifications only
- **Verification**: Verified in listNotifications filtering n.read = FALSE. Tested in aud-ntf.test.ts.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/NTF-02/test.log](docs/reviews/NTF-02/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Validate active project grant when marking notifications read, returning 404 NOT_FOUND if access has been revoked.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Prevents users from confirming the existence of, or interacting with, notifications from projects they no longer have permission to access.
- **Drawbacks**: Requires membership check on read update.
- **Alternatives Considered**: Allowing users to mark read regardless of project status (rejected: leaks entity existence and breaches project boundaries).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
