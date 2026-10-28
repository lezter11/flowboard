# Independent acceptance review: BRD-01 through BRD-07

Date: 2026-10-26 (Asia/Kolkata)  
Verdict: **fail**  
Review target digest: `6030645ad47e30135acca9e50e6043b192dff5a221e6684dc332e4ef94ee25d1` (161 files)

## Scope and independence

Fresh read-only subagent review (`/root/reaudit_boards`), assigned after repair round 1; this reviewer did not implement the target. The desktop runtime did not expose a durable actor UUID or session UUID, so those identifiers are explicitly unavailable rather than invented. The complete supplied manifest is preserved at [source-manifest.json](source-manifest.json). The supplied manifest matched all 161 current files before inspection. The same target was rechecked after review and matched; no listed file changed.

Reviewed board route wiring, adapters, shared project-grant lock and receipt code, migrations/constraints, tests, API contract, feature specification, frozen round-1 criteria, and backend review policy. The previous board review and its failed evidence were treated as context only; this review's conclusions are based on current source and the checks recorded below.

## Outcome

BRD-01 through BRD-06 have useful mounted PostgreSQL coverage for normal role checks, board/column creation and editing, version conflicts, column order, deletion guards, and board snapshots. The shared receipt helper now takes the current project grant lock before reading a replay and stores only a reduced outcome. The focused suite and typecheck pass.

BRD-07 does not meet its stale-cursor contract. A cursor contains only `position` and `id`; the list handler does not bind it to board revision or filter context. After an order/filter change, a previously issued cursor remains accepted and can skip or duplicate cards. The test only rejects a malformed cursor; it does not test a cursor made stale by a real board change. This is a mandatory acceptance blocker.

The board suite also does not contain the repair criteria's required mounted-route regressions for replay after grant removal/demotion, same-key concurrency, or receipt-body inspection. Shared helper tests for card writes are useful counterevidence, but they do not establish each board route's required replay evidence. Column removal has an unresolved expired-trash edge: the adapter ignores trashed cards at/after `restore_until`, then attempts to delete their referenced column; the PostgreSQL foreign key is `ON DELETE RESTRICT`, so the route can surface a generic database failure instead of a deliberate domain response. This latter issue is nonblocking for the frozen BRD-06 wording, which prohibits deleting columns referenced by active or *restorable* cards, but it remains a lifecycle defect to clarify and cover.

## Scores

Weights are the fixed backend gate weights; total is unrounded.

| Category | Weight | Score | Reason |
|---|---:|---:|---|
| Security and authority boundaries | 30 | 8.5 | The mounted board write routes use the shared project grant lock before replay and mutation; the membership lock serializes role changes. The round-1 replay fix is visible in source. Board-specific revoked/demoted replay regression evidence is missing, so the 9.0 minimum is not met. |
| Functional and API correctness | 25 | 6.5 | Core happy paths work, but BRD-07 accepts cursors without revision/filter binding and therefore cannot deliver the promised stale refresh semantics. Expired-trash column deletion also lacks deliberate handling. |
| Data integrity and concurrency | 15 | 6.5 | Transactions, optimistic board versions, grant locks and idempotency advisory locks are present. The cursor is not a stable snapshot, ordering changes can invalidate traversal silently, and board reorder concurrency is not exercised. |
| Test quality and independent evidence | 15 | 7.5 | Independent typecheck and all 16 focused PostgreSQL tests pass. The focused tests omit stale-after-reorder/filter, revoked board replay, same-key board concurrency and receipt content assertions required by round-1 criteria. |
| Maintainability and portability | 10 | 8 | Typed contracts, parameterized PostgreSQL and clear route/adapter boundaries are present. Cursor encoding is under-specified and duplicated application of receipt policy needs broader regression coverage. |
| Operations, performance and failure recovery | 5 | 6.5 | Limits exist, but page traversal has no change detection; placement/snapshot queries are not benchmarked, and expired referenced trash can fall through to FK failure. |

Weighted total: `(8.5×30 + 6.5×25 + 6.5×15 + 7.5×15 + 8×10 + 6.5×5) / 100 = 7.4/10`.

The total is below the strict `>8.5` gate, and category minimums fail for security, correctness, integrity, tests and operations.

## Findings

### F-01 — BRD-07 stale cursor is accepted after board/filter changes (high, blocking)

`apps/api/src/adapters/boards.ts:41-60` encodes/decodes only `{position,id}`. `listBoardCards` at `:1239-1265` rejects malformed cursors but has no board snapshot/version or filter hash to compare. The continuation predicate at `:1260-1265` simply applies the old tuple to the current result set. API.md requires stable cursors bound to project/filter/order/snapshot and a stale-cursor refresh response. The focused test at `apps/api/test/brd01-brd07.test.ts:823-830` covers only malformed input, not an order/filter change. A real change between pages therefore cannot yield `STALE_CURSOR`; the handler silently applies an obsolete tuple.

Impact: a user loading a long board can miss cards or see duplicates after another teammate reorders/moves cards or when the continuation request changes filters. Fix by binding cursor to board/order snapshot and normalized filter context (and validating cursor shape/range); add mounted PostgreSQL tests that fetch page one, change order/filter, and require a stable 409 refresh response.

### F-02 — Required board replay regression coverage is absent (high, blocking for this repair criteria)

`apps/api/src/http/routes/boards.ts` calls `checkOrReplayProjectWriteReceipt` on the mounted board/column write endpoints; the helper in `apps/api/src/adapters/idempotency.ts:44-80` calls `acquireWriteGrantLock` before receipt lookup, and receipt bodies are minimized at `:14-39`. This is positive source evidence and addresses the previous authorization-before-replay finding. However, `apps/api/test/brd01-brd07.test.ts` only tests ordinary board creation replay/collision (`:217-231`) and contains no board replay after grant removal/demotion, same-key parallel board mutation, or inspection that receipt JSON omits response bodies. The frozen repair criteria explicitly require these mounted PostgreSQL regressions. The broader card replay tests are counterevidence for the helper but do not satisfy board-route coverage. Add tests through the board routes and inspect persisted receipts before treating the repair criterion as evidenced.

### F-03 — Expired trashed cards can turn column deletion into a raw FK failure (medium, nonblocking)

`apps/api/src/adapters/boards.ts:693-703` blocks only trashed cards whose `restore_until > NOW()`, then deletes the column. `database/migrations/0001_initial.sql:101` and `0003_constraints.sql:51` make card-to-column references `ON DELETE RESTRICT`. An expired but not-yet-purged trash row still references the column, so the DELETE fails at the database constraint after the adapter has decided the column is removable. The route has no deliberate expired-trash response, and the existing test only seeds a restorable row (`apps/api/test/brd01-brd07.test.ts:640-660`). Clarify whether expired trash blocks removal until purge, then return a stable domain conflict and add an expired-row regression. This does not contradict the narrower BRD-06 active/restorable-card wording, so it is not the verdict basis.

## Required checks and evidence

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | [typecheck.log](typecheck.log) |
| `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55440/flowboard_harness node --test --test-concurrency=1 test/brd01-brd07.test.ts` from `apps/api` | exit 0; 16 passed, 0 failed, isolated local PostgreSQL | [brd01-brd07.test.log](brd01-brd07.test.log) |
| Builder `npm run check` | supplied log reports completion including API/contracts tests and dry-run Worker build; not independently rerun as a full check | `../npm-check.log` |

The initial sandboxed focused-test attempt failed with `EPERM` when connecting to localhost; it was rerun successfully after approval on the explicitly designated local isolated harness database. The database was synthetic and local. No Worker-specific BRD route run, large-board benchmark, or concurrent reorder/revocation race test was performed. No dependency advisory lookup was performed; dependency advisory status remains unverified.

## Gate decision

**Fail.** F-01 contradicts BRD-07 and the API contract. F-02 leaves mandatory round-1 replay acceptance evidence incomplete. Scores miss multiple category minimums and the total is 7.4, below the strict threshold. Preserve the failed round; do not mark any BRD feature verified or UI-ready from this review.
