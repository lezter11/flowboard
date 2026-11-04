# Backend API gate round1 — fail, mandatory regression

Final backend/transport phase criteria were frozen before execution in `../backend-criteria.json`. This run used dedicated disposable PostgreSQL17.11 container `flowboard-hosted-independent-16038`, loopback63931, four guarded test databases and no host volumes. Source maps before/after show no changed files during this failed run.

- Required OAuth component command: exit0,55/55 pass.
- Required complete API command: exit1;1386 tests,1333 pass,53 fail,0 skipped,358729.462625ms.
- Remaining eight required commands were deliberately left unexecuted after the mandatory failure, not reported as passing.

Failure root cause independently reproduced without credentials: `createApp().routes` explicit inventory114 versus OpenAPI118, with only four missing documented operations: POST/GET/DELETE/OPTIONS `/api/v1/mcp`. The live protocol is handled by an early ALL middleware branch, which all three inventory tests omit. Every generated cookie mutation subcase fails at its initial inventory assertion before its authorization cells execute; OpenAPI parity and route-auth inventory also fail. These53 failures are not53 demonstrated authorization vulnerabilities.

Repair requirements conveyed to Architect/builders: declare actual documented protocol methods while preserving the early authentication/body/deadline boundary and unsupported-method behavior; extend generated matrices for protocol-specific status/envelope/preflight semantics and genuine cookie-bound OAuth request/connection workflows. Preserve every existing REST matrix cell and real success control. No blanket OAuth exemptions or invented input fixtures count as coverage.

The reviewer changed no product source or API test fixture. Exact failed logs, command results and source hashes are preserved here before builders were released to repair the target. A new held revision and full mandatory rerun are required. Backend API closure and UI handoff remain blocked; no score can override this failure.
