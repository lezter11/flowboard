# Hosted MCP transport/runtime builder evidence

2026-11-04 resume. Status: **builder verified; independent acceptance pending**. The own17-file source hold is recorded in `source-manifest.json`, digest `a127c16da221630f1225c035b7cfad3bd493cb2e3ea7d6dd51c8e0a2db52ca65`. This is a bounded builder manifest, not the complete reachable feature manifest or a passing review record. OAuth/helper/Worker/root-contract dependencies need the coordinating full-target review.

## Actions

Extracted the existing five tools into an inert server factory and split URL-independent validated operations from the strict PAT stdio adapter. Mounted OAuth-only stateless HTTP MCP at the exact canonical `/api/v1/mcp` path. Added private Request-identity dispatch that reuses the parent pool, current API authority checks, connection-scoped semantic receipts and `mcp_oauth` activity provenance. Cookie/PAT fallback and external OAuth REST access remain refused.

Protocol requests own a128KiB/depth32/single-message guard and deadline before the generic buffer. OAuth form/consent POSTs now mount the Auth builder's bounded cancellable16KiB guard before the generic buffer, with true work lifetime retained for Worker pool cleanup. Origin is optional for server clients and exact-allowlisted when present; protocol CORS has no cookie credentials.

## Why and options

An internal tool call is another application request, carrying a private marker that HTTP callers cannot manufacture. For example, creating a card still executes the existing card transaction and current board grant check rather than giving MCP a separate write path. Stateless JSON avoids per-client server sessions; it does not provide persistent streaming or future protocol support.

The actual Worker initially failed while Node passed. A synthetic workerd probe confirmed that Workers rejects `new Request(...,{redirect:'error'})`, supporting only `follow` or `manual`. Hosted in-process Request construction now uses `manual`; it never performs a network fetch or follows redirects, and the validated client rejects3xx. The stdio PAT network adapter retains `redirect:'error'`. The protocol also checks already-aborted signals before and after body-reader setup and before SDK dispatch.

## Evidence and limits

- `logs/mounted-final-local.log`: **20/20** combined checks pass after child-guard mounting: mounted app10/10, Node protocol9/9 and actual workerd SDK1/1. Includes actual production Worker + Node-issued OAuth + isolated PostgreSQL create/replay with the Worker's one-connection pool; full mounted consent/token flow; role/scope/sibling/current-grant/archive checks; stable replay across refresh; safe provenance; separate-connection create/disconnect in both lock orders; connection rate limits; streaming and delayed-verification cancellation. Each DB run creates/drops its own schema.
- `logs/pat-regression.log`: existing PAT/token suites **24/24** pass, including108 generated denied operations across114 mounted routes. Executed in a separate fresh schema using process-only PGOPTIONS.
- `logs/typecheck-held.log`, `logs/mcp-held.log`, `logs/artifact-held.log`: exact held-scope compiler/package/executable command results. The package suite contains22 tests, including injected redirect refusal without global fetch; the executable test exercises the real SDK stdio handshake and tools against a synthetic loopback server.
- Independent reviewer separately reproduced the previously failing aborted-body scenario and reported it passing current source; independent review records govern acceptance, not this statement.
- Failed earlier mounted attempts remain in the evidence/chat: incorrect fixture activity spelling, local Wrangler host setup, unsupported Worker redirect construction and accumulated fixture consent limits. They are not relabeled passing.

No UAT deployment, browser Google acceptance, real Claude connector acceptance, hosted pooling/security/durability or full98-feature approval follows. The installed SDK implements supported initialize-based protocol versions including2025-11-25; complete future protocol support is not claimed. Shared source changes require the whole-feature immutable review and required regression gate.

## Next

Run `node docs/reviews/HOSTED-MCP-20261104/transport/run-focused.mjs --record` with an explicitly selected disposable local DATABASE_URL or the authorized private harness file. Local Worker/PostgreSQL tests need loopback permission. Complete the full-target independent backend review, required product regressions and UI/integration gates before any UAT promotion. No user input is required for these local checks; the user timebox stop remains binding.
