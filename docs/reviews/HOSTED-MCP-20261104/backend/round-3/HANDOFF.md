# Hosted OAuth backend component handoff

Status: implemented and locally verified component; fresh independent acceptance and whole-application integration are pending. No self-score, source commit, push, cloud write or UAT deployment was performed. Existing UAT d1c81f4 remains separate.

## Imports for assembly

```ts
import { createHostedOAuthRoutes } from './http/routes/hosted-oauth.ts';
import { getHostedMcpConfig } from './services/hosted-mcp-config.ts';
import {
  verifyHostedAccessToken,
  lockHostedOAuthCredential,
  type HostedOAuthPrincipal,
} from './adapters/hosted-oauth.ts';
```

`createHostedOAuthRoutes({publicOrigin?:string})` returns a Hono route module containing the full `/api/v1/mcp/...` paths from `docs/HOSTED_MCP_SPEC.md`. Mount with `app.route('', ...)`. `getHostedMcpConfig(c, originOverride?)` returns `{origin, issuer, resource, authorizationEndpoint, tokenEndpoint, registrationEndpoint, revocationEndpoint}`. The explicit loopback HTTP/port override works only in `NODE_ENV=test`; normal APP_ORIGIN must be a canonical HTTPS origin without a port. Request Host/forwarded headers never select issuer/resource.

`verifyHostedAccessToken(pool, rawToken, resource): Promise<HostedOAuthPrincipal|null>` accepts only `flw_mcp_access_` plus 64 lowercase hex characters. It verifies hash, access/family expiry and revocation plus exact audience. The returned principal is exactly `{actor:SessionActor, connectionId, accessTokenId, projectId, scopes:TokenScope[], resource}`. It never issues or impersonates a PAT.

`lockHostedOAuthCredential(client, {connectionId, accessTokenId, userId, projectId, requiredScope, resource}): Promise<void>` requires a caller-owned transaction; it takes connection FOR SHARE then access FOR SHARE and rechecks bindings/scope/expiry/revocation. Parent dispatch must then take the ordinary live project/board grant locks and retain all locks through response assembly or receipt/card/activity commit. Never acquire another pool connection while holding the Worker's one connection. The parent must bind retry receipts to stable connectionId, not accessTokenId.

`cleanupExpiredHostedOAuth(pool, {batchSize?})` from `services/hosted-oauth-cleanup.ts` is mounted as the `hosted-oauth-retention` scheduled job before rate-window cleanup. It defaults to25 top-level records/stage, hard cap100, with SKIP LOCKED and a five-second SQL statement deadline. Four stages remove old terminal families, expired orphan requests, residual sensitive request state and expired unused clients. Entire code/refresh families remain until the connection is retained for at least seven days after the conservative terminal/last-use anchor. See [the accepted retention addendum](../../../decisions/2026-11-04-hosted-mcp-retention.md). Synthetic timestamps are backdated to test policy; no live cron timing or wall-clock retention period was observed.

Worker `onMcpWorkLifetime` joins the existing image-work lifetime: `closePoolAfterWork` retains the pool through actual settlement with rejection-safe `Promise.allSettled`, registers closure with `waitUntil` when available, and awaits closure otherwise. The transport owner supplies the actual MCP-lifetime callback. The rate map now includes `mcp-protocol`120/minute and `mcp-create`30/minute for that owner to consume.

## Browser contract

Authorize creates a ten-minute request and HttpOnly/SameSite=Lax browser cookie `flowboard_mcp_authorization`, Secure on HTTPS, path `/`; it redirects to `/connect?request=<opaque>`. The existing `flowboard_session` cookie is needed to describe or decide the request. Explicit bearer credentials never substitute for a cookie session. GET binds the request to the current actor/session and rotates its one-use CSRF challenge. After building either callback, the decision immediately removes state/session/CSRF values and replaces the browser-binding hash with a public all-zero non-credential sentinel; the callback retains the original client state in memory.

GET authorization description strictly parses `hostedMcpAuthorizationViewSchema`. It returns the exact parent-owned view, excludes offline_access from displayed capability scopes, names the client as unverified, and supports `?projectCursor=<opaque>` with 100 choices/page and a cursor bound to this request/actor. It explicitly discloses `offlineAccess`, the 900-second access-token lifetime, 30-day absolute connection bound, and a 7-day refresh idle bound only for continuing access (`null` otherwise). Connection summaries also expose `offlineAccess`. These fields describe existing conditional token issuance; a request without offline_access still receives no refresh token. POST decision strictly parses the shared input and returns only the shared `{data:{redirectUrl}}`; callback/state/issuer/code come from recorded server state. Browser UI may perform a top-level navigation to this validated result. Missing/foreign Origin, wrong binding, switched session, bad CSRF, repeat decision and expired request are denied.

Connections use the exact shared schema. New project names are replaced with `Unavailable project` after project access is lost, while the actor can still disconnect their own permission slip. Logout and Disconnect are separate actions. Ordinary MCP operations still need current board grants; this component does not grant any board access.

## Verification and limits

- Focused suite: 42/42 passes (30 OAuth and12 retention/lifetime checks), unique schemas on the disposable PostgreSQL17 harness. In addition to prior OAuth cases, tests exercise immediate state redaction, retained expired/spent credential reuse, complete four-generation refresh-chain deletion, seven-day/last-use guards, cap/idempotence/SKIP LOCKED behavior, active client/pending request protection, the actual Node-invoked Worker scheduled entry and failure continuation, and pool closure after fulfilled/rejected work. This is not native workerd cron/provider acceptance.
- Root typecheck/MCP build: passes. Embedded migrations: 27 match. Own diff whitespace check: passes.
- `criteria.md` was written before implementation. `criteria.json` formalizes it against the frozen shared contract. `logs/focused.log`, `logs/static.log` and `source-manifest.json` preserve this component snapshot. Historical observed failures are retained in `development-evidence.md`.
- The first component snapshot and27-test evidence remain under `round-1/`; the persistence repair and29-test evidence remain under `round-2/`. Independent operations review then required bounded retention and immediate state removal. The current snapshot includes that accepted scope extension and requires fresh review; no older approval is reused.
- Safe test configuration is read in-process from `/private/tmp/flowboard-hosted-mcp-test-env.json` when DATABASE_URL is absent. Never print/copy its contents. The runner and standard URL guard require isolated synthetic local databases; no live data is used.
- Full root API regression, parent app/private-dispatch/card integration, actual Node/workerd protocol tests, browser Google-safe-next/consent and hosted Claude acceptance still belong to the final feature gate. The focused module is mounted in a real Hono harness, not yet the assembled parent application. Current old feature approvals must not be silently reused for changed shared source.

## Ownership hold

Builder-owned functional source is held after this handoff until a requested repair: `adapters/hosted-oauth.ts`, `http/routes/hosted-oauth.ts`, `services/hosted-mcp-config.ts`, `services/hosted-oauth-cleanup.ts`, migration0027, both `test/hosted-oauth*.test.ts` files, `runtime/worker.ts` and the OAuth/MCP additions in `services/rate-limit.ts`. The generated embedded migration file changed only via the repository generator. Parent and transport owners retain app/auth/card/activity/private-dispatch integration. The next fresh reviewer must inspect this component plus the full assembled reachable feature and update the immutable target after any integration change.
