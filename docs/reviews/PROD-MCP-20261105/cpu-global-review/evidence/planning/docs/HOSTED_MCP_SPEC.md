# Hosted MCP connector — accepted direction and implementation contract

2026-11-04. The user explicitly selected the proposed hosted browser-sign-in connector and authorized parallel implementation, testing and UAT-only deployment. This document freezes implementation choices before source assembly; it is not delivery approval. Existing UAT application candidate is d1c81f4; documentation baseline b19549c and branch codex/hosted-mcp-browser-signin preserve the preceding work. The user subsequently reported the existing Claude/UAT connection working; this is owner-reported baseline acceptance, not proof of the new hosted browser flow.

## Outcome and boundaries

A colleague adds one HTTPS connector URL in Claude, signs into Flowboard through the existing Google flow, explicitly chooses one project and approves the requested permissions. No repository, Terminal, Node installation, JSON editing or copied bearer token is needed. The server checks the human's current project membership and board grants on every operation. Owner inheritance remains unchanged. Choosing a project never grants new board access.

Keep the modular Hono/Worker API, PostgreSQL, same-origin Pages proxy and installed MCP SDK1.32.2. The existing stdio/PAT setup and ordinary browser API continue working. Exactly the five existing discovery/search/create tools are exposed. No existing-card MCP update, company client_credentials, arbitrary REST proxy, microservice, remote file access or automatic project choice is added.

## Public contract

O is validated explicit APP_ORIGIN (test override only for isolated loopback). Issuer=O; resource=O+'/api/v1/mcp'. Never derive them from Host or forwarded headers. SDK protocol compatibility is the installed SDK's supported versions including2025-11-25; do not claim the complete2026protocol.

| Endpoint | Behavior |
|---|---|
| POST /api/v1/mcp | Streamable HTTP, OAuth bearer only, authentication before SDK; no cookie/PAT/query-token fallback. Fresh stateless server per request, JSON responses. |
| GET/DELETE /api/v1/mcp | Valid authentication then405; no cross-user server session or persistent SSE. |
| GET /.well-known/oauth-protected-resource/api/v1/mcp | Resource metadata with exact resource/issuer; root protected-resource alias allowed. |
| GET /.well-known/oauth-authorization-server | Issuer metadata and endpoints; Pages forwards exact metadata paths without browser sign-in. |
| GET /api/v1/mcp/oauth/authorize | Validate code/S256/client/redirect/resource/scope/state; create short-lived browser-bound opaque request, redirect to O/connect?request=ID. GET cannot grant access. |
| POST /api/v1/mcp/oauth/register | Bounded public-client DCR, only exact hosted Claude callback. No secret, arbitrary callbacks or metadata fetch. |
| POST /api/v1/mcp/oauth/token | Standard form-urlencoded OAuth code/refresh responses, no API envelope. PKCE/client/redirect/resource binding. |
| POST /api/v1/mcp/oauth/revoke | Non-disclosing standard revocation; exact client binding, revoke connection/family/access. |
| GET /api/v1/mcp/authorization-requests/:id | Cookie session plus request browser binding; safe view from shared contracts; bounded project choices and optional projectCursor paging. |
| POST /api/v1/mcp/authorization-requests/:id/decision | Session, strict Origin, one-use CSRF and actor/browser/request binding. Shared decision schema; backend chooses exact stored callback. Returns {data:{redirectUrl}} for top-level navigation. |
| GET /api/v1/mcp/connections | Session-only safe own connection list;20active connection cap makes bounded listing usable. |
| DELETE /api/v1/mcp/connections/:id | Session-only own disconnect, Origin protected, idempotent204. |

OAuth authorization code with S256 PKCE binds a temporary code to the client that initiated sign-in. CIMD verifies public client metadata rather than making a user register credentials. Support CIMD for strict HTTPS origin claude.ai, non-root metadata URL, no port/credentials/query/fragment/redirects; fetch at most32KiB within3seconds, validate document client_id exactly and hosted callback exactly https://claude.ai/api/mcp/auth_callback. Render self-asserted name as text with client/redirect origins; do not claim client verification. Bounded DCR is a compatibility fallback; public client registration is not proof that a caller is Anthropic. Do not allow loopback callbacks in hosted v1; isolated tests may explicitly inject their callback only under NODE_ENV=test.

Known scopes: projects:read, boards:read, cards:read, cards:create; optional offline_access records persistence intent. No unknown scope/grant accepted. Scopes never override role/board access. Consent names persistence and the selected project. Use short-lived opaque access tokens and rotated opaque refresh tokens; hash credentials at rest. Request TTL10minutes, code5minutes, access15minutes, refresh family30days absolute. Concurrent code redemption has one winner. Refresh reuse revokes its family and successors, and the revocation must commit even when returning invalid_grant. Wrong-client attempts cannot revoke another connection. Logout ends the browser session; Disconnect ends the continuing MCP connection.

Create receipts are bound to stable connectionId plus operationId, not changing access-token IDs. Reuse after refresh must return the same card; changed input conflicts. Keep existing seven-day receipt lifetime and transaction ordering: credential/access lock, live project/board/assignee locks, receipt, card and safe mcp_oauth activity provenance in one transaction. No raw credential, code or verifier in logs, receipts, activity or browser storage.

## Internal operation boundary

Reuse existing mounted six-capability API behavior, projections, schemas and card transaction through an in-process dispatcher. A module-private WeakMap binds newly constructed Request object identity to {principal,pool}; no caller header, cookie, env string or body can create that capability. Strip Authorization/Cookie and permit only the existing capability allowlist. Legacy authType='token' means restricted machine capability; machineCredentialKind distinguishes personal_access_token from mcp_oauth. OAuth connection/access IDs must never be looked up as a PAT or minted into a PAT.

Internal dispatch reuses the parent's request pool through trusted object identity. Outer OAuth verification releases queries before dispatch; never hold a transaction while reacquiring the Worker's single connection. Each tool route still checks scopes and selected project; writes recheck live OAuth connection/access under lock. External OAuth credentials remain invalid on every ordinary REST/session/admin route. Caller-supplied identity headers or cloned HTTP requests cannot impersonate internal dispatch.

## Bounds, failures and tests

OAuth/consent/DCR forms16KiB; MCP128KiB (legal escaped descriptions can exceed64KiB), no batches, bounded JSON depth; safe request deadline, no raw upstream error text. Missing Origin allowed for server clients; invalid present Origin denied, allowed origins explicit. Protocol CORS does not enable cookie authentication. Protocol responses no-store, correct WWW-Authenticate/resource metadata, methods/content types/Accept tested. DCR5/minute/IP20/hour/IP, retained registration cap1000; no removal of clients with live grants. Authorize10/minute/IP; token/revoke30/minute/IP; consent10/minute/IP/user; MCP120/minute/connection and create30/minute/connection; fail closed if counters fail. Do not impose an unusable low global per-Claude-client bucket.

Mandatory evidence: actual mounted handlers with disposable PostgreSQL; separate-connection code redemption/refresh/revoke/create races; wrong client/resource/redirect/PKCE, replay/expiry/reuse, CSRF/browser/session switching, sibling project/board isolation, revoked membership/grants, OAuth-vs-PAT/cookie refusal matrix, stable retries across refresh, rollback/privacy/rate/size failures; actual Node and workerd protocol tests; browser Google-safe-next/consent/deny/disconnect; all existing required checks. Fresh independent backend/transport reviews and UI/integration checks bind immutable manifests and unchanged rubric (>8.5 and all category floors). A recorded failed/missing required check blocks deployment. Keep current UAT unchanged until new local gates pass; notify the user when promoting.

## Ownership and delivery

OAuth builder owns new adapters/hosted-oauth*, services/hosted-mcp-config.ts, routes/hosted-oauth.ts, migration0027, OAuth tests and service rate mapping. Transport builder owns packages/mcp factory/client refactor and services/hosted-mcp-transport.ts with tests. Architect owns shared schemas, private dispatch, app/auth/card/activity integration, dependency/build changes and final assembly. UI implementation follows a verified backend contract; UI planning can run now. UI owns connect/connections pages, safe-next/return paths, metadata proxy and navigation. Frozen evidence belongs under docs/reviews/HOSTED-MCP-20261104. Current baseline98 feature records remain historical as source changes; never silently reuse their manifest approvals.

Sources: [Claude auth](https://claude.com/docs/connectors/building/authentication), [custom connectors](https://claude.com/docs/connectors/custom/add-unlisted), current MCP authorization/client-registration specification and installed SDK source. DCR/CIMD choices and test protocol limits are explicit; full future protocol support is not implied.
