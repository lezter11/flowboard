# Board access repair: independent read-only review, round 2

Review task identity: `/root/backend_reaudit` (fresh agent, no source or test edits). The provider's opaque session ID and the implementer's session/model were not exposed to this reviewer; this round is a failed record and cannot authorize closure. Reviewed local source and the supplied `complete-suite.log` on 2026-10-28 UTC. The earlier BOARD-ACCESS-CUTOVER-20261028 claim is historical context, not approval for this target.

## Evidence status

- `complete-suite.log` reports `npm run check`, 353 API tests passed, 41 contract tests passed, zero skipped, local workerd HTTP and scheduled callback tests. I inspected the preserved log and source; I did not independently run that complete command. The parent task reports two isolated synthetic PostgreSQL databases. No hosted runtime or live-user claim is made.
- Mounted Node/Worker route wiring: `apps/api/src/http/app.ts` mounts boards, cards, comments, images, imports, trash, activity and notifications. `apps/api/src/runtime/worker.ts` uses the same app for fetch and invokes `processOutboxLease` from `scheduled`. The former public outbox processing route is absent. `session.ts` denies dev-login when Worker bindings are present. `getMyTasks` requires `projectId` and filters by project, membership and board grant. Mounted card/comment list handlers now hold board access locks for their transactions, with a concurrent comment-list revocation test.
- These positive observations do not offset the open findings below.

## Open blocking findings

### BAR2-01: Snapshot can deliver a board after grant revocation

Mounted `GET /api/v1/boards/:boardId` calls `getBoardSnapshot` (`routes/boards.ts:128-145`). That function begins `REPEATABLE READ READ ONLY` (`adapters/boards.ts:1000`), reads board context, then calls `requireBoardRead` (`:1031`), which checks project role and board grant with plain SELECTs (`:23-33`). It performs many content/count queries and commits at `:1221` without a grant lock or current-state recheck. PostgreSQL repeatable-read keeps the first query's snapshot: if Owner revocation commits after the first board-context SELECT, the in-flight request can still see the former grant and return names, counts, cards and people after revocation. This violates the frozen criterion requiring current board access before title/body delivery. A separate-connection, mounted snapshot/revocation race test is absent. This is a source-level concurrency finding; this reviewer did not execute that race.

### BAR2-02: Malformed outbox row can copy another project's card title into an Owner inbox

The Worker scheduled callback calls `processOutboxLease` (`runtime/worker.ts:38-46`). The consumer accepts `comment.created` payload IDs and joins card to comment only by `cardId`/`commentId` (`adapters/notifications.ts:280-296`). It does not require card/comment project and workspace to equal the outbox row. It builds a notification from the card's title but scopes the link, target-role check and inserted notification to the outbox row's project/workspace (`:300-345`). A row for project A whose JSON payload identifies a card/comment in project B can therefore notify A's Owner with B's title. The Owner branch of `visibleNotification` (`:65-75`) displays that row without requiring card ancestry. The `outbox` composite foreign key (`database/migrations/0003_constraints.sql:101-104`) validates only the row's project/workspace; `payload JSONB` (`0001_initial.sql:272-281`) has no card ancestry constraint. `notifications.card_id` is a separate card foreign key (`0006_retryable_storage_cleanup.sql:15-17`), also with no matching project constraint. Normal `postComment` writes consistent rows (`adapters/comments.ts:398-415`), so the trigger is a malformed or legacy outbox record, precisely a frozen fail-closed case. Existing tests cover missing `board_grants` for a non-Owner, but no mismatched outbox/card scope test was found. This is a source-level proof, not a mounted synthetic reproduction in this round.

## Other read paths and limits

`listNotifications` uses a transaction but no held board-grant locks around its scope digest and page query (`adapters/notifications.ts:106-136`); project card search and My Tasks use access-filtered queries and final rechecks but no held grant locks (`adapters/cards.ts:1004-1027,1239-1254`). Their precise race outcomes need separate mounted tests. I have not elevated these to additional confirmed defects in this round. The mandatory all-path claim and six review criteria therefore cannot be marked passed.

## Review judgment

Scores (0-10): security 7.0; correctness 8.0; integrity 8.0; tests 8.0; maintainability 8.0; operations 7.5. Weighted score = 7.675. Security, correctness, integrity and tests miss their category minima, and the two open findings veto closure regardless of score. The test suite is green on the supplied log, but no passing backend review record or handoff is authorized.

Repair evidence needed: bind outbox card/comment ancestry to the row before generating notifications; test malformed cross-project scope and Owner inbox behavior through the scheduled Worker; serialize snapshot delivery with board-grant removal and demonstrate both race orders with separate PostgreSQL connections through the mounted route. Re-audit the new exact source target after repairs.
