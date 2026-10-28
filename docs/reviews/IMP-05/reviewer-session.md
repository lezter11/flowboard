# Independent Backend Review Session: IMP-05

- **Feature ID**: `IMP-05`
- **Feature Title**: Preview new existing and conflict rows
- **API Contract**: `GET /api/v1/imports/:importId & POST /api/v1/imports/:importId/mappings & DELETE /api/v1/imports/:importId (docs/API.md v0.3)`
- **Reviewer Session ID**: `f4c93a81-d102-47e9-b520-94e8a101b0f5`
- **Builder Session ID**: `8523d3da-7482-4254-9365-1bea2b7a649d`
- **Audited Timestamp**: `2026-10-26T12:16:46.953564+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/IMP-05/test.log`](docs/reviews/IMP-05/test.log)

---

## 1. Executive Summary & Verification Context
IMP-05 Preview new existing and conflict rows verified. Dry-run preview creates temporary staging records only (zero cards/users modified); computes deterministic preview digest; calculates new/existing/invalid/conflict counts; supports bounded cursor pagination; enables status mapping updates; allows cancellation before commit. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Pure dry run guarantee: Upload and preview create temporary staging records only; zero cards, users, or grants are created or modified in the database during preview
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport writing exclusively to card_imports and card_import_rows. Tested in imp01-imp06.test.ts step IMP-05 asserting cards count in DB remains unchanged.

### Criterion: Accurate row classification: Rows classified into 'new', 'already_imported', 'invalid', and 'conflict'; counts accurately reflect batch composition
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport duplicate and error assessment. Tested in step IMP-05.

### Criterion: Deterministic preview digest: Computes SHA-256 preview digest over import target, version, and row outcomes
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: computePreviewDigest in apps/api/src/adapters/imports.ts. Tested in step IMP-05 asserting valid hex digest.

### Criterion: Paginated cursor inspection: GET /api/v1/imports/:importId supports limit and cursor query parameters for bounded row retrieval
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Mounted in apps/api/src/http/routes/imports.ts. Tested in step IMP-05 with limit=1 returning nextCursor.

### Criterion: Status mapping revalidation: POST /api/v1/imports/:importId/mappings updates unmapped status labels to board columns, clears errors, increments version, and updates preview digest
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: updateImportMappings in imports.ts. Tested in step IMP-05 mapping 'In QA' to column, transitioning state to 'ready'.

### Criterion: Pre-commit cancellation: DELETE /api/v1/imports/:importId cancels preview staging (state='cancelled') before commit execution
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: cancelCardImport in imports.ts. Tested in step IMP-05 with status transitioning to 'cancelled'.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Preview access gated to project managers/owners; temporary import records scoped to board; cancellation allowed before commit.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Accurate counts for all row outcomes; paginated cursor avoids large payload buffer; 30-minute expiration TTL.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Pure dry run: zero card rows inserted; preview digest binds rows and prevents concurrent tampering.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove zero cards created during preview, pagination cursor works, status mapping updates outcomes and digest, and cancellation succeeds.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean contracts alignment with ImportStatus and importStatusResponseSchema.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Temporary import rows automatically expire after 30 minutes.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `IMP-05` addresses core spreadsheet batch ingestion and data boundary concerns.
- **The Decision**: Implement a two-phase preview and explicit commit state machine where preview is a pure dry-run with a cryptographic digest, rather than immediate ingestion.
- **Benefits**: Empowers administrators to inspect validation errors, resolve unmapped columns, and verify duplicate counts before any permanent domain cards are created.
- **Drawbacks**: Requires an explicit two-step client workflow (upload/preview followed by confirmation).
- **Alternatives Considered**: Immediate partial import on upload (rejected: creates orphaned cards on partial failure and makes rollback impossible).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
