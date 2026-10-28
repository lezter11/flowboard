# Reviewer session: BOARD-ACCESS-DELTA-20261028 round 1

- Reviewer: actorId `delta-reviewer-opus`, sessionId `delta-review-opus-20261028T1540Z-r1`, model `claude-opus-5-5` (Claude Code subagent, fresh context).
- Implementer (not me): actorId `backend-chat`, sessionId `cc5e8cdb-backend-gapfix-20261028`, model `claude-sonnet-5-5`.
- Independence: I did not write or edit any file under apps/, database/, packages/ or scripts/. I wrote only files in this directory. I did not see the builder's desired score. Prior round-8 findings were not used as evidence.
- Date: 2026-10-28, approx. 15:40Z to 16:10Z.

## Target

Frozen criteria commit `4f15e16` (clean tree at start). During the review another chat committed `f2cf323` (changes `apps/api/wrangler.jsonc`, adds dev/uat environments; plus apps/web and docs/DEPLOY_SECRETS.md outside backend scope) and afterwards left an uncommitted edit to `apps/api/wrangler.jsonc` (UAT Hyperdrive id). No source, test, migration or contract file changed. I re-ran the mandatory suite on `f2cf323`; the final uncommitted config edit was not re-tested. The record manifest hashes the bytes present at finalization. Because the audited target moved, this round cannot be a pass regardless of findings.

## What I read

BACKEND_REVIEW_GATE.md, docs/reviews/README.md, the frozen criteria, both board-access proposals, docs/API.md (auth/authorization sections), docs/FEATURE_SPEC.md §1-4, features.tsv rows for the six features. Source: http/app.ts, routes/google-auth.ts, routes/system.ts, routes/session.ts, http/admin-secret.ts, middleware/auth.ts, adapters/session.ts, adapters/migrations.ts, adapters/embedded-migrations.ts (compared programmatically), runtime/worker.ts, runtime/node.ts, routes/board-grants.ts, rbac.ts write-lock and ancestry helpers, notifications read-state writes, card create/move lock sequence, trash delete lock sequence, import create ordering, migration 0007. Tests: google-auth-system.test.ts, cors-policy.test.ts, worker.test.ts, worker-probe.ts, board-access.test.ts setup. I also inspected the built Worker bundle (`apps/api/dist/worker/worker.js`) and wrangler's NODE_ENV define logic.

I did not re-read every one of the ~15k lines of route/adapter code; coverage of the remaining routes relies on my mounted-route probe matrix plus the passing suite.

## What I ran (all local, synthetic, loopback PostgreSQL 17 at 127.0.0.1:55492)

1. `npm run check` at `4f15e16` -> exit 0, API 375/375 pass, contracts 41/41, 0 skipped (reviewer-complete-suite-4f15e16.log).
2. `npm run check` at `f2cf323` -> exit 0, API 375/375 pass, contracts 41/41, 0 skipped, 0 cancelled (reviewer-complete-suite.log).
3. `NODE_ENV=test node reviewer-probes.ts` against `flowboard_access_test` in fresh schemas (dropped afterwards): 87 pass, 1 fail, 7 notes; exit 1 because of the parallel-write 5xx check (reviewer-probes.log).
4. `node reviewer-race-repro.ts same|move`: parallel card creates and parallel card moves on one board return 500 INTERNAL_ERROR; `pg_stat_database.deadlocks` rises by the number of 500s (reviewer-race-repro.log).
5. `node reviewer-worker-probe.ts` in local workerd (wrangler createTestHarness, test/wrangler.jsonc) bundled under build-shell NODE_ENV=production, test and development (reviewer-worker-probe.log). Read-only against the harness DB.

## What I could not do

- No real Google, hosted Cloudflare Worker, Hyperdrive or Pages proxy (excluded by criteria; not authorized).
- No dependency advisory lookup (no network); dependency status unverified.
- Deadlock exposure was reproduced for card create and card move only; other board writes with the same FOR SHARE -> FOR UPDATE pattern were identified by reading, not measured.
- No second independent reader confirmed DR1-01; it is reproducible with the saved script.
