# Independent Backend Acceptance Review Session: AUD-04
**Feature**: Manager and member audit scopes
**Reviewer Session ID**: `6f8e2190-3b47-49a2-9bc5-c81729de105a`
**Builder Session ID**: `0fce3a66-787d-4e93-92dd-84dd9adbcbf0`
**Timestamp**: `2026-10-26T12:35:23.435751+00:00`
**Criteria Version**: `backend-review-v1`
**Independence**: Independent read-only acceptance auditor. Did not author or implement the target code.

---

## 1. Acceptance Scope and Reachable Paths
- **API Contract**: `GET /api/v1/projects/:projectId/activity (docs/API.md v0.3)`
- **Target Engine**: PostgreSQL 17 (synthetic isolated harness test database)
- **Reachable Modules**:
  - `apps/api/src/adapters/activity.ts`
  - `apps/api/src/adapters/notifications.ts`
  - `apps/api/src/http/routes/activity.ts`
  - `apps/api/src/http/routes/notifications.ts`
  - `apps/api/test/aud-ntf.test.ts`

---

## 2. Mandatory Acceptance Criteria Audit
### [PASS] Project manager audit scope: Project manager can view project-wide activity via GET /api/v1/projects/:projectId/activity
- **Verification**: Verified in apps/api/src/adapters/activity.ts:listProjectActivity. Tested in aud-ntf.test.ts step AUD-04 with manager succeeding.

### [PASS] Workspace owner scope: Workspace owner can view project-wide activity for projects in owned workspace
- **Verification**: Verified via resolveProjectRole. Tested in aud-ntf.test.ts step AUD-04 with owner succeeding.

### [PASS] Member & viewer exclusion: Project members and viewers receive 403 FORBIDDEN on project-wide activity endpoint
- **Verification**: Verified in listProjectActivity checking role !== 'member' && role !== 'viewer'. Tested in aud-ntf.test.ts with member and viewer receiving 403.

### [PASS] Card-level scope boundary: Members and viewers can view card activity via GET /cards/:cardId/activity for granted cards only
- **Verification**: Verified in listCardActivity. Tested in aud-ntf.test.ts step AUD-01 and AUD-04.

### [PASS] Outsider protection: Outsiders receive 404 NOT_FOUND on project-wide activity
- **Verification**: Verified in listProjectActivity. Tested in aud-ntf.test.ts.

---

## 3. Test Execution Evidence
- Command: `WRANGLER_SEND_METRICS=false node --test apps/api/test/aud-ntf.test.ts`
- Full Log: [docs/reviews/AUD-04/test.log](docs/reviews/AUD-04/test.log)
- Result: **All 9 test suites passed with 0 errors**.

---

## 4. System Design Teaching (RULES.md Plain-English Decision)
- **Decision**: Differentiate project-wide activity (manager/owner only) from card-level activity (readers included).
- **Flowboard Example**: When a card is moved or a user is mentioned in a comment, Flowboard records immutable timeline facts and transactional outbox events to ensure reliable, auditable state.
- **Benefits**: Allows team members to follow the discussion and history of individual cards while keeping broader administrative and access changes restricted to project leadership.
- **Drawbacks**: Requires two separate activity endpoints with differing role authorizations.
- **Alternatives Considered**: Allowing all project members to view project-wide activity (rejected: reveals sensitive administrative and access modification events).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.620 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
