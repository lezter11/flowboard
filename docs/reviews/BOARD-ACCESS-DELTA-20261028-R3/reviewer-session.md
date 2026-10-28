# Reviewer session evidence: BOARD-ACCESS-DELTA-20261028-R3

Reviewer: actorId `delta-reviewer-haiku-r3`, model `claude-haiku-5-5`, sessionId `r3-reviewer-55e80b3e-c974-4eb1-8c80-874b7fc71a49`.
Implementer (not this reviewer): actorId `backend-chat`, sessionId `cc5e8cdb-backend-gapfix-20261028`, model `claude-sonnet-5-5`.

Declaration: this reviewer did not implement, edit, commit or push the target. Edits were limited to files under `docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/` (probe scripts, logs, this file, the draft and the generated record). No network service, live credential, hosted deployment or database other than the isolated synthetic PostgreSQL 17 on 127.0.0.1:55492 was used. The main checkout at /Users/shubham/Documents/Flowboard was not read or changed.

## Target
- Review target: worktree `r3-worktree`, detached at `3e11ab8` (commit after `1b8fbef`, which is the round-2 fix commit).
- `git rev-parse --short HEAD` and `git status --short` at start: `3e11ab8`, empty status.
- At end: see the final report. The only changes are untracked files under `docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/`.

## What I read (fresh context)
- `BACKEND_REVIEW_GATE.md`, `docs/reviews/README.md`, `AGENTS.md`, `docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/criteria.json` (frozen, not edited). Note: the R3 criteria differ from R2 only in the `target` and `roundHistory` text lines; the 12 mandatory criteria, required checks, and requiredTests are byte-identical in value.
- Round-1 and round-2 records (`docs/reviews/BOARD-ACCESS-DELTA-20261028/...-round-1.json`, `docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/...-round-2.json`) and the R2 probe logs, used only as a regression checklist (DR1-01..07, R2-01..08). The R2 `aborted-opus-attempt/` directory was not read.
- Source: `apps/api/src/adapters/{rbac,idempotency,board-grants-foundation,boards,cards,comments,imports,images,trash,notifications,activity,session,embedded-migrations}.ts`, `apps/api/src/services/{trash-purge,board-access-cursor-draft}.ts`, `apps/api/src/http/{app,admin-secret}.ts`, `apps/api/src/http/middleware/{origin,auth,error-handler}.ts`, `apps/api/src/http/routes/{cards,comments,trash,imports,images,boards,board-grants,notifications,session,google-auth,system}.ts`, `apps/api/src/runtime/worker.ts`, `apps/api/wrangler.jsonc`, `apps/web/functions/api/[[path]].ts`, `database/migrations/0007_board_grants.sql` (via embedded copy), `packages/contracts/src/{imports,cards,discussion}.ts`, `scripts/check_backend_review.py`, `scripts/generate_review_record.py`.
- Tests read: `apps/api/test/comment-move-replay.test.ts`, `board-concurrency.test.ts`, names and structure of `board-access*.test.ts`, `rbac01-matrix.test.ts`, `rbac-advanced.test.ts`, `origin-check.test.ts`, `cors-policy.test.ts`, `google-auth-system.test.ts`.

## What I ran (all outputs are in this directory)
1. `npm run check` from the worktree root with the two synthetic URLs exported. Full output in `reviewer-complete-suite.log`; last line `EXIT=0`. Counts: API `tests 383 / pass 383 / fail 0 / skipped 0 / todo 0`; contracts `tests 41 / pass 41 / fail 0 / skipped 0 / todo 0`.
2. `reviewer-r3-forced-probes.ts` / `.log`: forced interleavings on one board with a helper connection holding the board row `FOR UPDATE`, two mounted-route requests queued in a fixed order, then release. 10 rounds per scenario. Results: P1 move then comment PATCH: 200/503 x10. P2 move then comment DELETE: 200/503 x10. P3 move then card create (control): 200/409 x10. P4 import commit then the same import's commit: 200/503 x10. P5 import commit then card create (control): 200/409 x10. P6 comment POST then move (fixed path): 201/200 x10. `pg_stat_database.deadlocks` delta over the whole run: 30 (= P1 + P2 + P4). No 500 response was produced.
3. `reviewer-r3-replay-probe.ts` / `.log`: a board member writes once with an Idempotency-Key, the Owner revokes the grant, the member replays the same key and body. Results: create card 201 then replay 404; move 200 then 404; PATCH card 200 then 404; comment POST 201 then 404. No replay leaked the saved body.
4. `reviewer-r3-small-probes.ts` / `.log`: anonymous GET of an existing board 401 vs a missing board 404 (carried R2-02); `GET /boards/:id/access` with `CURSOR_SECRET` unset returns 503 `CONFIG_ERROR` for the Owner and for a member; cross-site cookie POST returns 403; `/api/v1/system/status` returns 403 with a wrong or no secret.
5. `reviewer-r3-old-code-comment-move-test.log`: the R3 copy of `apps/api/test/comment-move-replay.test.ts` run against a pre-fix copy of `e32f837` (the parent of `1b8fbef`, created with `git archive` into a scratch directory outside the worktree, with `node_modules` linked read-only from the worktree). Three runs: the interleaving test fails with `unexpected status 503` in 3/3 runs; the replay test passes. So the regression test does detect the pre-fix comment POST deadlock, but only probabilistically in a random 8-round loop, not by forced ordering.
6. `python3 scripts/check_backend_review.py` for each of the six features, run after the record is generated (exit codes in the final report).

## What I could not do or did not prove
- Real Google OAuth, real Hyperdrive, hosted deployment and live-user data were out of scope and not used. Google callback behaviour was checked by reading the source; the suite exercises it with mocked token and userinfo fetches.
- Dependency advisory status was not checked (no network). Unverified.
- Forced probes are single-environment samples (10 rounds per scenario). They show what reproduces; they do not prove absence of other interleavings. Trash, image attach, import cancel, and comment DELETE versus trash were not forced-probed; their lock order was read from source (see the record's findings).
- Replay-after-revocation was probed for 4 mounted write routes, not for trash, comment PATCH/DELETE, image, or import routes.
- The deployed-Worker `CURSOR_SECRET` finding is from the source and the wrangler config (no `CURSOR_SECRET` var is set), and from the Node runtime probe; it was not executed in a deployed Worker.
- Timestamps in the record are approximate. `startedAt` is 2026-10-28T17:00:00Z, shortly before the `npm run check` run started (its log file was created at 17:01Z). `completedAt` is the record generation time.

## Rejected candidates (kept with reasons; full list in the record)
- Origin/CSRF bypass via null Origin, Referer-only, lookalike localhost origin: rejected by `origin.ts` logic (cross-site rejected 403, `null` origin rejected) and by the R3 small probe P3.
- Trash versus move card/board deadlock: rejected by source (`routes/trash.ts` takes the board through `checkOrReplayProjectWriteReceipt` before `deleteCard` locks the card). Not forced-probed in R3; the same ordering was forced-probed in R2 with no 40P01.
- Board column writes (`addColumn`, `updateColumn`, `reorderColumns`, `deleteColumn`) versus Owner grant revocation: rejected by source. Each takes `lockBoardAccess` (grant `FOR SHARE`) before the board row `FOR UPDATE`, so a revocation holding the grant row `FOR UPDATE` cannot also hold the board row first. Not probed.
- Purge worker (`services/trash-purge.ts`) versus card moves: rejected by source; the worker claims card rows with `FOR UPDATE SKIP LOCKED` and never locks the board row.
- Import cancel versus import commit: rejected by source; `cancelCardImport` takes no board row lock. Not probed.
- Dev-login reachable on a deployed Worker: rejected by source (`routes/session.ts:103` returns 404 whenever `HYPERDRIVE` or `DATABASE_URL` is bound, and `runtime/worker.ts:16` always binds one).
