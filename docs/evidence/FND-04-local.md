# FND-04 — Failure and Observability Baseline Evidence

Date: 2026-10-26 (Asia/Kolkata). Role: Backend (FND-04 Observability Engineer). Status: **verified locally for FND-04**.

## Scope and Implementations

Task FND-04 implements modular observability, request correlation, timing, execution bounds/deadlines, and safe error masking for Flowboard's API runtime:

1. **Correlation Middleware (`apps/api/src/http/middleware/correlation.ts`)**:
   - Inspects incoming `x-request-id` header against ASCII safe printable characters regex (`/^[A-Za-z0-9._:-]{8,64}$/`).
   - If missing or invalid (<8 chars, >64 chars, spaces, control chars), generates a cryptographically random UUID via `crypto.randomUUID()`.
   - Stores `requestId` in Hono Context (`c.set('requestId', requestId)`).
   - Invariably attaches `x-request-id: <requestId>` to response headers on both successful and erroneous responses.

2. **Timing Middleware (`apps/api/src/http/middleware/timing.ts`)**:
   - High-precision request duration tracking using standard `performance.now()`.
   - Wraps downstream execution in `try ... finally` to ensure timing metrics are attached even on unhandled exceptions.
   - Formats and appends `Server-Timing: app;dur=<ms>` response header.

3. **Limits & Deadlines Middleware (`apps/api/src/http/middleware/limits.ts`)**:
   - **Body Limit**: Rejects request bodies larger than 1 MiB (1,048,576 bytes) with HTTP 413 `PAYLOAD_TOO_LARGE`. Uses Hono's streaming `bodyLimit` with support for both `Content-Length` header inspection and chunked transfer streams. Configurable for testing and specialized endpoints.
   - **Timeout / Deadline**: Enforces request execution deadlines (default 5,000ms) using `timeout` from `hono/timeout`. Aborts long-running operations and raises HTTP 504 `DEADLINE_EXCEEDED`. Configurable per app instance or route.

4. **Error & Not-Found Handling (`apps/api/src/http/middleware/error-handler.ts` & `apps/api/src/http/errors.ts`)**:
   - Provides strongly-typed `HttpError` extending Hono's `HTTPException`.
   - Enforces standard envelope: `{ error: { code: string, message: string, requestId: string, details?: Record<string, unknown> } }`.
   - Maps `@flowboard/contracts` `ValidationError` to HTTP 422 `VALIDATION_ERROR` with structured `{ details: { issues: [...] } }`.
   - Maps JSON syntax errors (`SyntaxError`) to HTTP 400 `MALFORMED_REQUEST`.
   - Maps canonical status codes:
     - 400 `MALFORMED_REQUEST`
     - 401 `UNAUTHORIZED`
     - 403 `FORBIDDEN`
     - 404 `NOT_FOUND`
     - 409 `CONFLICT` / `STALE_VERSION` / `STALE_CURSOR`
     - 410 `RESTORE_WINDOW_EXPIRED`
     - 413 `PAYLOAD_TOO_LARGE`
     - 422 `VALIDATION_ERROR`
     - 429 `TOO_MANY_REQUESTS` (with standard `Retry-After: 60` response header)
     - 503 `SERVICE_UNAVAILABLE` / `DATABASE_UNAVAILABLE`
     - 504 `DEADLINE_EXCEEDED`
   - **Safe 500 Handler**: For unhandled internal errors, guarantees response code `INTERNAL_ERROR` and static message `"Internal server error."`. Completely suppresses error messages, stack traces, database connection strings, passwords, and SQL statements.
   - Ensures `Cache-Control: no-store` header is attached to all error and private responses.

5. **Application Assembly (`apps/api/src/http/app.ts`)**:
   - Wires correlation, timing, body limit, deadline, and error handling into `createApp`.
   - Preserves existing health checks: `/health/live` (status 200 `{ data: { status: 'ok' } }`) and `/health/ready` (status 200 or 503 `DATABASE_UNAVAILABLE`).

## Verification Commands and Test Results

1. **Automated Observability Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/observability.test.ts
   ```
   Result: **20 tests passed, 0 failed, 0 skipped** across 9 suites (duration ~250ms).
   - Validates missing `x-request-id` header triggers UUID generation.
   - Validates incoming valid `x-request-id` is preserved and propagated.
   - Validates malformed/invalid `x-request-id` is rejected and replaced with UUID.
   - Validates `Server-Timing: app;dur=<ms>` header format on 200, 404, and errors.
   - Validates 404 returns `{ error: { code: 'NOT_FOUND', ... } }` conforming to `errorEnvelopeSchema`.
   - Validates malformed JSON yields 400 `MALFORMED_REQUEST`.
   - Validates contract schema validation failure yields 422 `VALIDATION_ERROR` with structured issues.
   - Validates internal error throwing sensitive credentials (`postgres://...`, SQL `SELECT * FROM user_secrets`) is masked with 500 `INTERNAL_ERROR` and zero leaked tokens.
   - Validates request body > 1 MiB returns 413 `PAYLOAD_TOO_LARGE`.
   - Validates request exceeding deadline returns 504 `DEADLINE_EXCEEDED`.
   - Validates custom error mappings (401, 403, 409, 410, 429 with `Retry-After: 60`, 503).

2. **Full Repository Check**:
   ```sh
   npm run check
   ```
   Result:
   - `tsc --noEmit` passed with 0 errors.
   - `wrangler deploy --dry-run` passed with 0 errors (866.63 KiB bundled).
   - 33 api tests passed (including Node HTTP, workerd Worker, migrations, and observability).
   - 41 contracts tests passed.
   - Total: **74 tests passed, 0 failed, 0 skipped**.

## Limitations

- Body size limit and timeouts are enforced at the HTTP application layer; edge infrastructure (Cloudflare Worker limits, reverse proxy limits) will provide outer bounds in deployed environments.
- Rate limiting middleware currently emits standard 429 envelopes with `Retry-After: 60`; tenant/token-bucket distributed rate-limiter state (e.g. KV or Redis) will be introduced in subsequent multi-instance deployment phases when documented scale triggers are reached.
