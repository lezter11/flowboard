# Independent Backend Review Session: ATT-05

- **Feature ID**: `ATT-05`
- **Feature Title**: Remove attached image
- **API Contract**: `DELETE /api/v1/images/:imageId (docs/API.md v0.3)`
- **Reviewer Session ID**: `1c7b9629-326a-4cf8-aad0-15495025a9dc`
- **Builder Session ID**: `ad772234-4182-46fa-ae45-ae96061b197d`
- **Audited Timestamp**: `2026-10-26T10:06:25.477049+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/ATT-05/test.log`](docs/reviews/ATT-05/test.log)

---

## 1. Executive Summary & Verification Context
ATT-05 Remove attached image verified. Implemented image removal enforcing ownership matrix (uploader, project manager, or workspace owner permitted; peer members rejected with 403 FORBIDDEN), OCC image version verification, atomic database removal with card imageCount decrement and board snapshot_version increment, activity_log recording, and underlying storage object cleanup. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Removal authorization: Image uploader, project manager, or workspace owner can delete image; normal members cannot delete another user's image (403 FORBIDDEN); viewers receive 403; outsiders receive 404
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in deleteCardImage in apps/api/src/adapters/images.ts checking (isUploader || role === 'owner' || role === 'manager'). Tested in att01-att07.test.ts step ATT-05.

### Criterion: OCC version check: DELETE accepts expectedVersion parameter and verifies image version; throws 409 STALE_VERSION on conflict
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: deleteCardImage checks expectedVersion !== undefined && img.version !== expectedVersion, returning 409 STALE_VERSION. Tested in att01-att07.test.ts step ATT-05.

### Criterion: Card and board updates: Removes image row, decrements card image count, bumps card version and board snapshot_version
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in deleteCardImage executing atomic SQL updates within transaction. Tested in att01-att07.test.ts step ATT-05.

### Criterion: Activity logging: Atomically logs image_removed fact with filename and image ID in activity_log
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in insert into activity_log in deleteCardImage. Tested in att01-att07.test.ts step ATT-05.

### Criterion: Storage cleanup: Asynchronously or atomically cleans up underlying storage object via storage driver
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: deleteCardImage calls storageDriver.delete(img.storage_key). Tested in att01-att07.test.ts step ATT-05 asserting storageDriver.has(key) is false.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Rigorous role and ownership matrix: uploader or project manager/owner permitted; peer members blocked with 403; viewers blocked; outsiders 404.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: OCC version guard prevents concurrent deletion races; updates card imageCount and board snapshot version.

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Atomic removal from database accompanied by immutable activity_log entry.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests verify uploader can delete, peer member is rejected, manager can delete, OCC rejects stale version, and storage driver removes object.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Clean adapter transaction in deleteCardImage.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Safe storage driver cleanup with error logging prevents dangling storage growth.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `ATT-05` addresses core private object handling and card attachment lifecycle concerns.
- **The Decision**: Enforce granular uploader ownership combined with manager moderation authority and optimistic concurrency control (OCC) for image deletion.
- **Benefits**: Permits content creators to manage their own uploads while empowering project leads to moderate content, while OCC prevents conflicting simultaneous deletions or updates.
- **Drawbacks**: Clients must track and transmit entity version numbers in deletion requests.
- **Alternatives Considered**: Universal member deletion (rejected: allows team members to maliciously or accidentally delete colleagues' attachments).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
