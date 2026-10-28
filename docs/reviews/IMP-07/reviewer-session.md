# Independent Backend Review Session: IMP-07

- **Feature ID**: `IMP-07`
- **Feature Title**: External ID and retry deduplication
- **API Contract**: `card_import_duplicates & idempotency (docs/API.md v0.3)`
- **Reviewer Session ID**: `f4c93a81-d102-47e9-b520-94e8a101b0f5`
- **Builder Session ID**: `8523d3da-7482-4254-9365-1bea2b7a649d`
- **Audited Timestamp**: `2026-10-26T12:16:46.960543+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/IMP-07/test.log`](docs/reviews/IMP-07/test.log)

---

## 1. Executive Summary & Verification Context
IMP-07 External ID and retry deduplication verified. Board-scoped text External ID preserves leading zeros; re-uploading identical payload skips already-imported cards; modified payload for existing External ID produces conflict error; 24-hour trashed cards remain reserved by duplicate markers. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Leading-zero preservation: External ID preserves leading zeros and unicode characters
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in excel-parser.ts preserving string format. Tested in imp01-imp06.test.ts step IMP-07.

### Criterion: Duplicate skipping: Re-uploading identical row payload marks outcome as 'already_imported' and skips insertion
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified via card_import_duplicates lookup. Tested in step IMP-07.

### Criterion: Conflict detection: Changed row payload for existing External ID marks outcome as 'conflict'
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified via row_hash comparison in card_import_duplicates. Tested in step IMP-07.

### Criterion: Trash reservation: Trashed cards retain duplicate markers to prevent resurrection or restore bypass
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in card_import_duplicates retention. Tested in step IMP-07.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Prevents replay attacks and prevents bypassing 24-hour trash retention rules through spreadsheet re-upload.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Row hash comparison accurately distinguishes unchanged duplicates from payload conflicts.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: card_import_duplicates primary key (board_id, external_id) enforces uniqueness.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Integration tests verify leading zeros, duplicate skip, conflict detection, and trash preservation.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean SHA-256 row hash calculation function computeRowHash.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Indexed primary key lookup ensures instantaneous duplicate verification.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `IMP-07` addresses core spreadsheet batch ingestion and data boundary concerns.
- **The Decision**: Store minimal SHA-256 row hashes in a dedicated `card_import_duplicates` table keyed by (board_id, external_id).
- **Benefits**: Enables instant O(1) deduplication without re-scanning historical cards, and prevents deleted/trashed items from being silently resurrected.
- **Drawbacks**: Requires maintaining duplicate marker records after cards are created.
- **Alternatives Considered**: Querying the cards table by External ID (rejected: requires adding external_id column to cards and fails when cards are edited or trashed).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
