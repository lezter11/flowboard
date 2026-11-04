# Hosted MCP UI acceptance plan

2026-11-04. Owner: UI builder. Implementation started only after the parent validated the independent HOSTED-MCP-BACKEND-API round2 pass9.1. Builder source is now held; [handoff](BUILDER_HANDOFF.md), [manifest](builder-source-manifest.json) and [checks](builder-checks.json) record current evidence. Final independent whole-feature/Pages/provider acceptance remains separate. No hosted writes were performed by UI.

## Frozen contract inputs

Consume `packages/contracts/src/hosted-mcp.ts`, `docs/HOSTED_MCP_SPEC.md` and the final passing backend handoff, rather than the earlier provisional research endpoints. Current backend component review is not yet the mounted app/transport/UI-ready gate.

- Page: `/connect?request=<opaque>`; request matches `/^[A-Za-z0-9_-]{43}$/`, with exactly one request parameter. Google return paths preserve this exact path, never a submitted offsite callback.
- Consent GET: `/api/v1/mcp/authorization-requests/:id`, optional `projectCursor`. Requires cookie session and HttpOnly browser binding. Each successful GET rotates the CSRF value; merge project pages but use the newest complete consent response for submission.
- Decision POST: same path plus `/decision`, `{decision:'allow'|'deny',projectId?,csrfToken}`. `projectId` is mandatory only for allow. Successful `{data:{redirectUrl}}` contains the backend-validated exact Claude callback. Do not log/store/render its code/state; top-level navigation only. The earlier proposed local-completion endpoint is superseded.
- Session-only Connections GET: `/api/v1/mcp/connections`; DELETE `/:connectionId` disconnects with 204. List contains active/unexpired own grants only, maximum100; the active issuance cap is20. No invented cursor/history/status fields.
- OAuth errors can be `{error:'invalid_request'}` and other OAuth codes, rather than the ordinary nested API error envelope. A dedicated helper must map these to safe local copy and retain status/Retry-After.
- `client.verified` is always false. Render supplied name as text and display supplied client and callback origins with an unverified warning. DCR names that say “Claude” remain unverified.
- Four explicit scopes: projects:read, boards:read, cards:read, cards:create. `offlineAccess` is separate; do not display `offline_access` as another card capability.
- `accessTokenLifetimeSeconds:900`, `connectionLifetimeDays:30`, `refreshTokenIdleDays:7|null`. Continuing access: at most30days, expires after7days without refresh; access tokens last15minutes. Without continuing access, explain the15minute access session and that no refresh credential is issued. Do not imply that a30day connection record extends a15minute access credential.
- Consent `expiresAt` is the pending request deadline, not a connection expiry timestamp. Connections `expiresAt` is the actual grant deadline. `lastUsedAt:null` means “Not recorded” under current evidence, not proof of never used.

## Source ownership after the gate

UI owns all new/changed `apps/web` paths for consent, Connections, same-origin API helper, error catalogue, UserMenu/Settings navigation, route handling, metadata Pages proxies/headers and tests. Parent additionally delegates `apps/api/src/http/safe-next.ts` and `apps/api/src/http/routes/google-auth.ts` to UI only after the backend gate. Transport/Auth builders must not concurrently edit those two files. Contract/routing changes require Architect coordination; no duplicate token/product onboarding UI.

## Proposed stable UI selectors

Accessible names are preferred. These anchors are deliberately small and independent of layout:

| Surface | Exact selector/name |
| --- | --- |
| Consent root | `[data-page="connect"]` |
| Client identity/warning | `[data-testid="client-identity"]`, `[data-testid="client-unverified"]` |
| Permissions and lifetime | `[data-testid="connection-permissions"]`, `[data-testid="connection-duration"]` |
| Required project | `getByLabel('Choose one project',{exact:true})`, first value `''` |
| Continuation | `getByRole('button',{name:'Load more projects',exact:true})` |
| Decisions | Buttons `Allow connection`, `Deny` |
| Google entry | Existing `#googleSignIn` link, same accessible `Continue with Google` |
| Personal navigation | Account menu link `Connections`; Settings tab `Connections` |
| Grant list/row | `[data-testid="connection-list"]`, `[data-connection-id]` |
| Disconnect | Row button `Disconnect`, dialog `Disconnect app?`, confirm `Disconnect` |
| Empty list | “No app connections yet” |
| Invalid/expired request | Heading `Connection request unavailable`; human recovery says restart from connector |
| Unknown outcome | “We could not confirm the result” with reload/restart recovery; no second blind decision |

## Bounded real-Chrome cases

All local writes use an isolated random PostgreSQL schema, inherited synthetic actor helpers and known loopback origins. Intercept provider navigation and exact Claude callback in the isolated browser context; never send an actual callback/code to Claude. A fake Google exchange checks Flowboard's actual local start/callback/safe-next flow; it is not provider acceptance. Never attach the user's daily Chrome profile.

| ID | Action and acceptance |
| --- | --- |
| HUI-01 | Signed-out direct load to a real pending request. Continue with Google retains exact handle, synthetic provider roundtrip returns to that consent, name step if required retains URL; no landing-page detour or project disclosure while signed out. Bad/duplicate request input cannot enter a redirect. |
| HUI-02 | Owner sees canonical name/origins, visible unverified warning, exact four permission labels, one explicit blank project choice and both decisions. Hidden sibling project/board names remain absent. Allow is disabled until choice; no All projects option. |
| HUI-03 | Approve exactly one project. Capture only safe POST structural facts, one outcome and a callback matching exact scheme/host/path. No submitted redirect URI/scopes/client ID fields. Double click does not create two grants/codes. Callback is intercepted locally. |
| HUI-04 | Deny with no project selection. POST omits projectId; callback error is access_denied, no code, and SQL count for own grants is unchanged. Reload/repeat cannot approve the consumed request. |
| HUI-05 | Unknown, malformed, expired, missing browser binding and consumed requests show the generic unavailable state, no project/client leak, and disabled/absent allow. Expire synthetic row directly; do not wait10minutes. |
| HUI-06 | Complete consent as Owner, Manager, Member and Viewer. The grant selects one existing project without inventing board authority. Viewer copy says actions remain limited by role; a grant cannot make a Viewer create cards. Personal Connections works for all four roles and an account with no projects. |
| HUI-07 | Continuing-access and access-token-only requests show distinct truthful duration text on consent and Connections. For false, no7day/30day continuing-access claim; for true, all15minute/7day/30day policies appear. |
| HUI-08 | More than100 currently accessible projects: Load more preserves current explicit selection, appends distinct choices, honors nextCursor and submits newest CSRF. Loading next page does not automatically choose another project or reset permissions. |
| HUI-09 | Switch actor/session after consent GET. Old project/client details are removed and the decision fails closed; membership removal between view and allow fails. Reload obtains canonical state rather than retrying the old CSRF or replacing project choice silently. |
| HUI-10 | Connections shows safe app/project/scopes/date/expiry and “Not recorded” for null last use; no success/last-use claim inferred from approval. Disconnect confirmation names the app/project; Escape preserves grant and returns focus, confirm sends one DELETE204 and removes row. Direct same-user repeated DELETE stays204; outsider ID remains non-disclosing. |
| HUI-11 | Lost decision response, OAuth400/401/403/404/409/429/503 and non-JSON faults show local copy and safe recovery. No raw SQL/stack/provider message, URL/code/secret or exception text. Honor Retry-After; no auto-post on GET/reload. Failed POST state is unknown, not falsely approved/denied. |
| HUI-12 | Malicious client name is inert text, no remote logo/script fetch. Record console warnings/errors, page errors, unexpected API failures, external origins and DOM diagnostic/credential-pattern scan; successful cases require zero unexpected events. Expected security refusals are recorded by status/path only. |
| HUI-13 | Keyboard-only choice/allow/deny/navigation/disconnect, visible focus and alert/status names; dialog Escape/focus restore;320px/200% zoom and long names fit without clipped action controls. Capture consent and Connections screenshots only before callback URLs contain codes. |
| HUI-14 | Built static export through actual Pages Functions: direct `/connect` load/refresh works; all exact well-known metadata aliases proxy with protocol JSON and no sign-in redirect; existing `/api/*` no-store/cookies survive. Next dev evidence does not close this case. |
| HUI-15 | Current unchanged stdio/PAT/browser flows, actual mounted OAuth→MCP tool calls and post-disconnect rejection pass final integration suites. The draft UI composition is not proof of private dispatcher or Worker behavior. |

## Runner, evidence and exclusions

The stable runner is `scripts/e2e/hosted-mcp-browser.mjs`, requiring NODE_ENV=test and the inherited fenced disposable database configuration. It exercises the actual mounted app through `CreateAppOptions.mcpPublicOrigin`, with no partial OAuth overlay. It requires every owned HUI group and minimum24passing cases; HUI14 is independently executed against the actual compiled Pages runtime. The old draft is retained as historical evidence, not a CI entrypoint. Complete native Worker, baseline regression and hosted provider acceptance remain separate checks.

Evidence output is a new timestamped directory under `ui/runs/`; never overwrite earlier results. Save source hash manifest, safe test outcomes, HTTP method/redacted path/status, console severity counts, unexpected-origin list, screenshots of local UI and cleanup status. Never retain raw cookies, codes, state, request handles, CSRF values, access/refresh credentials, callback query strings, token endpoint bodies or raw third-party exceptions. No HAR/traces unless a separately reviewed redaction mechanism exists.

The operator supplies the already-approved disposable database env through the existing private local mechanism; do not copy its connection string into this plan or logs. The colleague-facing product never exposes these developer commands. Required final gates: compiled product/UI tests, complete frozen independent review, actual static Pages/local mounted integration, then separately authorized hosted Google/Claude/UAT acceptance. Plan completion is not feature approval.
