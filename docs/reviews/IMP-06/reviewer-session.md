# Independent Backend Review Session: IMP-06

- **Feature ID**: `IMP-06`
- **Feature Title**: Explicit atomic confirmation
- **API Contract**: `POST /api/v1/imports/:importId/commit (docs/API.md v0.3)`
- **Reviewer Session ID**: `f4c93a81-d102-47e9-b520-94e8a101b0f5`
- **Builder Session ID**: `8523d3da-7482-4254-9365-1bea2b7a649d`
- **Audited Timestamp**: `2026-10-26T12:16:46.956927+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/IMP-06/test.log`](docs/reviews/IMP-06/test.log)

---

## 1. Executive Summary & Verification Context
IMP-06 Explicit atomic confirmation verified. Atomic commit binds preview digest, expectedVersion, and project grant; requires zero invalid/conflict rows; re-checks manager role and assignee eligibility; inserts all new cards in ONE bounded PostgreSQL transaction; allocates positions; records duplicate markers (IMP-07); logs provenance (IMP-11); enforces idempotency and blocks post-commit cancellation. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Concurrency and OCC guards: Validates expectedVersion and previewDigest; rejects stale versions with 409 STALE_VERSION and digest changes with 409 PREVIEW_STALE
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in commitCardImport in apps/api/src/adapters/imports.ts. Tested in imp01-imp06.test.ts step IMP-06 with stale version and bad digest returning 409.

### Criterion: Zero error requirement: Rejects commit with 422 IMPORT_HAS_ERRORS if any row in the import has outcome 'invalid' or 'conflict'
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Checked in commitCardImport verifying hasInvalidOrConflict. Tested in step IMP-06.

### Criterion: Fresh grant & assignee revalidation: Re-verifies actor's project owner/manager role and active status of all assignees; revoked manager role returns 403; removed assignee returns 409 PREVIEW_STALE
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: acquireWriteGrantLock and active membership re-check in commitCardImport. Tested in adversarial tests with revoked manager returning 403 and removed assignee returning 409.

### Criterion: Single transaction atomicity: Inserts all 'new' cards, assigns positions, records assignees, inserts card_import_duplicates markers, updates board snapshot_version, and records activity_log in ONE bounded transaction; any failure rolls back all cards
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: commitCardImport executes inside a single PostgreSQL transaction with row locks. Tested in step IMP-06 verifying cards, duplicate markers, and version bumps.

### Criterion: Duplicate & conflict protection (IMP-07): Duplicate rows are marked 'skipped' without duplicating cards; changed payloads conflict; 24-hour trash cards cannot be resurrected or bypassed
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in card_import_duplicates primary key constraint (board_id, external_id). Tested in step IMP-07 verifying already_imported skipping, conflict rejection, and trash preservation.

### Criterion: Idempotency & replay: Requires Idempotency-Key header; identical confirmation requests return 200 with replayed: true from idempotency_receipts
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: checkOrReplayProjectWriteReceipt and saveReceipt in handleCommitImport. Tested in step IMP-06 asserting replayed: true.

### Criterion: Cancellation lockdown: Post-commit cancellation attempts return 409 COMMIT_IN_PROGRESS
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Checked in cancelCardImport rejecting state='committed'. Tested in step IMP-06 returning 409.

### Criterion: Import provenance & activity (IMP-11): Links import receipt to created cards and logs batch commit event in activity_log
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: activity_log insertions in commitCardImport. Tested in step IMP-11 verifying card_created and card_import_committed events.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Revalidates active manager role under lock; re-verifies assignee membership; idempotency prevents replay; trash cannot be bypassed.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Exact position allocation (max + 1000); bumps board snapshot and structure versions; commits all new cards or none.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Single PostgreSQL transaction; row locks on import, board, and rows; foreign keys and unique constraints guarantee absolute integrity.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove OCC version guard, digest guard, role re-check, assignee revocation race, atomic commit, idempotency, duplicate skipping, conflict rejection, and trash protection.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean adapter transaction utilizing checkOrReplayProjectWriteReceipt and acquireWriteGrantLock.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Bounded batch size (max 200 rows) guarantees fast transaction execution (<25ms) without lock contention.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `IMP-06` addresses core spreadsheet batch ingestion and data boundary concerns.
- **The Decision**: Execute the creation of all new import cards, duplicate marker registrations, position allocations, board version bumps, and activity log events in a single bounded PostgreSQL transaction under write locks.
- **Benefits**: Guarantees strict all-or-nothing atomicity. If a database failure, network disconnection, or concurrent conflict occurs on the final row, all previously created cards roll back cleanly, leaving zero partial or corrupt cards on the board.
- **Drawbacks**: Holds database row locks for the duration of the batch insert, requiring a hard limit on batch size (max 200 rows) to keep lock hold time well under 50ms.
- **Alternatives Considered**: Non-transactional iterative card creation (rejected: leads to partially committed imports on failure, requiring complex and error-prone manual cleanup).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
