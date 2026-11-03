# Formal independent projects/boards review — round2

Verdict: projects/access/invitations FAIL (PB-02); boards INCOMPLETE. No domain or release approval. Full per-feature outcomes and traced source/tests/UI are in coverage.json/md. Prior round1 failure and PB01 focused repair evidence remain preserved.

## PB-02 — delayed project archive overwrites newer reopened state

Mandatory correctness/integrity defect under PRJ-04 and the frozen shared mounted-operation/state-version criteria. `apps/api/src/http/routes/projects.ts:580-589` binds archive receipt to `{}` rather than supplied lifecycle body; lines625-629 unconditionally update by ID. Reopen does the equivalent at695-706 and747-751. Neither consumes shared projectLifecycleInputSchema or validates expected project version.

Own mounted real PostgreSQL reproduction: initial version1; archive expected1 succeeds version2; reopen expected2 succeeds version3; delayed archive expected1 returns200 and changes reopened project to archived/version4. The test expected409 and unchanged reopened state, and exits1. See project-lifecycle-occ-probe.test.ts/log. Root independently reproduced the exact test and confirmed this mandatory contract at raw/root-project-lifecycle-occ-red.log.

Impact: a stale Owner action can undo a newer lifecycle decision and make collaborators' project read-only, despite the UI sending its expected project revision. No cross-project permission escape or card deletion was demonstrated.

Counterevidence: ownership/quota transactions are present, and the existing API note321 discloses ignored bodies; however shared schema, API table72 and UI all require/send expectedVersion. The lower note is not an explicit user-approved waiver and also incorrectly describes now-versioned board lifecycle. Similar board delayed-transition regression passes. Fix must parse the project lifecycle schema, hold the project row, validate expected version after current-authority/replay checks, bind receipt to the exact supplied body, and preserve exact same-key replay without accepting a changed version body. Add concurrent/stale/opposite transition/missing-invalid-body/no-side-effect tests and revise stale docs. Do not silently lower the requirement.

## Actual command evidence

- This reviewer ran invitation-repair.test.ts, boards-lifecycle-repair.test.ts, people-directory-policy.test.ts and prior direct-Pool controls on this source:39pass,0fail,0skip, exit0, independent-scoped-pg.log.
- This reviewer wrote/ran project-lifecycle-occ-probe.test.ts:1fail, exit1, confirmed PB02.
- The separate fresh independent executor /root/formal_foundation_account_round1 started all14-command work. Its snapshot observed9 completed zero exits and API without a final exit; no remaining command is fabricated. See independent-executor-observed.json. Root/builder earlier full green runs are not substituted for missing final independent execution.
- Root's real Chrome product13 context-fixed evidence was inspected:12 observed passing flows, selected source hashes unchanged. This is local synthetic, not Google/R2/mail/hosted acceptance or this reviewer's own browser run.

## Other paths and rejected candidates

PB01's route/default/display bypass remains repaired in current People tests, including direct Pool transaction/demotion controls; no revival of old failed approval. Project/board creation, quotas counting archived rows, manager creator grants, Owner-only board administration, scoped pickers/metadata PATs, invitation hashed-token/email/expiry/rotation, transactional receipts and terminal outbox redaction were traced. Board repeatable-read snapshot/cursor/filter/placement paths and soft-column raw SQL concurrency guards were inspected with current scoped regressions. Both Node/Worker dispatch and pool lifetime/middleware boundaries were followed; actual hosted behavior remains UAT pending.

Resend-at-cap was considered but rejected as a new defect: the documented existing cap policy explicitly includes resend. Potential revoke/resend lock-upgrade conflicts have safe40P01/40001 retryable503 mapping; no duplicated effect or broken invariant was demonstrated. Account-menu Settings drops board context but explicitly opens account settings with visible project selection/leave confirmation; no silent unauthorized mutation was shown. No finding is invented from those candidates.

## Limits and next action

Scores are deliberately unassessed because the full required independent gates and full acceptance proof were not completed before this mandatory defect. Source scope includes runtime/code/config/dependencies/criteria and preserved proofs; dynamic status/checklist/handoffs are excluded from approval scope. All615 source hashes were checked before and after this review (source-check files). This failed round cannot approve downstream UI/integration; fresh bindings and exact global freeze remain required. Hosted OAuth/R2/mail/CPU/cron remain explicit UAT pending under the user's sequence, never relabeled as verified. Repair all confirmed mandatory defects, freeze again and request full round3; three failed formal rounds is the automatic retry stop limit.
