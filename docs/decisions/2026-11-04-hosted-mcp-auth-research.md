# Hosted MCP browser authorization research — 2026-11-04

Status: proposed design for Architect contract freeze. This note is read-only research against application revision `d1c81f42fe306c352c9cb10f04883e251ead58bd`; the shared checkout has other owners' uncommitted documents. It is not an implemented OAuth server, independent approval or hosted acceptance. Only this note was written by the research agent. No secrets, cloud state or live database were read or changed.

## Actions

The user selected a hosted remote MCP connection with browser sign-in, with no terminal or copied credentials. Reuse the existing Worker, Hono application, PostgreSQL, Google sign-in, cookie session, project/board locks and five MCP tools. A person chooses one project during consent. A connection can see the boards that person is currently allowed to use in that project; it never creates membership or board grants.

Official sources checked on 2026-11-04:

- Claude supports CIMD and DCR. CIMD needs both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`; otherwise Claude looks for DCR. Claude requires a transport `401` to start sign-in, S256 PKCE, and the exact hosted callback `https://claude.ai/api/mcp/auth_callback`. Discovery/token requests have a 10-second client budget and refresh has 30 seconds. Invalid refresh uses `invalid_grant`; public-client refresh tokens rotate. [Claude authentication](https://claude.com/docs/connectors/building/authentication).
- Claude's custom connector UI supports its published identity and automatic registration. A user can therefore connect using a server URL and browser flow. [Add a custom connector](https://claude.com/docs/connectors/custom/add-unlisted).
- The current MCP specification prefers CIMD and deprecates DCR while retaining it for compatibility. CIMD requires exact document `client_id` equality and validation of the requested redirect against the document. [MCP client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration).
- Resource metadata, authorization-server metadata, OAuth 2.1 and audience-bound bearer tokens form the authorization model. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index). A transport `401` must happen before the MCP SDK wraps errors as successful tool responses. [Claude implementation guidance](https://claude.com/docs/connectors/building/lazy-authentication).

## Why and options

The grant is a revocable permission slip: Alice lets Claude work on Flowboard project A, while Flowboard still checks Alice's current board access on each operation. Signing in identifies Alice; consent names the project and capabilities Claude receives. PKCE binds the temporary authorization code to the client instance that started the flow, so stealing that code alone is insufficient.

### Recommended client identity

Use CIMD first for hosted Claude. Fetch only HTTPS client IDs from an explicit exact-origin/path allowlist for Anthropic metadata, with no redirects, credentials, query, fragment or arbitrary hostname. Require successful bounded JSON, exact `client_id`, `token_endpoint_auth_method: none`, `code` response and authorization-code support. Ignore extra provider grant types rather than enabling them. Cache validated public metadata according to its cache instructions, with a bounded cache lifetime. Render the client host and redirect host as text, not trusted HTML, logos or authority inferred from `client_name`.

Candidate hosted metadata paths found in first-party partner documentation are `https://claude.ai/oauth/mcp-oauth-client-metadata` and `https://claude.ai/api/oauth/mcp-oauth-client-metadata`. The research environment could not fetch either directly, so neither is confirmed as the currently served hosted identity. Do not fabricate its JSON or fall back to trusting an unresolved client. The live client request and fetched JSON must select the exact allowed URL before hosted acceptance. Claude Code has a separately documented identity; native loopback support is outside the hosted-app v1 scope and must not silently relax hosted redirect matching.

A bounded DCR fallback is a reasonable compatibility option if Architect requires it now. It adds client rows and registration abuse handling. It is not required by current Claude when CIMD is correctly advertised. Static client IDs/secrets require extra user setup; a PAT requires copied credentials. Neither fits the chosen setup as well. No company `client_credentials`, card updates, account impersonation or new microservice is included.

### One canonical public origin

Let `O` be an explicitly configured HTTPS public Flowboard origin and `R = O + '/mcp'`. These values must come from validated runtime configuration, never request `Host`, forwarded headers, or caller input. Serve the frontend, consent API, MCP endpoint and OAuth routes under `O`; Pages can proxy those routes to the existing Worker. That avoids a workers.dev cookie being unavailable when the consent page calls pages.dev. Do not mix public origins or redirect authenticated MCP requests across hosts. Local HTTP is allowed only in a declared isolated test environment.

Proposed exact paths for contract freeze:

| Method/path | Authorization and behavior |
|---|---|
| `POST /mcp` | OAuth MCP bearer only; reject query tokens, PATs and cookie-only requests. Authenticate before SDK dispatch. Existing five tools only. |
| `GET /mcp`, `DELETE /mcp` | Authenticate before either explicit unsupported-method response or supported transport handling; no unauthenticated data or persistent cross-user session. |
| `GET /.well-known/oauth-protected-resource/mcp` | Public metadata for exactly `R`; root `/.well-known/oauth-protected-resource` is an identical alias. |
| `GET /.well-known/oauth-authorization-server` | Public metadata with issuer exactly `O`. |
| `GET /oauth/authorize` | Validate OAuth parameters and client before creating a short-lived pending browser request; redirect to `O/mcp/connect?request=<opaque>`. Never grant on GET. |
| `GET /api/v1/mcp/authorization-requests/:requestId` | Existing cookie session plus bound browser cookie; bind the pending request to this actor/session and return safe client, requested scope, accessible project choices, CSRF challenge and expiry. |
| `POST /api/v1/mcp/authorization-requests/:requestId/decision` | Session only, strict trusted Origin, one-use CSRF and browser binding; `{decision:'allow'|'deny', projectId?, csrfToken}`. Return `{data:{redirectUrl}}` for top-level navigation. Never allow caller-supplied redirect/client/scope values here. |
| `POST /oauth/token` | Bounded form-urlencoded authorization-code or refresh exchange; public-client `client_id` required, no cookie fallback. Standard OAuth response/error JSON, no API `{data:...}` wrapper. |
| `POST /oauth/revoke` | Token possession plus exact client binding; RFC 7009-style non-disclosing success for unknown tokens. Revoke the connection/family and its access tokens. |
| `GET /api/v1/mcp/connections` | Session-only bounded safe list of the actor's connections; no token hashes or raw credentials. |
| `DELETE /api/v1/mcp/connections/:connectionId` | Session-only, Origin protection; revoke only the actor's connection. Idempotent `204`. |
| `POST /oauth/register` | Only if DCR compatibility is selected; do not advertise an unimplemented endpoint. |

Suggested discovery fields: resource `{resource:R, authorization_servers:[O], bearer_methods_supported:['header'], scopes_supported:[projects:read,boards:read,cards:read,cards:create]}`; issuer metadata includes `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `response_types_supported:['code']`, `grant_types_supported:['authorization_code','refresh_token']`, `token_endpoint_auth_methods_supported:['none']`, `code_challenge_methods_supported:['S256']`, `client_id_metadata_document_supported:true`, and the four capabilities plus `offline_access`. Include authorization response `iss=O` and advertise `authorization_response_iss_parameter_supported:true`. The `401` challenge includes `resource_metadata` pointing to the path-specific document and the four v1 scopes. Reject unsupported scopes/grants rather than broadening them.

### Browser request and code binding

Validate single values for `response_type=code`, `client_id`, `redirect_uri`, `resource=R`, requested scopes, `code_challenge` and `code_challenge_method=S256`. Reject duplicate parameters, fragments, credentials, unknown response modes and malformed/oversized values. Require the S256 challenge to be 43 base64url characters; verify a 43–128-character RFC 7636 verifier at exchange. Preserve a bounded optional OAuth `state` exactly; the client owns its state validation. State never substitutes for consent CSRF.

Redirects use exact byte equality against validated hosted client metadata plus the explicitly permitted hosted callback. No wildcard, prefix or suffix matching. Validate the redirect before any redirect error response; otherwise return a local error. A denied valid request redirects only to its recorded callback with `error=access_denied`, original state if supplied, and `iss`. A successful decision redirects with a fresh code, state and issuer only.

Generate separate cryptographically random 32-byte request handle, browser binding and CSRF challenge; store hashes only. The binding cookie is Secure, HttpOnly, SameSite=Lax, `Path=/`, ten-minute lifetime. Cookie session is the existing `flowboard_session`. Bind consent to request, browser binding, actor and current session hash; allow one decision. Recheck the live session and project authority inside the grant transaction. Preserve only `/mcp/connect?request=<bounded opaque>` through the existing Google `next` allowlist; do not whitelist arbitrary authorization query strings. A changed login or another browser must restart consent. Use `no-store`, `Referrer-Policy:no-referrer`, CSP/frame protections and no third-party content on consent; pending handles, codes and tokens must never enter application telemetry.

## Proposed migration 0027

`database/migrations/0027_hosted_mcp_oauth.sql` is additive PostgreSQL only; regenerate the existing embedded migration module with the owner script. No changes to migrations 1–26. All times use `TIMESTAMPTZ` and database `clock_timestamp()` for expiry decisions. Token/code/request hashes are unique lowercase SHA-256 hex with a 64-character shape constraint. No raw access/refresh/code/CSRF/browser-binding values in tables, receipts, audit, outbox or logs.

| Table | Fields and constraints |
|---|---|
| `mcp_oauth_authorization_requests` | `id` random row ID PK; `request_hash UNIQUE NOT NULL`; `client_id TEXT NOT NULL`; `redirect_uri TEXT NOT NULL`; `resource TEXT NOT NULL`; `scopes TEXT[] NOT NULL`; `state TEXT NULL`; `code_challenge TEXT NOT NULL`; fixed `code_challenge_method='S256'`; `browser_binding_hash NOT NULL`; `csrf_hash NULL` until session bind; `user_id NULL REFERENCES users ON DELETE CASCADE`; `session_hash NULL`; `expires_at NOT NULL`; `decided_at NULL`; `created_at NOT NULL`. Request payload becomes immutable once created. |
| `mcp_oauth_connections` | `id TEXT PK` stable connection/family identity; `user_id NOT NULL REFERENCES users ON DELETE CASCADE`; `project_id NOT NULL REFERENCES projects ON DELETE CASCADE`; `client_id TEXT NOT NULL`; `resource TEXT NOT NULL`; nonempty allowlisted `scopes TEXT[]`; `created_at`, `expires_at` (absolute family bound), `last_used_at`, `revoked_at NULL`, bounded `revocation_reason NULL`. One project per row. No board-grant snapshot. |
| `mcp_oauth_authorization_codes` | `id TEXT PK`; `code_hash UNIQUE NOT NULL`; `request_id UNIQUE NOT NULL REFERENCES ...requests`; `connection_id NOT NULL REFERENCES ...connections`; immutable `client_id`, `redirect_uri`, `resource`, `code_challenge`, `scopes`; `expires_at NOT NULL`; `consumed_at NULL`; `created_at NOT NULL`. Retain consumed rows briefly for replay detection, never reuse a request/code. |
| `mcp_oauth_access_tokens` | `id TEXT PK`; `token_hash UNIQUE NOT NULL`; `connection_id NOT NULL REFERENCES ...connections ON DELETE CASCADE`; `scopes TEXT[] NOT NULL`; `resource TEXT NOT NULL`; `expires_at NOT NULL`; `revoked_at NULL`; `created_at NOT NULL`. Verify token plus live connection; no JWT/signing-key service needed. |
| `mcp_oauth_refresh_tokens` | `id TEXT PK`; `token_hash UNIQUE NOT NULL`; `connection_id NOT NULL REFERENCES ...connections ON DELETE CASCADE`; `parent_id NULL REFERENCES same table`; `replaced_by_id NULL REFERENCES same table`; `expires_at NOT NULL`; `consumed_at NULL`; `revoked_at NULL`; `created_at NOT NULL`. Partial unique index on `connection_id WHERE consumed_at IS NULL AND revoked_at IS NULL` prevents two live leaves; unique non-null `parent_id` prevents forks. Keep spent hashes through family expiry to detect replay. |

Indexes: request `(expires_at,id)`; connection `(user_id,created_at DESC,id)` and `(project_id,user_id)` plus `(expires_at,id)`; code `(connection_id)` and `(expires_at,id)`; access `(connection_id)` and `(expires_at,id)`; refresh `(connection_id)` and `(expires_at,id)`. Unique hash constraints already supply lookup indexes; no duplicate hash index. Check TTL ordering (`expires_at>created_at`) and allowlisted subset cardinality/duplicates. Bound state 1,024, client/redirect/resource 2,048 characters and four capability scopes plus optional offline consent. Optional DCR adds `mcp_oauth_clients(client_id PK, redirect_uris TEXT[], client_name, allowed_grant_types, token_endpoint_auth_method='none', created_at, expires_at)` with at most five redirects and no secret, remote-logo fetch or dynamic metadata mutation.

Suggested explicit v1 policy, not a standards mandate: pending request 10 minutes; authorization code 2 minutes; access token 15 minutes; refresh 7-day idle expiry and 30-day absolute family expiry; 20 active connections/user; one-use rotation with no grace retry. Require `offline_access` consent before issuing refresh. A lost refresh response may require reconnecting because retrying a spent refresh revokes the family; document that deliberate fail-closed tradeoff.

### Atomicity and revocation

1. Consent: transaction locks pending request, checks browser/session/CSRF/project, uses per-user advisory issuance lock for the active-connection cap, and creates connection plus code while marking the request decided. A second decision creates nothing.
2. Code exchange: lock connection then code in that order, verify client/redirect/resource/PKCE/expiry and current project authority, consume code and insert access plus refresh in the same transaction. Wrong binding must never consume a legitimate code. A reused validly bound code returns `invalid_grant`; revoke any already-issued connection tokens as the chosen replay policy.
3. Refresh: resolve token hash without changing it; lock connection then refresh row. Verify client, resource, family/idle expiry and authority. In one transaction mark old token consumed and insert the sole successor plus new access token. Reuse of an otherwise correctly bound spent token revokes the entire connection/family; commit that revocation before returning `invalid_grant`. Throwing an error that rolls back the revocation is a security bug. A wrong-client attempt does not revoke another client's family.
4. Resource operation: hold connection `FOR SHARE` and access-token `FOR SHARE` through authorization/read assembly or card/receipt/activity commit. Then use existing workspace → membership → board-grant → board/card order. Revoke updates the connection and conflicts with the shared lock. After revocation commits, no new authorized operation or receipt replay can succeed. Existing in-flight operations may finish before the revocation transaction wins; this is the defined linearization point.
5. Request/code cleanup may use bounded batches. Do not delete spent refresh hashes while the family could still be used, and do not delete a connection whose identity is needed for a seven-day create receipt. A soft-revoked connection can remain without raw private data. Ordinary Flowboard logout and Disconnect are separate actions; only Disconnect revokes a continuing MCP grant unless the product explicitly chooses logout-all behavior.

### Existing source reuse and required narrow changes

| Existing source | Reuse or constraint |
|---|---|
| `apps/api/src/http/routes/google-auth.ts`, `session.ts`; `adapters/session.ts` | Existing Google sign-in and cookie session. Never give Google access/refresh tokens to MCP or make MCP tokens interchangeable with a user session. |
| `apps/api/src/http/safe-next.ts` and web `signin/page.tsx` | Existing safe return path; add only the bounded consent route. |
| `http/middleware/auth.ts`, `token-policy.ts`; `adapters/tokens.ts` | PAT bearer is globally enforced before routing; it currently rejects all other bearer shapes. Keep external `/api/v1` PAT behavior unchanged. Add an explicit `/mcp` OAuth gate before incompatible PAT parsing; reject mixed credential use and cookie fallback. Reuse the capability allowlist, not broad UI route access. |
| `adapters/board-grants-foundation.ts`, `rbac.ts`, `http/middleware/rbac.ts` | Live Owner inheritance and non-Owner active membership AND board grant. Use `lockProjectBoardReadScope`, `lockBoardAccess` and current write-grant helpers; no project-only shortcut. |
| `http/routes/cards.ts` create transaction | Extract a reusable application operation preserving credential lock, membership/grant locks, selected-assignee validation, receipt, card and activity commit. Current code hardcodes `lockPersonalAccessToken` and PAT provenance; introduce a typed PAT/OAuth principal and matching lock without faking a PAT. |
| Current projects/boards/search adapters and route projections | Reuse bounded data/metadata projections. A connection's list-projects tool returns only its bound project. List/search excludes hidden/archived boards and deleted cards as now required. |
| `packages/mcp/src/{index,schemas,client}.ts` | Preserve the five tool names/input validation and untrusted-content descriptions. Separate reusable tool registration from the stdio executable as needed; retain stdio/PAT compatibility. No updates, arbitrary API fetch or administration tools. |
| `services/rate-limit.ts`, `adapters/rate-limit-postgres.ts` | Reuse shared atomic fixed-window counters. Add OAuth paths explicitly: current mappings cover Google/API writes, not `/oauth/*` or `/mcp`. |
| `runtime/worker.ts`, `adapters/postgres.ts` | Worker owns one request-scoped PostgreSQL connection. Do not start an internal HTTP/app request while holding that connection. Shared operations receive the same client/transaction; avoid nested pool acquisition. |

For stable create retries, use `oauth:${sha256([connectionId,operationId])}` rather than the changing access-token ID. Recheck the live connection, project membership and board grant before receipt replay. This preserves one logical create across 15-minute access renewal and refresh rotation. New consent creates a new connection; it does not silently reuse another connection's receipts. Keep safe provenance `{type:'mcp_oauth', credentialId:connectionId, operationIdHash}` without bearer values.

### Rate and size bounds to freeze

Proposed fail-closed database windows: authorize 10/minute/IP; consent decisions 10/minute/IP plus 10/minute/user; token exchanges 30/minute/IP and 30/minute/client; revocation 30/minute/IP; MCP 120/minute/connection and card creation 30/minute/connection plus existing write controls. Metadata can use a generous edge bound without cookies or DB access. If DCR is included: 5/minute/IP, 20/hour/IP and a global retained-row cap/expiry; reject rather than silently dropping a live registration. Do not rate-limit all users under one client identity to an unusably low shared value; per-client limits should be checked against actual hosted traffic before enabling broadly.

Bodies: token/revoke/consent/DCR ≤16 KiB; MCP JSON ≤64 KiB, no JSON-RPC batches, bounded parse depth; metadata response ≤32 KiB, fetch timeout ≤3 seconds, no redirect following. Code/refresh lookup and transaction have a bounded deadline under Claude's 10-second initial-exchange budget. Use `429` plus `Retry-After`; counter/configuration failure denies sensitive work with `503`, and never creates a partially issued token. Operational logs contain only event, request ID, safe row IDs, outcome category and bounded timings.

## Evidence and limits

Source inspection confirms existing five stdio tools, the six-route PAT capability boundary, live board-grant locks, hashed PAT storage, card create's PAT lock/receipt/provenance coupling, one-connection Worker pool and PostgreSQL migration mechanism. No OAuth implementation or tests were run in this pass. The official public metadata URLs were inaccessible from the research fetch environment; browser-client identity and provider behavior require hosted evidence.

Required abuse/acceptance matrix for the frozen contract:

| Area | Required checks |
|---|---|
| Discovery/client | Exact issuer/resource; no Host injection; true 401 challenge; metadata accessible without session; CIMD public method advertised; unknown/private/redirecting/oversized/mismatched metadata refused; document names escaped. |
| Authorization | Missing/duplicate/oversized fields; wrong response/grant/method/scope/resource; missing PKCE; plain challenge refused; callback suffix/prefix/encoding/query/fragment tricks; error never redirects to unvalidated target. |
| Browser consent | No session, PAT-only, OAuth-only, cross-origin/missing-origin, wrong browser, wrong actor/session, expired handle, invalid CSRF, GET cannot grant, double allow/deny race; Google safe-next roundtrip; logout/session switch requires restart. |
| Code | Wrong client/resource/redirect/verifier, expiry boundary, missing code, concurrent exchange on separate PostgreSQL connections, replay after issuance, rollback fault injection leaves no usable partial tokens. |
| Refresh | Wrong client/audience, family/idle expiry, concurrent rotation gives no fork, replay revokes successor and access, revocation commits despite `invalid_grant`, wrong-client attempt cannot revoke victim, lost-response reconnect behavior. |
| Authority | Owner with no membership; manager/member/viewer; membership absent/revoked; zero board grants; sibling/foreign project, board and cursor; hidden-board names/counts/cards absent; archive/delete; revoke grant/member versus read/create/receipt on separate connections. |
| Capability | Exactly five tools; OAuth bearer rejected by REST/session/token/admin/image/import routes; PAT/cookie rejected at `/mcp`; token cannot mint consent or another grant; resource indicators required and no token passthrough. |
| Create retries | Same operation/input once; changed body conflict; concurrent duplicate once; renewal/rotation keeps connection receipt identity; access loss before replay denies; card, receipt and safe provenance roll back together. |
| Runtime/operations | Embedded/filesystem migration parity and second-run safety; real PostgreSQL locks, not SQLite; Node/Worker transport; one-connection pool no deadlock/leak; rate/size/timeout failure; redaction across logs/errors/receipts; signed-in Claude reconnect/refresh/disconnect. |

## Next / your input

Architect freezes public paths/origin, CIMD-only versus bounded DCR fallback, scope defaults and the typed shared-operation boundary before parallel source editing. Then implement, test with isolated synthetic PostgreSQL, freeze a complete reachable-source manifest and obtain the fresh independent acceptance review required by `BACKEND_REVIEW_GATE.md`. Keep current UAT `d1c81f4` tests separate from the new candidate. No action needed from the user for this research step.
