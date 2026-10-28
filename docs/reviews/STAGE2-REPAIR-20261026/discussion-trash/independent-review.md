# Independent acceptance review: comments and trash

**Verdict: FAIL.** This fresh, read-only audit covers COM-01 through COM-06 and DEL-01 through DEL-08 on the frozen 161-file target. The manifest digest is `6030645ad47e30135acca9e50e6043b192dff5a221e6684dc332e4ef94ee25d1`; all listed files matched at review start and final recheck.

The focused PostgreSQL suite passed 32/32 and the repository-root typecheck passed. Those checks show the mounted endpoints work for the scenarios asserted by the current suite. They do not cover several required behaviors: the comments list ignores its cursor; comments can be changed in archived contexts, and comment deletion is allowed on a trashed card; card deletion has no archive guard; trash listing is unbounded; no purge/cleanup implementation exists; and content copies survive tombstoning. Restore also retains the old rank instead of finding a safe surviving position. These contradict acceptance requirements and are hard blockers regardless of score.

## Scores

| Category | Weight | Score | Evidence-based reason |
|---|---:|---:|---|
| Security and authority boundaries | 30 | 8.0 | Replay authorization now locks the current project grant before receipt lookup and strips bodies from stored receipt outcomes. But write paths omit archive guards, and delete-comment replay uses a member-level gate even when the original operation was manager moderation. |
| Functional and API correctness | 25 | 6.0 | Basic comment CRUD and restore paths are mounted and exercised. Cursor pagination is broken; archive and trashed-card guards are inconsistent; trash is unbounded; restore does not re-anchor position. |
| Data integrity and concurrency | 15 | 4.5 | Comment, receipt and soft-delete work is transactional. There is no purge worker or actual cleanup fence; the “purge winner” test directly changes the row in a sequential test, so it is not concurrency evidence. Comment and notification bodies remain retained. |
| Test quality and independent evidence | 15 | 7.0 | Independent PostgreSQL run passed 32 tests and root typecheck passed. Coverage lacks pagination, archive writes, trashed comment deletion, same-key parallel requests, actual purge/restore races, purge cleanup, notification redaction and exact-cutoff equality. |
| Maintainability and portability | 10 | 7.8 | Existing adapters separate route handling from SQL and shared receipt/RBAC helpers are reused. Lifecycle guards and list behavior are inconsistent across adapters. |
| Operations, performance and failure recovery | 5 | 5.0 | Trash reads every trashed card with no limit/cursor. No retryable purge/cleanup job or observable failure recovery is implemented. |

**Weighted total: 6.655/10** (`(8.0×30 + 6.0×25 + 4.5×15 + 7.0×15 + 7.8×10 + 5.0×5) / 100`). The security and correctness category minima fail, the total is not above 8.5, and mandatory blockers remain.

## Findings

1. **Blocking — COM-01 comment cursor is ignored.** `listCardComments` accepts `cursor`, but its SQL has no cursor predicate and always selects the first chronological page. If there are more than `limit` comments, every next-page request repeats the first page indefinitely. Fix with a stable `(created_at,id)` cursor bound to card/order and tests that retrieve page two and reject malformed/stale cursors. Evidence: `apps/api/src/adapters/comments.ts:78-104`; route forwards cursor at `apps/api/src/http/routes/comments.ts:36-45`.
2. **Blocking — archive read-only state is not enforced for writes.** Comment post/edit/delete do not load or reject project/board archived state. `deleteCard` also omits project/board archive checks. An authorized member/manager can mutate archived content. Add archive checks in the transaction with the required lock order; test both archived project and archived board for each mounted write. Evidence: `apps/api/src/adapters/comments.ts:241-267,427-463,577-608`; `apps/api/src/adapters/trash.ts:165-211`.
3. **Blocking — DEL-08 trashed-card write guard is incomplete.** `deleteComment` joins the parent card but never checks `state`; it can tombstone a comment while its card is trashed. Unlike comment post/edit, this mutation bypasses the lifecycle guard. Add the same active-card check before authorization/write and test the mounted endpoint. Evidence: `apps/api/src/adapters/comments.ts:577-608`.
4. **Blocking — DEL-02 trash pagination is absent.** `listProjectTrash` selects all trashed cards and returns `nextCursor: null`; the route does not parse a limit or cursor. A large project trash grows response work and memory without a bound. Add stable, scoped keyset pagination and tests. Evidence: `apps/api/src/adapters/trash.ts:291-315,370-374`; `apps/api/src/http/routes/trash.ts:109-118`.
5. **Blocking — DEL-06/07 purge and cleanup are not implemented.** No mounted job/adapter transitions expired cards to `purged` or removes recoverable content/files. The test labelled purge/restore “concurrency” updates `state='purged'` directly, then calls restore sequentially; it proves only that restore rejects an already-purged row. Implement a retryable worker with conditional state/version fencing and real two-connection race tests. Evidence: `apps/api/test/com-del.test.ts:959-975`; `rg` across the frozen `apps/api/src` contains no purge/cleanup path.
6. **Blocking — deleted bodies survive in copied storage.** Comment deletion sets `deleted_at` but leaves `comments.body` and mention rows intact. Mention creation stores a body excerpt in `notifications.body`; no comment-delete or purge redaction touches those rows. `card_trashed` activity stores the card title. Thus normal comment reads hide a body, but retained comment, notification, and audit copies are not cleaned after deletion/purge. Add a privacy-preserving retention/cleanup plan and verify all copies are redacted/removed. Evidence: `apps/api/src/adapters/comments.ts:313-328,577-608`; `apps/api/src/adapters/trash.ts:224-232`; `database/migrations/0001_initial.sql:162-174`.
7. **Blocking — DEL-04 restore does not re-anchor placement.** Restore chooses a column but never computes or writes a new `position`; it returns the stale pre-trash rank, which may overlap or precede/follow surviving cards unpredictably. Preserve the same card identity while assigning the documented nearest valid position under the board lock. Evidence: `apps/api/src/adapters/trash.ts:468-523`.
8. **Mandatory replay-role gap — comment moderation replay accepts a demoted member.** The delete-comment route checks replay with minimum role `member` for every request, while the normal mutation requires `manager` if the actor is not the comment author. A manager who moderated another person's comment and was later demoted to member can still replay that key and receive the saved success/id/version outcome. Resolve author/required role before replay or apply operation-equivalent authorization. Evidence: `apps/api/src/http/routes/comments.ts:258-279`; normal dynamic role check at `apps/api/src/adapters/comments.ts:597-604`.
9. **Coverage gap — exact cutoff and executable purge race unproved.** Restore uses `>=`, which is the correct comparison in source, but the current test moves the deadline ten minutes into the past rather than testing equality. The required purge race has no worker and no parallel DB sessions. Add an injectable/DB-clock boundary test at `restore_until` and concurrent restore/purge tests.
10. **Coverage gap — COM-06 UI draft behavior is outside the frozen source set.** The manifest covers API/contracts/tests but no UI source or UI-owned evidence. The requested backend audit cannot establish that independent comment drafts survive field saves/refetch/errors or that Enter in a mention picker never posts. Keep this as UI/integration evidence, not an API claim.

## Counterevidence that passed

- Routes are mounted in `apps/api/src/http/app.ts:113-114`.
- Comment posts check active card state and current member-or-higher grant; edit checks author and grant; card update/move reject non-active cards.
- Project-write replay checks acquire a current grant lock before receipt lookup (`apps/api/src/adapters/idempotency.ts:49-72`), and receipts store only minimal identifiers/version fields (`:17-46`). The suite verifies body absence, replay after demotion to viewer, and same-key body collision (`apps/api/test/com-del.test.ts:259-323`).
- Restore rejects archived project/board, compares `serverNow >= restore_until`, and locks the card row. These are useful guards but do not substitute for archive checks on other writes or an implemented purge worker.
- Focused PostgreSQL assertions for roles, comment creation/edit/tombstones, basic trash/restore, destination missing and earlier-than-cutoff expiry passed.

## Commands and environment

- `npm run typecheck` from repository root — exit 0; log `root-typecheck.log`.
- Requested `npm run typecheck` from `apps/api` — exit 1 because `apps/api/package.json` defines no `typecheck` script. Root equivalent passed.
- `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55442/flowboard_harness node --test --test-concurrency=1 test/com-del.test.ts` from `apps/api` — exit 0, 32 passed, 0 failed; log `focused-test.log`. Local disposable PostgreSQL harness; no live user data.
- Builder-supplied `npm run check` output exists at `docs/reviews/STAGE2-REPAIR-20261026/npm-check.log`; it is builder evidence, not represented as an independent reviewer run.

The final target recheck found all 161 listed files unchanged and the manifest map digest still matches the requested digest. No source or handoff files were edited.

## Closure

Do not close these features or publish a verified backend handoff from this review. Repair the findings, freeze a new manifest, add regression coverage, then obtain another fresh read-only review. COM means a teammate discussion thread; a correct first comment is not enough if page two repeats page one or a deleted card can still be edited. DEL means a card enters a timed recovery state; the timer and the concurrent cleanup process must agree on exactly one winner, and old comment/notification copies must not survive permanent cleanup.
