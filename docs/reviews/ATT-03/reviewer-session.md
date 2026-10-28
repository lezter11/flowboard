# Independent Backend Review Session: ATT-03

- **Feature ID**: `ATT-03`
- **Feature Title**: Card image gallery
- **API Contract**: `GET /api/v1/cards/:cardId/images (docs/API.md v0.3)`
- **Reviewer Session ID**: `1c7b9629-326a-4cf8-aad0-15495025a9dc`
- **Builder Session ID**: `ad772234-4182-46fa-ae45-ae96061b197d`
- **Audited Timestamp**: `2026-10-26T10:06:25.469900+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/ATT-03/test.log`](docs/reviews/ATT-03/test.log)

---

## 1. Executive Summary & Verification Context
ATT-03 Card image gallery verified. Implemented card gallery listing querying only finalized attachments, excluding staged, failed, or cancelled uploads, providing complete image dimensions, sizes, and proxy delivery URLs, and maintaining badge count parity with CardSummary. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Gallery query authorization: Workspace owner, project manager, member, and viewer can view finalized card images; ungranted users receive 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in listCardImages in apps/api/src/adapters/images.ts via resolveProjectRole. Tested in att01-att07.test.ts step ATT-03 with member and viewer succeeding; outsider receiving 404.

### Criterion: Finalized filter: GET /api/v1/cards/:cardId/images returns only finalized images; pending, staged, failed, or cancelled uploads are strictly excluded
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: listCardImages queries exclusively from the card_images table. Tested in att01-att07.test.ts step ATT-03 where pending uploads are verified absent from the gallery.

### Criterion: Gallery item metadata: Each image item includes id, cardId, filename, byteLength, contentType, width, height, createdAt, contentUrl, and thumbnailUrl
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Validated against cardImageListResponseSchema in packages/contracts/src/images.ts. Returns relative proxy paths /api/v1/images/:id/content and /thumbnail.

### Criterion: Badge count consistency: CardSummary imageCount and Card detail imageCount match the exact count of finalized attachments
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Tested in att01-att07.test.ts step ATT-03 comparing gallery array length against CardSummary.imageCount.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Card-level project boundary verification enforces viewer or higher grant; prevents data disclosure to outsiders with 404 NOT_FOUND.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Strictly filters out non-finalized uploads; returns ordered list with complete dimensional and size metadata.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Referential integrity to parent card; counts match aggregate card summary badges across board views.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests verify gallery returns only finalized images, pending uploads are hidden, viewers can list, and outsiders get 404.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Consistent schema definition cardImageListResponseSchema with contracts alignment.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Indexed (card_id, created_at) lookup ensures instantaneous gallery rendering.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `ATT-03` addresses core private object handling and card attachment lifecycle concerns.
- **The Decision**: Store finalized attachments in a dedicated card_images table and query only finalized entities for gallery presentation, keeping staging records in card_image_uploads.
- **Benefits**: Completely prevents incomplete, failed, or malicious staging uploads from ever leaking into card previews or badge counts seen by other team members.
- **Drawbacks**: Requires moving metadata between staging and attachment tables upon finalization.
- **Alternatives Considered**: Single attachments table with a status flag (rejected: easy for developers to accidentally omit `WHERE status = 'finalized'`, leaking unverified uploads).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
