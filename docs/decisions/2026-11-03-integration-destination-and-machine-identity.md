# Integration destinations and machine identity

Status: requirements captured on resumption; company integration and MCP update are not implemented by this document. The existing reviewed release still requires current local checks, independent approval and UAT acceptance. This note does not expand the current PAT route allowlist.

## Current MCP behavior

The local stdio MCP discovers permitted projects, boards and column metadata, searches cards and creates cards. Creation takes an exact board ID and an unambiguous column ID/name. The board determines its project; a redundant project ID is not needed in that create command. The assistant can discover those IDs from a user's names. If names match more than one accessible destination, it must ask rather than choose arbitrarily. There is no hidden default across projects. A remembered destination is convenience, never authority.

The API checks the credential's allowed method/path, scopes, optional project restriction, current human permission, explicit board grant and current resource lifecycle on every operation, including receipt replay. Discovery never grants write authority. Viewer, removed member, revoked credential, foreign project/board and archived destination attempts must fail without effects. A column from another board must fail. Tests need both direct API calls and the actual built MCP process.

Updating an existing card is a separate future MCP capability. Current PAT policy intentionally denies it. Design it around an exact card ID, server-resolved project/board ancestry, current edit authority, expected card version and a retained operation ID; stale edits must return a conflict rather than overwrite another teammate. Name/title search may identify candidates but must not silently edit multiple or ambiguous matches. Proposed future scopes/tools are not available today.

## Company integration: proposed client-credentials flow

A fleet company's backend should have its own installation identity. It should not impersonate the employee who originally configured it. The user requested machine-to-machine client credentials. Recommended first implementation:

1. An authenticated Owner authorizes a named installation in one project, selects explicit boards and actions, and obtains a one-time client secret through a protected administrative flow. Owner-only installation/grant administration is a recommended default, not a new delegated Manager permission decision.
2. The confidential company backend authenticates to a dedicated token endpoint using client ID and secret over HTTPS and `grant_type=client_credentials`. Never put this secret in a browser, mobile bundle, URL, chat or repository. Store only a verifier server-side, with bounded constant-time verification, rate limits and safe errors. Prefer a maintained authorization-server implementation/provider over inventing cryptography.
3. Issue a short-lived access token scoped to the Flowboard API and the installation's approved actions. An initial 5–15 minute lifetime is a proposal to validate operationally. Do not issue refresh tokens for this flow; the backend obtains a new access token using its client authentication. Explicit issuer/audience/expiry validation is required if JWTs are used; opaque tokens with server-side lookup are a simpler revocation option.
4. Each request resolves the installation server-side and checks active installation, tenant/project, board grant, scope and lifecycle. A requested scope cannot exceed the grant. Check current grants/revocation even when a previously issued token has not expired, so removing access takes effect on the next request. Do not substitute the creator's later role for the installation's granted principal.
5. Keep client identity stable across secret rotation. Support a bounded overlap, independent secret revocation and installation-wide emergency revocation. Credentials/tokens and request content never belong in logs or permanent receipts. Audit records identify the installation and the human who authorized it, without pretending a machine action was a human action.

Client credentials are for confidential clients acting on prearranged access. User-delegated remote MCP login is a different flow, typically authorization code with PKCE, and remains separate work. A future web connector must not receive a company client secret as a substitute for user authorization.

## Card ingestion and repeated compliance issues

Keep the existing modular API/domain layer and add a deliberate integration boundary, rather than exposing every session route. Candidate future interface: a dedicated integration card-create endpoint and a narrowly scoped card-update endpoint; exact route/schema design requires frozen acceptance criteria before implementation.

Require explicit authorized board/column IDs, bounded validated card input and an idempotency key. Add a durable unique external identity such as `(installationId, externalIssueId)` plus a stored card mapping. The issue identity must remain stable across access-token renewal and secret rotation, unlike today's credential-namespaced seven-day PAT receipt. Define retention, deletion/trash/purge and reappearance behavior explicitly: repeated `BUS-042:insurance-expired` events must not silently make new cards or resurrect deleted private content. A database uniqueness constraint and atomic transaction enforce this under concurrent deliveries; searching a title cannot.

Separate event retry identity from the issue identity. Two event IDs for one issue can carry different updates; one event ID retried with different input must conflict. Source version/sequence and optimistic card versions protect against delayed events and human edits. Start with explicit create behavior; choose update/reopen ownership rules before adding automated synchronization. No guessed automatic overwrites.

## Alternatives and tradeoffs

- Personal access tokens reuse the current human permission model and suit local MCP. They are not independent company installations and have only bounded retry retention.
- Static board API keys are simpler, but every API call exposes the long-lived secret and lifecycle/revocation still need implementation. They do not meet the requested token-exchange flow by themselves.
- Client credentials add token issuance, credential rotation and installation grants, but give each company separately bounded, revocable machine access. Reuse existing transactional card logic and portable PostgreSQL invariants; no separate microservice is required.

## Acceptance to freeze before building

Cover invalid/expired/revoked credentials, wrong audience, excessive scopes, cross-company/project/board IDs, missing grants, archived targets, secret rotation, installation revocation versus in-flight writes, exact retry/conflicting retry/concurrent creates, stable external identity across token renewal, delayed events, per-installation rate/quota limits, bounded bodies, private logs and real Worker runtime behavior. Recheck authority before replay and commit card/mapping/receipt/audit together. Add only explicit machine capabilities to a generated route authorization matrix so future session routes stay denied by default.

## Sources

OAuth client credentials and confidential-client requirements: [RFC 6749 sections 4.4 and 2.3](https://www.rfc-editor.org/rfc/rfc6749#section-4.4). Current OAuth security considerations, including stronger asymmetric client authentication options for a later enterprise tier: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700). Consulted 2026-11-03. These references support the flow; proposed product permissions/lifetimes above are Flowboard design choices, not standards-mandated defaults.
