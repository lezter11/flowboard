# FND-01 — local backend harness evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for FND-01 only**. No Git repository exists in this checkout; no commit, Git initialization or push was made.

## Scope and files

- Coordinated root tooling: `package.json`, `package-lock.json`, `.node-version`, `tsconfig.json`.
- API workspace: `apps/api/package.json`, `tsconfig.build.json`, `wrangler.jsonc`, `README.md`.
- Runtime: `apps/api/src/http/app.ts`, `src/adapters/postgres.ts`, `src/runtime/node.ts`, `src/runtime/worker.ts`, `src/runtime/local-config.ts`.
- Verification: `apps/api/test/node.test.ts`, `worker.test.ts`, `rollback-probe.ts`, `worker-probe.ts`, `wrangler.jsonc`.
- Isolated database: `database/compose.local.yaml`. No selected product migrations were added or historical D1 files changed.
- Backend evidence: this file and `docs/handoffs/backend/FND-01.json`. The checklist is regenerated from role evidence, never manually checked.

Product/API/root planning documents, UI, templates and other-role evidence were not edited by this task.

## Reproduce from repository root

Prerequisites: Node 24.15.0, npm 11.12.1, Docker engine with Compose running; loopback access and unused ports 3000/8787 for manual development, 55432 for PostgreSQL. Automated HTTP tests use ephemeral ports. Initial npm/image installation requires network access; execution needs no cloud account.

```sh
npm ci
npm run db:up
npm run check
```

`db:up` starts only Compose project `flowboard-fnd01`. PostgreSQL has memory-backed disposable data and no product records. Its loopback-only `flowboard_harness` user/database and public synthetic password are local fixtures. Node/test configuration refuses remote or non-harness database targets and URL query overrides. An existing unrelated database container was inspected for port use and left untouched.

For interactive operation, run `npm run dev:api` (Node, port 3000) or `npm run dev:worker` (local workerd, port 8787). The Node build can also start with `node apps/api/dist/node/runtime/node.js`. Ctrl-C closes local API resources. Cleanup after work:

```sh
npm run db:down
```

No persistent data, product migrations, seeds or account setup are required. Missing PostgreSQL causes test failure; tests do not skip it or substitute a mock.

After verification, `docker compose -f database/compose.local.yaml down` exited 0 and removed only `flowboard-fnd01-postgres-1` and `flowboard-fnd01_default`. No Flowboard database or API process was left running. Re-run `npm run db:up` before checks or development.

## Environment and pinned versions

Observed macOS 27.0.1, arm64; Node v24.15.0; npm 11.12.1; Docker Desktop 4.83.0 / engine 29.6.2. PostgreSQL reports **17.11**, running from `postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.

Direct dependencies: Hono 4.13.14, @hono/node-server 2.1.5, Kysely 0.29.7, pg 8.23.1, Wrangler 4.152.0, TypeScript 7.0.2, @types/node 24.19.2, @types/pg 8.23.1. Wrangler's locked runtime is workerd 1.20261019.1 / Miniflare 5.20261019.2-beta. The upstream tool's transitive prerelease is recorded; no separate floating installation was used.

All direct dependency versions are exact; transitive resolution is in `package-lock.json`. Lockfile SHA-256: `04072f04d0c1d15bbe5b9fa704c112b36fd3b4ca10a478da63cd49dcd662a8e4`. Both `npm install` and a subsequent clean `npm ci --cache /private/tmp/flowboard-npm-cache --no-audit --no-fund` succeeded. npm lists some platform-optional Sharp/WASM helper packages as extraneous after its clean install; the selected direct dependency versions match and the checks below pass. This is not a dependency-security audit.

## Actual verification

Final command: **`npm run check`**, exit **0**, after clean lockfile installation.

1. `npm run typecheck`: strict TypeScript, exit 0.
2. `npm run build`: compiled Node JavaScript plus Wrangler `deploy --dry-run`, exit 0. The command bundled locally and explicitly printed `--dry-run: exiting now`; no Worker was deployed. Bundle reported 705.80 KiB / 124.11 KiB gzip; this is an artifact size, not a latency or CPU measurement.
3. `npm test`: **5 passed, 0 failed, 0 skipped** (observed total duration 759.733875 ms, not a performance benchmark):
   - Real Node HTTP liveness/readiness and JSON 404 for an unimplemented product route.
   - Real Node pg/Kysely parameterized query and rollback/commit positive control.
   - Actual refused local PostgreSQL connection returns safe 503 while liveness remains 200.
   - Nonlocal/non-harness URLs and query-string connection overrides are refused by the local harness guard.
   - Actual local workerd, shared HTTP handlers, pg/Kysely query and rollback/commit positive control.

The rollback probe checks out one connection, creates a session-local temporary table outside the measured transaction, inserts one synthetic row inside a transaction, sees that row, throws the intentional failure and verifies **0 rows after rollback**. It then commits a control insertion and verifies **1 row after commit**. The temporary table is dropped in `finally`; the pool/connection is destroyed or released. The observed result on **both runtimes** was:

```json
{"seenInside":1,"afterRollback":0,"afterCommit":1}
```

A separate compiled-JavaScript smoke check imported `apps/api/dist/node/runtime/node.js`, started `startNode(0)`, fetched `/health/ready`, asserted status 200 and closed the runtime: **passed**, observed `{"data":{"status":"ready"}}`.

Post-check `docker compose -f database/compose.local.yaml exec -T postgres psql -U flowboard_harness -d flowboard_harness -Atc "select count(*) from information_schema.tables where table_schema = 'public';"` returned **0**. No product schema was created. `rg` found no `/__test/rollback`, intentional-failure or committed-control markers in `apps/api/dist/worker/worker.js`; the rollback HTTP helper exists only in the separate test entry point.

## Local HTTP contract and examples

These infrastructure routes are separate from product **API v0.3**, which is unchanged and awaits FND-02 validated schemas. Requests use no session, identity header or role: the local harness has no private product resources or domain-write endpoints. Project RBAC, CSRF and authentication are **not implemented or verified** by FND-01. All responses have `Cache-Control: no-store`.

```http
GET /health/live
200 {"data":{"status":"ok"}}

GET /health/ready
200 {"data":{"status":"ready"}}

GET /api/v1/boards/not-implemented
404 {"error":{"code":"NOT_FOUND","message":"Route not found.","requestId":"<generated UUID>"}}
```

With an unavailable local DB, readiness returns the following tested shape; request IDs vary:

```json
{"error":{"code":"DATABASE_UNAVAILABLE","message":"Database is unavailable.","requestId":"<generated UUID>"}}
```

Status: 503. Error assertions confirm no connection URL, fixture password, SQL or ECONNREFUSED internals appear in its body. Node liveness remains 200 during that actual connection failure. Unexpected errors have a generic 500 handler; no broad error/observability completion is claimed.

## Why this design and alternatives

Hono holds the same HTTP handlers for Node and Worker; only entry points and connection lifecycle differ. Node reuses at most four pooled connections. Worker readiness opens at most one request-scoped pg connection and destroys it before returning. A plain pg-only probe would use fewer dependencies; including Kysely exercises the selected query/transaction layer now. A separate web framework for each host would create duplicated handlers and more room for behavior to diverge.

A transaction is a group of database changes that succeed or roll back together. For a later Flowboard card move, the card update and activity event must agree. This foundation proves the selected libraries can roll back an inserted synthetic row on both local runtimes. It does not yet prove card/history/receipt/outbox atomicity, project isolation, concurrency, crash durability or recovery.

Use PostgreSQL 17.11 because the official image was already available locally and that major/minor is supported; the digest keeps repeat runs stable. A local PostgreSQL installation would also work but needs separate setup. Memory-backed disposable storage avoids touching existing data and deliberately provides no persistence. Revisit the selected runtime/connection strategy after actual authenticated workload and hosted CPU, pooling and latency measurements.

## Issues resolved and limits

- The initial sandbox could not access Docker's Unix socket. Authorized local execution accessed Docker successfully; PostgreSQL was available, not missing.
- Wrangler's initial local build could not write its preferences logs under sandbox restrictions. Authorized local execution completed the dry run.
- `2026-10-26` was rejected as a future/unsupported compatibility date by the installed workerd. Both configs now deliberately pin `2026-10-19`, which passed actual execution. Do not advance it without rechecking runtime support.
- Firecrawl credits were exhausted during documentation retrieval; remaining official docs were read through the web fallback.
- Local Hyperdrive configuration connects **directly** to local PostgreSQL; hosted Hyperdrive connection reuse/cache behavior, Neon, TLS, Cloudflare accounts and Worker Free CPU limits remain untested. The all-zero binding ID is only a local placeholder, not a provisioned resource.
- No auth, product permissions, product migrations, board/card/import/image/trash features, UI integration, load tests, deployment or production claims. This does not close FND-02/03/04 or the 50 engineering controls.
- Test-only rollback entry point is excluded from normal builds; local setup is not a production deployment configuration.

## Official references consulted

- [Hono Node setup](https://hono.dev/docs/getting-started/nodejs) — Node adapter and server lifecycle.
- [Cloudflare pg integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/) — supported driver/compatibility setup.
- [node-postgres transactions](https://node-postgres.com/features/transactions) — one client for a transaction.
- [Kysely transactions](https://kysely.dev/docs/examples/transactions/simple-transaction) — thrown callback errors roll back.
- [Wrangler test harness API](https://developers.cloudflare.com/workers/wrangler/api/) — `createTestHarness` with the built-in Node test runner.
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) — local connections bypass hosted pooling/caching.
- [PostgreSQL version policy](https://www.postgresql.org/support/versioning/) — PostgreSQL 17.11 support.

## Handoff and next work

FND-01 has no user-facing UI requirement. Architect can review this evidence and integration status separately. **FND-02** is the next ordered dependency-ready task: shared validated API v0.3 schemas/OpenAPI/fixtures, coordinated with Architect. FND-03 and FND-04 also have their foundation dependency satisfied but were not started. No user action is needed to complete this local unit.
