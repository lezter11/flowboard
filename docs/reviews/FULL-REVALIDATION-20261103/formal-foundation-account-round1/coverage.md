# Round 1 coverage and outcome

Status: **fail, no approval**. Confirmed mandatory shared privacy blocker FNDACC-R1-01. Numerical category scores and closure records are not issued: required independent14 execution was deliberately held for the corrected immutable target, and the common final comprehensive manifest was not supplied for this rejected target. Do not turn these preliminary artifacts into a passing handoff.

## Identity and source

See independence.md. All611 source hashes were independently checked against source-before.json, digest27db43d94d3a45bfea41b6d8e3cffba3e07bb6118e0c0b08437ab5b7c011910b. No mismatches before or after the completed probes. Application/config/criteria source was not edited.

## Reachable source reviewed

- Mounted Node/Worker path: runtime/node.ts, runtime/worker.ts, runtime/local-config.ts → http/app.ts → pool injection/AsyncLocalStorage, PAT policy, origin/rate limits, timing/body/deadlines, no-store → route handlers → PostgreSQL helpers. bootstrap configuration shape differs from middleware responses; hosted runtime behavior is not inferred from local tests.
- FND01/04: adapters/postgres.ts; http/middleware/auth.ts, token-policy.ts, origin.ts, rate-limit.ts, correlation.ts, timing.ts, limits.ts, error-handler.ts, rbac.ts; services/rate-limit.ts; adapters/rate-limit-postgres.ts; http/errors.ts; API/package/root package, .node-version, wrangler.jsonc. Read runtime-validation and observability test coverage; own runtime-validation execution was skipped without identity-extra URL and is explicitly not credited as run.
- FND02: contracts/auth.ts, common.ts, projects.ts, workspaces.ts, contracts package exports; feature definitions and frozen criteria. Generated OpenAPI parity is observed builder evidence until independent rerun.
- FND03: adapters/migrations.ts, embedded source linkage; SQL migrations0001,0002,0003,0004,0019,0020,0026 directly read; migrations.test.ts checks clean install, ancestry, uniqueness, transactional failure and advisory migration concurrency. Remaining feature-specific migrations rely on the complete frozen inventory and cross-domain review, not a claim that this reader line-reviewed all SQL.
- ACC01/02/03: routes/session.ts, google-auth.ts, adapters/session.ts, personal-workspace.ts, safe-next.ts; contracts/auth.ts; Google/user-name/session and lifecycle tests. Google code exchange and userinfo are mocked in local tests. Verified-email refusal and state handling are local-path evidence only.
- ACC04/05/06/07: routes/workspaces.ts, projects.ts, adapters/personal-workspace.ts, own-projects.ts, last-location.ts, rbac.ts, tokens.ts; quota/retirement/owner-context source. Retirement returns authenticated typed410; ownership transfer is not an implemented capability.
- Shared directory/authority: routes/members.ts/projects.ts; adapters/rbac.ts; token-policy.ts/token helpers. Explicit Bearer cannot inherit cookie authority; capability allowlist covers six operations. Correct /members directory guard does not protect unscoped /people display.
- UI/proxy dependency inspection: web lib/session.tsx, session-state.ts, protected-drafts.ts, session-identity.ts, dates.ts, api.ts; shell/session-gate.tsx; settings/people page relevant source; Functions API proxy and _middleware. This source inspection does not award UI or integration phase closure.

## Executed evidence

- Own focused-people-runtime-authorized.log:10 tests,10 pass,0 fail,0 skip, exit0. Uses only random schemas in owned disposable PostgreSQL17.11 loopback55931 identity-extra DB; tests drop their schemas.
- Own focused-http-pure.log:49 tests,46 pass,0 fail,3 skip, exit0. Three runtime-validation tests lacked configured identity-extra URL and were deliberately skipped; this is not all-runtime evidence.
- Own people-display-probe.ts/.log: exit0, actual mounted API and PostgreSQL reproduction of privacy defect for Member and Viewer with zero boards/grants.
- Own unicode-name-probe.ts/.log: exit1 because the predicted500 did not occur; actual PATCH200/GET200 refuted candidate. unicode-name-control.ts/.log: exit0, same behavior accurately asserted. Original failed expectation remains preserved.
- focused-people-runtime.log and focused-http-boundaries.log: sandbox loopback EPERM environment failures preserved. The latter included3 DB-dependent rate-detail failures; no test source changed and no product failure inferred. Approved People/runtime rerun succeeded; rate-detail cases remain part of required independent full suite next round.
- Root builder raw/final-local-gates-1/commands.json observed all14 exit0/statuspass/sourceUnchanged true. Those are root-issued commands, not issued by this reviewer. They cannot override the independently confirmed defect and are not final approval.

## Rejected candidates

1. Name-schema astral Unicode length mismatch: rejected by actual accepted60-codepoint first/last name PATCH and successful subsequent session GET, both200. No broken session was reproduced.
2. PAT cookie fallback: rejected by explicit global Bearer authentication plus capability allowlist; malformed/expired explicit Bearer never chooses session authority. Required suite still must rerun on next target.
3. Retired ownership transfer still reachable: rejected; authenticated route unconditionally throws410 and contains no ownership write. Historical transfer test names do not establish an active transfer capability.
4. Hono deadline implies cancellation: rejected as an assertion. Source/tests explicitly preserve and observe post-timeout continuation;504 alone is not cancellation evidence. Applicable transaction/receipt and statement-timeout controls must be interpreted separately.

## Important limit

Local source/test readiness cannot establish actual Google sign-in, Cloudflare CPU/deadline, actual Hyperdrive pooling, private R2 policy/durability, configured mail delivery or cron execution. These remain UAT pending under the authorized direct-UAT sequence. No hosted mutation or real credentials were used here.
