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

## Browser contract

Authorize creates a ten-minute request and HttpOnly/SameSite=Lax browser cookie `flowboard_mcp_authorization`, Secure on HTTPS, path `/`; it redirects to `/connect?request=<opaque>`. The existing `flowboard_session` cookie is needed to describe or decide the request. Explicit bearer credentials never substitute for a cookie session. GET binds the request to the current actor/session and rotates its one-use CSRF challenge.

GET authorization description strictly parses `hostedMcpAuthorizationViewSchema`. It returns the exact parent-owned view, excludes offline_access from displayed capability scopes, names the client as unverified, and supports `?projectCursor=<opaque>` with 100 choices/page and a cursor bound to this request/actor. POST decision strictly parses the shared input and returns only the shared `{data:{redirectUrl}}`; callback/state/issuer/code come from recorded server state. Browser UI may perform a top-level navigation to this validated result. Missing/foreign Origin, wrong binding, switched session, bad CSRF, repeat decision and expired request are denied.

Connections use the exact shared schema. New project names are replaced with `Unavailable project` after project access is lost, while the actor can still disconnect their own permission slip. Logout and Disconnect are separate actions. Ordinary MCP operations still need current board grants; this component does not grant any board access.

## Verification and limits

- Focused PostgreSQL suite: 27/27 passes, one unique schema per process on the disposable PostgreSQL 17 harness. Covers code/refresh races, family reuse revocation committed on invalid_grant, wrong-client refusal, credential/revocation blocking, safe metadata, Origin/CSRF/session/browser failures, expiry/rollback, >100 project choices, DCR limits/cap/retention and strict own connection responses.
- Root typecheck/MCP build: passes. Embedded migrations: 27 match. Own diff whitespace check: passes.
- `criteria.md` was written before implementation. `criteria.json` formalizes it against the frozen shared contract. `logs/focused.log`, `logs/static.log` and `source-manifest.json` preserve this component snapshot. Historical observed failures are retained in `development-evidence.md`.
- Safe test configuration is read in-process from `/private/tmp/flowboard-hosted-mcp-test-env.json` when DATABASE_URL is absent. Never print/copy its contents. The runner and standard URL guard require isolated synthetic local databases; no live data is used.
- Full root API regression, parent app/private-dispatch/card integration, actual Node/workerd protocol tests, browser Google-safe-next/consent and hosted Claude acceptance still belong to the final feature gate. The focused module is mounted in a real Hono harness, not yet the assembled parent application. Current old feature approvals must not be silently reused for changed shared source.

## Ownership hold

Builder-owned functional source is held after this handoff until a requested repair: new `adapters/hosted-oauth.ts`, `http/routes/hosted-oauth.ts`, `services/hosted-mcp-config.ts`, migration0027, `test/hosted-oauth.test.ts` and the OAuth additions in `services/rate-limit.ts`. The generated embedded migration file changed only via the repository generator. Parent and transport owners retain app/auth/card/activity/private-dispatch integration. The next fresh reviewer must inspect this component plus the full assembled reachable feature and update the immutable target after any integration change.
