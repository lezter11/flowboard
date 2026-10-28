# Independent acceptance review: CRD-01 through CRD-11

Date: 2026-10-26 (UTC). Verdict: **fail**. Reviewer: fresh read-only collaboration agent `/root/reaudit_cards`; implementation was not performed by this reviewer. The platform did not expose actor/session UUIDs, so none is invented. The parent task identifies this as an independent reviewer.

## Target and scope

Reviewed the supplied frozen 161-file source target, including current card and comment routes/adapters, route wiring, RBAC/grant locks, idempotency receipts, contracts, PostgreSQL migrations, API/feature requirements and CRD tests. The exact source-manifest map digest is `6030645ad47e30135acca9e50e6043b192dff5a221e6684dc332e4ef94ee25d1`. All 161 current hashes matched before and after review; no listed target file changed. A byte-for-byte copy of the full manifest is preserved as [source-manifest.json](source-manifest.json). The report, JSON record and logs are outside that frozen source scope.

## Findings

### F-01 — High, blocking: comment-delete receipt replay skips the operation's manager/author authorization

The shared replay helper checks a minimum project role, and [comments route](../../../../apps/api/src/http/routes/comments.ts) calls it with `member` before invoking the delete adapter. The ordinary delete path requires `manager` for a non-author and `member` only for the author ([comments adapter](../../../../apps/api/src/adapters/comments.ts)). Therefore a project manager who deleted another user's comment, was demoted to member, and retries the same key can receive the saved success outcome. The current grant lock correctly blocks removed members and viewers, but the action-specific moderator rule is not rechecked on replay. This violates the gate's requirement that replay authorization be at least as restrictive as the original operation. No regression test covers this demotion/replay case.

### F-02 — High, blocking: create/edit/move/comment writes do not enforce archived context read-only behavior

The feature specification says archived projects and boards are read-only. `createCard` selects `boards.archived` but never checks it; it does not select project archive state. `updateCard` and `moveCard` load active card/board versions without archive flags or a shared archive guard. Comment post similarly checks card state and grant, not project/board archive state. An authorized writer can therefore mutate a card in an archived context. Existing restore code has archive checks, which is counterevidence that this state is modeled, but the card mutation paths omit them.

### F-03 — High, blocking: move accepts invalid neighbor pairs and can collide ranks

`moveCard` handles `(previousCardId:null,nextCardId:null)` as position 1000 without checking that the destination is empty. When both neighbors are supplied, it confirms each card exists in the destination but never confirms they are adjacent or ordered. An arbitrary request can therefore insert into a populated column at an occupied rank or outside the intended interval. The schema accepts nullable neighbor IDs but cannot establish canonical adjacency. Sequential happy-path placement tests do not cover malformed neighbor commands or actual parallel moves. The database's non-unique position index does not prevent equal ranks.

### F-04 — High, blocking: placement returns a result for nonexistent or inaccessible moving cards

The mounted route is `boardsRoutes` (mounted before `cardsRoutes` in `app.ts`). Its adapter validates the board and destination column, then filters destination cards by the caller-provided `movingCardId`; it never resolves that card or checks that it is active, on the same board/project, and writable. Thus a caller can receive a successful placement result for a nonexistent, trashed, or foreign card. CRD-08/09 depend on the server's placement result being for a real move command.

### F-05 — Medium, mandatory: overdue filtering includes done-column cards

Both board card listing and project search implement `due=overdue` as only `due_date < CURRENT_DATE`. Neither joins the card's column category to exclude `done`. The feature specification explicitly defines overdue as excluding done cards; this makes both summary/search filters incorrect for completed work.

### F-06 — High, blocking lifecycle mismatch: comment-post replay bypasses the trashed-card guard

The comments POST route resolves only `project_id`, performs replay authorization and returns a receipt before calling `postComment`. The adapter's normal command path rejects a trashed card (`CARD_IS_TRASHED`). If a successful comment's card is later trashed, an authorized project writer retrying the same key receives a 201 minimal replay outcome instead of the current lifecycle response. Receipt minimization prevents the old comment body from being returned, and grant locking protects access revocation; neither makes the stale success consistent with the current endpoint lifecycle semantics.

## Positive evidence and counterevidence

- The supplied repair moved current project grant locking before receipt lookup and reduces stored receipt responses to approved identifiers/version/outcome fields. The CRD-11 PostgreSQL tests pass removed/demoted access behavior exercised by that suite, body-minimal receipt inspection and same-key concurrent create (one logical creation and replay).
- `checkOrReplayReceipt` uses a transaction-scoped advisory lock for actor/scope/key before lookup. The current focused test observed all 14 tests pass, including parallel same-key create. This is meaningful positive concurrency evidence for that path.
- The current project role lock uses `FOR SHARE`, and normal card writes call it. This is positive evidence for membership revocation serialization; it does not fix the author-versus-manager authority distinction on comment-delete replay.
- Valid create, summary, detail, date, assignment, movement, placement, OCC error, and retry examples pass the focused suite. The CRD-10 test's stale-version cases are sequential stale requests, not two simultaneously racing writes.

## Feature-level disposition

| Feature | Result | Reason |
|---|---|---|
| CRD-01 | Fail | Archived board/project can accept create; create path otherwise has passing role/title/rank coverage. |
| CRD-02 | Partial | Compact summary cases pass; overdue filter includes done-column cards. |
| CRD-03 | Partial | Detail access cases pass; product deep-link/dialog/loading/focus behavior is not established by API tests. |
| CRD-04 | Fail | Archive read-only guard absent; ordinary stale version behavior passes. |
| CRD-05 | Fail | Date validation passes; overdue definition is wrong for done cards. |
| CRD-06 | Pass for tested API cases | Eligible assignments, exclusions and bounds pass the PostgreSQL suite; UI picker is unverified. |
| CRD-07 | Fail | Invalid neighbor commands can produce rank collisions/noncanonical placement. |
| CRD-08 | Fail / UI unverified | Mounted placement does not validate `movingCardId`; keyboard/tap UI behavior is not covered. |
| CRD-09 | Partial | Adapter queries canonical full destination order, but invalid moving IDs and browser filtered-drag behavior remain uncovered. |
| CRD-10 | Partial | OCC conflict responses pass; test cases are stale sequential requests and do not prove real simultaneous edit/move ordering. |
| CRD-11 | Fail | Card same-key concurrency and minimal receipts pass; moderator-delete authorization and trashed-card comment replay lifecycle are open. Save/Post/Upload draft UX is not verified here. |

## Scores

| Category | Score | Weight | Minimum | Reason |
|---|---:|---:|---:|---|
| Security and authority boundaries | 7.5 | 30 | 9.0 | Current membership is checked before receipt replay and sensitive bodies are removed, but non-author comment-delete replay accepts member instead of manager. |
| Functional and API correctness | 7.2 | 25 | 8.5 | Archive guards, rank validation, placement identity and overdue semantics contradict required behavior. |
| Data integrity and concurrency | 6.8 | 15 | 8.5 | Same-key create serialization passes; rank collisions remain possible and CRD concurrent OCC cases are sequential. |
| Test quality and independent evidence | 7.5 | 15 | 8.5 | 14/14 PostgreSQL tests and root typecheck pass, but several mandatory negative cases are absent; full `npm run check` is builder-only evidence. |
| Maintainability and portability | 8.0 | 10 | 7.5 | Shared receipt and auth helpers are clear, but overlapping placement implementations create route-dispatch ambiguity; no Worker execution was done. |
| Operations, performance and failure recovery | 7.0 | 5 | 7.0 | Meets the numeric floor; no performance or hosted runtime claim was tested, and lifecycle retry recovery has a gap. |
| **Unrounded weighted total** | **7.345** | **100** | **strictly >8.5** | **Fail**; security, correctness, integrity and test minima fail, with open hard blockers. |

## Commands and limits

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` from `apps/api` (requested exact cwd) | Exit 1: `@flowboard/api` has no `typecheck` script | [typecheck-api.log](typecheck-api.log) |
| `npm run typecheck` from repository root | Independently rerun, exit 0; afterward all 161 frozen source hashes still matched | [typecheck-root.log](typecheck-root.log) |
| `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55441/flowboard_harness node --test --test-concurrency=1 test/crd01-crd11.test.ts` from `apps/api` | Exit 0: 14 passed, 0 failed | [crd01-crd11-postgres.log](crd01-crd11-postgres.log) |
| Builder `npm run check` | Supplied log reports successful full check; not independently run by this reviewer | [../npm-check.log](../npm-check.log) |

The `apps/api` workspace-level typecheck invocation failed because no such workspace script is defined; the root-level typecheck passed independently. After rerunning it, the 161-file manifest was rechecked and retained the supplied digest with zero mismatches. The initial sandboxed PostgreSQL attempt was blocked with `EPERM`; the exact command then ran successfully after the tool's approval review against the named local synthetic harness. No source files were edited. No UI/browser behavior, Worker runtime, hosted service, benchmark, dependency advisory status or production behavior was tested. The report does not approve backend handoffs or checklist closure.

## Next

Resolve F-01 through F-06, add mounted PostgreSQL regressions for each, establish true concurrent field/move behavior, then freeze a new source manifest and obtain another fresh independent review. A card is an ordered row in a column; `previousCardId` and `nextCardId` are the server's instructions for where it belongs. The server still has to check those instructions because an old or malformed client can send a pair that creates a duplicate rank.
