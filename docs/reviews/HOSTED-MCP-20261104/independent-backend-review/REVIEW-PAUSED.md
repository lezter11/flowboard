# Independent backend review paused by explicit user instruction

Status: **paused, incomplete, no backend approval, UI implementation blocked**. No category/overall passing score is assigned. No UAT or production writes were performed. Reviewer is `/root/hosted_mcp_security_review`, independent of product implementation; edits are confined to this review directory.

## Confirmed finding 1 — OAuth child bodies precede their deadline and 16 KiB limit

Affected source: `apps/api/src/http/app.ts` line190, ordinary body-limit registration followed by ordinary deadline registration at lines195–198 (see preserved `paused-source/app.ts.txt`). `apps/api/src/http/routes/hosted-oauth.ts` lines37–44 implement the intended16KiB reader only after that global middleware.

Actual mounted `createApp` reproduction: set `deadlineMs:30`, send an unfinished streamed POST to `/api/v1/mcp/oauth/register`, content type application/json, enqueue17,000 bytes without closing. After200ms there is neither413 nor504. Only manually closing the stream produces413 `{error:"invalid_request"}`. The ordinary1MiB Hono buffer runs before both the configured request deadline and the OAuth module's16KiB reader/rate limiter. This permits unauthenticated slow bodies outside the accepted OAuth bounds. The exact `/api/v1/mcp` protocol prebranch does not fix descendant routes.

Evidence: `oauth-body-probe.mjs`, `oauth-body-probe.log`. Probe exited0 after deliberately closing its synthetic stream; it makes no database mutations. Reviewer reproduced this; Architect has been notified but has **not independently reproduced** it in the evidence available at pause. Required repair is bounded/cancellable OAuth/consent body handling before generic buffering, plus actual mounted regressions. No repair was made by this reviewer.

## Confirmed finding 2 — already-aborted body signal is missed

Affected source: `apps/api/src/services/hosted-mcp-transport.ts` `readMessage`, abort callback/listener at lines61–62; it subscribes to future abort events without checking `request.signal.aborted`. `apps/api/src/http/routes/hosted-mcp.ts` verifies credentials at line79 and consumes rate counters before entering the transport, while its deadline independently calls `controller.abort()` at line105.

Direct service reproduction: construct an already-aborted Request signal and an unfinished body, call `handleHostedMcpTransport`. After100ms it has not settled; manually closing the body finally returns400. If the outer deadline expires during credential/rate SQL work, entering the reader afterward misses cancellation and may retain the actual-work promise and Worker pool indefinitely on an unfinished body. Already-started transactions must still settle; this finding concerns a body reader that never receives its prior cancellation.

Evidence: `already-aborted-body-probe.mjs`, `already-aborted-body-probe.log`. Probe exited0 after deliberately closing its synthetic stream; no database was used. Reviewer reproduced this; Architect has been notified but has **not independently reproduced** it in the evidence available at pause. Required repair checks already-aborted state and forbids later dispatch, plus a mounted delayed-auth/rate regression. No repair was made by this reviewer.

## Partial coverage and retained observations

- Original held OAuth suite independently passed27/27; ten extra reviewer adversarial PostgreSQL tests passed10/10. Initial loopback sandbox failure and initial rate-limited fixture attempt remain preserved.
- Updated OAuth/persistence/retention/lifetime suite independently passed42/42, exit0 (`oauth-focused-round-3.log`), using unique schemas in the selected disposable loopback PostgreSQL harness. This is component evidence on changing integration source, not full acceptance.
- Persistence disclosure repair source was inspected: explicit offlineAccess and truthful900-second access/30-day family/conditional7-day refresh idle fields. The earlier disclosure gap is resolved in the candidate inspected.
- Retention service source was inspected: live-family code/refresh hashes retained, seven-day conservative terminal identity anchor, bounded top-level batch with SKIP LOCKED, request redaction and orphan protection. An observed DCR cleanup inconsistency was resolved in current source by its pending-request exclusion; no open finding remains on that candidate path. Fresh manifest/tests must bind the repaired bytes.
- Typecheck and27-migration parity passed earlier and remain preserved as observations, not final source-bound approval.
- Partial source trace covers private Request WeakMap identity, external OAuth rejection on ordinary REST, stable connection-based create receipt keys and credential/project/board/assignee lock order. Full reachable dependency review, independent assembled tests, actual wired Node/workerd PostgreSQL checks, grant/revoke/create races, complete required regressions and browser acceptance remain incomplete.
- Transport builder reported an actual Worker+PostgreSQL test failure under diagnosis and source not held. No passing final manifest or whole-feature result has been issued by this reviewer.

## Processes and resume boundary

No reviewer-owned process remains running. Unified exec session82277 (42-test focused run) completed exit0 and was collected. Both probes and all other reviewer commands completed. Review stopped immediately after the parent relayed the user's explicit pause; only this checkpoint and lightweight copies of three affected source files were saved afterward.

On explicit resume: independently reproduce the two failures at Architect level; coordinate builders' repairs; retain these failure artifacts; obtain a new held manifest; rerun relevant mounted/runtime tests and complete the unchanged overall gate. Do not treat this checkpoint as UI-ready or deployment authorization.
