# Independent Backend Review Session: ATT-06

- **Feature ID**: `ATT-06`
- **Feature Title**: Orphan cleanup and storage limits
- **API Contract**: `POST /api/v1/image-uploads/cleanup (docs/API.md v0.3) & quota limits`
- **Reviewer Session ID**: `1c7b9629-326a-4cf8-aad0-15495025a9dc`
- **Builder Session ID**: `ad772234-4182-46fa-ae45-ae96061b197d`
- **Audited Timestamp**: `2026-10-26T10:06:25.481653+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/ATT-06/test.log`](docs/reviews/ATT-06/test.log)

---

## 1. Executive Summary & Verification Context
ATT-06 Orphan cleanup and storage limits verified. Implemented hard quota of maximum 10 attachments per card enforced at staging and finalization, safe quota failure isolation without mutating card fields, and periodic orphan sweep sweeping expired (>1 hour) and cancelled uploads from storage driver and database. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Hard attachment quota: Rejects staging if card already has 10 attachments with 422 IMAGE_LIMIT_EXCEEDED
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in createImageUpload and finalizeImageUpload checking attachment count. Tested in att01-att07.test.ts step ATT-06 uploading 10 images, with 11th returning 422.

### Criterion: Quota failure isolation: Quota rejection does not corrupt, lock, or modify existing card fields, comments, or attachments
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Tested in att01-att07.test.ts step ATT-06 verifying card fields and 10 finalized attachments remain intact after 11th staging rejection.

### Criterion: Orphan upload sweeping: cleanupOrphanUploads identifies expired staged uploads (state IN ('staged', 'content_received') AND expires_at < NOW()) or state='cancelled'
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Implemented in cleanupOrphanUploads in apps/api/src/adapters/images.ts. Tested in att01-att07.test.ts step ATT-06.

### Criterion: Storage reclamation: Deletes unreferenced binary storage objects from storage driver and marks uploads as 'expired'
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: cleanupOrphanUploads deletes keys from storageDriver and updates upload state. Tested in att01-att07.test.ts step ATT-06 asserting storage key deleted.

### Criterion: Maintenance authorization: Cleanup endpoint restricted to Workspace Owners and Project Managers
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in /api/v1/image-uploads/cleanup route checking owner/manager authority. Tested in att01-att07.test.ts step ATT-06.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Quota prevents denial-of-service / storage exhaustion; maintenance endpoint restricted to administrators.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Max 10 bound enforced both at staging and finalization; sweep handles both expired and cancelled uploads.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Orphan sweep removes only unfinalized uploads; finalized images are strictly protected.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests prove quota rejects 11th image, cleanup cleans expired and cancelled uploads from storage and DB, and existing cards remain intact.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Modular cleanupOrphanUploads adapter function designed for cron execution or manual invocation.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Batch sweep with bounded limit prevents database lock contention during background maintenance.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `ATT-06` addresses core private object handling and card attachment lifecycle concerns.
- **The Decision**: Combine strict card attachment quotas (max 10) with an automated, bounded orphan upload sweeper for expired staging records.
- **Benefits**: Protects infrastructure from unbounded storage inflation, prevents malicious exhaustion attacks, and ensures abandoned upload attempts are reclaimed automatically.
- **Drawbacks**: Requires scheduled background maintenance execution.
- **Alternatives Considered**: Relying on synchronous client-driven cancellation only (rejected: clients crash, lose connection, or close browser tabs, leaving orphaned objects forever).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
