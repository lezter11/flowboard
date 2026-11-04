# Oversized-body cancellation repair

2026-11-04. Status: builder verification passed; independent full-feature gate pending. Base WIP commit `b78f21836d29daf814a2999a22acd34db5680875`.

## Problem and change

The protocol's declared-size and streamed-size rejection paths awaited the request stream's cancellation promise. A synthetic underlying source could return a promise that never settled, keeping the HTTP refusal and retained Worker request lifetime pending even though no tool should execute.

Both branches now request cancellation without awaiting its completion, catch cancellation rejection, and immediately return the existing413 response. This matches the OAuth body guard's bounded-refusal approach. Body limits, parsing, credentials, tool definitions, accepted payloads and database transactions are unchanged.

## Evidence

- Added declared-size and streamed-size regressions before the fix. Both failed because the HTTP refusal waited for source cancellation: `logs/cancel-regression-red.log` preserves that target's failures.
- After repair, Node protocol **11/11** passes. Each new case uses a real ReadableStream whose cancel method returns a never-resolving promise and verifies prompt413.
- Mounted app **11/11** passes. The new mounted case verifies declared/streamed413 and actual `onMcpWorkLifetime` settlement despite uncooperative cancellation, through OAuth verification and the parent one-connection PostgreSQL pool.
- Actual SDK workerd **1/1** passes. The mounted suite also executes actual production Worker+isolated PostgreSQL create/replay with Node-issued OAuth. Combined **23/23**, exit0: `logs/cancel-repair-focused.log`.
- `npm run typecheck` exited0 against the repaired source. Full required checks and independent scoring belong to the full-feature gate.

## Held target and limits

New builder-owned17-file manifest: `source-manifest-cancel-repair.json`, digest `f18e4fc458270784a8dfe5d5bac3c6d284a497a8e1f4fa237654f9315860dd51`. It records exactly three changed files: the transport service and its protocol/mounted tests. Prior manifest `a127c16da221630f1225c035b7cfad3bd493cb2e3ea7d6dd51c8e0a2db52ca65`, pause/checkpoint documents and failed evidence remain preserved.

This is a source hold and builder result, not a backend handoff, UI-ready decision, independent score, cloud deployment or real Claude acceptance. The coordinator/reviewer must include all reachable OAuth/runtime/contracts/config dependencies in the complete review target. No cloud, push or production action occurred during this repair.

Reproduce focused checks from the repository root with `node docs/reviews/HOSTED-MCP-20261104/transport/run-focused.mjs`; select an authorized disposable local DATABASE_URL or use the existing private harness fallback. Never print harness credential values. Tests create/drop only unique schemas.
