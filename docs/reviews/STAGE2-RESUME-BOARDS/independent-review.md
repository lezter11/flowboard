# Independent review: BRD-01 to BRD-07

## Outcome

**FAIL — backend review gate not met.** The suite and typecheck pass on the immutable source snapshot, but two reproduced defects violate mandatory access and pagination requirements. Existing round records and scores were treated as history and did not determine this result. The outcome does not approve any of BRD-01..BRD-07 for handoff.

| Feature | Local evidence | Acceptance outcome |
|---|---|---|
| BRD-01 Create board | Owner/manager, defaults, ancestry, and receipt happy paths pass. | **Fail**: cached receipt replay returns board data after the manager grant is revoked. |
| BRD-02 Board list/settings | Project list and rename/OCC happy paths pass. | **Fail**: PATCH board has the same pre-authorization replay path; role-limited rename can replay after grant removal. |
| BRD-03 Snapshot | Bounded response shape, counts, and people fixture test pass. | **Locally supported, not closed**: no concurrency snapshot or large-data bound evidence. |
| BRD-04 Add/rename columns | Max, duplicate, OCC, and role tests pass. | **Fail**: column mutation routes repeat receipt-before-grant ordering; no revocation replay test. |
| BRD-05 Reorder columns | Exact-set and stale-version tests pass. | **Fail**: reorder receipt replay follows the same authorization bypass; no parallel reorder/rollback test. Pointer/tap/keyboard behavior is UI-owned. |
| BRD-06 Remove empty column | Final, active-card, and restorable-trash guards pass. | **Fail**: delete receipt replay follows the same authorization bypass; expired-trash reference behavior and concurrent restore/delete remain untested. |
| BRD-07 Card pagination/counts | Basic filter and sequential cursor tests pass. | **Fail**: cursor omits a snapshot/version binding; after order changes it silently omits a card instead of returning stale-cursor refresh. |

“Locally supported” means the scoped integration tests passed for a happy-path slice. It is not a passing independent backend review or downstream UI/integration proof.

## Blocking findings

### F-01 — Revoked manager can replay a mutation receipt

**Severity:** High; mandatory authorization blocker. **Affected:** BRD-01 and same-pattern mutation receipt handlers in BRD-02/04/05/06.

`apps/api/src/http/routes/boards.ts:64-83` checks/replays the idempotency receipt before calling `createBoard`. The adapter's project grant check occurs later in `createBoard`. I revoked the synthetic project-manager membership and repeated the same authenticated POST with the original idempotency key and body. The route returned HTTP 201 and the cached board object with `replayed: true` (`brd01-revoked-replay-repro.log`). Current membership should be checked before any receipt response is disclosed. The path does not create a second board, but it returns private project/board metadata to a removed identity and contradicts current-request project authorization. Similar ordering appears in the PATCH board and column mutation handlers; review/fix all receipt replay paths consistently.

**Counterevidence:** Normal owner/manager create and same-grant replay tests pass. No test covers grant removal between first request and retry. These do not address the bypass.

**Required repair:** Reauthorize under the required grant lock before replaying receipt contents, while preserving the transaction and idempotency race guarantees; apply to board update and every column mutation route, and add revocation-before-replay regression coverage to each mutation scope.

### F-02 — Card cursor does not detect stale ordering

**Severity:** High; mandatory BRD-07 correctness/data-integrity blocker.

`apps/api/src/adapters/boards.ts:36-60` encodes only `{position,id}`. `listBoardCards` at `:1239-1264` accepts that tuple and filters only by current position/id. It does not bind the cursor to board, filters, or a board/card-order revision. In the synthetic PostgreSQL repro, page 1 returned `c_snap_1` at position 10; after moving `c_snap_2` ahead to position 5 and incrementing board structure/snapshot versions, resuming the old cursor returned HTTP-layer adapter data `[]` with `nextCursor:null`. It should reject the stale cursor so the client refreshes. Repro is preserved in `brd07-stale-cursor-repro.log`.

**Counterevidence:** The supplied suite proves a cursor can resume correctly without intervening changes and malformed base64/JSON is rejected. That is not stale-cursor handling.

**Required repair:** Bind a signed/validated cursor to the relevant board/filter context and a revision snapshot; reject mismatches/stale revisions with the documented stable response. Add order-change, filter-change, and tie-position pagination regression tests.

## Additional review notes

- `getPlacement` selects every active card in a destination column and materializes it to calculate neighbors (`apps/api/src/adapters/boards.ts` around the placement helper). The API describes a bounded placement read. This is an operations/performance gap; no large-column measurement was made.
- `getBoardSnapshot` bounds response card count but its ranking and aggregate subqueries can still process whole card/comment/image/assignee tables. No representative large dataset benchmark was run; do not claim a measured performance target.
- Board reorder and column mutation routines use SQL transactions and row locks, but lock interaction was source-reviewed only; no revoke-vs-write or parallel reorder stress was executed.
- PostgreSQL migration constraints use `ON DELETE RESTRICT` for card-to-column ancestry. `deleteColumn` checks active and restorable cards, not expired trashed cards; the expired-trash case remains unverified and should be resolved explicitly before claiming the full BRD-06 lifecycle.
- External dependency vulnerability/advisory status is unverified; no network lookup was performed.

## Test and command evidence

- `npm run typecheck` — exit 0; `typecheck.log`.
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/brd01-brd07.test.ts` — exit 0, 16 passed/0 failed on the isolated PostgreSQL instance; `brd01-brd07.test-escalated.log`.
- The initial sandboxed run of that same suite got `EPERM` opening localhost and exited 1; it was preserved at `brd01-brd07.test.log`. After the parent confirmed the dedicated disposable database, the same suite was rerun with local permission escalation and passed. Only the escalated successful run is counted as test evidence.
- `brd01-revoked-replay-repro.log` — synthetic authorized-session repro; observed 201 after membership removal.
- `brd07-stale-cursor-repro.log` — synthetic ordering-change repro; observed empty continuation rather than stale response.

## Gate result

The two findings are unresolved blockers, so no score can authorize closure. Scores in the generated record are evidence ratings, not a closure claim; the record verdict is `fail`. A fresh independent review of a new immutable target is required after repair. Backend UI handoffs and checklists must remain open.
