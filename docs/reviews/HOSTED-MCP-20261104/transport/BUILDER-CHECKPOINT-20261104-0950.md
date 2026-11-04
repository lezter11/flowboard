# Transport/runtime resume checkpoint — 2026-11-04

User timebox: resume09:28:26UTC, stop09:50:26UTC. This checkpoint records the held builder scope; it is not independent approval or deployment acceptance.

## Repaired and verified this resume

1. Confirmed the actual Worker requester root cause using a credential-free workerd probe: `Request` rejects `redirect:'error'`, supporting only follow/manual. Hosted local Request construction now uses manual; the in-process dispatcher performs no network fetch or redirect following, and the client rejects3xx. PAT network fetch retains redirect:error.
2. Repaired already-aborted MCP body handling and added direct and mounted delayed-verification regressions. Cancellation now settles the true lifetime and no tool dispatch begins after the observed cancellation guards.
3. Mounted Auth's cancellable16KiB OAuth/consent body helper after correlation and before generic buffer/PAT/origin/rate middleware. Generic body/deadline middleware skips only the helper's exact implemented POST paths. Auth owns the helper and its specific lifecycle tests.
4. Fixed the test-only Miniflare/global Response type mismatch using the narrow json() method interface. Each test now resets only its own unique-schema rate windows so unrelated consent setup does not exhaust the per-user fixture allowance.

## Held source and passing evidence

- Own17-file manifest: `source-manifest.json`, digest `a127c16da221630f1225c035b7cfad3bd493cb2e3ea7d6dd51c8e0a2db52ca65`. Rechecked09:48:20UTC: **no changed bytes**. Full-feature review must also freeze Auth/root-config/contracts/Worker dependencies.
- Combined mounted/Node protocol/real workerd: **20/20**, `logs/mounted-final-local.log`. Includes real production Worker+isolated PostgreSQL create/replay with one request connection; separate-connection create/disconnect in both lock orders; refreshed-token replay; current board/membership/archive checks; strict OAuth/PAT/session/REST boundary; streaming and queued-verification deadlines; connection limits.
- Existing PAT/token regression: **24/24**, `logs/pat-regression.log`;108 denied route cases over114 mounted routes.
- Root typecheck exit0, MCP **22/22**, packed executable **1/1**: `logs/{typecheck,mcp,artifact}-held.log`.
- Reusable focused command: `node docs/reviews/HOSTED-MCP-20261104/transport/run-focused.mjs --record`, using the explicitly selected disposable local harness. Never print the private harness configuration.

## Remaining review concern and release limits

The independent reviewer raised a late robustness candidate: oversized-body branches in `hosted-mcp-transport.ts` still await body/reader cancellation. A synthetic source with a never-settling cancel promise can keep the direct transport pending. The reviewer did not establish a remote exploit. Proposed narrow repair is fire-and-forget cancellation, matching the OAuth helper, with a declared/streamed oversize regression. Architect coordination was requested because source was already held; **no uncoordinated repair was made**. If unresolved at the timebox stop, retain this as an open concern rather than call the feature approved.

Whole-feature independent acceptance, required broader product regressions, UI/integration approval and real hosted browser/Claude acceptance remain the coordinating Architect's gates. No UAT or production mutation, push or deployment occurred in this builder stream. The existing UAT deployment remains unchanged.

## Processes

All owned execution sessions completed. No builder-owned local Worker, test transaction or background process is known to remain. Test cleanup closed harnesses/clients, removed temporary config and dropped only unique schemas. Parent owns disposable Docker shutdown. Resume work after the timebox requires the user's next instruction.
