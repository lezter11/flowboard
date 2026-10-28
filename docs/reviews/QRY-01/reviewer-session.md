# Independent Backend Review Session: QRY-01

- **Feature ID**: `QRY-01`
- **Feature Title**: Project-scoped card search
- **API Contract**: `GET /api/v1/projects/:projectId/cards/search (docs/API.md v0.3)`
- **Reviewer Session ID**: `4a39d647-291f-4a13-3a70-ac3836218be8`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Audited Timestamp**: `2026-10-26T13:23:41.544552+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/QRY-01/test.log`](docs/reviews/QRY-01/test.log)

---

## 1. Executive Summary & Verification Context
QRY-01 Project-scoped card search verified. Implemented bounded text search matching card title and description within a single project, project reader authorization check rejecting ungranted users with 404 NOT_FOUND, strict sibling-project privacy (404 on sibling project), and exclusion of soft-deleted/trashed cards. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Project-scoped text search: GET /api/v1/projects/:projectId/cards/search matches search text against title and description
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in searchProjectCards in apps/api/src/adapters/cards.ts:970-975 where (c.title ILIKE $ OR c.description ILIKE $) is queried. Tested in apps/api/test/qry01-qry03.test.ts step QRY-01.

### Criterion: Sibling project privacy: Requesting search on a sibling project without a grant returns 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in resolveProjectRole check in searchProjectCards returning 404. Tested in qry01-qry03.test.ts step QRY-01 asserting 404 on sibling project.

### Criterion: Outsider access rejection: Outsiders without project membership receive 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Tested in qry01-qry03.test.ts step QRY-01 where ungranted outsider receives 404 NOT_FOUND.

### Criterion: Soft-deleted card exclusion: Trashed cards (state != 'active') are strictly excluded from search results
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in condition c.state = 'active' in searchProjectCards. Tested in qry01-qry03.test.ts step QRY-01 asserting 0 trashed cards returned.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Strict project boundary check via resolveProjectRole; anti-enumeration 404 on ungranted projects prevents existence leakage; excludes trashed cards.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Case-insensitive substring search matches both title and description; bounded limit clamping (1..100); preserves active state integrity.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Zero data disclosure across sibling projects; respects soft-deletion state boundaries.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Unit and integration tests verify title search, description search, sibling 404, outsider 404, and trash exclusion.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Reusable query builder joining columns and fetching batch counts.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Indexed project_id, state, and bounded limit prevent full-table scan degradation.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `QRY-01` addresses core search, discovery, and personal task aggregation requirements.
- **The Decision**: Enforce project-scoped search boundaries with anti-enumeration 404 NOT_FOUND rather than global workspace search or 403 responses.
- **Benefits**: Prevents data leakage across project boundaries. Teammates invited to Project A cannot discover card titles, descriptions, or project existence in Project B.
- **Drawbacks**: Users seeking cards across multiple projects must navigate per-project or use the dedicated 'My Tasks' personal endpoint.
- **Alternatives Considered**: Global workspace search across all projects (rejected: violates project-only isolation requirements).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
