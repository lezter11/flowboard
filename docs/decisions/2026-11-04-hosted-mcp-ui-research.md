# Hosted MCP consent UI — research and proposed contract

Date: 2026-11-04. Owner: UI research. **Draft; design coverage only.**

The parent task authorizes a hosted connector for colleagues who should only add a URL, sign in, choose one project and approve. This document records source findings and a proposed UI boundary. It does not approve an OAuth implementation, change the existing API contract, or establish hosted acceptance. Backend contract, source manifest, passing independent review and handoff must precede UI implementation under RULES.md and docs/handoffs/README.md.

## Current evidence

Source inspected at `d1c81f42fe306c352c9cb10f04883e251ead58bd`. Root planning/handoff documents have existing uncommitted changes owned by other work; their status is not inferred from this SHA. No application source was edited by this research task.

| Existing path | Observed behavior and integration consequence |
| --- | --- |
| `apps/web/next.config.ts:4` | Next static export is enabled for deployment. A query-based `/connect` page fits existing `/board?id=…` routing without a dynamic server-rendered page. Local rewrites currently cover `/api/*` only. |
| `apps/web/functions/api/[[path]].ts:14` | The same-origin Pages proxy forwards `/api/*` through the Worker service binding, preserves the visible Pages URL and uses manual redirects. Browser calls can keep the existing HttpOnly session cookie. |
| `apps/web/functions/_middleware.ts:30` | Invitations are self-guarded; unknown paths otherwise redirect to sign-in or a landing page. `/connect` and any backend root discovery/OAuth/MCP paths need deliberate routing coverage. |
| `apps/web/src/lib/return-path.ts:6` | Client sign-in return paths allow known pages and a single resource ID. A consent request handle and `settings?tab=connections` would currently be dropped. |
| `apps/api/src/http/safe-next.ts:37` | API sign-in return paths have a fixed allowlist and reject external URLs, encoded bytes, controls and backslashes. `/connect` is absent. Add narrow route-specific parsing; do not widen this to arbitrary URLs. |
| `apps/api/src/http/routes/google-auth.ts:89` | Google start stores the validated return path in an HttpOnly OAuth-state cookie and validates it again on callback. Callback failures currently return `/signin?state=…` without the return path. |
| `apps/web/src/app/signin/page.tsx:22` | The Google link passes `next` to the API. Browser code does not exchange Google tokens. Preserve this ownership boundary. |
| `apps/web/src/components/shell/session-gate.tsx:12` | Only sign-in/invitation routes handle their own signed-out states. An already-signed-in visitor to `/signin` is sent to their landing page. |
| `apps/web/src/components/shell/app-shell.tsx:18` | Bare pages avoid the project rail. The name-confirmation step replaces page content without changing its address, so a pending consent handle can survive it. |
| `apps/web/src/app/settings/page.tsx:27` | Settings already supports query-selected tabs, account controls and shared panel styles. Add a personal Connections tab without requiring a selected project. |
| `apps/web/src/components/shell/rail.tsx:146` | Project Settings navigation lives under Manager/Owner controls. This alone is insufficient for personal connection management by Members/Viewers. |
| `apps/web/src/components/shell/user-menu.tsx:71` | Every signed-in person has an account Settings link. A Connections link can use the same menu, avoiding another top-level rail group. |
| `apps/web/src/lib/api.ts:105` | API helpers use same-origin credentials, structured errors and Retry-After. The existing generic request helper follows redirects; it must not be used for an approval endpoint that responds with an offsite redirect. |
| `apps/web/src/lib/session.tsx:28` | Session identity changes clear protected queries. New consent/grant queries must be actor-scoped and included in that removal behavior. |
| `apps/web/src/lib/navigation-state.ts:1` | Draft navigation scope compares resource query keys, not consent handles. Do not store consent selections in the protected draft subsystem; if this page ever gains retained drafts, request identity must be a scope boundary. |
| `apps/web/public/_headers:2` | Current CSP permits same-origin connections/forms, blocks frames and external scripts. Keep client branding text-only and avoid remote client logos. A cross-origin redirect following a native form POST requires an actual-browser check against this policy. |
| `packages/contracts/src/tokens.ts:4` | Existing capabilities are `projects:read`, `boards:read`, `cards:read`, `cards:create`. Existing PAT issuance returns a raw token once; do not reuse that issuance response for the browser consent UI. |
| `packages/mcp/src/index.ts:24` | Existing MCP exposes exactly five tools: list projects, list boards, get board columns, search cards and create card. No update-card or company credential setup is part of this UI. |

Read alongside PRD.md, ARCHITECTURE.md, DESIGN.md, TASKS.md, PROGRESS.md, docs/FEATURE_SPEC.md, docs/FEATURE_CHECKLIST.md, docs/IMPORT_SPEC.md, docs/API.md, docs/ENGINEERING_CHECKLIST.md and docs/references/README.md. Older D1, inherited board access and prototype-only claims in those documents remain superseded by the current project-plus-board boundary and exact-source handoffs.

## Recommended approach and alternatives

Use a bare, same-origin `/connect?request=<opaque-handle>` page and Settings → Connections at `/settings?tab=connections`. Reuse the current session provider, Google sign-in, name confirmation, wordmark, buttons, panel styles and error notes. The backend stores the full authorization request before redirecting to `/connect`; the page receives only its short-lived handle.

For example, Priya approves Website for a connector. The stored grant limits that connector to Website and to Priya's current role and board grants. Selecting Website does not reveal Operations, grant a hidden Website board, or permit a Viewer to create cards. UI disclosure helps Priya decide; server checks enforce the limit on every tool call.

Alternatives: rendering consent entirely in the backend would reduce frontend routing work but duplicate the existing UI/session presentation. Returning an external callback URL in JSON is workable only with exact backend validation, but puts more redirect handling in browser code. The proposed same-origin completion hop keeps the final callback and authorization code on the backend. Final endpoint names and completion behavior belong to the parent contract.

## Consent flow and copy

1. The colleague adds the published hosted MCP URL in their connector app. Its authorization request reaches the backend, which validates it, stores it with expiry and browser/session binding, then redirects to `/connect?request=…`.
2. With no Flowboard session, show “Connect to Flowboard” and “Sign in to choose the project this connection can use.” Offer the existing “Continue with Google” control, with a constructed same-app return path. Do not show private client/project details until the backend permits them.
3. After sign-in and any existing name-confirmation step, load canonical consent details using the request handle. Display “Connect {client display name} to Flowboard”, the signed-in account and a backend-derived client identity hint. Client-supplied name/description are untrusted text, never HTML or verified branding.
4. If the backend does not establish verified client identity, show: “Flowboard has not verified this app's identity. Continue only if you intended to connect it.” A client name containing “Claude” or another brand does not remove this warning. Do not display an invented verified badge.
5. Show a required native select labeled “Choose one project”, starting with “Select a project”. Require explicit choice even when only one is available. Choices and any disabled reasons come from the consent API, not a broader cached project list. Never offer “All projects”.
6. Show the exact requested permission set in plain text: “Read this project's name”, “Read names and columns of boards you can open”, “Search and read cards you can open”, “Create cards where your role allows”. Render only requested scopes, using a fixed local mapping. Unknown scopes block approval. Show “Access follows your current project role and board access.”
7. Display the backend's grant expiry policy before approval. Show “You can revoke this connection in Settings → Connections.” If all scopes form one fixed bundle, approve or deny that bundle; do not silently edit scopes with unchecked controls.
8. Explicit buttons: “Allow connection” and “Deny”. Approval is disabled until a project is selected and canonical details are current. Both actions use a CSRF-protected POST, with duplicate submission blocked. A browser GET never grants access.
9. After an acknowledged decision, navigate to a fixed same-origin backend completion URL. Only that backend endpoint redirects to the stored, exact validated callback URI with its OAuth result. For an invalid request/callback, stay on a local safe error page; never redirect to submitted input.

Do not ask the colleague to open Terminal, issue a PAT, paste a client secret or generate company credentials. Suggested onboarding copy: “Copy the Flowboard URL. In your connector app, add a custom connector and paste it. Sign in to Flowboard, choose one project, then allow the connection.” Product-specific connector labels and plan availability need verification against the actual target client before publishing those instructions.

## Proposed shared contract — parent must freeze before implementation

All UI endpoints below are session-only and return private/no-store JSON with the current `{data:…}` or `{error:{code,message,requestId,details?}}` envelope. They reject machine bearer credentials. Names are proposals, not existing routes.

| Method/path | Request | Success and ownership |
| --- | --- | --- |
| `GET /api/v1/oauth/requests/:requestId` | Opaque request ID; cookie session | Canonical pending consent view, eligible project choices, requested scopes, request expiry, proposed grant expiry and a session/request-bound CSRF nonce. |
| `POST /api/v1/oauth/requests/:requestId/decision` | `{decision:"approve", projectId, csrfToken}` or `{decision:"deny", csrfToken}` | `{data:{completionHandle}}`; grant/code/outcome are committed atomically. Request ID plus decision payload defines stable retry behavior. No callback URI, OAuth code, raw access/refresh token, client secret or PAT in JSON. |
| `GET /api/v1/oauth/completions/:completionHandle` | Opaque handle plus bound session/browser | Top-level navigation only. Backend completes only the stored decision and redirects to its exact validated callback. Replay cannot mint a second code/grant. |
| `GET /api/v1/oauth/connections?limit=…&cursor=…` | Default 50, maximum 100; bounded opaque cursor | Current user's grant summaries plus `nextCursor`. Include expired/revoked rows only if the contract explicitly defines their retention and status. |
| `POST /api/v1/oauth/connections/:grantId/revoke` | `{csrfToken}` or agreed session-CSRF mechanism | Canonical revoked summary, or idempotent `{data:{success:true}}`. Repeated requests succeed without a new grant; other users' IDs receive private 404. |

Proposed types, to be implemented in `packages/contracts` by the shared-contract owner:

```ts
type ConnectorScope = 'projects:read' | 'boards:read' | 'cards:read' | 'cards:create';
type ClientDisplay = {
  name: string;
  identityHint: string; // backend-derived origin/identifier; never an arbitrary link
  verification: 'verified' | 'unverified'; // verified only with a defined backend policy
};
type ConsentProject = { id: string; name: string; selectable: boolean; reason?: 'read_only' | 'archived' };
type ConsentView = {
  requestId: string;
  client: ClientDisplay;
  scopes: ConnectorScope[];
  projects: ConsentProject[];
  requestExpiresAt: string;
  grantExpiresAt: string;
  csrfToken: string;
};
type ConnectionSummary = {
  id: string; // grant ID, not an access token
  client: ClientDisplay;
  project: { id: string; name: string } | null;
  scopes: ConnectorScope[];
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUseStatus: 'recorded' | 'never_used' | 'unknown';
  revokedAt: string | null;
};
```

Parent decisions needed: final URL/endpoint family; handle grammar/expiry/browser binding; mandatory scope bundle versus exact subset; grant lifetime and nullable project disclosure after access loss; truthful verification policy; accurate last-use recording semantics; grant list retention; CSRF nonce/Origin enforcement; one-shot decision retry/outcome lookup; completion replay behavior. These are contract decisions, not permission requests to the user.

POST decision must recheck the current actor, eligible selected project, role/board policy, requested scopes, expiry and CSRF state inside the protected transaction. A changed/revoked role while the screen is open cannot win approval. Same approved request/payload replay may return the same safe completion outcome; changed selection/decision must conflict. If response loss leaves an unknown result, reload the canonical request state or retry the identical recorded decision only as explicitly supported. Do not silently submit a fresh intent or choose another project.

## URL, sign-in and secret boundaries

- Use exactly one `request` query parameter with the backend-defined base64url/opaque grammar and bounded length; reject duplicate, malformed or missing values. The browser constructs `/connect?request=…` from that validated value only. It does not carry `redirect_uri`, `client_id`, requested scopes, OAuth state, token or authorization code in its route.
- Add narrow return-path handling for `/connect?request=…` in both client `return-path.ts` and API `safe-next.ts`, rather than broadening their existing grammar. Reject `//host`, offsite URLs, backslashes, controls, encoded separators, duplicate parameters and extra callback parameters. Consider preserving only the fixed `/settings?tab=connections` tab alongside existing resource routes.
- Add `/connect` to the bare/self-guarded page sets so it can explain sign-in and invalid/expired requests itself. Preserve the current name step without changing the URL. Existing Google callback failure redirects lose `next`; either preserve a validated opaque resume handle securely in backend state or show a clear “Return to your connector app and start again” recovery. Do not build resume state from provider error text.
- A request handle is short-lived and bound server-side; possessing its URL must not authorize a grant. The CSRF nonce is a separate anti-forgery value in memory/form body, never a browser URL or authentication credential.
- Keep consent state in memory only. Do not use localStorage/sessionStorage, retained drafts, URL hashes or token rendering. Actor changes remove old consent/grant data and selection immediately. Do not persist React Query cache. Query keys include actor ID and request/grant identity; do not send opaque handles to analytics/loggers.
- Use `Referrer-Policy: no-referrer` and private/no-store responses on consent and completion paths. External client metadata images/links are unnecessary in v1. Existing CSP/frame protection should remain effective; no external JS is needed.
- Keep browser fetches same-origin. Preferred decision POST returns JSON and explicitly uses redirect error/manual behavior if the backend could redirect. A new helper must not let an unexpected 302 become an offsite fetch. The UI constructs a fixed local completion path from its opaque handle; the backend owns final callback validation and navigation.
- Root `/mcp`, `/.well-known/*` and `/oauth/*` do not currently follow the `/api/*` Pages proxy automatically. If the parent selects root paths, explicit Pages functions/Worker routes and middleware exclusions plus equivalent local development routing are required. Discovery errors must remain protocol responses, never a sign-in/SPA page.

## States and recovery

| State/result | Visible behavior |
| --- | --- |
| Loading | Named status “Loading connection request…”; no client/project claims or enabled decision. |
| Signed out / 401 | Generic sign-in screen with safe local resume; no stale consent/project details. Signing in again requires a fresh consent fetch. |
| Missing/malformed/unknown/unbound request | “This connection request cannot be opened.” Start again from the connector; no submitted URL/client text echoed. |
| Expired/consumed request | “This connection request has expired” or canonical completed outcome; no automatic new approval. |
| No eligible projects | “No projects are available for these permissions.” Explain read-only restriction only where backend safely supplies it. Deny remains available; no implicit project creation. |
| CSRF/session/request mismatch / 403 | “This request changed or your session ended. Reload it before continuing.” Clear decision state; never blindly resubmit. |
| Current project lost/inaccessible | Remove its selection and private details; show generic unavailable message and refetch current options. |
| 409 stale/changed/already decided | Reload canonical outcome/details. Keep no enabled stale approval; never overwrite another decision. |
| 422 invalid selection/scope | Local field error plus updated eligible choices. Unsupported scopes block the entire approval. |
| Network timeout after POST | “We could not confirm the result.” Query canonical status or replay identical intent only if the contract permits it; do not claim denied/approved. |
| 429 / 503 | Human copy, honor Retry-After for deliberate retry, keep decision disabled during retry window. |
| 500 | Stable local error copy and support request ID; no raw backend/client/provider body. |

Consent and Connections need dedicated error-catalogue entries for their approved codes. Do not render arbitrary backend `message` or third-party metadata as trusted error instructions.

## Settings → Connections

Use a personal tab independent of active project context. Include each approved app's safe name/identity hint, project, exact permission labels, grant creation/expiry, status and recorded last use. For `unknown`, show “Not recorded”; use “Not used yet” only when the backend guarantees that meaning. An active grant is an approval, not evidence of a successful connector handshake. Do not show “Connected successfully” from consent completion alone.

Provide “Revoke access” on active grants and a named confirmation dialog: “Revoke {app} access to {project}?” Explain “This app will no longer be able to read or create cards using this connection. Cards it already created will remain.” On confirmed server success, refetch canonical grants and show “Access revoked”. Revoke removes all credentials derived from that grant according to the backend's serialized revocation policy; an already-committing protected write may finish. Do not present revocation as undoing already delivered data or created cards.

Empty state: “No app connections yet. Add the Flowboard URL in your connector app to connect a project.” Show the deployment-configured public MCP URL with a “Copy URL” button only once it is frozen and available; never infer it from a random browser host or reveal an internal Worker URL. No PAT or company credential controls.

## Browser acceptance plan and stable selectors

Use accessible roles/names as the primary selectors. Optional stable `data-testid` anchors below support cross-browser evidence without depending on CSS layout. Synthetic accounts/projects only; current-user provider login remains a separately authorized hosted test.

| Acceptance | Selector/evidence |
| --- | --- |
| Bare consent works on direct load and refresh, signed in and out | `[data-page="connect"]`; heading `Connect to Flowboard`; no project rail/fallback landing. |
| Google sign-in and first-name confirmation return to exact pending request | `#googleSignIn`; existing name form; final URL has only `request`; GET loads server-canonical consent. Include failed/cancelled Google recovery. |
| One explicit eligible project is required | `getByLabel('Choose one project')`; initial blank; `getByRole('button',{name:'Allow connection'})` disabled before choice; no All projects option. |
| Client warning truthful; malicious names inert | `[data-testid="client-identity"]`, `[data-testid="client-unverified"]`; HTML-looking name rendered as text; no remote logo fetch or script. |
| Exact scopes and expiry displayed | `[data-testid="connection-permissions"]`, `[data-testid="grant-expiry"]`; compare to canonical API data, including a read-only subset or unknown-scope rejection. |
| Allow/Deny is explicit and serialized | Buttons `Allow connection` / `Deny`; inspect one POST body, session/request-bound CSRF, no client callback fields; double click/race produces one outcome. |
| Offsite redirect occurs only through backend | Record POST→local completion→exact allowed callback; malformed redirect URI, changed callback, duplicate query and open-redirect payloads stay local with no grant. |
| Stale role/board grant and expiry stop approval | Revoke/demote using synthetic backend fixtures between GET and POST; verify server refusal, selection redaction and no grant/token issuance. |
| Unknown POST result is honest | Interrupt response after commit; no success claim; canonical outcome/replay returns one grant, never another approval. |
| All roles manage only their own grants | User menu `Connections`; tab `Connections`; `[data-testid="connection-list"]`; direct `/settings?tab=connections` works with zero projects and Member/Viewer; another user's grant ID remains private. |
| Revoke clear, confirmed and effective | `getByRole('button',{name:'Revoke access'})`; named dialog; button `Revoke access`; active token request after committed revoke fails; other grants remain active. |
| Privacy and expiry truthful | Storage audit contains no OAuth/PAT secrets; DOM/URL/React Query responses contain no raw bearer/code/secret; unknown last use says Not recorded; expired grant cannot mutate. |
| Keyboard/narrow/error usability | Native select keyboard operation, Tab order, focused invalid field, visible focus, named alerts/status, dialog focus restore, 320px/zoom and long untrusted name coverage. |
| Static and protocol routes both work | Test built static export through actual Pages functions, not only next dev. Probe selected MCP/discovery/OAuth endpoints and ensure JSON/protocol errors survive without SPA/sign-in redirects. |

Future file ownership proposal: UI owns `apps/web/src/app/connect/page.tsx`, small presentational `components/integrations/*`, `apps/web/src/lib/api.ts`, Settings tab/UserMenu, route-return helpers, dedicated error entries and web tests. Parent/Backend owns contracts, API safe-next/auth/consent/grants and runtime routes. Deployment owns Pages root proxies and headers; coordinate edits to existing Pages middleware. Do not start source changes until parent freezes that ownership and publishes passing backend evidence.

## Primary references checked 2026-11-04

- [Current MCP authorization specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): HTTP authorization, resource discovery, scope selection and client registration guidance. `latest` currently resolves to this version; pin the intended version in the parent contract rather than assuming the older stdio setup is a hosted flow.
- [RFC 9700, section 2.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1): exact callback URI matching, avoiding open redirectors and authorization-flow CSRF protection. Session-bound consent POST controls described above are Flowboard's proposed implementation boundary, not a claim that the MCP specification defines its screen/API.

## Result and next gate

Actions: source and primary-reference research completed; this draft is the only file added. Why/options: one same-origin opaque request makes approval understandable while leaving callback/credential authority in the backend. Evidence/limits: no implementation, test execution, browser acceptance, live account action or hosted approval occurred. Next: parent freezes the backend contract and passes its independent review/handoff; UI then implements against that exact contract and runs the browser acceptance plan. No user action is needed for this research handoff.
