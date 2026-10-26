# Independent Reviewer Session Evidence: FND-04

## 1. Independence and Audit Metadata
- **Feature ID**: FND-04 (Observability, correlation, limits & safe errors)
- **Reviewer Actor ID**: `independent-backend-reviewer`
- **Reviewer Session ID**: `b54e0975-7baf-4cac-99fe-0f396b9bb498`
- **Implementer Actor ID**: `builder`
- **Implementer Session ID**: `builder-session-id`
- **Reviewer Model**: `gemini-2.5-pro`
- **Fresh Context**: Yes, clean auditor session with no implementation crossover
- **Read-Only Audit**: Reviewer did not write or modify production code under audit
- **Environment**: macOS arm64, Node.js 24.15.0, PostgreSQL 17 isolated synthetic test database

## 2. Reachable Scope and Source Verification
- `apps/api/src/http/middleware/correlation.ts`:
  - Validates incoming `x-request-id` against `/^[A-Za-z0-9_\-.]{8,64}$/`. If absent or invalid (e.g. contains spaces, control characters, or invalid length), generates a secure UUID via `crypto.randomUUID()`.
  - Sets `requestId` in Hono context variable.
  - Attaches `x-request-id` header to response.
- `apps/api/src/http/middleware/timing.ts`:
  - Records `startTime = performance.now()`.
  - Awaits downstream middleware.
  - Attaches `Server-Timing: app;dur=${durationMs.toFixed(2)}` on all response statuses.
- `apps/api/src/http/middleware/limits.ts`:
  - `bodyLimitMiddleware(maxBytes)`: Inspects `content-length` and stream chunks. If body exceeds `maxBytes` (default 1 MiB = 1,048,576 bytes), aborts with HTTP 413 `PAYLOAD_TOO_LARGE`.
  - `deadlineMiddleware(timeoutMs)`: Wraps execution with an abort race against `timeoutMs` (default 5,000 ms). If deadline expires, terminates request with HTTP 504 `DEADLINE_EXCEEDED`.
- `apps/api/src/http/middleware/error-handler.ts`:
  - Catches `HttpError` and maps to structured status and `{ error: { code, message, requestId, details } }`.
  - Handles Zod `ZodError` by converting to 422 `VALIDATION_ERROR` with structured field issues.
  - Handles syntax errors in JSON bodies by returning 400 `MALFORMED_REQUEST`.
  - Unhandled / 500 errors: logs internally, but client receives safe generic message `"Internal Server Error"` with code `'INTERNAL_ERROR'` and correlation `requestId`. PostgreSQL connection strings, query strings, and stack traces are strictly stripped and never leaked.
  - `429 TOO_MANY_REQUESTS` attaches `Retry-After: 60`.

## 3. Mandatory Criteria Evaluation
1. **Correlation IDs**: Verified. Incoming valid ASCII `x-request-id` is preserved; missing or malformed values are replaced with safe UUIDs. Present on 200, 400, 404, 413, 500, 504 responses.
2. **Server-Timing**: Verified. `Server-Timing: app;dur=<ms>` is attached to all success and error responses.
3. **Safe error masking**: Verified. Database connection strings, SQL queries, and internal crash details are masked into safe generic error envelopes.
4. **Body size limits**: Verified. Bodies exceeding 1 MiB are rejected with HTTP 413 `PAYLOAD_TOO_LARGE`.
5. **Request timeouts**: Verified. Requests exceeding the configured deadline (tested with 50ms synthetic timeout) return HTTP 504 `DEADLINE_EXCEEDED`.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/observability.test.ts`
All 20 tests passed across 9 suites:
- Correlation middleware and request IDs (4 tests, all pass)
- Server-Timing header (2 tests, all pass)
- Not found handler 404 (pass)
- Validation error formatting 400 & 422 (2 tests, all pass)
- Safe 500 handler & sensitive internal error masking (pass)
- Body size limits 413 (2 tests, all pass)
- Request deadline / timeout middleware 504 (2 tests, all pass)
- Custom HTTP errors & status mappings (401, 403, 409, 410, 429, 503) (6 tests, all pass)

## 5. Plain-English System Design Teaching & Decision Analysis
Production web servers must defend against denial-of-service, prevent sensitive information leakage, and provide traceability when bugs occur.
- **Correlation IDs (`x-request-id`)**: When a user experiences an error, asking them "what happened?" is ineffective. With correlation IDs, the server assigns a UUID to every request. The frontend can display: "Something went wrong. Ref: `a1b2c3d4`". An engineer can grep server logs for that exact UUID and see the precise error, database query, and timing trace.
- **Safe Error Masking**: Default framework behavior (like Express or raw Node) often dumps stack traces containing database passwords (e.g. `postgres://user:password@host/db`) into the HTTP response. Flowboard's central error handler catches all unhandled exceptions, logs the error safely on the server, and returns only a generic error envelope with the correlation ID to the client.
- **Body and Deadline Limits**: Attackers can exhaust server memory by uploading a 1 GB JSON body or keeping connections open indefinitely. Flowboard enforces a strict 1 MiB payload ceiling (413 Payload Too Large) and a 5-second deadline (504 Deadline Exceeded).
- **Benefits**: Comprehensive operational safety and debugging visibility without operational overhead.
- **Drawbacks**: Long-running asynchronous batch tasks cannot use standard HTTP request-response cycles and must use background jobs instead.
- **Alternatives Considered**: Unlimited body size with per-route checks (rejected due to memory exhaustion risk).
