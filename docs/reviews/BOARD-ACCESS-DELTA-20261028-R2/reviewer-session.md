# Reviewer session evidence: BOARD-ACCESS-DELTA-20261028-R2

Reviewer: actorId `delta-reviewer-haiku-r2`, model `claude-haiku-5-5`, sessionId in the generated record.
Implementer (not this reviewer): actorId `backend-chat`, sessionId `cc5e8cdb-backend-gapfix-20261028`, model `claude-sonnet-5-5`.
Declaration: this reviewer did not implement, edit or commit the target. Edits were limited to this directory (probe scripts, logs, this file, the generated draft and record). No network service, live credential or database other than the isolated synthetic PostgreSQL 17 on 127.0.0.1:55492 was used.

## Target
- Start HEAD `e32f837` on `chore/baseline-2026-10-28`; `git status --short` was empty at start (no tracked changes).
- End HEAD and status: recorded in the final report (see the reviewer's closing check). Tracked files under apps/, packages/, database/, scripts/ were not changed by this reviewer.

## What I read (fresh context; the aborted round-2 attempt directory was not read)
- `BACKEND_REVIEW_GATE.md`, `docs/reviews/README.md`, `docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/criteria.json` (frozen; not edited).
- Round-1 record `docs/reviews/BOARD-ACCESS-DELTA-20261028/87c2b1003e0506fe3310cd50357dc218ca8261ce9d2bdfaddd5446aef3bb0399-round-1.json`, used only as the DR1-01..07 regression checklist.
- Source: `apps/api/src/adapters/rbac.ts`, `adapters/board-grants-foundation.ts`, `adapters/boards.ts` (lock sites), `adapters/cards.ts` (createCard, getCard, moveCard, requireCardBoardAccess), `adapters/comments.ts` (postComment lock sites), `adapters/trash.ts` (delete/restore locks), `adapters/images.ts` (requireImageBoardAccess, listCardImages), `adapters/activity.ts`, `adapters/notifications.ts` (grant predicates), `adapters/idempotency.ts`, `adapters/session.ts`, `adapters/migrations`/`embedded-migrations.ts` (via the drift test), `http/app.ts`, `http/middleware/origin.ts`, `http/middleware/auth.ts`, `http/middleware/error-handler.ts`, `http/admin-secret.ts`, `http/routes/system.ts`, `http/routes/session.ts` (dev-login), `http/routes/google-auth.ts`, `http/routes/board-grants.ts`, `http/routes/boards.ts`, `http/routes/cards.ts`, `http/routes/comments.ts`, `http/routes/images.ts`, `http/routes/trash.ts`, `http/routes/activity.ts`, `http/routes/notifications.ts`, `runtime/worker.ts`, `apps/api/wrangler.jsonc`, `apps/web/functions/api/[[path]].ts`, `database/migrations/0007_board_grants.sql`, `scripts/check_backend_review.py`, `scripts/generate_review_record.py`.
- Tests read: `apps/api/test/board-concurrency.test.ts`, `origin-check.test.ts`, `cors-policy.test.ts`, `google-auth-system.test.ts`, names and structure of `board-access*.test.ts`, `board-grants-foundation.test.ts`, `rbac-advanced.test.ts`, `rbac01-matrix.test.ts`.
- Hono 4.13.14 CORS middleware (`node_modules/hono/dist/cjs/middleware/cors/index.js`), to confirm the empty-Origin behaviour.

## What I ran (all outputs are in this directory)
1. `npm run check` from the repo root with the two synthetic DATABASE URLs exported. Full output in `reviewer-complete-suite.log`, last line `EXIT=0`. Counts read from the log: API `tests 381 / pass 381 / fail 0 / skipped 0 / todo 0`; contracts `tests 41 / pass 41 / fail 0 / skipped 0 / todo 0`. Typecheck, `wrangler deploy --dry-run` build and both test workspaces ran.
2. `reviewer-r2-probes.ts` / `.log`: P1 15 rounds of 6 parallel card creates plus 6 parallel moves on one board (status counts 200=15, 201=15, 409=150; no 500 or 503). P2 member creates a card with an Idempotency-Key, owner revokes the grant, member replays the same key (replay returned 404 and no saved body). P3 anonymous GET of an existing vs missing board (401 vs 404). P4 viewer holding a grant gets 403 on write. P5 Origin/Referer/cookie-name variants against `POST /api/v1/session/logout` (see log for each status).
3. `reviewer-r2-lock-order-probe.ts` / `.log`: 20 rounds of move versus trash on one card, random interleaving. No deadlock observed (probe result is not proof of absence).
4. `reviewer-r2-lock-order-forced-probe.ts` / `.log`: forced interleaving with a helper connection holding the board row FOR UPDATE, move queued first, then trash. 10 rounds: no deadlock (trash route takes the board through its receipt check before the card lock, so the ordering is board then card for both routes).
5. `reviewer-r2-comment-lock-probe.ts` / `.log`: the same forced interleaving with a comment POST instead of trash. 10 of 10 rounds: the comment returned 503 SERVICE_UNAVAILABLE ("The request conflicted with another update") and the move returned 200. Control (move versus move, same forced setup): 200/409 each round, no deadlock. This is the reproduced finding R2-01.
6. `python3 scripts/check_backend_review.py` and `scripts/generate_review_record.py` were run only after the record was generated (see the final report for exit codes).

## What I could not do or did not prove
- Real Google OAuth, real Hyperdrive, a hosted deployment and live-user data were out of scope and not used. Google callback tests use the mocked token and userinfo fetch in the suite.
- Dependency advisory status was not checked (no network access). Unverified.
- I did not mutate the target (no reverting `FOR UPDATE` to measure whether the deadlock fix is necessary). Such a mutation would have needed an edit outside this directory, which the rules forbid.
- Race probes are single-environment samples (15 + 20 + 10 + 10 + 10 rounds). They show what reproduced; they do not prove absence of other interleavings.
- I did not probe every route with a board-scoped row lock taken before a grant lock. Same-pattern sites not probed: `routes/comments.ts:190` and `:301` (FOR SHARE on card and comment rows before the receipt check), `routes/images.ts:43`, `routes/imports.ts:222`.
- Card GET (`GET /api/v1/cards/:cardId`) and image reads check the grant in autocommit statements; I did not probe a revocation that commits during those reads.
- Timestamps in the record are approximate: `startedAt` is taken from the process start time of the first suite run, not from a log of this session.

## Rejected candidates (kept with reasons; full list in the record)
- Origin/CSRF bypass via null Origin, Referer only, lookalike localhost, legacy cookie name, sec-fetch-site values: rejected by probes P5 and by `origin.ts` logic (cross-site rejected 403; `session=` legacy cookie covered).
- Trash-versus-move card/board deadlock: rejected by the forced probe (no 40P01 in 10 rounds) and by reading `routes/trash.ts:61,193` (board lock before card lock).
- Workspace activity exposing board-scoped events to non-owner members: rejected, `adapters/activity.ts:431-458` returns 403/404 for non-owners.
- Replay after revocation returning the saved response: rejected by probe P2 (404, no body).
- Dev-login reachable on a deployed Worker: rejected, `routes/session.ts:103` returns 404 whenever HYPERDRIVE or DATABASE_URL is bound, and `runtime/worker.ts:16` always binds one.
- Test-only admin secret accepted by a deployed Worker bundled with NODE_ENV=test (DR1-02): not reproduced in the deployed path; `system.ts:10,22` derives `deployed` from bindings and `admin-secret.ts:12` never returns the test secret when deployed.
