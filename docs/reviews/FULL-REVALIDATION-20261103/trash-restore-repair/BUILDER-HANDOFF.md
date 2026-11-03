# Trash restore builder handoff — local evidence only

**Status:** owned source and tests held for fresh independent review. This builder assigns no score, closes no gate and has not pushed or deployed. The broader product's full frozen gate and hosted UAT remain the coordinating agent's work.

## Actions

- `apps/api/src/adapters/trash.ts`: preserve the logical insertion index before rank compaction, compact with one set-based PostgreSQL update, then calculate a rank in the same gap. Existing authorization, cutoff, receipt, version and lifecycle boundaries are unchanged. Canonical order stays the database's `position,id` order, including ties.
- `apps/web/src/app/trash/page.tsx` and new `apps/web/src/lib/trash-restore.ts`: allow a `destination_missing` row to start the existing picker while retaining the server-clock cutoff and archived-project/pending guards. Other server blockers remain disabled. The initial request still authorizes on the server, then the existing explicit-column request performs restore.
- New `apps/api/test/trash-restore-placement.test.ts` and `apps/web/test/trash-restore.test.ts`: targeted mounted/PostgreSQL and initiation regressions. All database runs explicitly select the disposable local PostgreSQL instance on55931; fixtures create/drop their own random schemas. The nearest-suite runner additionally gives legacy global-pool tests a new random primary-database schema rather than their public/shared tables.

## Why and options

A Flowboard card's rank is a number used to sort it. Repeated moves can consume the integer space between two neighbors. Compaction spreads the neighbors out again; remembering only the old number loses the card's intended location. Remembering the gap's index lets the card return between the same surviving cards. Appending after compaction was simpler but violated nearest-position recovery. The update follows the ordinary move path's SQL ranking pattern and avoids one database round trip per existing card.

A missing original column is recoverable through an explicit active column choice. Enabling this one initiation case makes the existing picker reachable. The API remains responsible for current authority, active destination, optimistic versions and strict expiry; enabling the button never authorizes a restore.

## Evidence and limits

- `green-api-05.log`: **19/19**, zero skips. Normal mounted create/delete/move produces the actual1000/1001 gap; restore preserves index1. Includes both anchors, either anchor alone, neither anchor, head/tail/empty destinations, dense first-rank recovery, same content/ID, existing-card version preservation, parallel identical-key replay, wrong versions, forbidden actors, legacy explicit destination, retired/foreign/unknown destinations, archives, revoked board access, exactly deadline-1ms versus deadline, real separate-connection restore/purge overlap, and deferred-commit rollback of compaction/state/board/receipt/activity.
- `green-probe-01.log`: unchanged independent `restore-nearest-rank-v2.mjs` reports expected/actual index1 and restored position1500. No manual rank mutation.
- `append-mutation-01.log`: a temporary source copy reintroduces only the original append fallback. Both corrected numeric-order regressions fail; harness succeeds only because mutated tests exit1. Held production source is unchanged. This confirms the assertions catch the actual defect after the test-query correction described below.
- `nearest-suite-02.log`: **55/55**, zero skips, covering existing comments/trash, lifecycle/undo, retention and board-access/import/trash suites.
- `green-ui-01.log`: **7/7** targeted initiation/destination tests. `web-suite-01.log`: **325/325**, zero skips. `typecheck-web-01.log` and `typecheck-02.log`: pass. `build-node-worker-02.log`: Node TypeScript and Worker bundle dry-run pass. `build-web-01.log`: production Next build passes. `build-web-export-01.log`: fresh static export passes. Build warnings concern multiple Wrangler environments and static export ignoring rewrites; the local browser harness supplies the same-origin API proxy explicitly.
- `browser-destination-02.log` and `browser-destination-03.log`: actual isolated Chrome flows for **Owner and Manager**, using the fresh `.next-trash-restore` export and mounted synthetic API. A row with `canRestore:false/destination_missing` has an enabled Restore action; actual click returns409 and opens the picker; retired column is excluded; selecting the second active column and clicking Restore card returns200; canonical read verifies the same ID/title/description/priority in the selected column. An expired control remains disabled. No page errors. Relevant source hashes match before/after. `*-settled.png` captures follow existing entrance animations; earlier screenshots are retained.
- The legacy fixture disables only `columns_retirement_guard` inside its own random schema for setup, re-enables it before API/browser observation and verifies it remains enabled. Current API/DB guards prevent creating ordinary new restorable orphans. This is explicitly legacy recovery evidence.

### Preserved race and UI limits

The purge-first overlap exposes a real board/card/activity foreign-key deadlock: restore waits on the purger's card lock while the purge activity insert waits on restore's context locks. PostgreSQL aborts the losing restore; the documented middleware returns503 `SERVICE_UNAVAILABLE`, `Retry-After:1`, and `The request conflicted with another update. Retry shortly.` The actual cycle is retained in `race-diagnostic-02.log` and `green-api-05.log`.

Per the coordinating agent's explicit direction, no purge-ordering patch was added. The final test proves purge commits exactly once; no losing restore receipt/event survives; card/description/comment text is scrubbed; notification body/link is redacted; finalized cleanup-only sentinel row/object is removed; repeated purge makes no new effect. Retrying the **original restore body and same key** returns404 `NOT_FOUND`, still with no receipt or restored content. Restore-first overlap retains card/comment/notification/object content and produces one restore event. The future purge `asOfDate` is deliberate test eligibility while the restore's actual clock remains before its deadline; it does not alter the product clock.

The existing Trash UI invalidates/refetches trash and shows the busy toast after503. It does **not** retain a restore command/key or provide the toast's retry callback; a later manual restore invocation generates a new key. This UX limitation is reported for independent adjudication, not claimed verified or repaired. API recovery proof above uses the exact original command/key.

### Failed attempts retained

- `red-api-01.log`:10 connection errors from sandbox EPERM; rerun with authorized loopback access.
- `red-api-02.log`:8pass/2fail; one genuine dense regression plus an initial head-move test missing the required nullable previous anchor.
- `red-api-03.log`:8pass/2fail before production edits. The initial test's `ORDER BY position` referred to its `position::text` alias. The helper was corrected to numeric `cards.position`; the independent unchanged probe and isolated append mutation establish the actual nearest-position failure rather than relying on that early test sort.
- `green-api-01.log`:8pass/2fail from that text-order test helper; `green-api-02.log`:10/10 after numeric-order correction.
- `green-api-03.log`:16pass/2fail because test setup attempted to read an unbound storage driver. The test now binds a synthetic in-process driver for purge only.
- `green-api-04.log`:17pass/2fail: the observed503 contention outcome plus a rollback fixture initially created its right anchor after delete, producing1500 rather than1001. The anchor setup was corrected; no production source change was needed.
- `race-diagnostic-01.log`:2pass/1fail; `race-diagnostic-02.log`:1pass/1fail retained the strict404 expectation, actual503 and exact live lock cycle. `green-api-05.log` adds complete rollback/same-key recovery/content proof before accepting the documented retryable path.
- `red-ui-01.log`:1pass/1fail on the old initiation predicate, then targeted7/7 green.
- `nearest-suite-01.log`:54pass/0fail/1skip due to absent access-test database environment. The explicit access database rerun is55/55.
- `typecheck-01.log`: unrelated concurrent `card-assignee-concurrency.test.ts:30` Promise/Response type mismatch; the owning stream corrected it and root typecheck rerun passes.
- `build-node-worker-01.log`: exit0 with an EPERM warning for Wrangler's default log location. The rerun sets a temporary log path and passes without that warning.
- `browser-destination-01.log`: failed because the first harness run served the preserved historical `apps/web/out` artifact. Next's custom export directory is `.next-trash-restore`; correcting only the harness directory gives actual successful fresh-artifact runs02/03.

No prior failed logs, frozen criteria or independent review records were overwritten. See `held-manifest.json` for exact owned source hashes and `evidence-index.json` for retained artifacts and counts.

## Next / your input

The coordinating agent should review the held target and concurrency/UX limits, obtain a fresh independent passing review, run the broader frozen checks, and then perform its authorized staged rollout/UAT work. No user action is needed for this builder handoff.
