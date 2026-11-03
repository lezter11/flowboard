# MCP and scoped-token review

Started 2 November; completed 3 November 2026 (Asia/Kolkata).
Target: `62ce05f49aed3179bf6af97ffb3f5415512ef392`, branch `feat/mcp-scoped-token`, in `/Users/shubham/Documents/Flowboard-mcp`.
Base: `7c6418a6867a3e5cebd09b21754f8bcc9fdba2f2`. Source was clean and was tested from a Git archive of the target, rather than the shared checkout. No source fixes or hosted checks were performed.

Verdict: **do not merge or deploy this version**. One critical, one high, five medium and one low finding. These are independent review findings, not an implementation approval score.

## MCP-01 | critical | apps/api/src/http/middleware/auth.ts:22

**What is wrong.** A valid PAT becomes the underlying human's ordinary `SessionActor` globally. Scope and project checks exist on only four intended route paths. All other existing `authMiddleware` routes admit that actor without checking the token's capabilities or destination. A token limited to `cards:read` in project A can read and change a card in project B when its underlying user has access to B. It can also list and revoke that user's other tokens (`http/routes/tokens.ts:58`, `:70`). Token capability attenuation has failed; this does not demonstrate access beyond the underlying human's memberships.

**Exact reproduction.** Run `probes/security-repro.mjs` against the guarded disposable localhost database. It creates a synthetic Owner of A and B, then uses the feature's own token adapter to issue an A-only `cards:read` PAT (the CLI uses this adapter too). `GET /api/v1/session` returns B; `GET /api/v1/cards/{B-card}` returns B's title; `PATCH` of that card with `expectedVersion:1` returns 200 and persists the new title. `GET /api/v1/tokens` returns four token summaries; `DELETE /api/v1/tokens/{peer-token}` returns 200. Results: `raw/security-repro.json`, keys `sessionLeak`, `foreignCardRead`, `foreignCardWrite`, `peerTokenList`, `peerTokenRevoke`.

An additional realistic public-API reproduction avoids the Owner-minting defect/adapter setup entirely: a Member of shared project A who owns a private project mints an A-bound `cards:read` credential through session-authenticated `POST /api/v1/tokens` (201). That credential successfully PATCHes a card in the Member's private project (200, persisted). See `publicIssuedTokenEscalation`. No direct database token insertion is required for that attack path.

**Suggested fix.** Introduce an explicit authentication principal and deny-by-default token route policy. Session/account/credential administration must reject PAT authentication. Each permitted machine operation must intersect token action scope, bound project/board, active installation policy, and current resource authority before reads, writes and receipt replay. Generate the negative matrix from actual registered routes; adding a route without an authentication policy must fail CI. A dedicated integration namespace reduces accidental exposure of future UI endpoints.

**Confidence:** confirmed with mounted handlers and real PostgreSQL.

**Refutation attempted.** Downstream `acquireWriteGrantLock` checks the human's current membership/grant correctly, but never receives the token restrictions. An unrelated synthetic user was denied with 404, expired/revoked PATs with 401, PAT child minting with 403, and foreign-project creation on the specifically guarded create route with 403. Those controls do not repair the unguarded routes.

## MCP-02 | high | apps/api/src/http/routes/boards.ts:182

**What is wrong.** `boards:read` grants the full card snapshot at line 196 even without `cards:read`. The MCP columns tool then passes through the snapshot's column objects (`packages/mcp/src/client.ts:103`); TypeScript's smaller `BoardColumn` interface does not remove the runtime `cards` properties. A column-discovery tool sends card content into the model context. This persists even after MCP-01 is fixed because the intended guarded route itself authorizes the wrong data shape.

**Exact reproduction.** Issue an A-bound PAT containing only `boards:read`; call `GET /api/v1/boards/{A-board}` and then `FlowboardClient.getBoard(A-board)`. Both retain the card `unrelated private item` in a column. `raw/security-repro.json`: `boardScopeIncludesCardContents.hasPrivateCard=true`, `mcpColumnsToolLeak.hasCardsProperty=true`, `hasPrivateCard=true`.

**Suggested fix.** Add a bounded metadata-only board/column endpoint and explicitly construct its response. Require `cards:read` for any route returning card data. Make the MCP columns tool serialize only ID, name, category, position and the required structural revision. Test absence of card titles, excerpts, assignees and counts under metadata credentials.

**Confidence:** confirmed with real route output and MCP client mapping.

## MCP-03 | medium | apps/api/src/http/routes/projects.ts:93

**What is wrong.** The project restriction filters `result.data` after the unscoped SQL page has been fetched, leaving `nextCursor` unchanged. That cursor encodes another accessible project's name and ID (`adapters/projects.ts:36`, `:237`). It also creates empty pages and makes a token's own project hard to discover.

**Exact reproduction.** Give a synthetic Owner `AA confidential project` and `ZZ scoped project`. With a `projects:read` PAT restricted to ZZ, request `/api/v1/projects?limit=1`. The result is HTTP 200 with zero visible items, but decoding `nextCursor` yields AA's name and ID. `raw/security-repro.json`: `filteredPaginationCursor`.

**Suggested fix.** Apply the token project predicate in SQL before ordering/limit/cursor calculation. Bind cursor scope to the authorized resource/filter set; reauthorize every page. A token bound to exactly one project can use a direct single-project metadata response.

**Confidence:** confirmed against PostgreSQL.

## MCP-04 | medium | packages/mcp/src/client.ts:141

**What is wrong.** Every `createCard` invocation generates a new idempotency key. When a POST commits but its response is lost, repeating the tool creates a second card. The 409 handler at lines 166–174 also retries every conflict category with a fresh key, rather than distinguishing stale board revisions from other errors. Title search cannot enforce uniqueness under concurrent calls.

**Exact reproduction.** The probe forwards the first create to the real API, waits for its 201 response, then throws a synthetic transport error before delivering that response to the client. It invokes `createCard` again with identical arguments. PostgreSQL contains two cards: `lostResponseRetry.createdCards=2`. The test does not falsely report that a generic 409 alone commits a duplicate.

**Suggested fix.** Expose and preserve a stable operation ID across host/process retries. Transport retries retain the same key and payload. Restrict stale-version recovery to the documented code and explicitly define how a new revision attempt relates to the original operation. For company integrations, additionally persist a unique integration/external-issue mapping so daily alerts do not generate new cards after receipt expiry or credential rotation.

**Confidence:** confirmed for response-loss replay; broad 409 retry confirmed by source.

## MCP-05 | medium | apps/api/src/http/routes/tokens.ts:35

**What is wrong.** Scoped token creation recognizes only an active `project_memberships` row. Normal Owners inherit project access through workspace ownership and often have no such row, so the Owner cannot issue a restricted token for their own project. The test fixture masks this by inserting Owner-as-Manager memberships (`apps/api/test/tokens.test.ts:49`).

**Exact reproduction.** A synthetic workspace Owner with an owned project and no membership row calls session-authenticated `POST /api/v1/tokens` with that project and `cards:create`. The response is 403: `ownerScopedMintWithoutMembership.status`.

**Suggested fix.** Use the canonical role/ownership resolver and the issuance policy inside a transaction. Add a real Owner fixture without a redundant membership, plus Member, Viewer, foreign-project and removed-user cases. Do not recommend an unrestricted token as a workaround.

**Confidence:** confirmed with a mounted session-authenticated request.

## MCP-06 | medium | packages/mcp/src/client.ts:195

**What is wrong.** The client sends the search term as `q`; the route parses `cardsQuerySchema`, which accepts `query` (`packages/contracts/src/cards.ts:136`). Zod strips `q`, so the API returns an unfiltered page. The tool description's duplicate-check suggestion is unreliable and unnecessarily sends unrelated card data to the model.

**Exact reproduction.** Seed `needle compliance alert` and `unrelated private item` in the same board. Call `FlowboardClient.searchCards(projectId,'needle')` through the real API. It returns both cards: `mcpSearch.count=2`, `unrelatedReturned=true`.

**Suggested fix.** Use `query`, share typed request serialization where possible, and test a matching and nonmatching card through mounted handlers. Handle pagination explicitly. Search remains a user discovery feature, not the duplicate prevention mechanism.

**Confidence:** confirmed against PostgreSQL and the actual MCP client.

## MCP-07 | medium | packages/mcp/package.json:7

**What is wrong.** The advertised executable targets `dist/index.js`, but no MCP build or prepare script generates it from a clean Git snapshot/install. The package TypeScript check fails: Node type configuration is missing, and the `.ts` import in `src/index.ts:4` raises TS5097. Root typecheck does not include `packages/mcp`, and root tests/CI do not execute the MCP test command. Existing ignored build files in another developer's worktree are not a reproducible package.

**Exact reproduction.** From the frozen archive after `npm ci --ignore-scripts`, run `node node_modules/typescript/bin/tsc -p packages/mcp/tsconfig.json --noEmit`: exit 1 with five reported errors, including TS5097 and TS2591. Inspect the package scripts: only start/test. The clean snapshot has no `packages/mcp/dist/index.js`. See `raw/mcp-typecheck.log`. The combined attempt to execute that entry and run online npm audit was blocked before execution; no executable-failure exit code is claimed.

**Suggested fix.** Choose a supported source-launch or compiled distribution contract. If compiled, add Node types, import rewriting, a build script and an executable shebang; test the installed artifact from a clean checkout. Include MCP typecheck, tests and a protocol smoke test in CI. Source startup currently works and is not the same as validating the advertised binary.

**Confidence:** confirmed typecheck and static packaging inspection; installed binary execution not covered.

## MCP-08 | low | apps/api/src/http/routes/cards.ts:91

**What is wrong.** Authentication records `tokenId`, but the card command and activity event receive only `actor.id`. The audit history cannot distinguish a UI action, Claude, and a fleet integration acting for that person. This weakens investigation and integration-level abuse controls.

**Exact reproduction / trace.** Follow token principal assignment in `http/middleware/auth.ts:32`, card creation at `http/routes/cards.ts:91`, and `recordActivity` in `adapters/cards.ts`. No credential/installation/source-event identifier is passed or stored. No hosted audit-log claim is made.

**Suggested fix.** Store an explicit integration principal and safe provenance: installation ID, credential ID, operation/source-event ID and the installing human separately. Never store a bearer value in activity metadata.

**Confidence:** confirmed by source trace.

## Positive controls and boundaries

- PAT generation uses 32 cryptographic random bytes, stored as SHA-256 rather than plaintext. List responses omit the bearer value.
- Expiry and revocation were exercised and denied subsequent requests with 401.
- Token-authenticated token minting was denied with 403.
- Current underlying human/board authority is still checked on the guarded paths: removing a Member's board grant changed board access from 200 to 404.
- The source-started stdio server completed a real SDK handshake, listed five tools and executed project listing against a synthetic local HTTP stub. Startup diagnostics appeared on stderr.
- Missing remote OAuth metadata is **not** a defect of this local stdio server. A remote URL-based offering is a separate capability.

## Additional design gaps, not separately counted findings

No per-installation authoritative card budget, no durable external-issue identity, optional never-expiring PATs, unbounded token list/creation policy, no HTTP timeout/cancellation strategy in the MCP client, and no user-facing setup/rotation guide. General per-IP write limits do not establish company-level quotas. These need explicit policy and tests before a public integration launch. Prompt-injection resistance depends on narrow server permissions and bounded tool output; content instructions must never authorize an operation.

## Existing dependency debt, not counted as a new MCP defect

After explicit user approval, sanitized npm advisory checks ran against this frozen lockfile. Production dependency tree: two findings (one high, one moderate). All dependencies: five (two high, three moderate), covering the existing Next/PostCSS and development Undici/Miniflare/Wrangler chains. No advisory was attributed to the new MCP SDK in that output. This is the previously documented dependency debt, not evidence that the new package is free of vulnerabilities. Reports: `raw/npm-audit-prod.json`, `raw/npm-audit-all.json`; both exit 1 because findings exist. A combined executable/registry command had earlier been rejected before execution; only the separately approved sanitized registry check ran.
