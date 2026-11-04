# Hosted MCP — 22-minute development checkpoint

Status: STOPPED at the user's requested usage timebox. Source is work in progress, not approved for deployment. Branch: codex/hosted-mcp-browser-signin. Starting commit: b19549c341d169340dfae707499057fae8c81442 (documents the already-deployed application d1c81f4). No hosted connector code has been pushed or deployed during this feature work. Current UAT remains d1c81f4; the user reported its existing Claude connection working.

## Implemented locally

- Full strategy/ownership/critical path and acceptance plan: docs/HOSTED_MCP_PLAN.md; wire contract: docs/HOSTED_MCP_SPEC.md.
- OAuth browser authorization backend and migration0027: consent/session/browser/CSRF binding, project restriction, S256 codes, hashed access/refresh credentials, rotating refresh/reuse revocation, connection listing/disconnect.
- Truthful persistence/lifetime response fields and bounded retention scheduled through Worker; ended identities retained for receipt/provenance requirements.
- Shared five-tool factory, preserved PAT stdio client and remote stateless JSON transport; existing API authorization/board projections reused through private Request-identity dispatch.
- Assembled OAuth-only MCP route, credential locks and stable connection-scoped create receipts/provenance; one request-scoped pool retained through real work settlement.
- Actual Worker Request compatibility repair: local injected requests use supported manual mode; no redirect is followed and PAT network client still rejects redirects.
- Already-aborted body handling, early bounded16KiB OAuth/consent body guard, streamed-body timeout/cancellation and real transaction lifetime handling.
- Shared strict schemas and generated OpenAPI118operations/245schemas. UI acceptance plan/Chrome runner draft only; production consent/Connections UI is NOT implemented.

## Actual evidence from this pass

Independent held-source bundle:75/75 connector OAuth/cleanup/bodyguard/mounted/protocol/nativeworkerd checks;24/24 PAT compatibility;13/13 extra adversarial and nativeWorker browser-API checks. All three commands exit0, unique synthetic PostgreSQL schemas, source before/after comparison unchanged. Independently observed typecheck0 and embedded migration27parity0. These counts overlap builder runs and must not be added to historical counts as unique coverage.

Builder evidence also includes real Worker+PostgreSQL create/replay, max-one-connection nested dispatch, create/disconnect lock order races, current board/project grant removal, scope/credential refusal, safe receipt provenance, body/rate bounds, MCP22/22 and packed stdio executable1/1. Evidence lives in backend/, transport/, contracts/ and independent-backend-review/. Preserve original failed probes, paused snapshots and repairs.

Root independently reviewed source and contract tests; Architect did not independently rerun the original malicious-stream probes before this timebox ended. Findings/repair execution attribution remains with the fresh reviewer and builder. No invented primary reproduction, final score, formal HMCP05 pass, UI-ready handoff or hosted acceptance is claimed.

## First tasks on resume

1. Repair/retest open await-cancel robustness candidate in services/hosted-mcp-transport.ts: oversize refusal currently awaits body/reader cancel; a synthetic source whose cancel promise never resolves can retain work. Production exploitability is not established. Prefer nonblocking cancellation and add declared+streamed oversize regressions with uncooperative cancellation. Coordinate a NEW held target; do not edit or reuse old source manifests silently.
2. Finish full reachable backend/transport independent gate and required regression commands. Current component evidence is strong but fullAPI/browser/complete release criteria remain pending. Every category minimum and score strictly above8.5 apply. No self-approval or ratings copied from prior UAT.
3. Only after verified backend handoff, implement UI /connect?request=..., personal Connections and all-role navigation; retain latest CSRF after project paging; preserve Google safe-next; proxy exact well-known metadata paths on Pages. UI researcher owns apps/web and has ACCEPTANCE_PLAN.md + browser-acceptance.draft.mjs ready.
4. Assemble and test actual browser approve/deny/expired/session-switch/disconnect, full existing suites and current Linux CI. Existing98-feature approvals apply only to their recorded release target; new shared source needs legitimate current-source revalidation.
5. Freeze reviewed candidate, create clean artifacts; notify user before changing UAT. Fresh authorized encrypted UAT backup and additive missing0027 migration only after gates; explicit Worker--envuat and UAT Pages target, then bounded smoke and real hosted Claude/browser acceptance. Production excluded.

## Local tools and resumption

Private synthetic test environment: /private/tmp/flowboard-hosted-mcp-test-env.json, mode0600; never print its values. Disposable PostgreSQL container flowboard-full-revalidation-20261103 on loopback55931, postgres17.11-alpine. All tests create/drop their own schema; do not reset public while other checks run. Container stopped at end after agents confirmed no active test processes; restart only when tests resume. Other projects' containers preserved.

OAuth builder: /root/hosted_mcp_auth_design. Transport/runtime builder: /root/hosted_mcp_transport_design. UI builder: /root/hosted_mcp_ui_design. Fresh auditor: /root/hosted_mcp_security_review. OpenAPI builder: /root/hosted_mcp_openapi. Resume existing agents with followup_task (send_message alone does not wake an idle/completed agent). Recheck current source and checkpoint before executing.

Next user instruction: Continue from docs/reviews/HOSTED-MCP-20261104/CHECKPOINT-22MIN.md. Root must remain Architect/primary reviewer; fresh auditor assesses authored/shared assembly. No further work while usage window is exhausted unless user explicitly resumes.
