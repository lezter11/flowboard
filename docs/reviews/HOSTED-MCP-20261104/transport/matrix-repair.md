# Explicit MCP routes and matrix repair

2026-11-04. Builder verification passed; fresh independent full-feature review is pending. The preceding full API failed target and its source hashes/results remain preserved under `independent-backend-review/failed-round-1/` (1386 checks,1333 passed,53 failed). The failures were the three route-inventory families; they were not erased or treated as approval.

## Problem and resulting behavior

MCP was served by exact-path ALL middleware, so requests worked but the explicit mounted inventory contained114 methods/paths while OpenAPI documented118. `createApp` now registers real POST, GET, DELETE and OPTIONS handlers at the same early point, using the same protocol handler. An exact-path ALL fallback preserves HEAD and unsupported-method behavior. The documented methods now appear in the actual118-operation inventory without adding routes or removing contract entries.

The new workflows required distinct test models. Ordinary REST continues requiring the same session/PAT boundaries and the same no-private-data/no-domain-effects assertions. MCP requires OAuth: cookies and PATs receive401 JSON-RPC, valid OAuth POST lists the five tools, valid OAuth GET/DELETE returns405, and public OPTIONS returns204 without credentials. Intended authentication counters are recorded separately from application effects for these new cells.

## Genuine workflow fixtures and controls

- New shared matrix helper performs actual mounted public-client registration, S256 authorization, browser-bound consent, PKCE code exchange and access verification. Opaque request/connection IDs, browser cookie, current CSRF, client/resource and form bodies come from real state; no fake identifiers are used as successful controls. Loopback origin is explicitly configured only in the test apps.
- Cookie mutation controls cover real pending consent: a different session with the correct browser binding still receives403, while the bound owner approves and creates the expected connection/code without creating cards. Consent throttle counter changes are explicit; all other denied-state fingerprints remain unchanged.
- Connection disconnect is actor-owned and non-disclosing: another actor receives empty204 with no state change; the actual owner receives empty204, revokes the connection and can retry without another material effect. No JSON envelope is fabricated for204.
- Public OAuth controls test invalid callback400 and actual registration201, wrong PKCE/resource400 with unchanged credential state, correct cookie-free exchange200 with exact granted scopes, wrong-client revocation200 without effects, and own-client revocation200 that blocks subsequent MCP access. Public endpoints are classified by client/PKCE authority rather than pretending to require a browser cookie.
- Original REST negative and authorized controls remain. Existing PAT inventory now recognizes only the exact MCP endpoint's deliberate401 protocol refusal; ordinary forbidden PAT routes retain403.

## Passing evidence on the held target

`logs/matrix-repair-final.log`: **603/603**, zero skipped checks, combining the three affected inventory/matrix files and the mounted/Node/actual Worker MCP suites.

- Route authentication:118 operations,520 cells,480 expected denials, exactly6 actual PAT authority cells,3 separate public protocol preflight cells,0 failures.
- Cookie mutations:50 operations,307 cells,58 genuine authorized controls,302 expected denials,0 failures.
- Detailed generated rows: `logs/route-auth-matrix-round-2.json` and `logs/cookie-mutation-matrix-round-2.json`.
- Existing token/PAT suites: **24/24**, `logs/matrix-pat-regression-final.log`;111 denied method/path cases from117 non-OPTIONS mounted routes, preserving the six capabilities.
- Root `npm run typecheck` exited0 after all source changes.

Failed builder attempts remain recorded: `matrix-repair-attempt-1.log` (missing disposable identity-extra database), `matrix-repair-attempt-2.log` (passing580 before the reporting-count refinement), and `matrix-pat-regression.log` (missing explicit test origin for newly inventoried MCP). The missing local fixture database was created only on the authorized builder55931 harness. Every matrix fixture creates/drops a unique schema; reviewer databases were untouched.

## Hold and next step

The24-file bounded builder hold is `source-manifest-matrix-repair.json`; previous manifests remain preserved. It includes the runtime registration, matrix tests, relevant fixture helpers and the unchanged OpenAPI parity test. It is not a complete reachable feature manifest or an independent review result.

The reviewer has been notified to take a fresh whole-feature snapshot and rerun the unchanged backend gate. No self-score, backend/UI-ready handoff, UAT rollout or production action is claimed. Root dependency/contracts changes and eventual UI/integration/hosted acceptance remain separate coordinated gates.
