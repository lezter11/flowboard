# Hosted MCP transport research — 2026-11-04

Status: research and proposed implementation contract; no application source change, independent acceptance or hosted verification is established by this note. OAuth issuance/consent and the final internal principal contract belong to the coordinating Architect/backend stream.

## Recommendation and ordinary-language model

Expose one canonical UAT endpoint, `https://flowboard-app-uat.pages.dev/api/v1/mcp`, using the installed `@modelcontextprotocol/sdk` **1.32.2** `WebStandardStreamableHTTPServerTransport`. Create a fresh MCP server, transport and authorized client for each HTTP request. Use `sessionIdGenerator: undefined`, `enableJsonResponse: true`, `maxRequestBodySize: 131_072`, and no resumability/event store. This cap accommodates a valid 20,000-character description even when JSON escaping expands characters to six bytes. Return 405 for GET and DELETE rather than opening idle streams or pretending to retain a session. Handle OPTIONS before bearer authentication.

For example, Claude asks to create a card. The hosted endpoint checks Claude's OAuth access token, turns the tool call into the existing card command under the selected project, and returns its bounded result. The next request checks authority again. No laptop process or permanent in-memory connection is required. This is a proposal until mounted PostgreSQL, actual Worker and signed-in remote-client evidence pass.

The pinned SDK documents native `Request`, `Response` and `ReadableStream` support for Workers/Hono, and explicitly prohibits reusing a stateless transport across requests because message IDs could collide. Its JSON response option fits these five short request/response tools. Cloudflare also supports remote Streamable HTTP, but its current Agents documentation uses newer SDK abstractions; adding Agents or Durable Objects is unnecessary for this slice. A durable session/event store would add lifecycle and revocation complexity without a current server-notification requirement. Sources: installed [`webStandardStreamableHttp.d.ts`](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.d.ts), installed implementation, and [Cloudflare transport guidance](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/).

## Existing source and coupling

| Source | Current behavior and required coordination |
| --- | --- |
| `packages/mcp/src/index.ts` | Five tools are defined inline and stdio starts at module import. Extract `createFlowboardMcpServer(client)` into an inert module; keep index as the stdio entry. Preserve exact names, descriptions, annotations and schemas. |
| `packages/mcp/src/schemas.ts` | Reuse these schemas; preserve bounded IDs/pages, real dates and stable operation IDs. |
| `packages/mcp/src/client.ts` | Current constructor accepts PATs only and uses global `fetch` with `redirect: 'error'`. Add an explicit injected request adapter for hosted use while preserving the PAT-only default. Reuse response projections, size bound, safe error messages, exact-column selection and the one stale-board-version retry. |
| `apps/api/src/http/middleware/auth.ts` | Global `personalAccessTokenMiddleware` rejects every non-PAT Authorization value before route mounting. OAuth MCP must have an explicit entry before this check or a coordinated auth boundary; a generic PAT exception is unsafe. |
| `apps/api/src/http/middleware/token-policy.ts` | Existing PAT method/path allowlist stays deny-by-default. OAuth access tokens must not automatically gain public API access or a route-allowlist bypass. |
| `apps/api/src/http/routes/cards.ts` | Existing creation locks PAT credential, then current grants, and commits card/receipt/activity together. OAuth needs an equally real credential/grant lock and credential-scoped receipt/provenance, not a check only at the MCP entrance. |
| `apps/web/functions/api/[[path]].ts` | `/api/v1/mcp` already reaches the Worker through the Pages API service binding. `/mcp` would need an additional function plus the page middleware bypass. |
| `apps/web/functions/_middleware.ts` | `/api/*` bypasses cookie page gating. The selected path avoids accidental sign-in redirects for MCP machine traffic. |
| `apps/api/src/runtime/worker.ts` | Worker creates and closes a request-scoped PostgreSQL pool around `app.fetch`. Complete JSON responses fit this lifetime; do not close the pool while tool work continues. |
| package manifests/root tooling | Architect owns pinned API SDK dependency, lockfile, shared exports, build order and typecheck scope. Importing the MCP binary entry into the Worker would start stdio and is forbidden. |

Keep exactly: `flowboard_list_projects`, `flowboard_list_boards`, `flowboard_get_board_columns`, `flowboard_create_card`, `flowboard_search_cards`. A selected-project grant filters the list-projects response and rejects another project's arguments/board ancestry. No extra issue/external-project API, server-management tool, browser cookie credential or caller-supplied identity header is introduced.

## HTTP and protocol contract

This implementation intentionally targets the **installed SDK's initialize-based protocol** (negotiation through `2025-11-25`), not the newer 2026 metadata-based protocol. Newer web documentation must not be mistaken for support in SDK 1.32.2. Record actual negotiated protocol in hosted tests; reconsider the pin only if the target Claude client cannot negotiate a supported version.

| Case | Proposed behavior |
| --- | --- |
| POST initialize | SDK-generated JSON-RPC initialize result, 200 JSON, no `Mcp-Session-Id`. |
| POST `notifications/initialized` | 202 with empty body. |
| POST `tools/list` / `tools/call` / `ping` | SDK parsing/dispatch. Tool execution remains authorization-controlled; list returns only the five defined tools. |
| Unknown request method | SDK JSON-RPC method-not-found, normally HTTP 200 with error code `-32601`. |
| Missing acceptable response media types | 406; POST clients must advertise both `application/json` and `text/event-stream`, even though this server chooses JSON. SDK uses substring checks; a small outer media-type parser should reject lookalike types and explicit `q=0`. |
| Non-JSON Content-Type / malformed JSON | 415 / 400 with safe protocol errors. |
| Oversize declared or streamed body | 413 before parsing. Use the SDK body reader, do not supply unchecked `parsedBody` (which bypasses its bound). |
| Batch body | Reject arrays explicitly if enforcing the 2025-11-25 single-message contract; SDK 1.32.2 itself retains bounded legacy batch handling. |
| Unsupported protocol header | 400 from SDK. Do not invent a negotiated-version registry in a stateless isolate. |
| GET / DELETE / other methods | 405 with `Allow: POST, OPTIONS`; authenticated GET may return 405 instead of providing a standalone event stream. |
| OPTIONS | Bounded preflight response, no cookie or bearer requirement, exact allowed origin/method/header rules. |

The MCP lifecycle specifies initialize followed by the initialized notification and subsequent protocol-version headers. Stateless requests still use this client lifecycle; the server does not use initialization as authentication. [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [2025-11-25 transport specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx).

## Authentication, origin and downstream safety

1. Require an OAuth access token issued for this exact canonical MCP resource on every protocol request. Reject missing/invalid/expired/revoked token, PAT and session-only authentication with 401 and a `WWW-Authenticate: Bearer resource_metadata="…"` challenge. The resource metadata URL must be anonymously reachable on the Pages origin and advertise the matching authorization server. Validate token audience/resource and scope; never take project/actor identity from tool arguments or headers. OAuth route/metadata ownership remains with the auth stream. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
2. Check the URL's canonical scheme/host against configured server values; never derive allowed hosts or resource identity from forwarded-host headers. Validate any present Origin against an exact configured allowlist, rejecting malformed, `null` and untrusted origins with 403. **Absence of Origin is allowed:** Claude's server-to-server requests need not carry browser Origin. Host/origin checks are independent of CORS. SDK DNS-rebinding options exist but are deprecated and disabled by default; explicit outer middleware is clearer.
3. For browser CORS, echo only a permitted Origin; use `Vary: Origin`, `Access-Control-Allow-Methods: POST, OPTIONS`, and explicit `Authorization`, `Content-Type`, `MCP-Protocol-Version` headers. Expose `WWW-Authenticate` and necessary request identifiers. Do not set `Access-Control-Allow-Credentials`; cookies do not authenticate MCP. Preserve no-store and omit Set-Cookie.
4. Never send this MCP bearer to global HTTP fetch, another host, an API fallback origin or a redirect. A hosted client adapter may call a **locally mounted application** with a fresh sanitized Request and a private verified-principal capability supplied by backend code. Strip Authorization, Cookie and caller identity headers. The capability must be impossible to create over public HTTP and must permit only the existing tool routes, retain current role/board checks, and provide live credential/grant checks inside writes. An alternative is extracting reusable application functions; it is cleaner longer term but touches more transaction code now. Architect decides before source changes.
5. Do not reinterpret an OAuth token as a PAT, mint a hidden PAT, impersonate a session, or forward arbitrary client tokens. The MCP security guidance forbids token passthrough and requires audience validation. [Security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices).
6. Add bounded protocol abuse controls rather than inheriting session CSRF rules. Authenticate before expensive parsing/tool work, while applying host/origin/method/body guards early. Keep safe static errors; the SDK passes request headers to handler metadata, so sanitize the Request passed to it or keep credentials away from tool callbacks and logging.

## Frozen acceptance to carry into implementation

Risk: high (new remote authentication and cross-project boundary). Required independent review covers the complete reachable auth, MCP, API, transaction, runtime and proxy graph under `BACKEND_REVIEW_GATE.md`, not just the transport file.

- Protocol fixtures: initialize, initialized notification, ping, list (exact five names/schema equivalence), calls, invalid method/params/JSON/Content-Type/Accept/version, single-message/batch policy, bounded streamed body, no session/cookie, and controlled 405/preflight.
- Authority: no bearer/PAT/session-only failure; correct OAuth resource/scope; revoked grant/token, selected sibling project, inaccessible board, Viewer create denial, archived board/project, encoded separators and forged principal headers. Test direct external API requests cannot use OAuth to reach unapproved routes.
- Integrity on disposable PostgreSQL through mounted app: same operation/input creates one card/event/receipt; changed input conflicts; stale-board single retry; unknown outcome replay; separate-connection token/grant revoke races in both lock orders; refreshed access token does not accidentally change logical receipt identity.
- Isolation/leaks: two simultaneous clients reuse JSON-RPC IDs without collision; different actors/projects cannot share authority; no global fetch or redirects from hosted adapter; no raw tokens/cookies/upstream messages in output/logs; bounded input/output.
- Runtime: typecheck, MCP tests and packaged stdio executable regression; API Worker dry-run bundling; actual workerd native Request/Response probe; full API/contracts regression; Pages proxy metadata/challenge/header test; then exact reviewed UAT deploy and real remote-client browser OAuth/list/create/replay/revoke acceptance. Local SDK probe alone cannot pass those gates.

## Observed evidence and limits

On 2026-11-04 a no-network Node script imported the installed SDK and used a new server/transport for each of five synthetic POSTs. Observed: initialize 200 negotiating `2025-11-25`; initialized notification 202/empty; tools/list 200; tools/call 200; unknown request 200 with JSON-RPC `-32601`; no response session header. The probe used one synthetic echo tool, not Flowboard authorization or a database. It proves the installed per-request lifecycle is usable in Node; Worker bundling/runtime, real app integration, OAuth security and UAT remain unverified.

Actions: captured the transport proposal and source coupling. Why/options: stateless JSON avoids connection affinity for ordinary card commands; stateful streaming remains a future option. Evidence/limits: installed SDK source and the narrow local probe, with primary specifications linked above. Next: Architect publishes the verified-principal/client/dependency contract; then bounded implementation can begin. No user action is needed for this research note.
