# Independent Reviewer Session Evidence: FND-02

## 1. Independence and Audit Metadata
- **Feature ID**: FND-02 (Dual Node/Worker runtime database wiring)
- **Reviewer Actor ID**: `independent-backend-reviewer`
- **Reviewer Session ID**: `b54e0975-7baf-4cac-99fe-0f396b9bb498`
- **Implementer Actor ID**: `builder`
- **Implementer Session ID**: `builder-session-id`
- **Reviewer Model**: `gemini-2.5-pro`
- **Fresh Context**: Yes, clean auditor session with no implementation crossover
- **Read-Only Audit**: Reviewer did not write or modify production code under audit
- **Environment**: macOS arm64, Node.js 24.15.0, PostgreSQL 17 isolated synthetic test database, Wrangler / workerd 1.20261019.1

## 2. Reachable Scope and Source Verification
- `apps/api/src/runtime/node.ts`:
  - Starts Node HTTP server with `@hono/node-server`.
  - Injects `pool` into `createApp(() => queryDatabase(pool), { pool })`.
  - Implements `close()`: cleanly closes HTTP server, then `await pool.end()`.
  - Registers `SIGINT` and `SIGTERM` process handlers with a 10s deadline.
- `apps/api/src/runtime/worker.ts`:
  - Cloudflare Worker fetch handler.
  - Resolves connection string from `env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL`.
  - Allocates request-scoped single connection pool (`createPool(connectionString, 1)`), injects it into `createApp`, runs request within `try / finally`, and guarantees `await pool.end()` in `finally`.
- `apps/api/src/http/app.ts`:
  - Middleware step 0:
    - In Node (when options.pool is provided): binds injected pool to Hono context (`c.set('pool', injectedPool)`) and runs down the middleware chain inside `poolStorage.run(injectedPool, () => next())` using `AsyncLocalStorage`.
    - In Worker: derives pool from environment, binds to context and `AsyncLocalStorage`, and terminates pool in `finally`.
  - Probes:
    - `/health/live`: returns 200 `{ data: { status: 'ok' } }` without checking database (indicates process is alive).
    - `/health/ready`: executes `await probeDatabase()`. On failure, catches and returns safe 503 with error code `DATABASE_UNAVAILABLE` and correlation ID without leaking connection strings.

## 3. Mandatory Criteria Evaluation
1. **Dual runtime harness**: Verified. The exact same Hono `createApp` router executes both on Node.js and inside local Cloudflare `workerd`.
2. **Database dependency injection**: Verified. Both runtimes inject the database pool. Product routes and health checks use `getPool(c)` or `poolStorage.getStore()`.
3. **Health and readiness probes**: Verified. `/health/live` returns 200 OK independently of DB. `/health/ready` executes a live DB query; when the DB is refused or unavailable, returns HTTP 503 `DATABASE_UNAVAILABLE`.
4. **Graceful shutdown**: Verified. Node runtime's `close()` closes the server listening socket and calls `pool.end()`.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/node.test.ts`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/worker.test.ts`
All 5 tests passed:
- Node HTTP liveness, readiness, product routes (pass)
- Node pg/Kysely parameterized query & rollback (pass)
- Node HTTP refused DB returns safe 503 (pass)
- Local harness rejects non-harness targets (pass)
- Local workerd shared HTTP routes, pg/Kysely query, transaction rollback (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
Modern cloud applications often run in edge serverless environments (Cloudflare Workers) or containerized servers (Node.js in Docker/Kubernetes).
- **The Challenge**: Serverless edge environments have completely different connection lifecycles from persistent Node.js servers:
  - In Node.js, you create a persistent connection pool of 4-10 connections that lives for days.
  - In Cloudflare Workers, an edge worker isolate can start, handle one request, and pause. Shared global socket pools can cause connection leaks or socket exhaustion on PostgreSQL.
- **The Decision**: Flowboard abstracts the runtime harness into `createApp(probeDatabase, options)`:
  - In Node, a persistent pool is injected and shared across requests.
  - In Workers, a request-scoped pool of size 1 is allocated and guaranteed to close in a `finally` block.
  - Both runtimes pass connections to request handlers via `AsyncLocalStorage`, so application code (`getPool()`) never needs `if (isWorker)` statements.
- **Benefits**: Single unified codebase runs everywhere; zero connection leaks at the edge.
- **Drawbacks**: Worker requests establish a short-lived connection if Hyperdrive pooling is not active.
- **Alternatives Considered**: Global pool in Workers (causes edge socket errors and memory leaks across isolates).
