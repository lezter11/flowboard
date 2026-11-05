# CPU regression investigation after production rollback

Actions: Confirmed a local CPU hotspot and a narrow framework-router candidate. This is investigation evidence, not fix approval or production acceptance. Failed Worker58a363e0 was rolled back to756fdc6e at100%; Pages76ca822d was rolled back to876eacf4/source3a82b24, per the separately supplied provider receipt. Production schema27 and the new backup remain. No source, paid configuration, cloud state or application data was changed by this reviewer.

Why and options: Flowboard creates a fresh Hono app for every Worker request. Hono's default SmartRouter registers every route and builds its RegExpRouter matchers when that fresh app handles its first request. Because the Worker discards the app afterwards, even a simple health request pays for compiling the entire routing table again. The old release already used this pattern; the new release expands the route list from209 to242 entries. A request-local TrieRouter builds a path tree during registration and searches that tree, avoiding the full regular-expression matcher build. It costs more registration work than merely queuing routes, but was cheaper overall for these one-request app instances. Reusing one global app could remove still more work, but the app currently closes over request pools, storage, verifier and work-lifetime callbacks. That introduces identity/lifetime risks and is unnecessary for this first bounded candidate.

Measured evidence on Apple M5/arm64, Node24.15.0, installed Hono4.13.14: each workload ran five rounds of300 operations, separately from CPU profiling. CPU values below are the median of the five process-CPU averages, including user+system time. They are not Cloudflare metered request CPU.

| Synthetic workload | Old3a82b24 SmartRouter | Failed40e51e1 SmartRouter | Current derived TrieRouter |
| --- | ---: | ---: | ---: |
| Fresh app plus health |1.488ms|2.187ms|0.628ms|
| Fresh app plus anonymous session |1.487ms|2.053ms|0.597ms|
| Fresh app plus metadata |1.493ms, old404|1.965ms|0.507ms|
| Reused app health, diagnostic comparison |0.077ms|0.071ms|0.081ms|

Current fresh health's separate V8 profile assigns61.77% of self-sampled time to Hono router code and22.96% to garbage collection. Largest router frames include buildRegExpStr, add, trie insert and buildMatcher. Repeated matcher construction is a measured CPU amplifier: current health CPU is47% higher than the old-source comparison, and the derived TrieRouter probe uses28.7% of current default CPU. Route construction itself is only0.147ms for default versus0.521ms for Trie; the default's later matcher build is the expensive part. Raw round measurements, wall-time percentiles and V8 profiles are preserved here. A separate agent owns real workerd corroboration; process/HTTP-bridge CPU there has different overhead and cannot be mixed with these numbers.

SDK/Zod distinction: the hosted SDK and schema modules are eagerly imported, so they can contribute to isolate startup. Total Node import CPU increased from175.4ms to242.8ms across the two app snapshots, but many imports changed, so this delta cannot be assigned solely to SDK/Zod. The actual createFlowboardMcpServer/tool-schema construction happens only after an authenticated MCP POST reaches the transport. There are no SDK/Zod frames in the warm ordinary health profile. Separate synthetic SDK construction/initialize/tools-list measurements are preserved in mcp-synthetic-cpu.json; they exclude OAuth, database and rate checks. Router work and SDK startup/tool work need separate budgets.

Router behavior evidence: the supported LinearRouter is faster in this fixture, but is not a compatible replacement. It matches trailing slashes where the current default does not, including /api/v1/mcp/. The first parity output found135 differences;15 were parameter-object key-order artifacts, which were corrected by normalizing keys. All135 original comparisons remain in router-parity-initial-includes-keyorder.json; the120 genuine route differences are retained in router-parity.json. Do not apply a plain LinearRouter swap.

TrieRouter matches all2400 actual-route/method/path probes after normalizing parameter key order, including exact MCP paths, descendants, trailing slashes and unsupported methods. Another1183 cases use actual HonoRequest.param() decoding with distinct encoded parameter values. All72 mounted public/anonymous negative cases preserve status, body and security headers, including MCP and OAuth path/method policy. Those tests make zero database or external calls. This is useful candidate evidence, not a substitute for PostgreSQL-backed role/authority/concurrency tests.

Causal limits: the production tail deliberately retained only aggregates, so it cannot establish which endpoints exceeded CPU or prove this hotspot caused every hosted failure. It also cannot classify the41 exceptions retrospectively. The Node CPU profile confirms where this fixture spends CPU; it does not establish the active provider plan or an absolute Workers CPU allowance. Older API source3a82b24 is the recorded D24 baseline; the rollback receipt verifies Worker version and Pages source, while this investigation did not independently hash the old hosted Worker module. Idle PostgreSQL errors also occur on a UAT control and remain a separate lifecycle problem. Do not attribute CPU exhaustion to the production pooler alone, and do not call pool errors harmless merely because requests returned200.

Recommended bounded builder scope: select Hono's exported TrieRouter for the main request-local createApp only, retaining every existing middleware, route, request pool, callback, deadline and cleanup boundary. Keep the normal default route factories and avoid global pools/apps, custom path normalization, relaxed authentication, changed limits or paid CPU settings. Review the resulting exact source separately.

Proposed acceptance criteria before another promotion:

1. Preserve all2400 route selection/order/parameter comparisons,1183 decoded-parameter checks and72 mounted status/body/security-header cases. Add these as meaningful regression evidence; retain the LinearRouter rejection cases. Run the existing mounted PostgreSQL authorization, cookie/PAT/OAuth, exact MCP path/method, concurrency and work-lifetime suites, plus the actual local workerd entry-point tests.
2. Repeat the fresh-request benchmarks against an immutable before/after pair with the same lockfile, runtime and fixtures. Target median process CPU at most40% of the failed default baseline for health, anonymous session and metadata over at least five independent batches. This is a proposed local relative target justified by the measured Trie probe, not a hosted budget guarantee. Report wall percentiles and GC separately; do not average a reused-app benchmark into the acceptance claim.
3. Measure real local workerd with the production-shaped request lifecycle, warm and cold runs, and mixed public, anonymous401 and authenticated synthetic paths on an isolated database. Include concurrent requests from distinct actors to prove request pools and authority stay separate. Profile SDK initialize/list/call and maximum allowed import/image workloads separately; a router fix does not waive their existing deadlines and data limits.
4. Reconfirm the actual existing provider CPU/runtime settings read-only. Use those facts to set a concrete headroom target for each representative workload before release; do not assume an unverified plan allowance or raise a paid limit to conceal a regression. Capture only fixed endpoint families, outcome enums and bounded numeric CPU/timing fields if a new observer is needed, never raw URLs, query strings, IDs, messages or credentials.
5. Pass the exact-candidate local checks, independent review and required final CI in the established order, then UAT acceptance before production. A new bounded observation must have zero exceededCpu and uncaught exceptions; keep the original strict error-log predicate and resolve or explicitly disposition the separate pool errors. Preserve all failed attempts. Owner sign-in, tool-create and disconnect acceptance remain distinct from anonymous smoke.

Reproduction from the repository root, with the existing exact-lock local dependencies:

```text
python3 docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/prepare-old-source.py
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/build-probes.mjs
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/build-trie-probe.mjs
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/benchmark.mjs old
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/benchmark.mjs current
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/benchmark.mjs current-trie
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/trie-router-parity.mjs
node docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance/mounted-router-parity.mjs
```

The probes bundle isolated old/current tracked app and contract source, with the same installed external libraries. Derived-router substitutions happen only in esbuild probe memory/output, never product source. Existing receipt files must be copied aside before rerunning if their original bytes are needed as evidence. The initial synthetic MCP probe path error is retained separately; the corrected probe passed.

Next / your input: Architect should settle the criteria and assign the narrow builder task, then obtain fresh independent acceptance. This investigation does not authorize a new production promotion or mark the release complete.
