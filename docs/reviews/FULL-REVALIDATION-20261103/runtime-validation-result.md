# Runtime validation and bounded safety repair — 2026-11-03

## Actions

Frozen criteria: [runtime validation](criteria/runtime-validation.json) and [safety repairs](criteria/runtime-safety-repair.json). Full source/log hashes, commands, failed attempts and actual environment are in [the JSON record](runtime-validation-result.json).

Actual Node HTTP and workerd tests cover1,000 cards across five columns, two assignees per card, 8,000-character descriptions, and complete 1,000-row My Tasks cursor walks with tied and NULL dates, snapshot/search filters, project isolation, caps, health, correlation/timing, HEAD/OPTIONS, unavailableDB and Worker bootstrap behavior. Actual parameterized SQL was captured in test-only instrumentation; sanitized SELECT/EXPLAIN plans contain no bound values/sessionIDs or result rows.

After failing reproduction, bounded source fixes in rbac/comments remove the first-100-recipient validation window while retaining canonical names-only suffix numbering; system errors and unexpected library 5xx errors stop exposing private text; real PostgreSQL 57014 timeouts return retryable 503 with Retry-After: 1. Both actual runtimes retain zero failed-command effects and allow a subsequent fresh valid write. No Node transport or My Tasks source edits by this slice.

## Why and options

A picker page is a display limit, not an eligibility rule. A valid recipient numbered 150 can be searched and selected, so a save must check those submitted IDs rather than the first 100 names. The profile check is bounded to 20 selected IDs. Canonical duplicate-name suffixes still need the active project names; this is not a claim of total O(20) work. Existing board serialization is retained rather than adding target locks after the board and reversing revocation lock order. Both separate-connection race orders pass; the delayed notification consumer does not renotify a removed recipient.

A PostgreSQL statement timeout is a temporary inability to finish, so503/Retry-After fits better than an internal500. It does not justify automatic replay of side effects. A command receipt remains the duplicate protection; the tests separately verify rollback and a fresh successful control write.

## Evidence and limits

Installed: Node 24.15.0, Wrangler 4.156.2, Hono 4.13.14 and pg 8.23.1; Apple M5, 10 logical CPUs, 16 GiB RAM, PostgreSQL 17.11 in Docker. All data and sessions synthetic on localhost:55931; fresh identity-extra schemas. No cloud/provider calls. Primary/access nearest reservation released.

| Local case | Node | workerd |
|---|---:|---:|
| Startup (ms) | 5.03 | 340.58 |
| First snapshot after startup (ms) | 55.26 | 79.71 |
|Five warm snapshots: min / median / max (ms)|18.45 / 19.85 / 23.83|26.53 / 29.30 / 31.63|
| Snapshot response bytes (50 of 1,000 cards)|37572|37572|
|My Tasks pages / rows|10/1000|10/1000|
|My Tasks SQL calls: 1 → 5 returned boards|13→13|13→13|

These are small local measurements, not production p95/p99, hosted cold starts or service-level guarantees. Earlier My Tasks samples before batching (13 → 17 queries) are retained.

Latest actual-runtime suite **14/14**, zero skipped, exit 0: `raw/runtime-validation-transport-repeat.log/.json`. Latest combined attempt reached and passed all 12 safety/discussion cases but retained three runtime/parent failures from a transport reset and corrected stale revision fixture. A separate earlier 11-case safety/discussion run passed. Typecheck and the owned-path diff check exited 0.

Nearest legacy suite **122 passed / 1 failed**, zero skipped. The remaining failure is the shared error catalogue missing newly reachable `CELL_LIMIT_EXCEEDED`, `INVALID_LIMIT` and `PARSE_BUDGET_EXCEEDED`. Root added them; the isolated catalogue recheck then passed 2/2 (112 codes, zero unresolved identifiers). The original failed run is retained.

One actualNode large-body fetch reset under concurrent local checks is retained; final solo pass does not erase it. Node-server's unread-body drain has a 500 ms timeout, but causation is not yet deterministically established. No transport fix or blanket guarantee of a structured 413 response is claimed.

An HTTP timeout does not cancel database work: The test-only Node 30 ms deadline returned 504 in about 40 ms, then the SQL write completed. The test-only workerd 50 ms deadline completed its SQL write and returned in about 162 ms because pool.end waited for outstanding SQL. Worker bootstrap missingbinding remains500 CONFIG_ERROR without a request ID before middleware. These limits are explicit, not relabeled as passing cancellation or hosted behavior.

## Next / your input

Root coordinates missingcatalogue entries, complete local gates, artifact freeze, independent review and direct UAT after local gates. No user action needed. Next assigned bounded slice freezes separate cursor criteria and reproduces malformed-date/microsecond pagination gaps before source changes.
