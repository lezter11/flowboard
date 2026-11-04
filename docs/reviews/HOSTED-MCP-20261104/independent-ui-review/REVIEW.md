# Independent UI / Pages review

## Actions

Reviewer `/root/hosted_mcp_ui_review` did not implement this product. Product source remained read-only; reviewer changes are confined to this directory. Reviewed the consent, Connections, session/navigation, Google continuation, request/error and Pages paths against the fixed hosted spec and UI acceptance plan. Executed the focused helper/proxy suite and actual compiled Pages/workerd/Chrome probe. No cloud, production, real account or UAT mutation occurred.

**HUI14 and supplemental HUI01 focused runtime verdict: pass on the615-file target. Whole UI verdict: pending the fresh main hosted-browser result and exact-target continuity after the main gate's test-only compile repair.** This is supporting evidence for the independent whole-feature auditor, not a replacement numerical backend/release gate.

Final source is the main review's615-file target: `independent-backend-review/final-preparation/runs/2026-11-04T13-19-13.421Z/source-before.json`. The source manifest file hash and the independently computed sorted-path/hash digest are in [review-target.json](review-target.json). Canonical digest: `965e9eb1537571b5bbc2004dad6e79f4a1b07db7c30e452b2399937bdfdf4ae6`. All615 current source hashes matched at independent recheck. Frozen Pages harness hash: `fcdbcd784e1b8065bba5da03868af6c6313908359cf4998739dec33aa6293122`.

## Why and options

A colleague should see the same consent screen after Google sign-in, while a different person signing into that browser must not inherit the first person's project choices. The UI keys consent by current actor/access state, clears details after server refusal and submits the latest server-issued approval token. This adds explicit account and project checks without inventing a second source of authorization; the server still decides whether a project can be approved.

Pages is a separate runtime from Next development. This review compiled the real staged Functions with installed Wrangler and ran that bundle in local workerd through Miniflare. Installed Wrangler ASSETS served a copied production static export, including real clean-URL, `_headers` and `_redirects` handling. This catches discovery routes falling into sign-in or static fallback, which a helper-only proxy test cannot prove.

## Evidence and limits

| Executed command | Actual result |
| --- | --- |
| `NODE_ENV=test node --test apps/web/test/hosted-mcp.test.ts apps/web/test/hosted-mcp-api.test.ts apps/web/test/oauth-metadata-proxy.test.ts` |11tests,11pass,0fail; [log](focused-source-new-target.log) |
| `NODE_ENV=test node docs/reviews/HOSTED-MCP-20261104/independent-ui-review/pages-runtime.mjs --run` | exit0;6checks,6pass,0fail; [final result](runs/2026-11-04T13-20-38.271Z/result.json) |
| `NODE_ENV=test node docs/reviews/HOSTED-MCP-20261104/independent-ui-review/name-step-runtime.mjs` | exit0;3checks,3pass; [supplemental result](name-step-runs/2026-11-04T13-27-25.062Z/result.json) |

The six Pages checks prove:

1. All three exact OAuth metadata aliases reach the actual mounted Hono routes through the compiled Pages Functions; each returns200 protocol JSON, no sign-in redirect and no-store. Canonical issuer/resource remain the configured public origin despite an untrusted forwarded-host header.
2. Direct `/connect` GET, refresh GET and HEAD serve built HTML without session routing or redirect. No-store and the effective no-referrer policy survive actual static serving.
3. Canonical URL/query bytes, method, body, cookie, bearer header, duplicate Set-Cookie and no-store survive compiled proxy forwarding. This one upstream endpoint is explicitly reviewer-controlled, not a product route.
4. Actual Hono session and missing-bearer MCP401 responses survive the compiled Pages proxy as JSON, including the canonical `WWW-Authenticate` resource metadata. A no-I/O pool sentinel supplies only the pool reference needed before missing-bearer validation; every query/connect would fail the probe. **Zero database operations occurred.** This does not claim selected-database authentication, role or limiter verification.
5. MCP and exact metadata paths return safe503 rather than using `API_ORIGIN` when the private service binding is absent.
6. Isolated Chrome loads and reloads the built static consent entry at320px with correct Google continuation and no horizontal overflow. An actual same-origin browser GET through Pages to a reviewer-controlled read-only endpoint confirms the consent URL is absent from the referrer header; only a boolean is retained. Unexpected console/page errors and origins are zero.

All145 copied static files match the main review's fresh artifact manifest before and after execution; [artifact-continuity.json](runs/2026-11-04T13-20-38.271Z/artifact-continuity.json) records zero differences. Probe source-before/source-after hashes are identical. Workerd, Chrome and watchers were closed. The signed-out320px screenshot was visually inspected: the heading, Google action and explanatory text fit without clipping.

### Source trace and remaining acceptance map

| Criteria | Independent assessment |
| --- | --- |
| HUI01 Google continuation | Exact43-character handle and state-bound success/error continuation traced. Independently executed actual NameStep/save/session/consent/allow on compiled Pages and real PostgreSQL passes3/3. Fresh main Google browser gate pending; no real provider claim. |
| HUI02/03 explicit consent and decisions | Inert React text, unverified identity/origins, explicit blank project, exact actions, latest-CSRF decision and synchronous duplicate-submit guard traced; helper tests pass. Fresh mounted-browser outcome pending main gate. |
| HUI04/05 deny/invalid/expired/binding/consumed | No project on deny; expiry clears view; strict input parser and canonical unavailable/error states traced. Fresh real API/browser cases pending main gate. |
| HUI06/07 every-role personal Connections and durations | Personal navigation is not gated by project administration; actor-keyed list and truthful15minute/7day/30day copy traced. Fresh role/no-project browser cases pending main gate. |
| HUI08/09 pagination/session changes | Merger uses newest complete response/CSRF; actor/access-key remount and protected-query clearing traced; refused views/lists hide retained data. Fresh actual actor/session/grant-change browser cases pending main gate. |
| HUI10 disconnect | Exact204, error hiding, once-only submit, shared dialog focus/Escape/inert behavior traced and helper tests pass. Fresh real disconnect/keyboard/MCP refusal pending main gate. |
| HUI11/12 safe errors/privacy | Response-body deadline, strict schemas, status handling and safe local catalogue traced; no raw callback/token rendering/storage path found. Fresh injected UX faults and real lost-commit browser case pending main gate. Browser fault injection does not verify production rate limits. |
| HUI13 keyboard/320px/200percent/long names | Source semantics/focus/CSS traced; independent actual static signed-out320px case passes. Fresh main test includes held max100-character unbroken client name;200percent uses CSS zoom and must be described as a layout simulation. |
| HUI14 built Pages | Independently passed6/6 as above. |
| HUI15 regression/integration | Main reviewer owns full real PostgreSQL, native runtime, legacy PAT/stdio and actual five-tool browser/MCP regression evidence; this reviewer does not claim to have run those commands. |

### Findings, counterevidence and preserved attempts

No confirmed product exploit was found in this focused trace. Before final hold, the reviewer reported an empty `code` plus `access_denied` callback-shape weakness. Builder repaired presence-based XOR validation at `apps/web/src/lib/hosted-mcp-state.ts:24`; focused tests now reject the ambiguous shape. Destination was fixed Claude and the backend did not emit that shape, so this was defence in depth, not an open redirect exploit.

Root also reported a prematurely cleared body deadline and acceptance of non204 disconnect success. Independent held-source inspection and executed focused tests verify the deadline spans JSON consumption and disconnect requires204 at `apps/web/src/lib/hosted-mcp-api.ts:13` and`:52`. Product implementation was not edited by this reviewer.

Two initial probe failures remain under `runs/2026-11-04T13-12-23.943Z/` and `runs/2026-11-04T13-14-17.200Z/`. The first expected one literal Referrer-Policy value, although Wrangler correctly combines global and specific values; [W3C Referrer Policy section8.1](https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header) processes recognized values in order, with the last taking effect. Final actual Chrome proof confirms no referrer. The other first-run failure used no configured pool reference, so actual Hono correctly failed closed503 before missing-bearer checking. The second probe used an incorrect native-navigation wait for a Next client-routed link. Both were harness assumptions, not product repairs. Product source stayed unchanged. The diagnostic passing run at13:16 was not accepted as the new global target; the frozen harness and all checks were rerun against the rebuilt615-file target at13:20.

**Coverage candidate GAP-HUI01, resolved on615 target:** the stable24-case runner uses already-confirmed synthetic names. The reviewer raised the absent NameStep browser proof to root/main before claiming whole HUI01 acceptance. Root authorized a separately frozen supplemental probe, [name-step-probe-hold.json](name-step-probe-hold.json), hash `45867f91d99a4605810ad11915e46435b7811088b4c1efd36a2e72132d907745`. It changed none of the615 source files or existing17-command harness.

The supplemental actual Chrome/compiled Pages probe used its own new pinned PostgreSQL17.11 container on loopback56509 and random schema, workerd44954, the immutable accepted145-file static snapshot, and a legitimate synthetic owner session. Only that fixture's name-confirmation fields were unset. Browser network recorded session GET200 → name PATCH200 → session GET200 → consent GET200 → decision POST200. The URL stayed exactly the pending `/connect?request=…` URL; no automatic project or approval appeared after saving the name; explicit project selection produced exactly one real connection. Callback navigation was intercepted locally. Source-before/source-after mismatches were zero, unexpected console/origins zero, and browser/workerd/schema/container cleanup all succeeded. Result SHA256: `cca025a7e2a2bf4f6cc42c76abeffae2acb8b2ca702a82b2d42c752f6b9c56d3`.

After this proof completed, the main615 gate reported a required TypeScript failure in `apps/api/test/google-connect-resume.test.ts:24` (`string | undefined` supplied where `string` was required). That failure is outside this focused runtime proof and blocks the combined gate. A later test-only repair/new target requires an explicit runtime-source continuity proof or rerun; these results must retain their original615 binding.

No real Google provider exchange, real Claude callback, deployed Pages service binding, production limiter, real database role or hosted account behavior was exercised by this probe. Synthetic/local evidence does not establish UAT acceptance.

## Next / your input

Main reviewer supplies the fresh hosted-browser result and exact next-target continuity, then binds this focused evidence into the whole-feature review. No user action is needed for the local review. Product and held harness remain unchanged by this reviewer.
