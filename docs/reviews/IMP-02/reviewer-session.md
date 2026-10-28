# Independent Backend Review Session: IMP-02

- **Feature ID**: `IMP-02`
- **Feature Title**: Choose authorized import target
- **API Contract**: `POST /api/v1/boards/:boardId/imports (docs/API.md v0.3)`
- **Reviewer Session ID**: `f4c93a81-d102-47e9-b520-94e8a101b0f5`
- **Builder Session ID**: `8523d3da-7482-4254-9365-1bea2b7a649d`
- **Audited Timestamp**: `2026-10-26T12:16:46.942585+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/IMP-02/test.log`](docs/reviews/IMP-02/test.log)

---

## 1. Executive Summary & Verification Context
IMP-02 Choose authorized import target verified. Workspace owner and project manager authorized to upload and preview; members and viewers rejected with 403 FORBIDDEN; outsiders and sibling project members rejected with 404 NOT_FOUND; project, board, and default column ancestry strictly verified; cannot create projects or alter grants. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Role authorization matrix: Workspace owner and project manager permitted to upload and create import preview; project members and viewers rejected with 403 FORBIDDEN; outsiders and unauthenticated requests rejected with 404 NOT_FOUND / 401 UNAUTHORIZED
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport via acquireWriteGrantLock(client, board.project_id, actorId, 'manager'). Tested in imp01-imp06.test.ts step IMP-02 with owner and manager succeeding, member and viewer receiving 403, outsider 404, unauthenticated 401.

### Criterion: Sibling project isolation: Members of a sibling project without a grant in the target project receive 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in acquireWriteGrantLock resolving role in board.project_id. Tested in step IMP-02 with sibling member receiving 404 NOT_FOUND.

### Criterion: Target ancestry validation: Verifies project and board are active (not archived) and default column belongs to the target board
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport SQL queries. Tested in step IMP-02 with bad column ID returning 422.

### Criterion: Resource creation protection: Spreadsheet import cannot create workspaces, projects, boards, columns, users, or modify membership grants
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: createCardImport executes strictly against pre-existing project, board, and column IDs. Verified in schema and adapter logic.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Strict owner/manager gate; member/viewer blocked with 403; cross-project sibling blocked with 404; acquireWriteGrantLock guarantees no concurrent bypass.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Verifies board and default column ancestry; checks board active status; returns 422 on invalid default column.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Foreign key constraints link import session to workspace, project, board, column, and uploader.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove owner/manager pass, member/viewer 403, outsider/sibling 404, bad column 422, unauthenticated 401.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Unified RBAC enforcement through shared acquireWriteGrantLock helper.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Fast fail-early validation before workbook body parsing.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `IMP-02` addresses core spreadsheet batch ingestion and data boundary concerns.
- **The Decision**: Enforce strict Project Manager or Workspace Owner authorization for card imports, treating spreadsheet upload as an administrative batch operation.
- **Benefits**: Prevents normal project members or viewers from flooding boards with unmoderated bulk tasks, enforcing clear accountability for batch card creations.
- **Drawbacks**: Normal team members cannot import their own task spreadsheets directly and must request a manager to perform the import.
- **Alternatives Considered**: Universal member import (rejected: creates high risk of board clutter, accidental mass card creation, and quota abuse).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
