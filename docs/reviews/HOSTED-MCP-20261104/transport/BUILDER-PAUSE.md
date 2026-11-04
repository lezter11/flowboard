# Transport/runtime builder pause — 2026-11-04

User explicitly paused development/testing to change effort/usage. No further fixes, tests, Git operations or deployments are authorized while paused. UAT remains the existing d1c81f4 deployment. This source is **not held or approved**.

## Owned source currently written

- `packages/mcp/src/server.ts`: inert five-tool factory and structural operations interface; `index.ts` is the stdio entry only.
- `packages/mcp/src/client.ts`: injected relative-route `FlowboardOperationsClient`; strict PAT-only `FlowboardClient` wrapper remains. API errors are sanitized.
- `apps/api/src/services/hosted-mcp-transport.ts`: request-local SDK transport, JSON responses,128KiB/depth32/single-message guards, exact Accept negotiation, no cookies/session, safe failures.
- `apps/api/src/http/hosted-mcp-context.ts`: private Request-identity WeakMap, sanitized allowlisted in-process dispatch, shared parent pool.
- `apps/api/src/http/routes/hosted-mcp.ts`: canonical host/origin, OAuth-only gate, explicit protocol CORS, connection rate limits, outer deadline and true work-lifetime callback.
- `apps/api/src/http/app.ts`, `middleware/auth.ts`, `routes/cards.ts`, `adapters/activity.ts`: mounted metadata/OAuth/MCP, trusted context propagation, OAuth credential locking and stable connection-scoped create receipts, `mcp_oauth` activity source. Private children bypass the ordinary soft IP throttle and ordinary Hono deadline so the outer lifetime tracks real transaction settlement.
- Focused tests: package client/server/artifact tests; API `hosted-mcp-transport.test.ts`, `hosted-mcp-worker.test.ts`, `hosted-mcp-mounted.test.ts`.
- Package manifests/exports/declarations/build order are parent-owned. OAuth adapters/routes/config/rate map and Worker lifecycle are Auth-builder-owned.

## Executed evidence and limits

- Earlier protocol slice passed root typecheck, MCP21/21, DB-free protocol8/8, actual local workerd protocol1/1, packed stdio executable1/1. Those commands preceded later runtime assembly changes.
- Root typecheck passed after assembly, before the latest mounted-test additions and final abort-signal repair.
- Mounted unique-schema PostgreSQL run passed6/7: full app OAuth consent/token; OAuth/PAT/cookie/REST refusal; explicit CORS/discovery; roles/scopes/sibling boards; max-one-connection dispatch; stable create replay across refresh and safe provenance; disconnect; streamed128KiB and slow-body deadline; per-connection protocol/create limits. Log: `logs/mounted.log`.
- A later focused run passed the real mounted create/disconnect race in both lock orders on separate PostgreSQL connections. Its command output is in this chat; no separate persisted log was captured before pause.
- Actual production Worker+PostgreSQL create/replay remains **failing**. Initially canonical-host enforcement refused Wrangler's default loopback host. Test config now uses documented `dev.host` and `upstream_protocol:'https'`, which reaches the tool. Current failure is the safe requester exception: `Flowboard request failed or timed out. If a create outcome is unknown, retry with the same operationId and input.` No root cause is established. Do not weaken canonical-host checks or claim Worker integration passed.

## Required fixes/checks on resume

1. Reviewer confirmed OAuth-child streaming defect: global ordinary1MiB body buffering precedes child16KiB parser/deadline. An unfinished17,000-byte `/api/v1/mcp/oauth/register` body does not return413/504 until closed. Root/reviewer evidence: `independent-backend-review/oauth-body-probe.{mjs,log}`. Parent must coordinate app/auth-route ownership for bounded cancellable child parsing/deadline and true token-transaction retention. No repair was made during pause.
2. Reviewer confirmed already-aborted MCP body signal could be missed when outer timeout occurs during auth/rate before body reading. A last source repair checks `request.signal.aborted` before and after listener registration and cancels the body. **Not tested yet.** Add regression including delayed verification/rate, an unfinished body, no tool dispatch and settled lifetime.
3. Diagnose the actual Worker injected-requester exception without logging raw credentials/headers/DB errors. The Node full app and pool-max1 path pass; actual Worker path remains mandatory.
4. Add remaining current membership/board-grant revocation and transaction/deadline evidence as required by the frozen spec/reviewer, run focused checks and required regressions, then hold an exact manifest for independent review. No backend gate pass/handoff exists for this assembled source.

## Safe resumption runner pattern

Use the parent-approved local harness configuration from `/private/tmp/flowboard-hosted-mcp-test-env.json` only inside the process; never print its values. `DATABASE_URL` points to the disposable local PostgreSQL harness. Tests create/drop only their uniquely named schema. Parent may stop its Docker container while paused; restart/identity verification must precede resumed DB tests.

Next focused command, after the user resumes and ownership is coordinated: use the existing backend `run-focused.mjs` pattern to spawn Node with that private configuration and `NODE_ENV=test`, running `apps/api/test/hosted-mcp-mounted.test.ts`; record all output under this transport evidence folder. Loopback Worker/PostgreSQL checks require sandbox escalation with their existing synthetic/local-only justification.

## Process cleanup at pause

All builder exec sessions completed; latest session20063 exited1. Test `finally` blocks closed the Worker harness, removed temporary configuration, rolled back/closed separate clients, removed the temporary trigger/function and dropped the unique schema. No builder-owned background process or open test transaction is known. Parent owns disposable Docker shutdown. No production/UAT write occurred.
