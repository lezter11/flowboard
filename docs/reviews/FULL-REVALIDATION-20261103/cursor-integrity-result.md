# Cursor integrity repair — 2026-11-03

## Actions

Implemented [frozen criteria v4](criteria/cursor-integrity-repair.json), preserving earlier versions and failing logs. [The JSON result](cursor-integrity-result.json) contains 13 source/criteria hashes, exact commands, log hashes and verification limits.

Comments and trash now carry PostgreSQL microseconds in cursor boundaries. All affected date cursors validate real calendar dates, clock values and valid text before SQL. Comments/trash bind actor and resource; project cursors bind actor and exact workspace or token project scope. Ambiguous old cursors request refresh instead of silently restarting. Existing authorization remains mandatory on every page.

Trash query errors no longer discard the supplied cursor. Shared `notificationQuerySchema` makes limits, cursor bounds and literal true/false behavior match the mounted route. Root updated generated OpenAPI under separate ownership. Old audit/notification fixtures now select actual full display names; authority, privacy and notification assertions remain.

## Why and options

PostgreSQL stores fractions smaller than a millisecond. Converting `00.123900` to JavaScript's `00.123` before making a cursor changed where the next page began: chronological comments repeated rows, while descending trash skipped them. Keeping SQL's canonical timestamp text preserves the boundary; displayed timestamps can keep their existing format.

`Date.parse` also normalizes impossible dates such as February 30. That let forged cursors reach PostgreSQL and fail with an internal 500. Calendar validation now rejects them before querying. A final probe confirmed that cursor NUL text also produced PostgreSQL 500; cursor text now rejects NUL and lone surrogates without expanding this task to every public route ID.

## Evidence and limits

- Final mounted cursor suite: **38/38**, zero skips, exit 0. Four rows in one millisecond include distinct microseconds and an exact timestamp tie; limit-one walks verify every ID once across six feeds in both ordering directions.
- Latest nearest six legacy suites: **115/115**, zero skips, exit 0 on v3, before final NUL/lone-surrogate narrowing. Final v4 mounted, typecheck and contract checks pass; the complete final API gate still belongs to root after all owners release source.
- Root typecheck exited 0. Contracts **126/126**, zero skips, exit 0. Owned-path diff check exited 0.
- Initial cursor baseline: six passed / fourteen failed, including parent counts. Retained notification malformed-query baseline: zero / eight. Retained NUL-text baseline: zero / eight.
- One first-green failure was a test assuming unsupported session `?projectId`; corrected to actual token project scope without inventing API behavior. Legacy failures were obsolete shortened mention fixtures, corrected only after retention. An external image-worker typing failure was fixed by its owner before final typecheck.

No score, approval, feature closure, full final API gate or hosted acceptance is implied. Public timestamps and response envelopes remain compatible; old ambiguous opaque cursors deliberately request refresh. Primary/access database reservations are released.

## Next / your input

Root coordinates the complete frozen gate, independent review and direct UAT after local gates. No user action needed. Next assigned work is an inventory-driven authentication matrix, with criteria before probes and no runtime fixes without root coordination.
