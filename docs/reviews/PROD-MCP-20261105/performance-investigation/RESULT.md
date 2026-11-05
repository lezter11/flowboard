# Local Worker CPU investigation after production rollback

**Finding:** rebuilding Hono's default SmartRouter/RegExpRouter on every request is a measurable avoidable cost. A strictly local TrieRouter experiment reduces this cost while preserving per-request app construction. This is evidence for a narrow optimization, **not proof that it is the sole cause of the observed hosted CPU failures**. Production was not contacted, tested, changed or redeployed by this investigator.

## Frozen input and ownership

Used the existing clean candidate `/private/tmp/flowboard-prod-release-40e51e1`, deployed-candidate source `40e51e1336a783a6b450806260ed6c5aa8ace0ea`. Actual compiled Worker input SHA256: `b66ea3c07de35f7921551d33236cdb3f9f88cb64e3596c8ac079a8bfa711da21`. Node24.15.0, installed Wrangler4.156.2 and local workerd1.20261102.1. No application files, dependency files, credentials, Docker resources or cloud accounts were changed. All probes/results are inside this owned directory.

Source diff versus production's rolled-back `3a82b24732166b1c570c5d2b52d0e73db6122497` confirms **both** entry points build a new pool and `createApp` for each request. Newer code adds PAT/OAuth routes and middleware, image admission/verification context, actual-work lifetime retention and cleanup. This investigator did not build or execute the old production artifact; the independent reviewer's Node baseline comparison is separate evidence.

## Actual local workerd measurements

The existing Wrangler test harness ran compiled Worker code against synthetic loopback configuration. Every measured path is anonymous and performs no database query. A synthetic pool URI points only at unused loopback; no real database was provisioned or contacted. The harness uses two owned workerd processes; measurements sum both process CPU times (`ps`,0.01second resolution), rather than accidentally reporting only the idle proxy process.

### Ordinary requests,1000 sequential requests per path

| Path | Original processCPU/request | Trie experiment | Statuses |
| --- | ---: | ---: | --- |
| `/health/live`, first mixed warm-up batch |2.95ms|2.10ms|1000×200 each|
| `/api/v1/session` |1.56ms|1.41ms|1000×401 each|
| `/.well-known/oauth-authorization-server` |1.51ms|1.37ms|1000×200 each|
| `/api/v1/mcp` |1.54ms|1.48ms|1000×401 each|

Receipts: [original](current-harness-v2-workerd-requests.json), [Trie](trie-harness-workerd-requests.json). These include local HTTP/harness/runtime overhead; they are not Cloudflare per-invocation CPU accounting. The health row mixes first-use/JIT/GC costs and cannot be called isolated cold-start CPU.

### Internal loops amortizing the local HTTP bridge

Each outer local request performs100internal fetch calls;10outer batches produce1000internal operations per row. This is a nondeployable profiler wrapper, not actual user traffic. `worker` calls the actual compiled default Worker fetch. `app` calls the actual compiled `createApp` with a no-query fake pool, excluding the real pool constructor/end and entry-point binding setup.

| Mode/path | Original processCPU/internal request | Trie experiment | Reduction |
| --- | ---: | ---: | ---: |
| Worker `/health/live`, mixed warm-up |2.02ms|0.98ms|51%|
| Worker `/api/v1/session`, warm |1.13ms|0.73ms|35%|
| App `/health/live` |0.84ms|0.55ms|35%|
| App `/api/v1/session` |0.86ms|0.48ms|44%|

Receipts: [original loops](current-loop-internal-loops.json), [Trie loops](trie-loop-internal-loops.json). Each original/Trie run returned1000expected statuses per row and closed its harness. Warm original Worker-versus-app session difference is approximately0.27ms; it includes pool construction/retirement and Worker binding setup and does not isolate those individually. With no actual PostgreSQL I/O, this does **not** measure TLS, Hyperdrive, authentication queries or database response costs.

## Experiment provenance and reproduction

[derive-trie-probe.mjs](derive-trie-probe.mjs) asserts the exact original B66 hash and exactly one literal constructor occurrence, replacing only:

```text
this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
```

with:

```text
this.router = options.router ?? new TrieRouter();
```

[Derivation receipt](trie-derivation.json) binds original and derived bytes. Derived SHA256 is `8f1fac06041d3e94ffb5eecff9bf368721e3687cc0249f311dfd9790e4215ad8`. This compiled-Hono substitution is broader than the intended product fix (an explicit router choice for Flowboard's app only). It is **not approved application source and must never be uploaded**. The parent-assigned builder owns the actual narrow application fix and tests.

The internal-loop script separately appends an export of `createApp` to the original compiled bytes and bundles a local wrapper. It preserves the original code's control flow, but the wrapper and build are explicitly experimental rather than claimed as identical deployment artifacts. Large generated bundle copies were removed after completed measurements; both generators deterministically recreate them. Probe scripts and receipts remain.

Run the scripts with the pinned candidate dependencies and sanitized environment (`NODE_OPTIONS=--dns-result-order=ipv4first`, `WRANGLER_SEND_METRICS=false`; no DB/test/secret environment). `workerd-requests.mjs` accepts candidate, artifact, count and label. `workerd-internal-loops.mjs` accepts artifact and label. Recreate the Trie experiment first with `derive-trie-probe.mjs`. Loopback-listen/`ps` permissions are needed; no Docker, cloud credentials, hosted Actions or production endpoint is required.

## What did not work, retained honestly

- Initial sanitized PATH omitted `/usr/local/bin`: exit127, retained [log](current-workerd-run-initial.log).
- Direct Miniflare5 was first called with old top-level options: validation refusal, exit1; [report](current-workerd-profile-invalid-api.json).
- Corrected direct-Miniflare attempt was blocked by sandbox loopback `EPERM`: exit1; [log](current-workerd-run-sandbox-denied.log).
- Direct Miniflare with inspector enabled then hit an opaque local runtime startup error: exit1; [log](current-workerd-run.log). No CPU profile was collected. The exact compiled artifact subsequently ran successfully through the existing Wrangler harness; the direct harness failure is not identified as an application defect.
- First Wrangler run selected only one of two workerd PIDs and used an incorrect virtual host, producing misleading near-zeroCPU/MCP403. Original [receipt](current-harness-workerd-requests.json) remains as invalid instrumentation evidence; it is excluded from conclusions. The corrected paired runs include all child workerd PIDs and the exact virtual host.
- All corrected paired request/loop runs exited0. No database/hosted/provider test is implied by those successful commands. No profile demonstrates Google/Claude refresh, real storage/mail, high-concurrency correctness or hosted CPU-cap compliance.

## Recommendation and remaining proof

Prefer an explicit TrieRouter for Flowboard's app over globally caching the entire Hono app. `createApp` captures request pool, health callback, storage/verifier, work-lifetime callbacks and limits; naïve global reuse risks cross-request state and pool ownership. The narrow router change retains the established isolation/lifetime model. Independent route/middleware/params parity and mounted-handler tests must cover its semantics; this investigator's performance probes are not authorization proof.

Rebuild and review a fresh immutable source, run required local/CI acceptance, deploy UAT first and observe actual runtime behavior with safe endpoint-family categories and CPU accounting where provided. Historical production monitoring retained aggregate counts only, so its failures cannot be attributed retrospectively to specific routes. Production should remain on the rolled-back baseline until the new candidate clears those gates. A relative local speedup cannot alone authorize another production attempt.
