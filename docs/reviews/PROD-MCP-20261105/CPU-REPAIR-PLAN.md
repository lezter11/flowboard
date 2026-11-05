# CPU repair acceptance — established before product edits

Production promotion is blocked after actual exceededCpu outcomes; the prior Worker/Pages were restored without reverting database27. User authorization to finish the production promotion includes repairing this observed release defect, not changing paid account settings.

## Measured candidate and scope

Both old and current Workers rebuild the Hono app per request. Independent synthetic Node profiling found current fresh health construction/dispatch2.187ms CPU versus old1.488ms. Current TrieRouter candidate0.628ms (~71% lower), session0.597ms versus2.053ms. These are local process-CPU measurements, not Cloudflare-metered CPU or proof of sole cause. Profile paths and the normalized2400case route parity live in operations-review/performance evidence.

Use the documented Hono TrieRouter only for the main request-local app. Do not cache an application, database pool, actor, SDK server or mutable request capabilities globally. Do not change authentication, authorization, SQL, limits, parser budgets, project scoping, migration data, cloud routing or billing to pass this repair.

LinearRouter is rejected: after removing parameter-object key-order artifacts,120 genuine trailing-slash routing differences remained. Preserve both the original135raw differences and corrected normalized result; no functional difference is ignored to improve a score.

## Mandatory acceptance

1. Main app explicitly uses TrieRouter; all actual route registrations/order and normalized decoded parameters match the prior SmartRouter over2400representative/adversarial cases. Exact MCP path, trailing slashes, unsupported methods, wildcard middleware and nested IDs retain behavior.
2. Preserve per-request pools and contexts and all five MCP tools. No global mutable application cache, cross-user state or relaxed security checks.
3. Add meaningful mounted route-boundary regressions for malformed/encoded/trailing-slash paths and exact MCP authentication/discovery behavior. Preserve existing generated route coverage and real disposable-PostgreSQL authorization/concurrency suites.
4. Run required local type/build/contracts/MCP/full API tests on a separate disposable database, recording real counts/exits. Keep source-bounded prior UI evidence when UI bytes are unchanged; do not invent UI reruns.
5. Reprofile actual local runtime before/after on synthetic inputs. Establish the improvement without weakening limits or calling Node/localworkerd timing equivalent to hosted CPU enforcement.
6. Freeze exact full reachable source and obtain fresh independent BACKEND_REVIEW_GATE approval (>8.5 plus all category floors/no blockers), including route parity and negative cases. Prior release scores do not waive deployed failures.
7. One new exact reviewed CI candidate only after local proof, then clean artifacts and UAT verification. Hosted candidate must not exhibit CPU-limit failures during its bounded representative observations before production reattempt. Owner auth acceptance remains distinct; seek owner participation for signed-in hosted tests rather than using credentials from chat.
8. Production reattempt requires current backup/migration state and rollback IDs; no redundant migration or data restore. Preserve the failed rollout and stop/rollback again if resource failures recur. Never claim the failed initial789second window was clean or complete.

Architect owns coordination/root docs. Backend builder owns only apps/api/src/http/app.ts and relevant apps/api tests. Profile agents are read-only on application source. A fresh reviewer did not implement the repair. Docker may be used only for required isolated regressions and stopped afterward; no hosted Actions debugging loop.
