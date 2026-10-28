# Resumed Stage 2 acceptance audits

Date: 2026-10-26 (Asia/Kolkata). Task: resume Gemini's interrupted boards, cards, discussion and trash acceptance audits. Decision: **all three audit groups fail acceptance; the 32 affected backend handoffs are blocked**. This is an audit continuation, not a product implementation or deployment.

## What was recovered

All 32 feature handoffs and initial review records already existed when work resumed. Their review JSON passed the structural checker, but sampled manifests covered only selected feature files, leaving out reachable shared authentication, authorization, receipts, runtime wiring and configuration. A validator can verify the files declared in a manifest; it cannot discover all missing dependencies or prove that evidence justifies a score. The review policy explicitly requires that human/independent check.

The old review records remain untouched. Original handoff JSON bytes are preserved under [prior-handoffs/](prior-handoffs/) before current statuses were changed. [adopted-reviews.json](adopted-reviews.json) identifies the exact new reports and hashes; [resume-metadata.json](resume-metadata.json) records execution isolation and source identity.

## Independent review results

The user explicitly selected GPT-6 Luna delegation. Three fresh-context Luna reviewers worked read-only on implementation, with the primary agent supervising scope, verifying manifests/scores and independently reproducing important findings. Reviewers did not implement the target. Their actual collaboration task identities and the limitation that no provider session UUID was exposed are recorded honestly in the session evidence; no provider UUID was invented.

| Stream | Features | Verdict / unrounded score | Final independent record | Readable report |
|---|---|---|---|---|
| Boards | BRD-01–BRD-07 (7) | Fail / 5.825 | [round 2](../STAGE2-RESUME-BOARDS/726e5ff8814d4ec41e8839a0ae6b6a19be7ec6939f84900d5b8c035fb2e00540-round-2.json) | [findings](../STAGE2-RESUME-BOARDS/independent-review.md) |
| Cards | CRD-01–CRD-11 (11) | Fail / 5.575 | [round 1](../STAGE2-RESUME-CARDS/6d92c86fc55a42b7f9e178673fcca90b8409444eb7dfd531acdc35f0417a1cf1-round-1.json) | [findings](../STAGE2-RESUME-CARDS/independent-review.md) |
| Discussion and trash | COM-01–COM-06, DEL-01–DEL-08 (14) | Fail / 5.1 | [round 2](../STAGE2-RESUME-DISCUSSION-TRASH/stage2-resume-round-2.json) | [findings](../STAGE2-RESUME-DISCUSSION-TRASH/independent-review.md) |

These are group review judgments, not per-feature probabilities or a single averaged backend score. Some narrow positive cases work; none of these failed group records authorizes a verified handoff. Client-only draft/gesture/dialog behavior cannot be approved by a backend test.

## Tests and target identity

- Starting Git HEAD: `6120e51`; Stage 2 implementation is uncommitted. A separate immutable source/execution copy was made at `/private/tmp/flowboard-stage2-resume-a37x7egs`.
- [source-manifest.json](source-manifest.json) captures all 71 API source/tests, contract source/tests and selected PostgreSQL migration files. All 71 still matched the live checkout when records were adopted. Final review manifests cover 95 / 102 / 96 files, adding the reachable configuration, requirements, policies and preserved reviewer/test evidence. Parent verification recalculated every declared hash and exact decimal score.
- Parent `npm run check`: **exit 0**, typecheck + Node compile + local Worker dry-run bundle + **229/229 API and 41/41 contract tests**. Full output: [npm-check.log](npm-check.log). The dry run did not deploy anything.
- Each reviewer also ran typecheck and its isolated PostgreSQL suite: boards **16/16**, cards **12/12**, discussion/trash **32/32**. Cards additionally ran the contract suite. Individual commands, failed sandbox attempts and successful escalated runs are retained in their directories. Those checks are not added to the full-suite total as distinct coverage.
- Four dedicated disposable PostgreSQL 17.11 containers used loopback ports **55435–55438**, with public synthetic `flowboard_harness` fixture credentials. Existing development port 55432 and the unrelated database container were not used for destructive fixtures. No production/live-user data was accessed.
- No new dependencies, network advisory lookup, cloud resources, Git commit/push or actual deployment. Dependency vulnerability status and hosted performance/security remain unverified.

The temporary execution copy uses existing locked dependencies, with its `@flowboard/contracts` workspace link redirected to the frozen contracts, rather than silently importing live changing workspace source. The source was not edited to make tests pass.

## Supervisor-confirmed blockers

[parent-probes.mjs](parent-probes.mjs) runs only against audit port 55435 and the declared source snapshot. [parent-probes.log](parent-probes.log) records five independent real-handler/PostgreSQL reproductions. Its exit 0 means all five predicted violations were reproduced, **not that feature acceptance passed**. The first fixture attempt omitted required timestamps; it failed before testing any finding, was corrected, and its [setup-failure log](parent-probes-setup-failure.log) is preserved.

| Finding | Observed result | Required behavior |
|---|---|---|
| Revoked card receipt replay | Normal card GET is 404 after the grant is removed, but replaying the prior create key returns 201, `replayed:true` and stored private card content | Reauthorize current project access before replay; store minimal receipt outcomes |
| Revoked comment receipt replay | Removed actor still receives 201 and stored private comment text from the prior post receipt | Current authorization and deleted-content/replay rules apply to comments too |
| Archived-board field mutation | Card PATCH returns 200 while its board is archived | Read-only context rejects new writes |
| Comment deletion while card is trashed | Comment DELETE returns 200 and changes the comment after trashing | Trashed-card write guards apply to all discussion mutation paths |
| Comment pagination | The first and next page return the same comment ID | Cursor continuation advances consistently rather than repeating page one |

The revoked-replay case requires an actor who previously held access, still has a valid session and retains the original command key. It does not show arbitrary outsider login or a public deployment exploit. The primary agent independently checked the source path and actual DB result; reviewers reproduced the board/card versions separately.

Additional independent stream findings, with detailed source references and counterevidence in the linked reports:

- Board cursor scope/revision is incomplete; a cursor after ordering changes returns an empty page rather than mandatory stale refresh.
- Card move accepts both neighbors null for a populated destination and can create rank collisions; the placement path does not validate the moving card. First-mounted route ordering matters because board and card routers define overlapping read paths.
- Unknown card request fields are stripped rather than rejected; archive checks need correction; card mutation activity is absent. Source review also calls for explicit viewer-assignment negative coverage because the current eligibility query accepts active grants without excluding viewer roles.
- Concurrent same-key card creates produce one creation plus a 409 rather than the documented replay; real concurrent field-edit OCC did yield one 200 and one 409. This positive counterevidence is retained and does not prove concurrent move correctness.
- Mention validation misses surrogate/token boundaries; receipt/notification content copies conflict with purge/privacy requirements.
- **No purge worker/content cleanup implementation exists in the reviewed source.** The previous “purge race” test directly marks a row purged. Restore locking alone cannot prove fencing against a nonexistent competing worker, and restore does not recalculate required surviving placement.
- UI-only COM-06 and portions of card gestures/drafts have no frontend implementation evidence. A backend POST rejection is not proof of those client behaviors.

## Review-record verification and status changes

Every adopted record's manifest was recalculated against current live paths after confirming they still matched the executed source snapshot. No missing path, stale hash or target-digest mismatch remained. `check_backend_review.py` returns **exit 1: `review verdict is not pass`** for each final record, exactly as required. It must not be made to return approval for these findings.

The record helper currently rejects below-minimum category scores even when generating a failing review. Reviewers preserved honest failing scores and used direct manifest/decimal construction rather than inflating scores or changing policy. Improving that helper is separate tooling work, not performed here.

The boards reviewer attempted removal of provisional review output. Automatic approval review rejected deletion because audit history must be preserved. The files remain; the table above names the adoption records explicitly. No permission workaround or deletion retry was attempted. Superseded drafts are history, not extra implementation repair rounds or approval.

All 32 current backend handoffs now have `status: blocked`, point to their fresh failed record, and link their exact historical copy and hash. Existing review JSON and other roles' handoffs are preserved. The generated feature checklist was regenerated normally; this continuation approves **zero** new backend/UI/integration features. Unrelated old approvals are not reaudited by this result, and existing stale prerequisites remain withheld by the renderer.

Final parent consistency checks passed: [supervisor-verification.json](supervisor-verification.json) confirms the three current manifests/scores, all 71 source hashes, all 32 blocked statuses and exact historical handoff hashes. The generated checklist reports 15 backend approvals, zero UI approvals and zero integration approvals at this checkpoint; that count is a gate result, not a new audit of those 15 features. All four task-created audit containers on 55435–55438 were removed successfully; the original development and unrelated database containers remained running. The frozen execution copy and all evidence are retained for inspection.

## Next bounded work

Start with **current authorization before Stage 2 receipt replay plus minimal receipt payloads**, covering board/card/comment/trash endpoints through actual mounted-route regressions. Define criteria before edits; include removal/demotion, tombstone/purge content, lost response and concurrent same-key behavior. Then address shared archive/lifecycle guards, canonical movement/cursors and the missing purge/cleanup slice as separate tasks.

Each repair changes the target and requires tests plus a fresh independent review with all minima, no blockers and score strictly above 8.5. This audit does not pre-approve a repair, widen product scope or authorize deployment. Existing authentication/invitation repairs and unaffected Stage 1 acceptance are not reopened or silently waived by this continuation.
