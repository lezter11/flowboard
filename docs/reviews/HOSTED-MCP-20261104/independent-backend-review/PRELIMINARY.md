# Independent hosted MCP backend review — preliminary, incomplete

Reviewer: `/root/hosted_mcp_security_review`, fresh delegated reviewer with no implementation ownership. Builder: `/root/hosted_mcp_auth_design`; architecture/assembly remain separately authored. The reviewer has edited only this review-output directory. This note is neither backend closure nor a UI-ready handoff. No overall/category approval scores are assigned before the assembled target and mandatory runtime checks are available.

## Actions

Read the frozen hosted specification, plan, OAuth component criteria/handoff, gate and review-record instructions. Adversarially traced the OAuth adapter, mounted component routes, canonical issuer selection, migration, session adapter, project/board authorization locks, rate counter integration and shared consent/connection contracts. Compared eight component/embedded/contract file hashes with builder manifest `d7cc28276b5dc5848482af7ec6eedf0ffe4141036b2314388cb0016c64ce3c58`: unchanged at observation time; see `component-observed-manifest.json`. This is a component observation and does not freeze changing integration dependencies.

Executed the builder's real PostgreSQL component suite independently: 27/27 pass, exit 0, `oauth-focused-elevated.log`. Initial sandbox run could not open loopback PostgreSQL (`EPERM`); it is preserved as `oauth-focused.log`, and the authorized local-only escalation subsequently succeeded. No hosted database, real credentials or live user data were accessed.

Wrote and executed ten additional mounted Hono/PostgreSQL adversarial tests in `adversarial.test.mjs`: 10/10 pass, exit 0, `adversarial.log`. Each process uses its own disposable schema, selected only after the repository's isolated-local URL guard. Tests exercise same-person session replacement, logout before consent, CSRF rotation, wrong-client consumed-code/refresh replay, refresh-insert rollback, fail-closed broken counters with safe errors, cookie/bearer refusal, parallel cap admission, absolute-family expiry and chunked-body bounds. The initial connection-cap setup consumed the legitimate per-user consent rate limit and received 429; retained in `adversarial-attempt-1.log`. Corrected setup seeds nineteen synthetic connections directly, then tests the two real concurrent decisions; no product rate limits were relaxed.

Embedded migration parity was also checked: all 27 SQL migrations match.

## Why and options

A Flowboard connection is a continuing permission slip for one project. Its rotating token identifies that permission slip; it does not create project membership or board access. PostgreSQL locks serialize consent/redemption/refresh/revocation and let a failing issuance undo partial database work. This avoids a second authentication system or an OAuth-to-PAT conversion, but the final mounted tools must actually use these guards on every operation and retry. Passing isolated helper/component tests cannot establish that integration.

The reviewed component correctly locks connection before credentials/project authority, checks exact client/resource/callback/S256 binding before code redemption or reuse revocation, returns invalid-grant as a successful transaction result when family revocation must persist, and retains wrong-client refusal before revocation. The independently executed wrong-client and refresh-trigger tests support those paths. Raw SQL diagnostics from the injected refresh/counter failures were not returned to clients.

## Evidence and limits

No confirmed exploitable OAuth component defect has been established in this preliminary phase. This is not a claim of defect absence.

Open contract question sent to Architect: `describeHostedAuthorization` removes `offline_access` from `scopes`, and `hostedMcpAuthorizationViewSchema` currently has no explicit persistence field. Consequently UI cannot distinguish a refresh-persistent request from access-only consent using this response. The specification requires consent to explain persistence. Resolve with an explicit safe field, or provide precise contract/source evidence for the intended consent behavior before UI approval. This is currently an acceptance/coverage concern, not a demonstrated privilege escalation.

Still required: frozen complete dependency manifest, exact mounted app/auth/private Request identity dispatch/card/activity review, OAuth-vs-PAT/REST refusal matrix, current project/board/assignee authority at operation and receipt replay, stable retries across refresh, separate-connection create/revoke/grant-removal races, one-connection Worker lifecycle, actual Node and workerd wired runtime tests, complete mandated regression/typecheck/build checks and browser sign-in/consent/disconnect evidence. Existing transport-only workerd fixture uses synthetic operations and cannot substitute for the assembled Worker/database boundary. Changing global source has not been approved.

## Next / your input

Await held assembly source and independently execute its declared checks. Architect must resolve the persistence consent contract question and provide source hold; user action is not required at this stage. No UI implementation handoff or UAT promotion is authorized by this preliminary review.
