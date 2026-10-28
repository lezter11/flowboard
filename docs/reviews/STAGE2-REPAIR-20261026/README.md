# Stage 2 repair round 1 and re-audit — 2026-10-26

## Actions

This round repaired current authorization before project-scoped Stage 2 receipt replay, reduced persisted receipt bodies to safe outcome metadata, added a migration to redact existing receipt responses, and serialized concurrent use of one actor/scope/key before the first lookup. The mounted PostgreSQL tests cover card/comment receipt redaction, role demotion, and two concurrent card-creation requests producing one row.

The final full check passed against disposable PostgreSQL 17.11: typecheck, Worker dry-run bundle, **231 API tests**, and **41 contract tests**. The final log is [npm-check.log](npm-check.log). Repair acceptance was frozen in [criteria.md](criteria.md).

## Why and options

Idempotency means retrying one command must not create a second card, comment, or notification. A database transaction lock now makes concurrent requests with the same key wait before checking the receipt; after the first commits, the second returns the small saved outcome. Rechecking a project grant first prevents a removed or demoted teammate from using that receipt as a side door back into data.

The complete BRD/CRD/COM/DEL groups were then re-audited by three fresh read-only Luna agents against the exact 161-file target digest `6030645ad47e30135acca9e50e6043b192dff5a221e6684dc332e4ef94ee25d1`. All 161 file hashes match the live target. Each focused PostgreSQL suite and the required root typecheck passed. These scores are honest group reviews, not approvals:

| Scope | Verdict | Score | Current review |
|---|---:|---:|---|
| BRD-01–07 | Fail | 7.400 | [Boards report](boards/independent-review.md) · [record](boards/independent-review.json) |
| CRD-01–11 | Fail | 7.345 | [Cards report](cards/independent-review.md) · [record](cards/6030645ad47e30135acca9e50e6043b192dff5a221e6684dc332e4ef94ee25d1-round-2.json) |
| COM-01–06, DEL-01–08 | Fail | 6.655 | [Discussion/trash report](discussion-trash/independent-review.md) · [record](discussion-trash/independent-review.json) |

The failed round-1 audit remains preserved at [the resumed audit report](../STAGE2-RESUME-20261026/README.md). The checker correctly reports `REVIEW REQUIRED: review verdict is not pass` for each current record. No feature handoff is promoted and all 32 remain blocked.

## Evidence and limits

The round-1 replay/privacy defects are addressed for the covered project mutation paths, but acceptance remains blocked by separate defects:

- Board-card cursors are not tied to board order/filter revisions and can silently skip or repeat cards.
- Card moves accept invalid or nonadjacent neighbors, can produce duplicate ranks, and placement does not confirm the moving card exists in the same active board.
- Archived project/board contexts still accept card, comment, and trash mutations. Comment-delete replay uses a weaker role than non-author moderation requires; comment retry can also replay after the parent card is trashed.
- Comment pagination ignores its cursor. Trashed-card comment deletion is not guarded; trash listing lacks a bound.
- There is no real purge/cleanup worker or restore-versus-purge fencing test. Comment text, notification excerpts, and some activity copies remain after deletion; restore does not re-anchor placement.
- Overdue filtering counts cards in completed columns.

See each independent report for exact source lines, counterevidence, scores and checked commands. The builder full check is separate from each reviewer's own focused test run. No hosted environment, UI, browser workflow, production database, performance benchmark, or dependency advisory status was verified.

The audit containers on ports 55440–55442 and the repair-validation container on port 55439 are temporary. They must be removed after evidence review. The older development PostgreSQL container was not used.

## Next / your input

Continue with a bounded round covering archived-context write guards, action-specific replay authorization, comment cursor pagination and the trashed-comment deletion guard. Then address canonical card placement/order and the separate purge/cleanup worker. Each changed target needs a new manifest, full checks and fresh independent group audits. No user action is needed now; no deployment or feature approval occurred.

## Repair round 2 and re-audit — 2026-10-26

Round 2 added archived project/board locks to card, comment and trash writes, rechecked comment-delete authority by actor role, checked parent-card lifecycle before comment receipt replay, and implemented card-scoped keyset pagination for comments. Mounted PostgreSQL coverage now exercises all of those behaviors. The full root check passed: typecheck, Worker dry-run, API **235/235**, and contracts **41/41**. See [frozen criteria](criteria-round-2.md), [machine-readable criteria](criteria-round-2.json), and [round-2 full-check log](round-2-check.log).

Three fresh independent group reviews checked the exact 164-file SHA-256 target digest `b8f1cd4def58d26b4d688888ced46ab88e12a1cee930ff94277709caff24e0cd`; every target file matched before and after. Each reviewer’s focused PostgreSQL suite and root typecheck passed after correcting the local test database URL. Results:

| Scope | Verdict | Score | Main open blockers | Report |
|---|---:|---:|---|---|
| BRD-01–07 | Fail | 7.810 | Board-card cursors are not bound to board, filters, or ordering revision; receipt regression coverage remains incomplete. | [Corrected board review](round-2/boards/reviewer-report-corrected.md) |
| CRD-01–11 | Fail | 7.135 | Invalid move-neighbor pairs can collide ranks; placement does not validate the moving card; card cursors and overdue search remain incorrect; trash/replay race. | [Card review](cards/round-2-independent-review.md) |
| COM-01–06, DEL-01–08 | Fail | 6.775 | No purge/cleanup worker or fencing; private content copies remain; trash is unbounded; restore placement does not re-anchor. | [Discussion/trash review](round-2/discussion-trash/report.md) |

The results remain below score/category minimums and include mandatory blockers. The separate review JSON records note that delegated-agent actor/session UUIDs were unavailable, so the repository’s strongest identity-attestation fields could not be independently established. No handoff is approved; all 32 remain blocked. The corrected board and discussion test logs preserve earlier failed setup attempts while reporting the later successful runs. The disposable review databases were isolated from the development database.

The backend review checker returned `REVIEW REQUIRED` for all three round-two records, as expected for failed audits. The board reviewer added a gate-format non-passing record at [reviewer-report-gate-record.json](round-2/boards/reviewer-report-gate-record.json); the original corrected report JSON is preserved, with its schema limitation noted in [the validator log](round-2/boards/gate-validator.log). Cards and discussion/trash records also remain non-passing. None of these records authorizes checklist or handoff closure.

The repository review gate says to stop automatic score-chasing after three failed review rounds and escalate the concrete repair decision. The resumed audit, repair round 1, and repair round 2 have now all failed. Preserve these findings and wait for a directed next repair scope before starting another automatic review cycle. No hosted behavior, production DB, browser/UI workflow, deployment, or production readiness was validated.
