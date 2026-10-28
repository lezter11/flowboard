# Independent Backend Review Session: ATT-07

- **Feature ID**: `ATT-07`
- **Feature Title**: Attachment lifecycle in trash
- **API Contract**: `POST /api/v1/cards/:cardId/trash & /restore & /purge (docs/API.md v0.3)`
- **Reviewer Session ID**: `1c7b9629-326a-4cf8-aad0-15495025a9dc`
- **Builder Session ID**: `ad772234-4182-46fa-ae45-ae96061b197d`
- **Audited Timestamp**: `2026-10-26T10:06:25.486241+00:00`
- **Review Criteria Version**: `backend-review-v1`
- **Verified test log**: [`docs/reviews/ATT-07/test.log`](docs/reviews/ATT-07/test.log)

---

## 1. Executive Summary & Verification Context
ATT-07 Attachment lifecycle in trash verified. Implemented complete trash lifecycle for attachments: trashing preserves finalized card images until 24-hour restore deadline while blocking normal member access (404), restoring a card recovers all images and gallery availability, and permanent purge scrubs card_images records and permanently deletes binary objects from the storage driver. Audited with unrounded score 9.605/10.0.

---

## 2. Frozen Evaluation Criteria & Evidence Mapping

### Criterion: Trash preservation: Trashing a card preserves its finalized card_images and underlying storage objects without modification
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Verified in soft-delete flow in apps/api/src/adapters/trash.ts. Tested in att01-att07.test.ts step ATT-07 verifying rows and storage keys remain intact.

### Criterion: Access lockdown during trash: Trashed card images return 404 NOT_FOUND to normal readers and cannot be modified or added to
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: getImageContent and listCardImages check parent card active state. Tested in att01-att07.test.ts step ATT-07 asserting 404 while trashed.

### Criterion: Complete restoration: Restoring a card recovers all finalized images, restoring gallery visibility and download availability
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: restoreCard recovers active status. Tested in att01-att07.test.ts step ATT-07 asserting gallery returns image and delivery succeeds post-restore.

### Criterion: Permanent purge: Purging an expired trashed card permanently scrubs all card_images records and permanently deletes binary objects from storage driver
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: Implemented in apps/api/src/services/trash-purge.ts:purgeTrashedCard where card_images rows are deleted and storageDriver.delete(key) is invoked. Tested in step ATT-07.

### Criterion: Purge safety guard: Purge cannot destroy images of a card that was restored before the restore cutoff
- **Reviewer Finding**: PASS
- **Concrete Code Evidence**: purgeTrashedCard queries strictly `WHERE state = 'trashed' AND restore_until <= NOW()`. Restored cards (state='active') are ignored by the purge worker.

---

## 3. Categorical Audit Scores & Qualitative Analysis

### Security — Score: `9.8 / 10.0`
- **Justification**: Trashed attachments are inaccessible to normal members; purge permanently destroys storage objects to prevent forensic retention.

### Correctness — Score: `9.6 / 10.0`
- **Justification**: Atomic restore preserves original IDs and links; purge removes rows and calls storageDriver.delete().

### Integrity — Score: `9.6 / 10.0`
- **Justification**: Strict state transitions: active -> trashed -> active (restore) or purged; purge worker checks state='trashed' under row lock.

### Tests — Score: `9.7 / 10.0`
- **Justification**: Tests verify attachments preserved in trash, inaccessible to normal readers, fully restored on card restore, and permanently scrubbed from storage on purge.

### Maintainability — Score: `9.2 / 10.0`
- **Justification**: Unified trash lifecycle integrating cards, comments, and attachments in trash-purge.ts.

### Operations — Score: `9.0 / 10.0`
- **Justification**: Storage cleanup during purge operates per object with error capture to prevent blocking transactions.

---

## 4. Plain-English System Design Teaching & Decision Analysis
In Flowboard, `ATT-07` addresses core private object handling and card attachment lifecycle concerns.
- **The Decision**: Synchronize card attachment lifecycle with the card's 24-hour soft-delete trash and purge pipeline.
- **Benefits**: Provides full accidental deletion recovery within the 24-hour restore window, while ensuring permanent binary file deletion from storage when the card is purged, preventing dangling storage costs and meeting privacy compliance requirements.
- **Drawbacks**: Requires storage driver deletion integration inside the purge background service.
- **Alternatives Considered**: Immediate storage file deletion upon card soft-delete (rejected: makes card restoration impossible if accidentally deleted).

---

## 5. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
