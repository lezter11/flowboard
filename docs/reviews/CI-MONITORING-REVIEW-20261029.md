# Independent review: CI workflow, monitoring guide and Wrangler config

Date: 2026-10-29. Reviewer: Support chat (read-only; no product file edited). Requested by: Architect.
Scope: commits 42b7cee (wrangler.jsonc), 17b04a0 (ci.yml), 5b964d9 (MONITORING.md). CI was reviewed at commit 6e15bd0, as requested. At the time of review the working tree matched 6e15bd0 for `.github/workflows/ci.yml`, so any Deployment edit after this review is not covered.

Method: `git show <commit>:<path>` for each file, then line-level checks against the code (`apps/api/src`, `apps/api/test`), the installed `wrangler` (`node_modules/wrangler`), and `docs/RELEASE_BETA.md`. No commands were run against a database and no dev server was started. Secret scan: values were not printed; findings give locations only.

## Verdicts

| File | Verdict | Highest severity |
|---|---|---|
| `.github/workflows/ci.yml` | **Needs changes.** Safe from production, but the gate is red (API suite) and the authorization tests never run. | High |
| `docs/MONITORING.md` | **Needs changes.** One probe URL is wrong and would not work. | High |
| `apps/api/wrangler.jsonc` | **Needs changes.** No committed secret and bindings are correct, but removing `localConnectionString` breaks `npm run dev:worker`. | High |

## Findings

### ci.yml (at 6e15bd0)

**[HIGH] H1. The API suite fails on the database fence before any test runs.**
- CI sets `DATABASE_URL` with user `flowboard_ci` and database `flowboard_ci_test` (`ci.yml:26-28`, `ci.yml:60`).
- The fence in `apps/api/src/runtime/local-config.ts:21-25` allows a local URL only when the hostname is local, the path is `/flowboard_harness`, and the user is `flowboard_harness`. Anything else throws `FND-01 requires the local flowboard_harness database and user`.
- `localDatabaseUrl(process.env['DATABASE_URL'])` runs in many suites (for example `migrations.test.ts:12`, `worker.test.ts:27`, `node.test.ts:58`), so those suites throw.
- Do not "fix" this by setting `ALLOW_REMOTE_DB: 'true'` (`ci.yml:61`). That disables the fence that protects against pointing tests at a remote database.
- Requirement for any fix: user and database must both be `flowboard_harness`, or the fence must be changed under Backend ownership.

**[HIGH] H2. The 14 authorization test files never run in CI, and the job still passes.**
- 14 test files read `FLOWBOARD_ACCESS_TEST_DATABASE_URL` (for example `board-access.test.ts:13`) and skip when it is unset (`board-access.test.ts:18`). The workflow never sets it.
- Skipped tests exit with success, so a green CI run says nothing about board access, grants or lock ordering.
- The board-access fence needs a different database name (`/flowboard_access_test`, `board-access.test.ts:21`). The harness fence needs `flowboard_harness` (H1). One service database cannot satisfy both. The fix needs two databases, or two service containers, or a run step that creates both.
- Count note: the Architect's message says 13 gated tests. I found 14 files that reference the variable at 6e15bd0. I did not count individual test cases.

**[MEDIUM] M1. No `permissions:` block.** The file has no top-level or job-level `permissions` (`ci.yml:1-20`), so `GITHUB_TOKEN` gets the repository default. Add `permissions: contents: read` at top level.

**[MEDIUM] M2. Actions are pinned to tags, not commit SHAs.** `actions/checkout@v4` (`ci.yml:39`) and `actions/setup-node@v4` (`ci.yml:42`) are mutable tags. The service image `postgres:17-alpine` (`ci.yml:24`) is a floating tag. `apps/api/README.md` says local PostgreSQL 17.11 is pinned by digest in `database/compose.local.yaml`. CI and local therefore may run different PostgreSQL builds.

**[LOW] L1. Credentials persist in the workspace.** `actions/checkout` persists the token in git config by default. Add `persist-credentials: false` (`ci.yml:39`).

**[LOW] L2. No job timeout.** The job has no `timeout-minutes`, so a hung test uses the 6-hour default.

**[LOW] L3. Hardcoded database password in the workflow.** `POSTGRES_PASSWORD` (`ci.yml:27`) and the `DATABASE_URL` password (`ci.yml:60`) are the same literal string. It is throwaway, used only by a loopback service container, and no secret is referenced. Acceptable; if Deployment adds real credentials here, use `secrets` and keep this one for CI only. Location only, value not printed.

**[LOW] L4. The API build is not in CI.** Only `build:web` runs (`ci.yml:64-65`). `apps/api`'s `build` script includes a `wrangler deploy --dry-run` (`apps/api/package.json:8`), which is never exercised in CI.

**Checked and correct:**
- Triggers (`ci.yml:3-11`): `pull_request` only, with no `pull_request_target`. Fork PRs get no secrets and a read-only token.
- No `secrets.*` references anywhere in the workflow (count 0).
- Production and UAT reachability: none. The database is a loopback service container (`127.0.0.1:5432`) with no credentials from outside the workflow. CI cannot reach Neon or Hyperdrive at 6e15bd0. Keep it that way.
- Step order (`ci.yml:50-65`): typecheck, then contracts tests, then API tests, then web build. Failures fail the job; no `continue-on-error` anywhere.
- Cache: `setup-node` with `cache: 'npm'` keyed on the lockfile (`ci.yml:45`). Low poisoning risk, since fork PRs cannot write to the base branch's cache scope. Accepted.
- `.node-version` is `24.15.0`; `package-lock.json` exists.

### docs/MONITORING.md (at 5b964d9)

**[HIGH] D1. The checklist probe URL does not exist.** Line 59 says to probe `https://flowboard-app.pages.dev/api/v1/health/ready`. No `/api/v1/health` route exists; the health routes are registered at the root, `/health/live` and `/health/ready` (`apps/api/src/http/app.ts:117-118`). The Pages host is the frontend (`docs/RELEASE_BETA.md:5`). The API Worker is `flowboard-api` (`flowboard-api.web-app-cloud.workers.dev` per `RELEASE_BETA.md:22`). An uptime probe on this URL would report the service as down, or would never reach the readiness check. Section 1 (line 16) and line 22 use `/health/ready`, so the document contradicts itself. Whether Pages proxies `/health/*` is unverified.

**[MEDIUM] D2. Cron thresholds apply to production only.** Section 2 (line 35) alerts on 10 minutes of silence for a 5-minute cron. UAT runs `*/15 * * * *` (`apps/api/wrangler.jsonc:33`; `RELEASE_BETA.md:105`). Applied to UAT, the same thresholds would alert on every run. Split the thresholds by environment.

**[MEDIUM] D3. A public 60-second probe runs a query every minute.** `/health/ready` runs `probeDatabase()` on each request (`app.ts:118-121`). A one-minute external probe keeps Neon compute busy and uses a Hyperdrive connection every minute. This is a cost and cold-start consideration, not a leak. Consider a longer interval, or a cached result.

**[LOW] D4. The availability alert window is too short for the probe.** At 60 seconds, "< 99.0% over 5m" is five samples, so one failed probe is 20% and triggers the critical alert. Use a longer window for the critical level.

**[LOW] D5. Some metrics are not implemented, and the document does not say so.** Section 2 (availability, 5xx rate, P95 latency, pool exhaustion) and the Cloudflare notification rules in section 4 describe alerts. I did not find a metrics source in the code, and the checklist boxes are unchecked. Mark these as "planned, not implemented" so nobody reads them as active.

**[LOW] D6. A dev-named secret protects the production status route.** Section 1 (line 20) names `DEV_LOGIN_SECRET` as the admin secret. `system.ts:11` uses it on the status route. The name suggests dev-only, which could lead an operator to set it loosely. Consider renaming it under Backend ownership.

**Checked and correct:**
- `GET /health/live` returns `{"data":{"status":"ok"}}` (`app.ts:117`), matching line 15.
- `GET /health/ready` returns 503 `DATABASE_UNAVAILABLE` with `requestId` (`app.ts:119-130`), matching line 16.
- `GET /api/v1/system/status` exists (`system.ts:8`, mounted at `app.ts:152`), requires `x-dev-secret`, and fails closed when no secret is configured (`admin-secret.ts:17-18`).
- The cron jobs `purgeExpiredTrash` and `processOutboxLease` are called from `scheduled()` (`apps/api/src/runtime/worker.ts:38-44`).
- The local scheduled path `/cdn-cgi/local/scheduled` (line 50) exists in the installed wrangler (`node_modules/wrangler/wrangler-dist/ProxyWorker.js:227`).
- No secret value appears in the document. It names the header and the variable only.

### apps/api/wrangler.jsonc (at 6e15bd0, with 42b7cee)

**[HIGH] W1. `npm run dev:worker` now fails at startup.** The only local connection string was removed in 42b7cee. `dev:worker` runs `wrangler dev --local` (`apps/api/package.json:7`). The installed wrangler throws a `UserError` in local mode when a Hyperdrive binding has no `localConnectionString` and no environment variable is set (`node_modules/wrangler/wrangler-dist/cli.js:191975-191977`). This breaks the documented local Worker path (`apps/api/README.md:30`, `curl http://127.0.0.1:8787/health/ready`). I confirmed this by reading the code, not by running `wrangler dev`. Fix: restore a local connection string for `flowboard_harness` on the top-level binding, or document the environment variable and provide it in the README.

**[HIGH] W2. The README describes a placeholder that is no longer in the file.** `apps/api/README.md:43` says the Worker config contains "an all-zero local Hyperdrive placeholder". The committed ID is `18f56141…` (`wrangler.jsonc:11`), which `RELEASE_BETA.md:121` names as the production `flowboard-hyperdrive`. The ID is an identifier, not a secret, so this is not an exposure. But a reader who trusts the README could assume the binding is a harmless placeholder when it points at production. Correct the README with W1.

**[LOW] W3. A harness password literal exists in a second file.** `apps/api/test/wrangler.jsonc:9` contains the local harness connection string, as does `apps/api/src/runtime/local-config.ts:2`. Both are disposable local-only values, so this is low. The removal in 42b7cee did not clean the test copy. Location only, value not printed.

**Checked and correct:**
- No committed secret. The file holds two Hyperdrive IDs (identifiers) and three public URLs (`vars`, lines 14-18 and 28-32).
- Local bindings: `dev.ip` and `dev.port` are `127.0.0.1` and 8787 (line 7).
- UAT is isolated: it redefines `vars`, `hyperdrive` (line 27, a different ID from production) and `triggers` (line 33), as the comment on lines 22-23 says. It also has its own worker `name`.
- Cron: production `*/5 * * * *` (line 20), matching `RELEASE_BETA.md:105`. UAT `*/15 * * * *` (line 33), also matching.
- Frontend URLs and CORS origin are exact hosts, not wildcards (lines 15-17, 29-31), matching `RELEASE_BETA.md:106`.

## Summary for Deployment and Backend

1. **Before CI can gate anything:** fix H1 (database user and name) and H2 (create the two databases and set `FLOWBOARD_ACCESS_TEST_DATABASE_URL`). Then confirm the 14 files actually run, not skip.
2. **Before the MONITORING checklist is used:** fix D1 (the probe URL).
3. **Before anyone runs `dev:worker`:** fix W1 and W2.
4. Medium and low items can follow in a separate change.

No secret values were printed. Severity labels reflect the state at 6e15bd0 and 5b964d9, and the state of the working tree at review time.
