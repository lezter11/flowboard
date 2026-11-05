# Auxiliary anonymous release smoke source review

Reviewed 2026-11-05T09:44:47.274271+00:00 by fresh independent operations reviewer `/root/production_operations_review`. **PASS for bounded anonymous probe source only. NOT EXECUTED.** No prior held helper target was edited.

Actions: Read complete script and semantic referrer helper; compared against prior anonymous-hosted-smoke-v2.mjs. `node --check docs/reviews/PROD-MCP-20261105/anonymous-release-smoke.mjs` exited0. No HTTP/provider/credential/database operation executed.

Why and options: Anonymous probes check whether Flowboard refuses unauthenticated access and serves the prepared public files. They cannot prove an Owner can connect Claude and create a card; that requires separate signed-in acceptance. Exact public-byte checks help detect a stale deployment without creating any application record.

Request boundaries: exactly17 requests on a complete path, hard cap25; serial requests, each15second AbortSignal timeout, manual redirects (no follow), credentials omitted and Authorization/Cookie explicitly refused. Only exact target-derived Pages origin and its known direct Worker origin are allowed. Paths require one leading slash and resolved URL origin must equal selected base, rejecting scheme/host changes. No registration/authorization/token-exchange/revoke/upload/tool-create/card endpoint is invoked. MCP POST carries anonymous JSON-RPC ping only; other POST-free calls are GET/DELETE anonymous MCP authorization rejection, OPTIONS preflight or public health/static/meta/session checks. Server security counters may be touched by anonymous requests; application record mutation is not requested. Response bodies are capped4MiB by declared length and accumulated streaming bytes; cancellation is attempted on overflow. No response/application body is persisted, only boolean checks/status/size/hash and safe error class.

Assertions: Existing exact metadata issuer/resource/endpoints,401Bearer challenge/no-store/no credentials/no cookies/error-only MCP checks,403attacker origin,401session/tokens/connections and same-origin sign-in next-value checks are unchanged. Semantic effectiveReferrerPolicy helper remains byte-identical and last recognized policy must be no-referrer. Changes select exact settings JS instead of connect/fallback JS, additionally require Copy sample prompt bytes, parameterize allowlisted environment/fullSHA/stage, and add directWorker live/ready health checks; these do not weaken authentication checks. Prepared connectHTML/settingsJS/CSS bytes and manifest hashes must match downloaded bytes; static assets must remain immutable, with no redirects.

Path/source boundaries: Full40hexSHA must match stage artifact-manifest sourceCommit; stage is lexically restricted to /private/tmp/flowboard-* and report lexically to this release directory, existing report paths refused and final write uses exclusive wx/mode0600. These are trusted operator-owned paths; parent directories are not realpath/symlink hardened. Root must select canonical owned staging/report directories, bind stage manifest to actual reviewed build, and verify provider Worker/Pages version/source separately. Optional Worker/Pages IDs are recorded labels, not provider-verified here. A malformed/missing artifact or top-level assertion can terminate without a completed JSON report; nonzero exit remains failure and must not be presented as success.

Evidence and limits: Source comparison and syntax only; no live success asserted. Root must execute only after matching deployed candidate, retain actual exit/status/17checks, and separately satisfy releaseCI, fresh production backup/migration, provider bytes, observation and Owner acceptance. This review grants no backup deletion authority; pending quota permission remains pending.

Next / your input: Root may run unchanged probe after its deployment gates. No user action needed for this source review.

Exact inspected source hashes:

- `docs/reviews/PROD-MCP-20261105/anonymous-release-smoke.mjs`: `1a3ccea40d8462774ce22381bea2aa18b63839e05b3ed14c30819558d3d3c925`
- `docs/reviews/HOSTED-MCP-20261104/release-dce1a67/referrer-policy.mjs`: `954e2365083027ca409f34cfc6651a65ead6cd314a26c8009729b6c3929cf840`
- `docs/reviews/HOSTED-MCP-20261104/release-dce1a67/anonymous-hosted-smoke-v2.mjs`: `7117fca5d2bf53c2d5cc3b6dd9a07434c874ae2dc651d6d985a6ab00f776858b`
