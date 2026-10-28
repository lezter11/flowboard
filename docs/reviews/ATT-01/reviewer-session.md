# Independent Backend Review Session: ATT-01

- **Feature ID**: `ATT-01`
- **Feature Title**: Image upload staging
- **API Contract**: `POST /api/v1/cards/:cardId/image-uploads (docs/API.md v0.3)`
- **Reviewer Session ID**: `1c7b9629-326a-4cf8-aad0-15495025a9dc`
- **Builder Session ID**: `ad772234-4182-46fa-ae45-ae96061b197d`
- **Audited Timestamp**: `2026-10-26T10:06:25.461288+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/ATT-01/test.log`](docs/reviews/ATT-01/test.log)

---

## 1. Executive Summary & Verification Context
ATT-01 Image upload staging verified. Implemented bounded upload staging for cards, verifying workspace owner, manager, or member role authorization while rejecting viewers (403 FORBIDDEN) and ungranted/sibling requests (404 NOT_FOUND), enforcing 10 MiB limit, image MIME check, SHA-256 digest format, 10-image card quota check, and staging inspection & cancellation. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Authorized staging request: Workspace owner, project manager, or project member can request upload staging via POST /api/v1/cards/:cardId/image-uploads; viewers receive 403 FORBIDDEN and ungranted users receive 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in apps/api/src/adapters/images.ts:createImageUpload where acquireWriteGrantLock is invoked. Tested in apps/api/test/att01-att07.test.ts step ATT-01 with owner, manager, and member succeeding; viewer rejected with 403; ungranted rejected with 404.

### Criterion: Sibling project isolation: Upload staging rejects attempts to attach files across sibling projects with 404 NOT_FOUND
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createImageUpload project role resolution. Tested in att01-att07.test.ts step ATT-01 where sibling member receives 404 NOT_FOUND.

### Criterion: File parameter validation: Enforces filename length <= 255, byte length <= 10 MiB (10485760 bytes), valid contentType ('image/png', 'image/jpeg', 'image/webp'), and valid sha256 64-hex string
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Validated via createImageUploadInputSchema in packages/contracts/src/images.ts. Rejections for invalid byteLength and unsupported content types tested in att01-att07.test.ts.

### Criterion: Quota check before staging: Rejects staging with 422 IMAGE_LIMIT_EXCEEDED if card already has 10 finalized attachments
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createImageUpload checking COUNT(*) from card_images WHERE card_id = $1. Tested in att01-att07.test.ts step ATT-06.

### Criterion: Staged record lifecycle: Creates card_image_uploads record with state='staged', expires_at set to 1 hour in future, and storage_key assigned
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in database insertion in createImageUpload. Returns 201 Created with upload record metadata.

### Criterion: Staging inspection and cancellation: GET /api/v1/image-uploads/:uploadId returns upload state; DELETE /api/v1/image-uploads/:uploadId cancels staging before finalization
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Mounted in apps/api/src/http/routes/images.ts. Tested in att01-att07.test.ts step ATT-01 where inspection succeeds and cancellation transitions state to 'cancelled'.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Acquires project write grant lock; validates member authority; blocks viewers with 403; returns 404 on sibling projects; isolates storage key under project/card namespace.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Generates UUID upload record with 1-hour expiration; state='staged'; enforces max 10 attachments per card before allocating upload slot.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Foreign key constraints link upload record to workspace, project, card, and user; staging inspection and cancellation prevent orphaned dangling states.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Comprehensive integration tests verify role checks, parameter bounds, quota rejection, staging inspection, and cancellation.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean separation between contracts schema, images adapter, and HTTP routes.

### Operations — Score: `9.0 / 10.0`
- **Justification**: 1-hour TTL on staged uploads and indexed state queries allow safe background cleanup of abandoned uploads.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `ATT-01` addresses core private object handling and card attachment lifecycle concerns.
- **The Decision**: Use bounded two-phase staging for private file uploads instead of single-step multipart body upload.
- **Benefits**: Separates metadata authorization and quota verification from heavy binary transfer. Prevents unauthenticated clients or quota-exceeded requests from consuming server network bandwidth or buffering large binaries in memory.
- **Drawbacks**: Requires two client round-trips: staging registration followed by binary content streaming and finalization.
- **Alternatives Considered**: Single multipart/form-data upload (rejected: mixes streaming body parsing with database authorization, leading to resource exhaustion vulnerabilities).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
