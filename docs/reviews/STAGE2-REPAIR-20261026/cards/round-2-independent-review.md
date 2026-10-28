# Independent CRD-01–CRD-11 Acceptance Review — Round 2

**Verdict: fail.** Fresh read-only sub-agent review; implementation not performed by this reviewer. The review target is the supplied 164-file SHA-256 map, digest `b8f1cd4def58d26b4d688888ced46ab88e12a1cee930ff94277709caff24e0cd`. All 164 hashes matched before and after review. The readable report, JSON and command logs are outside the target manifest. No source or handoff was changed.

## Scope and evidence

Reviewed reachable CRD routes and adapters, mounted route order, RBAC/idempotency helpers, PostgreSQL migrations/schema, feature/API specs, frozen round-1/round-2 criteria, and CRD test suite. The current deployment path mounts `boardsRoutes` before `cardsRoutes`, so `/boards/:id/cards` and `/columns/:id/placement` resolve to board-adapter handlers. Project search resolves to `cards.ts`.

- Root `npm run typecheck`: **exit 0**, [round-2-typecheck.log](round-2-typecheck.log).
- Focused mounted-route PostgreSQL suite: **14 passed, 0 failed**, using isolated synthetic DB `127.0.0.1:55441/flowboard_harness`; [round-2-crd01-crd11-postgres-approved.log](round-2-crd01-crd11-postgres-approved.log). This run required approved local TCP access. The originally supplied `/stage2_cards` database name is rejected by `localDatabaseUrl` before connection; the parent supplied the corrected disposable DB. The initial rejected command and sandbox-blocked attempt are preserved in adjacent logs.
- Tests in `CRD-10` named “Concurrent…” use sequential stale-version requests, not two racing field/move writes. The same-key create test does run two concurrent HTTP requests and supports receipt atomicity for that path.
- The frozen criteria also list full `npm run check` and BRD/COM/DEL suites. Those commands were outside this cards subreview and were not run here; no evidence is inferred for them.

## Findings

### F-01 — High, blocking: move accepts noncanonical neighbors and creates rank collisions

`apps/api/src/adapters/cards.ts:681-725, 727-772` assigns rank `1000` when both neighbors are null without verifying the destination is empty. With two neighbors it checks only that each is active in the destination; it never verifies adjacency or that the previous card sorts before the next. For example, if destination ranks are 1000, 2000, 3000, supplying the first and third as neighbors assigns 2000 and collides with the middle card. The position index in `database/migrations/0001_initial.sql` is non-unique, so PostgreSQL accepts the duplicate. Board row locks and OCC serialize valid moves, and the tests cover ordinary first/last/between cases; they do not cover an occupied `(null,null)` request, nonadjacent pairs or rank uniqueness. This contradicts the API’s requirement to validate adjacent canonical neighbors and server-owned ranks.

### F-02 — High, blocking: placement succeeds for a nonexistent, trashed or foreign moving card

The mounted board handler calls `apps/api/src/adapters/boards.ts:getPlacement`, which validates board/column and access, then merely excludes the caller-supplied `movingCardId` from destination cards (`boards.ts:740-780`). It never loads the moving card or verifies active state and board/project ancestry. A project member can request placement for an arbitrary ID and receive a 200 result. The card adapter has a separate placement implementation, but it is not the mounted handler due to `boardsRoutes` being registered first. Existing valid-placement tests do not cover this case. This leaves CRD-08/09 placement unreliable for the actual move command.

### F-03 — Medium, mandatory: project card search misclassifies completed cards as overdue

The actual project-search handler calls `searchProjectCards`; its `due=overdue` predicate is only `c.due_date < CURRENT_DATE` (`apps/api/src/adapters/cards.ts:1085-1091`). It does not join the column category to exclude `done`, and it uses the database session date rather than the workspace-local “today.” `FEATURE_SPEC.md` defines overdue as before workspace today and not in the done category. Board-list code has a corrected shared predicate, but that does not repair project search. The CRD suite has no overdue search assertion; the board suite’s overdue sample is in a todo column only.

### F-04 — High, mandatory: card-list cursors are not bound to board filters or snapshot

Mounted `listBoardCards` decodes cursor data containing only `{position,id}` (`apps/api/src/adapters/boards.ts:36-60, 1239-1265`). It accepts that boundary with another board or a changed filter and has no snapshot/version check. Inserting or moving cards between pages can therefore cause omissions or repeats; changing filters with the old cursor can silently skip matching cards. `API.md` requires cursors to bind project/filter/order/snapshot and stale cursors to return `409 STALE_CURSOR`. Valid same-filter page resumption and malformed JSON cursor tests are positive counterevidence, but they do not cover cross-filter/board reuse or mutation between pages.

### F-05 — High, blocking: card update/move replay can return stale success after a concurrent trash

The PATCH and move routes read `cards` state before opening their transaction (`apps/api/src/http/routes/cards.ts:148-157, 221-230`). The helper then locks current grant and archive context before receipt lookup, which correctly handles replay authorization/archive state, but it does not lock or recheck the card lifecycle. If a past PATCH/move receipt exists and a delete commits after the initial active-state lookup but before receipt lookup, the retry can return the stale success outcome for a now-trashed card. Normal commands re-lock and check active state inside their adapters; receipt replay returns earlier. This is a narrow race, not a claim that every retry succeeds after trash. The API and round-1 criterion require current lifecycle semantics on replay. No trash-versus-replay concurrency case exists in the CRD suite.

## Positive evidence and counterevidence

- `checkOrReplayProjectWriteReceipt` checks the actor’s current grant and calls `acquireWritableProjectContextLock` before reading a receipt. This includes the row locks that serialize normal replay attempts against project/board archive transitions. The round-2 archived-context acceptance is implemented on the checked paths.
- Comment post/edit/delete routes check card state under `FOR SHARE` before replay; comment-delete passes `manager` for a non-author and `member` for the author. The comment cursor uses ascending `(created_at,id)`, binds to `cardId`, and keyset paging avoids duplicates from later inserts. COM test source includes archive, demotion, lifecycle replay and pagination cases, but that suite was not run in this cards review.
- Receipt JSON is reduced to safe IDs/status/version fields; the CRD test inspects a created-card receipt and exercises current-role denial and parallel same-key create. These are material positives, but do not cure the open correctness findings.
- Ordinary card create/detail/edit/move, assignment bounds, same-key create, role replay denial and valid placement cases are covered in the CRD PostgreSQL route suite and passed in the isolated run. The malformed card-cursor example is in the separate BRD suite, which was not run here.

## Scores

| Category | Score | Weight | Minimum | Reason |
|---|---:|---:|---:|---|
| Security and authority boundaries | 8.0 | 30 | 9.0 | Project/grant locks and minimal receipts are sound; stale lifecycle replay can return an outcome after card access has changed. |
| Functional and API correctness | 6.5 | 25 | 8.5 | Neighbor/rank validation, moving-card validation, overdue search and cursor binding violate documented behavior. |
| Data integrity and concurrency | 6.2 | 15 | 8.5 | Duplicate ranks are accepted; tests do not prove concurrent OCC or trash/replay lifecycle serialization. |
| Test quality and independent evidence | 7.0 | 15 | 8.5 | Focused PostgreSQL suite and typecheck pass; key negative cases and all frozen command families are not independently evidenced here. |
| Maintainability and portability | 7.8 | 10 | 7.5 | Typed route/adapter boundaries and shared authorization helpers are understandable; duplicate card/board implementations create route-order ambiguity. |
| Operations, performance and failure recovery | 7.0 | 5 | 7.0 | Meets the minimum; bounded pagination exists, but stale cursor and rank recovery behavior are incomplete. |
| **Unrounded weighted total** | **7.135** | **100** | **strictly >8.5** | **Fail; four category minima fail and mandatory blockers remain.** |

## Limits and disposition

No Worker dry-run, full root `npm run check`, BRD/COM/DEL suites, hosted behavior, production DB, browser/UI behavior or dependency advisory lookup was performed in this subreview. The PostgreSQL evidence is only the isolated synthetic database above. Identity/session UUIDs are not exposed to this reviewer, so none is fabricated.

This review does not authorize a CRD handoff or checklist closure. Fix F-01 through F-05, add mounted PostgreSQL regressions, run the frozen command set, then freeze a new manifest for a fresh review. The old incomplete acceptance history remains preserved.
