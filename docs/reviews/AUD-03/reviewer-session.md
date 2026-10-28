# Independent Backend Acceptance Review Session: AUD-03
**Feature**: Owner cross-project activity
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.432235+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `GET /api/v1/workspaces/:workspaceId/activity (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Workspace owner authorization: Workspace owner can view unified cross-project activity via GET /api/v1/workspaces/:workspaceId/activity
- **Verification**: Verified in apps/api/src/adapters/activity.ts:listWorkspaceActivity checking ws.owner_id === actorId. Tested in aud-ntf.test.ts step AUD-03.

### [PASS] Cross-project filtering: Supports filtering by projectId, cardId, actorId, action, fromDate, and toDate
- **Verification**: Implemented dynamic SQL WHERE builder in listWorkspaceActivity. Tested in aud-ntf.test.ts filtering by projectId and action.

### [PASS] Sibling project privacy: Invited project managers and members attempting to query workspace activity are rejected with 403 FORBIDDEN
- **Verification**: Verified in listWorkspaceActivity. Tested in aud-ntf.test.ts step AUD-03 with project manager and member receiving 403.

### [PASS] Outsider protection: Complete outsiders receive 404 NOT_FOUND
- **Verification**: Verified in listWorkspaceActivity. Outsider query tested in aud-ntf.test.ts returning 404 NOT_FOUND.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/AUD-03/test.log](docs/reviews/AUD-03/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Restrict workspace-level activity feed strictly to the workspace owner and return 403 for project managers/members.
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Guarantees sibling project confidentiality so invitees to Project A cannot discover activity or metadata in Project B.
- **Drawbacks**: Managers cannot view aggregate metrics across projects unless granted ownership.
- **Alternatives Considered**: Allowing project managers to see workspace activity filtered to their projects (rejected: leaks sibling project counts and workspace metadata).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
