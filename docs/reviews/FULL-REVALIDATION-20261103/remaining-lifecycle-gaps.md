# Lifecycle behavior and evidence inventory —2026-11-03

This supplements the69-ID discovery matrix. Current status below is builder evidence only; no score, closure or independent approval. Source references on historical leads refer to the discovery target; use final parent manifest for current lines.

## LIFE-OPEN-01 — BRD-06, DEL-04

locally_repaired_pending_frozen_gate_independent_review_UAT: See boards-lifecycle-handoff.json for current implementation,45 focused tests and83 nearest legacy tests; no approval inferred.

Next: Parent final source manifest/full local gate/independent review and UAT checks.

Historical reproduced/source gap: Interim409 retained-reference guard prevents FK500/data loss, but user expects an active-empty column to be removable once all restore windows expire. Physical restrictive FKs retain history; full feature needs a coordinated soft-column lifecycle, not permanent blocking.

Sources: `apps/api/src/adapters/boards.ts:811`, `database/migrations/0001_initial.sql:101`, `database/migrations/0001_initial.sql:216`.

## LIFE-OPEN-02 — CRD-08, CRD-09, BRD-05

locally_repaired_pending_frozen_gate_independent_review_UAT: See boards-lifecycle-handoff.json for current implementation,45 focused tests and83 nearest legacy tests; no approval inferred.

Next: Parent final source manifest/full local gate/independent review and UAT checks.

Historical reproduced/source gap: getPlacement selects every destination card ID and finds anchors in memory. It is not bounded by a SQL LIMIT. UI needs canonical off-page before/after positioning and bounded destination choice paging.

Sources: `apps/api/src/adapters/boards.ts:946`, `apps/api/src/adapters/boards.ts:1029`.

## LIFE-OPEN-03 — BRD-08

locally_repaired_pending_frozen_gate_independent_review_UAT: See boards-lifecycle-handoff.json for current implementation,45 focused tests and83 nearest legacy tests; no approval inferred.

Next: Parent final source manifest/full local gate/independent review and UAT checks.

Historical reproduced/source gap: listProjectBoards always filters archived=false. Reopen mutation exists, but after navigation an authorized admin cannot rediscover archived board IDs through this list.

Sources: `apps/api/src/adapters/boards.ts:238`, `apps/api/src/http/routes/boards.ts:144`.

## LIFE-OPEN-04 — QRY-03

mandatory_source_gap_against_current_catalogue: Current catalogue explicitly requires selected-project due-state filters/pagination. getMyTasks accepts projectId/limit only and silently returns at most100 rows; no cursor/next page or due-state filter.

Next: Separate bounded My Tasks criterion/contract and mounted tests, retain one-project scope and current board grants; do not add cross-project aggregation.

Sources: `docs/features.tsv:94`, `apps/api/src/adapters/cards.ts:1215`, `apps/api/src/http/routes/cards.ts:474`.

## LIFE-OPEN-05 — COM-03

source_grounded_lead_not_runtime_confirmed: Mention validation checks integer bounds/overlap/eligible identity, but does not verify selected token boundaries or reject a UTF16 surrogate split. API requires these. Trimmed body may also shift supplied spans; needs explicit normalization proof.

Next: Freeze mention normalization criterion and reproduce through mounted POST/PATCH; preserve v1 no-renotify on edit and no directory leakage.

Sources: `docs/API.md:106`, `apps/api/src/adapters/comments.ts:241`, `packages/contracts/src/discussion.ts:9`.

## LIFE-OPEN-06 — BRD-08

locally_repaired_pending_frozen_gate_independent_review_UAT: See boards-lifecycle-handoff.json for current implementation,45 focused tests and83 nearest legacy tests; no approval inferred.

Next: Parent final source manifest/full local gate/independent review and UAT checks.

Historical reproduced/source gap: API/schema declare expectedVersion for board archive/reopen, but mounted routes ignore body and apply transition without version guard. No newer explicit server-contract retirement was located.

Sources: `docs/API.md:114`, `packages/contracts/src/boards.ts:47`, `apps/api/src/http/routes/boards.ts:737`, `apps/api/src/http/routes/boards.ts:856`.

## LIFE-OPEN-07 — ATT-02

Full pixel verification is implemented locally, but mandatory maximum acceptance remains blocked. The injected Node/native and Worker/Images drivers fully drain a bounded decode output; a strict custom JPEG entropy checker catches the known warning-recovered input; every supported WebP frame is checked and APNG is explicitly unsupported. Known header-only/corrupt-DEFLATE/entropy cases now reject422.

Current v5 focused result is62tests:60pass,2fail,0skip,exit1. Textured20MP Node CMYK and actualworkerd RGB return503 processingbudget; the separate v5 diagnostic passedRGB in both runtimes but failedCMYK in both. Both runs remain evidence. Existing10MiB/8192/20MP caps are unchanged. See `image-full-verifier-handoff.json`, `raw/image-pixel-entropy-v5.log` and `image-maximum-blocker-options.md`.

Next: parent scope/architecture decision, then frozen source/full local gate/fresh independent high parser review; hostedCPU/plan/private-provider acceptance remains UAT pending. No ATT02 closure or selfapproval.

Sources: `apps/api/src/services/image-validator.ts`, `apps/api/src/services/jpeg-entropy.ts`, `apps/api/src/services/image-verifier.ts`, `apps/api/src/adapters/images.ts`.

## LIFE-OPEN-08 — NTF-03

source_design_evidence_gap: Outbox uses transaction-held SKIP LOCKED claims; there is no expiring token/fencing lease persisted outside transaction. Crash rollback can safely retry database-only notification work, but does not by itself prove all lease/fencing/provider-failure acceptance. SQL poison failures can abort the transaction before retry update.

Next: Freeze failure-recovery criterion and test actual SQL error/crash/restart/overlap; independent review must decide whether database-lock equivalent satisfies the exact claimed runtime before closure.

Sources: `apps/api/src/adapters/notifications.ts:245`, `database/migrations/0001_initial.sql:272`.

## LIFE-OPEN-09 — AUD-03, AUD-04

source_grounded_input_validation_lead_not_runtime_confirmed: Activity fromDate/toDate filters are read as raw strings then used as timestamp SQL parameters. Invalid date behavior needs mounted validation rather than assuming all malformed inputs yield safe4xx.

Next: Adversarial timestamp/range/cursor probes; root owns any shared query schema coordination.

Sources: `apps/api/src/http/routes/activity.ts:44`, `apps/api/src/http/routes/activity.ts:77`, `apps/api/src/adapters/activity.ts:270`, `apps/api/src/adapters/activity.ts:442`.

## LIFE-OPEN-10 — UX-05, DEL-05, DEL-06, ATT-04

verification_or_hosted_acceptance_pending: Focused local suite/one200row workerd wall-time sample are not representative warm/cold/load/maximum-payload/hosted storage/cron/signed-in acceptance. Exact restore cutoff and separate-connection full coverage must bind final frozen target.

Next: Parent local full gate/independent review, then explicit UAT-pending acceptance per latest release order.

Sources: `apps/api/test/ux-integration.test.ts:351`, `docs/reviews/FULL-REVALIDATION-20261103/import-repair-handoff.md`.

## UI-owned integrated acceptance

Focus/keyboard/narrow views, filtered drag explanation, pending/unsaved drafts, poll/reconnect reconciliation and explicit Low/Medium/High/Urgent UI selection require browser proof. Existing API/MCP none-priority compatibility remains unchanged. No browser or screenshot in this backend stream closes these.
