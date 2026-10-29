# Rate limiter not enforcing on UAT — root cause and options — 2026-10-29

Status: finding and recommendation. No deployment made. Decision belongs to the Architect.

## What was observed

- UAT Worker `0635b142-…` (commit `8b41fe6`) has the five `FB_RL_*` bindings (Deployment's `wrangler versions view`).
- 42 sequential `GET /api/v1/auth/google` through `flowboard-api-uat.web-app-cloud.workers.dev` all returned 302. The limit is 10 per 60 s.
- 65 unauthenticated `POST /api/v1/workspaces` all returned 401. The limit is 60 per 60 s.
- Locally (`wrangler dev`), the 11th request in a burst returns 429. The code path works there.

## Root cause (most likely, with evidence)

Cloudflare documents the binding as approximate. The Workers Rate Limiting binding page says: "Rate limits are approximate and apply separately in each Cloudflare location", and that counts are "eventually consistent". Requests served in another location "count toward a separate limit, even with the same namespace and key", and the counts "do not combine into one worldwide limit".

Our traffic is spread over several locations, so no single location's counter reached 10 or 60:

- My own sample on 2026-10-29, 15 unauthenticated `GET` requests to `workers.dev`, was served from FRA, CDG, LHR, HKG, BOS and others (read from the `cf-ray` suffix). The same sample through the Pages URL came from CDG, MAA and CJB.
- With roughly five locations, a burst of 42 gives about 8 per location, under 10. A burst of 65 writes gives about 13 per location, under 60. Every request passes, which matches what was observed.

I did not run the 42/65 burst again myself, so this is strong but not a direct reproduction. The check that would make it conclusive is the `cf-ray` suffix on each UAT response (see "Next evidence").

## What was ruled out or not yet proven

- **Binding read from the wrong env:** `worker.ts` passes the Worker `env` to `app.fetch`, and the limiter reads `c.env`. A fake env in tests exercises this path. Not yet proven in production. The new `GET /api/v1/system/status` reports which bindings the deployed runtime sees, and absent bindings are logged as `rate_limit_binding_absent`.
- **Mounted on the wrong app:** the Worker entry (`src/runtime/worker.ts`) calls `createApp` with the default Cloudflare resolver. The Node entry uses the same app and has no bindings by design.
- **Middleware order:** the limiter is mounted with `app.use('*')` before every route and before `authMiddleware`. A 401 for an unauthenticated write is therefore produced after the limiter has counted the request. The 401s did count, but per location.
- **`cf-connecting-ip` missing or spoofed:** Cloudflare overwrites this header at the edge. The Pages service-binding hop was not verified. A missing or malformed value uses one shared key, which would collapse all clients into one bucket and cause false refusals rather than missed ones. The new `rate_limit_client_ip_missing` log detects this without logging the IP.

## Diagnostics added (this commit)

- `rate_limit_binding_absent` (error) when a required binding is missing on the Worker.
- `rate_limit_client_ip_missing` (warn) when the key falls back to the shared bucket.
- `rate_limit_refused` (warn) with the binding name only.
- `GET /api/v1/system/status` (admin secret required) adds `rateLimitBindings`: booleans per binding.
- Logs carry no client IP, token or secret.

## Options, ranked

**1. Accept the binding as an approximate burst softener for beta (recommended).**
- It stops single-location bursts and costs nothing to run.
- It does not give an exact or global limit. A client that spreads requests across locations can exceed the numbers.
- Our auth route is Google OAuth, with no password login, so brute-force password guessing is not possible there. The main exposure is write volume from a signed-in user, which the per-location limit still slows.
- Document it as approximate (done in `docs/API.md`) and keep the diagnostics so UAT can confirm the bindings are live.

**2. Exact limiter in PostgreSQL, for sign-in and invitations only.**
- How: a small table of `(limit key, window start, count)`. Each limited request runs one atomic upsert and increments the count. Exact, because PostgreSQL serializes the upsert. Needs a periodic cleanup of old windows.
- Cost on Neon: one extra write per limited request (WAL and compute), plus a cleanup job. Negligible at beta volume. Do not apply it to all writes: that is a write per request.
- If the database is down: the sign-in callback needs the database anyway, so failing closed (503) on those routes costs little. Failing open would be safer for availability; failing closed is safer for abuse.
- Downside: IP-keyed limits punish many users behind one shared NAT address.

**3. Durable Objects (exact, global per key).**
- How: one Durable Object per key (for example per IP per route family). It holds its own count and is strongly consistent. Requests from every location reach the same object.
- Cost and plan: Durable Objects are generally part of the paid Workers plan. The docs did not confirm free-plan SQLite-backed storage, so check the dashboard before relying on it. Each limited request adds a hop to the object, usually a few milliseconds.
- Complexity: a new class, a migration in `wrangler.jsonc`, and a new failure mode to test. Highest of the three, and the right choice if exact global limits become a requirement.

## Recommendation

Choose 1 for beta. If the Architect requires an exact sign-in or invitation limit before beta, choose 2 for those routes only. Choose 3 only if an exact limit on writes is needed later. Option 2 should not cover all writes.

## Next evidence (for Deployment, no code needed)

- Count `cf-ray` suffixes over a UAT burst of 42 `workers.dev` requests. If more than one location appears and all return 302, the root cause is confirmed.
- `GET /api/v1/system/status` with the admin secret: `rateLimitBindings` should show five `true` values.
- Worker logs: no `rate_limit_binding_absent` or `rate_limit_client_ip_missing` lines during the burst.

## Open facts not verified

- Free-plan limits for the binding (not stated in the docs read).
- Whether `limit()` fails open or closed on a Cloudflare error (not documented). Our middleware lets a thrown error surface as a 500, so a limiter fault would fail the route.
