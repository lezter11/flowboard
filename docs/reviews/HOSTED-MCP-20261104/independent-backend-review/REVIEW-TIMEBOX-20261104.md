# Independent backend review — resumed timebox checkpoint

User-authorized window:2026-11-04T09:28:26Z through09:50:26Z. Review resumed within that window and stopped after collecting the bounded focused checks. Reviewer `/root/hosted_mcp_security_review` did not implement product source; changes are confined to this review-output directory. This checkpoint supersedes the pause only for the work explicitly reported below; preserve `REVIEW-PAUSED.md`, original failures and earlier preliminary notes.

## Actions

Both builders declared functional source held before the final focused bundle. Independently executed:

| Command | Result | Evidence |
|---|---|---|
| `node docs/reviews/HOSTED-MCP-20261104/independent-backend-review/run-held.mjs hosted` | exit0;75/75 | `held-hosted.log`, `held-hosted-before.json`, `held-hosted-result.json` |
| `node docs/reviews/HOSTED-MCP-20261104/independent-backend-review/run-held.mjs compat` | exit0;24/24 | `held-compat.log`, `held-compat-before.json`, `held-compat-result.json` |
| `node docs/reviews/HOSTED-MCP-20261104/independent-backend-review/run-held.mjs reviewer` | exit0;13/13 | `held-reviewer.log`, `held-reviewer-before.json`, `held-reviewer-result.json` |
| `npm run typecheck` | exit0 | `typecheck-held.log` |
| `node scripts/sync-embedded-migrations.ts --check` | exit0;27 migrations match | `embedded-parity-held.log` |

Total focused tests:112/112. Each of the three test bundles recorded **no changed source files** between its before/after SHA-256 maps. Those maps cover API source/tests, contracts source, MCP source/tests, relevant package/lock files and migration0027. They are observation manifests, not a machine-validated passing independent review record. Logs were collected from actual commands, not copied builder results.

All database tests use the preselected disposable loopback PostgreSQL harness. OAuth suites and reviewer cases use unique schemas. PAT compatibility runs inside an additional unique `PGOPTIONS` schema created and removed by `run-held.mjs`; no public/shared table reset is performed. Actual local workerd executes the production Worker entry point against those synthetic schemas. No real UAT, credentials or live-user records were probed.

## Findings and dispositions

1. **Original confirmed OAuth-child buffer/deadline failure: repaired in inspected candidate and independently retested.** `oauth-body-retest-2.log` proves unfinished17,000-byte registration input refuses413 before manual close; under-limit unfinished input refuses504 at a30ms configured deadline. Both cancel the body and settle work even when the source cancel promise never resolves. The original probe's first post-fix rerun completed early then raised an already-closed-controller cleanup error; retained as `oauth-body-retest-1.log`. The assertion-based retest avoids that harness assumption. The held75-test bundle includes13 actual-createApp body regressions across registration/token/revoke/decision, exact UTF-8 boundary, already-aborted input and retained transaction lifetime.
2. **Original confirmed already-aborted MCP reader failure: repaired in inspected candidate and independently retested.** `already-aborted-body-retest-2.log` proves a pre-aborted unfinished body cancels and returns400 without manual close. Original post-fix probe cleanup failure is retained as `already-aborted-body-retest-1.log`. Held mounted tests also execute a deadline while credential verification is queued, then prove resumed work cancels and settles.
3. **Persistence disclosure gap: repaired in candidate.** Independent native production Worker flow verifies explicit offlineAccess,900-second access lifetime,30-day connection bound and conditional7-day refresh idle field. It runs registration→authorize→cookie/browser-bound description→decision→code exchange→own list→disconnect→refresh refusal against real PostgreSQL.
4. **Retention concern: implemented and reviewed as bounded component evidence.** Cleanup keeps complete retained code/refresh families, uses a conservative seven-day terminal identity anchor, removes orphan expired requests and redacts retained sensitive request state; separate DCR cleanup now also protects pending authorization. Held tests exercise actual self-FK deletion, rollback, locks, caps and scheduler continuation. No native hosted cron or real elapsed retention period was observed.
5. **OPEN robustness candidate — transport awaits oversized-body cancellation.** The transport's declared/streamed oversized-body paths still await cancellation. A synthetic Request source whose cancel promise never resolves leaves the service pending after signal abortion. This has not been established as a remotely triggerable Node/workerd incoming-body defect. Architect explicitly retained the frozen source and deferred this candidate for the next session, rather than invalidating current proof with a late repair. Do not present it as a confirmed remote exploit or silently discard it. Next review must verify the runtime guarantee or repair/test nonblocking cancellation.

## Why and options

A saved Flowboard create receipt remembers a prior successful operation; it must never become a new permission grant. Reviewer-owned mounted tests prove the same receipt is denied after board-grant removal and after membership removal. Another test uses separate PostgreSQL connections and observes the real membership lock wait: revocation wins, the delayed operation then fails, and no card is written. Held builder tests independently rerun by this reviewer cover both credential-disconnect lock orders, stable receipt identity across refresh, external OAuth refusal on ordinary REST/PAT/session routes and private Request identity absent from clones.

The production Worker is exercised locally, rather than inferred solely from TypeScript or an injected Hono helper. This provides bounded runtime evidence for Request identity, one-connection dispatch, OAuth state and create/replay. It cannot establish deployed Cloudflare/Hyperdrive/Pages or real Claude/Google acceptance.

## Evidence and limits

**Overall status remains incomplete. No HMCP-05 approval, no UI-ready handoff and no category/overall passing score is issued.** The focused112 passing tests are substantial component/runtime evidence; they do not replace full required API/contracts/build/release checks, a complete immutable whole-feature review record, remaining concurrency/privacy/failure coverage, browser Google safe-next/consent/disconnect acceptance, or the original overall gate. The changing-source observations and earlier component handoff are not silently promoted to final approval. The retained oversized-cancel candidate remains open.

No UI implementation is established by this review. No UAT or production mutation was performed; existing UAT application baseline remains d1c81f4. A parent WIP commit would be source/evidence preservation, not release approval.

## Next / your input

At explicit resume, verify the final committed bytes still match the preserved maps, resolve or reject the open cancellation candidate with native-runtime evidence, complete the missing required checks and whole-feature review, then obtain the original independent gate before downstream UI approval or deployment. No user action is needed for this saved checkpoint.

No reviewer-owned process remains running. Sessions83300 and61794 were collected exit0; prior sessions82277 and68762 were already collected. All probes exited. No additional checks or source edits are scheduled beyond the authorized stop.
