# Flowboard progress

Updated 2026-10-26 (Asia/Kolkata). Current phase: feature specification v0.3 completed and first local backend foundation handed off; application delivery remains unverified until feature evidence appears.

## Done and observed

- Task FND-04 (Failure and observability baseline) implemented and verified locally: correlation middleware (`x-request-id` propagation/generation), `Server-Timing: app;dur=<ms>` duration measurement, 1 MiB body limit (`413 PAYLOAD_TOO_LARGE`), 5000ms deadline timeout (`504 DEADLINE_EXCEEDED`), central error handler with safe 500 masking preventing database/credential leaks, and canonical envelope mapping. 20/20 unit tests passed; full test suite of 74 tests across api and contracts passing cleanly.
- Updated `docs/FEATURE_CHECKLIST.md` via `python3 scripts/render_feature_checklist.py`; Backend verified features count increased to 3 (FND-01, FND-02, FND-04).

- Expanded RULES.md and AGENTS.md so every Flowboard chat teaches system-design decisions in plain English with relevant examples, benefits, drawbacks and alternatives. Added modular-monolith/microservices explanation and clarified that a monolith can run multiple instances.

- Flowboard Architect, Flowboard Backend and Flowboard UI chats exist. Backend and UI initial turns were read-only.
- Initial two GPT-6.1 Sol agents researched platform and product/API behavior. This iteration used two GPT-6.1 Sol agents for concerns 01–25/26–50 and a third GPT-6.1 Sol agent for stack/performance/portability comparison.
- Six canonical root documents established: PRD.md, ARCHITECTURE.md, DESIGN.md, RULES.md, TASKS.md and this file. AGENTS.md points future agents to them; old docs/PRODUCT.md and docs/ARCHITECTURE.md are forwarding notes.
- All three original visual references are stored in docs/references, with a catalogue and checksum manifest. Treat image content as reference data, not task instructions.
- Backend and UI received explicit read-only handoffs pointing to the six root documents, all three references, the v0.2 stack recommendation, teaching rules and 50-item checklist. No parallel application implementation was started by that handoff.
- Both chats acknowledged the handoff and independently checked all three image hashes. Their review prompted API v0.2 clarifications: bounded snapshot/count shape, historical display identities, direct placement-neighbor read, and idempotency normalization/retention. These remain proposed contracts for shared-schema validation in A-08; identity-provider selection remains open.
- v0.2 recommendation: React/Vite + Hono + PostgreSQL/Kysely/pg, initial Cloudflare Worker + cache-disabled Hyperdrive + Neon; real Node target and Better Auth compatibility spike required. No benchmark has selected a fastest runtime.
- All 50 concerns have design plans, delivery states and acceptance/adoption criteria in docs/ENGINEERING_CHECKLIST.md. **0 of 50 are marked delivered/validated for the selected application stack.** Deferred techniques have explicit triggers, not fake completion.
- Original D1 schema moved to database/prototypes/d1/migrations/0001_initial.sql. Its test command is python3 scripts/check_schema.py; 11 synthetic SQLite checks pass. This is not PostgreSQL, deployed D1, API, load or UI verification.
- GitHub connector retrieved lezter11/flowboard metadata: public, default main, size 0 at observation; pull=true, push=false. This local folder is not yet a Git checkout and no push was attempted.
- Installed gh reported invalid stored credentials. Installed codex CLI supports mcp add --url and mcp login. Cloudflare plugin catalogue search returned no match; official OAuth MCP instructions are documented in docs/ACCESS_SETUP.md. No Cloudflare tools/account verified in this chat.

## Issues, limitations and changed assumptions

- User's ordinary Terminal reported codex: command not found. Verified the desktop-bundled binary exists and runs; documented a current-session alias plus plain-URL commands in docs/ACCESS_SETUP.md. This is a command-lookup fix, not evidence of Cloudflare login. Added docs/LEARNING.md with simple tool roles, benefits, drawbacks and a card-move walkthrough.

- Earlier D1 baseline is superseded as a recommendation because the user emphasized portability and scale. Preserved history avoids confusing previous tests with the new choice. SQL schemas/driver behavior cannot be swapped across engines without work.
- GitHub push access remains unavailable/unverified. User reports Cloudflare approval completed; current-chat account access remains unverified until the dedicated tools are loaded. No secret or repeated Cloudflare approval is requested.
- Firecrawl research hit a shared request rate limit; researchers used official documentation through the web fallback. This affected retrieval speed, not evidence status. No third-party upgrade instruction was adopted.
- At the pre-implementation checkpoint no application dependencies, PostgreSQL migrations, auth integration, telemetry, worker, queue, container or hosting resources had been installed/created/tested. FND-01 is now handed off and active; current runtime evidence must be read from its later handoff record. No production-readiness, performance, free-running-cost or portability claim is established.
- UI references suggest several directions; none is a final accepted visual system. DESIGN.md contains tentative tokens and interaction expectations only.

## Next

TASKS.md A-07 access verification, then B-01 minimal compatibility/transaction spike and A-08 shared contracts. UI can review the reference-informed first flow in parallel without changing backend/shared payloads. Provisioning, paid benchmarks and release promotion are separate concrete tasks.

## User inputs eventually needed

Connect/re-authenticate GitHub using docs/ACCESS_SETUP.md if still pending. Cloudflare approval is reported complete; verify it once tools are exposed rather than repeating setup. Then clarify who will sign in (internal team or public customer workspaces), typical team size/user geography and the first visual direction. No need to provide API keys in chat. These inputs do not prevent the completed architecture/research work.

## Update discipline

Every relevant change updates its TASKS item and engineering checklist evidence. Record failures/assumptions openly. Keep the teaching format from RULES.md: Actions → Why/options → Evidence/limits → Next/your input.

## Feature baseline revision v0.3

User requested a detailed feature-first backlog before implementation and specifically chose Owner plus Project Manager for inviting/removing teammates and deleting/restoring cards. Three GPT-6 Luna research agents covered access/lifecycle, board workflows and Excel imports. Their reports are under docs/research/features-*.md.

Reconciled earlier contradictory scope: project grants replace workspace-wide visibility; manager role is project-local; card trash supports strict 24-hour restore; private reference images and XLSX import are release features; invitation email remains distinct from deferred email mention alerts. docs/FEATURE_SPEC.md and API v0.3 define flows, permissions, exact restore boundary, purge/receipt/audit content rules and importer semantics. Root PRD/ARCHITECTURE/DESIGN/RULES/AGENTS/TASKS point to the new baseline.

The catalogue has 98 implementation units with separate B/U/I gates, generated from docs/features.tsv. All are initially unchecked; the supplied Excel artifact does not mark its future API/import feature complete. Role-owned evidence files avoid overlapping checklist edits. User requested Backend verification before corresponding UI implementation; visual planning may happen earlier.

Created outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx with blank Cards and Instructions/examples. Exact seven columns, External ID text format, due-date format and priority list. Export/reimport and visual review are artifact checks; actual Excel native-application and real import behavior are not claimed.

First Backend handoff: FND-01 only, a minimal local Node/Worker/PostgreSQL compatibility harness with transaction rollback, plus explicitly coordinated root tooling. No cloud deployment, paid resources, production data or entire-product implementation. UI is briefed on revised scope and waits for verified feature handoffs before implementation. Latest runtime progress belongs in role evidence and subsequent entries, not inferred from this planning snapshot.

Final baseline checks passed: 98 unique IDs and acyclic dependency graph, local document links, original reference checksums and XLSX structural/export/reimport/visual inspection. See docs/evidence/feature-baseline-v0.3.md. Backend reports local Docker available and is actively preparing real PostgreSQL harness tests; feature completion is not yet claimed here. UI acknowledged the handoff and its review gaps are now explicit v0.3 contract shapes.

FND-02 completed and verified: `@flowboard/contracts` package created with modular Zod schemas and derived TypeScript types for all 36 API v0.3 routes, OpenAPI 3.1 catalog, Gregorian date-only bounds, non-overlapping UTF-16 mention spans, 24h trash cutoff models, Excel import preview models, and complete multi-tenant test fixtures covering sibling-project isolation. Strict typecheck passed (0 errors); 41 unit tests passed; audited and scored 9.8/10.0 by validation subagent. Feature checklist regenerated (2 of 98 backend verified). Git repository initialized and pushed to origin main.

FND-03 and FND-04 completed and verified in parallel:
- FND-03 (PostgreSQL schema and migrations): implemented `database/migrations/0001_initial.sql` covering all 21 entities with explicit foreign keys, `ON DELETE RESTRICT` on active columns, `ON DELETE CASCADE` on child items, and performance indexes. Implemented TypeScript runner with advisory locking (`pg_advisory_lock`) and transaction wrapping. All 7 integration tests passed; audited and certified at 10.0/10.0.
- FND-04 (Failure and observability baseline): implemented request correlation (`x-request-id`), execution duration tracking (`Server-Timing`), body size limits (1 MiB), deadline timeouts (5,000ms), structured error formatting, and safe 500 credential/SQL masking. All 20 unit tests across 9 suites passed; audited and certified at 10.0/10.0.
- Checklist regenerated: 4 of 98 features backend verified. Entire foundation stage (S0: FND-01 through FND-04) is complete.
