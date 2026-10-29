# PostgreSQL window limiter for sensitive routes — 2026-10-29

Status: built on `chore/baseline-2026-10-28` (migration 0011). Architect-approved (Option 2 of `docs/decisions/2026-10-29-rate-limiter-uat-finding.md`). Not deployed; Deployment applies migration 0011 to UAT.

## Why

Cloudflare's Workers rate-limiting binding was observed not to enforce on UAT. Sequential requests were served from several Cloudflare locations (WAW, ARN and others), and each location's count stayed under the limit (12 and 11 requests, all 302, limit 10). The binding is documented as approximate and per location. Zone WAF rules need a custom domain and a paid plan. A limit on sign-in and invitations needs an exact count, so the count moves to PostgreSQL, which every Worker already reaches.

## Design

- Table `rate_limit_windows (bucket, client_key, window_start, request_count)`, primary key `(bucket, client_key, window_start)`, `window_start` in epoch seconds, aligned to one-minute windows by the database clock.
- One atomic statement per limited request: an upsert that adds 1 to the count and returns it. PostgreSQL locks the row during the upsert, so concurrent requests are counted exactly once each.
- Refusal when the count is above the bucket limit. `Retry-After` is the seconds to the window end, from the same database clock.
- Buckets: `auth` 10, `invite` 10, `import` 5, `upload` 10 per minute. The client key is `cf-connecting-ip` only, never a forwarding header.
- Failure policy: **fail closed** (503 `SERVICE_UNAVAILABLE`, `Retry-After: 1`) on these routes. Sign-in and invitations need the database anyway; failing open would let a database fault disable the limit.
- Cleanup: the scheduled job deletes windows that have ended, in batches of 5,000, and is safe to repeat.
- The general write limit stays a soft Cloudflare binding. No database write on every write route.

## Choices

- **UNLOGGED table.** Writes skip the write-ahead log, which removes most of the cost of a counter write on every sensitive request. The cost: a crash or restart empties the table, so counters reset. Windows last one minute, so the effect is short. Chosen because the counters are disposable.
- **Database clock.** Using `now()` in SQL means every Worker agrees on window boundaries even when their clocks differ.
- **Limiter runs before authentication.** Unauthenticated bursts are counted, which is the point for sign-in.
- **Worker only for the fallback key.** On Node and in tests a request with no client address is not counted, so the existing suites are unaffected. On the Worker the shared fallback key applies and is logged.

## Cost (estimates from the statement, not measured on Neon)

- Queries per limited request: one statement (round trip) plus, for refusals, the same statement again. No extra reads.
- Rows: one row per active (bucket, client key, minute). A burst of 1,000 distinct addresses hitting invitations in one minute writes about 1,000 rows. Rows older than the current window are removed by the purge, which runs every five minutes, so the table holds about five minutes of windows.
- Index use: the upsert uses the primary key as its conflict index (checked with `EXPLAIN`). The purge scans by `window_start` through its own index once the table is large; on a tiny table the planner chooses a sequential scan, which is fine.
- Writes: UNLOGGED, so no WAL for these rows. Refused requests are also written, so a flood of refusals is a write per request. This is the main cost risk and is why the limiter covers only four route families.

## Alternatives

1. **Cloudflare binding only (rejected for these routes).** Free and simple, but approximate per location; observed not to enforce on UAT.
2. **PostgreSQL window counter (chosen).** Exact, fail-closed, no new vendor. Costs one write per limited request, and a database dependency on those routes.
3. **Durable Objects (not built).** One object per key gives an exact global count without a database write per request. Needs a new class, a migration in `wrangler.jsonc`, a plan check (the free-plan position was not confirmed), and an extra hop per request. The right choice if writes need exact limits later.
4. **Zone WAF rules (not built).** Needs a custom domain and a paid plan; accuracy and free-plan availability were not confirmed here.

## Verification

- Real PostgreSQL tests (`apps/api/test/rate-limit-postgres.test.ts`, 9 tests, 0 skipped): exactness with 30 parallel counts and 30 parallel HTTP requests, window rollover, key and bucket isolation, `Retry-After` range, purge of ended windows only (repeat-safe), migration 0011 additive and idempotent with the embedded copy equal to the file, fail closed on a database error, health never counted.
- Local workerd burst against the same database: requests 1 to 10 returned 302, requests 11 and 12 returned 429 with `Retry-After: 15`, health stayed 200, and the stored count matched the requests sent.
