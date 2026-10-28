# Independent Backend Review Session: IMP-04

- **Feature ID**: `IMP-04`
- **Feature Title**: Map and validate template fields
- **API Contract**: `POST /api/v1/boards/:boardId/imports (docs/API.md v0.3)`
- **Reviewer Session ID**: `f4c93a81-d102-47e9-b520-94e8a101b0f5`
- **Builder Session ID**: `8523d3da-7482-4254-9365-1bea2b7a649d`
- **Audited Timestamp**: `2026-10-26T12:16:46.950066+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/IMP-04/test.log`](docs/reviews/IMP-04/test.log)

---

## 1. Executive Summary & Verification Context
IMP-04 Map and validate template fields verified. Enforces exact seven standard headers, preserves leading zeros on text External ID while rejecting numeric IDs with guidance, skips blank rows anywhere, validates Title/Description/Priority, converts 1900/1904 serial dates (rejecting fictitious 1900-02-29), resolves semicolon emails to active project members, and matches column statuses. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Strict header validation: Row 1 must match the seven standard headers (External ID, Title, Description, Priority, Due Date, Assignees, Status); unknown or duplicate headers rejected with 422 UNKNOWN_HEADER or DUPLICATE_HEADER; missing required headers rejected with 422 MISSING_REQUIRED_HEADER
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in excel-parser.ts header mapping. Tested in imp01-imp06.test.ts step IMP-04 with unknown, duplicate, and missing headers returning 422.

### Criterion: Leading zeros and numeric ID rejection: Preserves leading zeros on text External ID (e.g. '00123'); rejects numeric External ID with format-as-text guidance
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in excel-parser.ts inspecting cell t attribute. Tested in step IMP-04 with text '000123' preserved and numeric 10042 returning NUMERIC_ID_REJECTED.

### Criterion: Blank row skipping: Fully blank rows anywhere in the sheet are ignored without producing empty cards or errors
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in isBlank check in excel-parser.ts. Tested with template and interleaved blank rows.

### Criterion: Field length & priority bounds: Enforces Title 1-200 chars, Description <= 20000 chars, priority normalized to 'none'|'low'|'medium'|'high'|'urgent' (blank becomes 'none')
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Validated in excel-parser.ts per-field validators. Tested in step IMP-04.

### Criterion: Date system conversion: Converts genuine Excel serial dates respecting 1900 and 1904 date systems to Gregorian YYYY-MM-DD; rejects fictitious 1900-02-29 (serial 60 in 1900 system) with INVALID_DATE
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: excelSerialToIsoDate in excel-parser.ts. Tested in step IMP-04 with 1900 system, 1904 system, and serial 60 rejection.

### Criterion: Assignee email resolution: Resolves semicolon-separated verified emails to active owner/manager/members of the target project; rejects unknown or sibling members with UNKNOWN_OR_INELIGIBLE_ASSIGNEE; deduplicates repeated emails; enforces max 20 assignees
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport emailToUserId resolution. Tested in step IMP-04 with valid assignees resolving and unknown emails flagged.

### Criterion: Column status matching: Matches source status to existing board columns case-insensitively, or falls back to default column when blank
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createCardImport columnByName matching. Tested in step IMP-04.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Assignee lookup resolves strictly against verified project members; external emails cannot inject unverified users; formula characters neutralized.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Exact date arithmetic for 1900 and 1904; rejects Lotus 1-2-3 day 60 bug; preserves leading zeros on IDs.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Zero silent coercion: invalid fields explicitly surfaced with row number, field name, and error code.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove header checks, leading zeros, numeric rejection, 1900/1904 dates, fictitious leap day, and assignee resolution.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Modular validation logic sharing contracts priority and date validators.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Fast in-memory normalization before database staging.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `IMP-04` addresses core spreadsheet batch ingestion and data boundary concerns.
- **The Decision**: Enforce strict text formatting for External ID to preserve leading zeros, while converting genuine Excel serial dates respecting both 1900 and 1904 date systems.
- **Benefits**: Guarantees external system identifier fidelity (e.g. Jira/SAP ticket '00452' is never corrupted into number 452) and prevents subtle date off-by-one errors caused by Excel's historical 1900 leap-year defect.
- **Drawbacks**: Users who enter unformatted numbers in the External ID column receive an error requiring them to format the column as Text in Excel.
- **Alternatives Considered**: Silently coercing numeric IDs to string (rejected: leading zeros are lost before the file reaches the parser).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
