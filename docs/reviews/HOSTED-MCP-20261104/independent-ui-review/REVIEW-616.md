# Current616-target independent UI / Pages review

## Actions

Independent reviewer `/root/hosted_mcp_ui_review` did not implement the product and made no product/cloud/UAT changes. **Focused verdict: pass. Whole UI verdict awaits the main reviewer's fresh24-case browser result.** The combined backend/release gate remains the main independent auditor's responsibility; this bounded report does not invent a separate numerical release approval.

Current source: `independent-backend-review/final-preparation/runs/2026-11-04T13-30-38.685Z/source-before.json`,616 files. Independently computed sorted-path/hash digest: `786c39a27a78cd93517e134059caef218aa80d441af30b4516740a1edc93627c`. All616 hashes match. [review-target-616.json](review-target-616.json) records the exact manifest hash, executed evidence hashes and continuity results.

The only differences from the earlier615 target are `apps/api/test/google-connect-resume.test.ts`, the main gate runner and the newly included supplemental name-step probe. Delivery source is unchanged; the detailed independent source trace and rejected candidates in [REVIEW.md](REVIEW.md) remain applicable, while every runtime result below was freshly repeated on the616 target. Earlier615 runs and failed harness attempts remain preserved with their actual dates and hashes.

## Why and options

The normal frontend test server cannot prove that a deployed static page and its OAuth discovery routes share the same public URL. The independent probe uses the actual compiled Pages Functions, local workerd, installed Wrangler ASSETS and the exact copied production export. That verifies the deployment path without touching a cloud environment.

The first-sign-in name form is a distinct browser branch. Rather than inferring it from source, the supplemental probe marks only its own synthetic actor's name unconfirmed, fills the real form and verifies its real API write, session refresh and return to the pending consent. It leaves the immutable main test runner unchanged.

## Evidence and limits

| Exact execution | Result and evidence |
| --- | --- |
| `NODE_ENV=test node --test apps/web/test/hosted-mcp.test.ts apps/web/test/hosted-mcp-api.test.ts apps/web/test/oauth-metadata-proxy.test.ts` | exit0,11/11 tests,0 skipped; [focused-source-616.log](focused-source-616.log) |
| `NODE_ENV=test node docs/reviews/HOSTED-MCP-20261104/independent-ui-review/pages-runtime.mjs --run` | exit0,6/6; [Pages result](runs/2026-11-04T13-32-23.714Z/result.json) |
| `NODE_ENV=test FLOWBOARD_UI_REVIEW_SOURCE_MANIFEST=docs/reviews/HOSTED-MCP-20261104/independent-backend-review/final-preparation/runs/2026-11-04T13-30-38.685Z/source-before.json FLOWBOARD_UI_REVIEW_PAGES_STAGE=docs/reviews/HOSTED-MCP-20261104/independent-ui-review/runs/2026-11-04T13-32-23.714Z/stage node docs/reviews/HOSTED-MCP-20261104/independent-ui-review/name-step-runtime.mjs` | exit0,3/3; [NameStep result](name-step-runs/2026-11-04T13-32-36.004Z/result.json) |

Held harnesses: Pages `fcdbcd784e1b8065bba5da03868af6c6313908359cf4998739dec33aa6293122`; supplemental NameStep v2 `124b9ea8a43c00db332308de041c5fb0bfc86956fe683871611f2ce6075ffe11`. Both were frozen before this target's execution. The original NameStep v1 source/hash and pass remain preserved separately.

Pages checks all passed: three exact metadata aliases with canonical issuer/resource and no sign-in redirect; direct static `/connect` load/refresh/HEAD; canonical URL/query/body/cookie/bearer and duplicate Set-Cookie forwarding; actual Hono401 JSON and canonical `WWW-Authenticate`; protocol503 when the service binding is absent rather than `API_ORIGIN` fallback; and actual Chrome320px static load/reload plus effective no-referrer proof.

All145 copied static files match the main fresh export before and after execution. Source changes are zero. The no-I/O pool sentinel performed zero database operations. The cookie/referrer endpoints are explicitly reviewer-controlled; the authentication/discovery responses use actual mounted Hono. No real-database authentication/limiter claim follows from this Pages-only probe. Unexpected Chrome console/errors/origins are zero; browser/workerd/watchers closed.

Supplemental NameStep checks all passed: the real form appeared at the exact pending consent URL; actual PATCH200 committed name confirmation and session GET200 resumed that same consent with blank project/disabled approval; explicit project choice then produced exactly one real PostgreSQL connection and a locally intercepted fixed Claude callback. The fixture used a separate fresh pinned PostgreSQL17.11 container/random schema and workerd44954. No source mismatches, unexpected console or origins; browser/workerd/schema/container cleanup all true. This closes the earlier mandatory GAP-HUI01 for this target using actual browser/API/database evidence.

Both the signed-out320px page and the after-name consent screenshot were visually inspected. Controls and explanatory text fit; the unverified identity warning, explicit project choice and truthful one-session duration are visible. The separate main browser runner supplies all-role/session-swap/pagination/unknown-commit/dialog/long-name keyboard and CSS200percent layout cases; its fresh result is still pending. CSS zoom remains a layout simulation, not a native browser zoom claim.

No confirmed product security finding remains in the focused reviewed paths. The callback code/error presence weakness was repaired before hold; body deadline and exact204 disconnect behavior were independently verified in held source and passing tests. Rejected harness assumptions, exact failed attempts and their counterevidence are retained in [REVIEW.md](REVIEW.md), including the [W3C rule for ordered Referrer-Policy values](https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header).

No real Google provider, real Claude connection, deployed Cloudflare binding, production limiter, hosted account or UAT behavior was exercised by this reviewer. No source/mock/local result is promoted to hosted acceptance.

## Next / your input

Main reviewer provides the fresh24-case browser report, then binds the completed UI mapping and this exact supporting evidence into the whole-feature gate. No user action is needed. Held product and harness files remain unchanged.
