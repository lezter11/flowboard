# Bounded hosted browser portability repair

## Actions

The hosted runner uses the already-established legacy platform choice: an explicit custom executable has precedence; Darwin retains installed Google Chrome; non-Darwin defaults omit the executable path and use the pinned Playwright-managed Chromium. No browser cases, assertions or timeouts changed. The runner imports a small diagnostic projector, includes that helper in its source guard, and prints projected setup diagnostics in the final stdout summary.

The projector accepts a fixed error-type set and extracts only numeric line/column with fixed `hosted-mcp-browser.mjs` filename. It never copies arbitrary names, messages or stack lines. Name/stack accessors are read once and protected against throwing accessors. Its direct regression exercises synthetic secret-bearing names/messages/stacks, malformed locations, changing/throwing accessors, actual runner platform selection and both case/setup integration sites. Root command wiring is Architect-owned.

## Why and options

A Flowboard consent test needs a browser installed on its host. A macOS application path is unsuitable on Linux. Letting Playwright choose its installed browser on Linux preserves package/browser compatibility, while retaining the working Mac choice. Changing CI installation, dependencies, permissions or case behavior would expand this repair without addressing that host-path defect.

## Evidence and limits

- `diagnostic-regression-held.log`: four focused tests pass against held source.
- `linux-baseline-red.log` and `linux-baseline-red-runtime.json`: actual local Linux ARM64 Node24.15 executes original e5 runner line217 verbatim, reports safe Error at runner217:28, confirms missing executable and original Mac path in memory, exits1. This is a local reproduction, not the undisclosed earlier CI exception.
- `baseline-original-runner.mjs`: original e5 source preserved; no app/API/contract/parser/schema changes.
- `held-source.json` and `linux-source-copy-preflight.json`:754 public source-file hashes; copied snapshot equals this manifest. Operational documentation is not behavioral acceptance input and is separately owned by Architect. Linux acceptance source/dependencies are readonly; Git initialization belongs only to the disposable public source copy.
- Mac and explicit bad-path accepted executions are independently owned and recorded under `../independent-review/new-reviewer/`; their detailed manifests bind the held runner.
- Original first bad-path attempt is retained in `mac-bad-executable/` and `mac-bad-executable.log`: exit1/cases0 but sourceChanges2 because Next regenerated config for a custom cache path. Both generated files were restored exactly, and execution control now uses existing `.next` convention. That attempt is not passing evidence.
- Reviewer first Mac attempt without loopback sandbox escalation is retained as its own failed attempt. Accepted retry uses authorized escalation; no underlying browser assertion changed.

Linux green acceptance and final cleanup receipts are recorded below. No hosted reruns, push, commit, production/UAT writes or full API reruns are part of this builder task. Linux ARM64 is not GitHub x64 hardware equivalence.

## Next / your input

Independent reviewer judges the held target and Linux evidence before Architect can assemble the review. No user action needed.

## Completed Linux acceptance

`linux.log` records the exact original root command exit0,24/24 passed, zero setup failure and sourceChanges0. `linux-source-copy-postflight.json` verifies all754 copied hashes remain identical, zero failures, blocked origins, unexpected console and unexpected HTTP. `linux/report/result.json` holds full sanitized case/network evidence and runner source hashes.

`linux-preflight.log` passes Git2.43, Next availability, exact package1.64.1 and read-only parser patch verification. `linux-identity.log` records an actual managed-browser smoke launch156.0.8078.80, Node24.15, no executable override/NODE_OPTIONS, node/browser/lock hashes. `linux-image.json` records official Playwright1.64.1-noble image digest `sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f` LinuxARM64. Its default Node26.13 is separately disclosed; execution explicitly mounts only the public pinned Node24.15 binary from the existing Node image. `pinned-node-binary.json` equals the execution binary hash. This is runtime selection, not a module hook, dependency overlay or source substitution.

`execution-commands.jsonl` records Docker command/mount inventory and environment variable names; no credential values. No host credentials/configuration were copied. Git safe-directory configuration is explicit for the disposable public index only. `local-control.mjs` and `linux-identity.mjs` are evidence-only execution controls, not product implementation.

`cleanup.log` records actual PostgreSQL browser-schema count0, then owned disposable database container stop/removal. The browser test container used `--rm`; no running containers remained. Docker Desktop was stopped after the proof. Public cached images/dependency volumes remain unchanged for reuse. Private temporary generated credentials/state paths are excluded from published review evidence.

Implementation and local Linux/Mac verification are complete; independent review and Architect acceptance remain separate. No hosted CI/UAT/production acceptance is claimed.
