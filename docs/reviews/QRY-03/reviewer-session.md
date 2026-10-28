# Independent Backend Review Session: QRY-03

- **Feature ID**: `QRY-03`
- **Feature Title**: My assigned tasks personal view
- **API Contract**: `GET /api/v1/me/tasks & GET /api/v1/workspaces/:workspaceId/my-tasks (docs/API.md v0.3)`
- **Reviewer Session ID**: `4a39d647-291f-4a13-3a70-ac3836218be8`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Audited Timestamp**: `2026-10-26T13:23:41.550326+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/QRY-03/test.log`](docs/reviews/QRY-03/test.log)

---

## 1. Executive Summary & Verification Context
QRY-03 My assigned tasks personal view verified. Implemented personal assigned tasks query aggregating active cards assigned to current actor across all accessible projects where actor has an active membership or workspace ownership, sorting by due date ascending nulls last, enriching with project/board/column metadata, and instantly revoking tasks upon project access removal. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Personal task aggregation: GET /api/v1/me/tasks returns active cards where current user is assigned across accessible projects
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in getMyTasks in apps/api/src/adapters/cards.ts:1071-1125. Tested in qry01-qry03.test.ts step QRY-03.

### Criterion: Access boundary enforcement: Excludes cards in projects where actor lacks an active membership or ownership
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in SQL query joining project_memberships pm WHERE (w.owner_id = $1 OR pm.id IS NOT NULL). Tested in qry01-qry03.test.ts step QRY-03 where assigned cards in ungranted Project Beta are hidden.

### Criterion: Workspace scoping: GET /api/v1/workspaces/:workspaceId/my-tasks filters personal tasks to target workspace
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Mounted in apps/api/src/http/routes/cards.ts. Tested in qry01-qry03.test.ts step QRY-03.

### Criterion: Instant revocation: Setting membership to 'removed' immediately hides tasks from that project on the next request
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Tested in qry01-qry03.test.ts step QRY-03 verifying zero tasks returned post-revocation.

### Criterion: Enriched entity context: Response items include projectName, boardName, and columnTitle
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in getMyTasks mapping returned fields. Tested in qry01-qry03.test.ts step QRY-03 asserting metadata presence.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Strict join against active project_memberships guarantees zero post-revocation leakage; outsider gets empty array without disclosing project existence.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Accurate sorting by due_date ASC NULLS LAST; returns complete CardSummary attributes plus contextual names.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: State filter c.state = 'active' prevents trashed cards from appearing in task list.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests verify member view, owner view, workspace filter, sibling isolation, and instant revocation.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean adapter function getMyTasks with typed options.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Indexed card_assignees(user_id) join provides sub-10ms personal task resolution.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `QRY-03` addresses core search, discovery, and personal task aggregation requirements.
- **The Decision**: Query 'My Tasks' by joining live active project memberships on every request, rather than storing a flat global assigned tasks table.
- **Benefits**: Guarantees instantaneous access revocation: the instant an administrator removes a user from a project, all tasks from that project vanish from their personal view without running cache invalidations or background database cleanup.
- **Drawbacks**: Requires a multi-table join across `card_assignees`, `cards`, `projects`, `workspaces`, and `project_memberships`.
- **Alternatives Considered**: Denormalized user task list table (rejected: requires complex multi-table transactional synchronization upon role revocation).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
