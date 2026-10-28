# Independent Backend Review Session: QRY-02

- **Feature ID**: `QRY-02`
- **Feature Title**: Assignee, priority, date, column filters
- **API Contract**: `GET /api/v1/projects/:projectId/cards/search?priority=&assigneeId=&columnId=&due= (docs/API.md v0.3)`
- **Reviewer Session ID**: `4a39d647-291f-4a13-3a70-ac3836218be8`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Audited Timestamp**: `2026-10-26T13:23:41.547596+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/QRY-02/test.log`](docs/reviews/QRY-02/test.log)

---

## 1. Executive Summary & Verification Context
QRY-02 Assignee, priority, date, column filters verified. Implemented multi-facet combinable filters supporting assigneeId, priority, columnId, and due date states (overdue, today, upcoming, none), returning distinct activeCardCount and matchingCardCount, and correctly excluding 'done' columns from overdue calculations. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Multi-facet filtering: Supports filtering by assigneeId, priority, columnId, and due state (overdue, today, upcoming, none)
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in searchProjectCards in apps/api/src/adapters/cards.ts. Tested in qry01-qry03.test.ts step QRY-02 for each facet.

### Criterion: Active vs matching count distinction: Response provides activeCardCount and matchingCardCount
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Implemented via dual count aggregation query in searchProjectCards. Tested in qry01-qry03.test.ts step QRY-02 asserting exact count matches.

### Criterion: Overdue business logic: Overdue filter requires due_date < workspace today AND column category is NOT 'done'
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in SQL condition c.due_date < asOfDate AND col.category != 'done'. Tested in qry01-qry03.test.ts step QRY-02 asserting cards in Done column with past due dates are not overdue.

### Criterion: Combinable facets: Multiple filter parameters combine predictably via logical AND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Tested in qry01-qry03.test.ts step QRY-02 combining query, priority, and columnId.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Filters execute strictly within authorized project context; parameter sanitization via contracts Zod schema.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Accurate active vs matching counts; overdue logic correctly respects column category != 'done' and workspace timezone.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Consistent query aggregation with card counts (comments, attachments, assignees) hydrated.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove priority, assignee, column, overdue, and combined query combinations.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Structured cardsQuerySchema in packages/contracts/src/cards.ts.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Count query uses filtered WHERE clause with project index.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `QRY-02` addresses core search, discovery, and personal task aggregation requirements.
- **The Decision**: Expose explicit active vs matching counts in search and filter responses and define overdue by workflow category rather than raw date alone.
- **Benefits**: Enables rich UI badge counters without requiring separate count roundtrips, and prevents completed work in 'Done' columns from incorrectly alerting users as overdue.
- **Drawbacks**: Requires joining the `columns` table to inspect `category != 'done'` during overdue queries.
- **Alternatives Considered**: Simple `due_date < NOW()` filter (rejected: flags completed tasks as overdue, confusing project teams).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
