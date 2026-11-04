# Independent operations review: referrer-policy smoke correction

Reviewed 2026-11-04T18:12:22.293470+00:00 by `/root/browser_portability_review`, which did not implement these operations helpers. No reviewer network requests, new CI, deployment, application mutations or edits to the held817-file backend review target were made. This is a bounded operations judgment, not a new backend feature score or release approval.

## Actions and judgment

**APPROVE the semantic correction and the corrected two-request browser proof.** Architect may run the prepared bounded full anonymous smoke v2. Release completion still requires its actual passing result. Original14/15 smoke and first browser-adapter failure remain preserved; neither is relabelled a passing execution.

The original smoke's sole failure was literal `referrer-policy === 'no-referrer'`. Its other connect checks passed:200HTML, no-store, exact prepared bytes and no redirect. For the observed ordered fields `strict-origin-when-cross-origin` then `no-referrer`, the effective policy is `no-referrer` under the supplied [W3C Referrer Policy §8.1](https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header) rule. Selecting the last recognized policy preserves the requirement that Flowboard's connection page suppress the Referer header. It does not replace that requirement with merely finding a `no-referrer` token anywhere.

## Why and options

Duplicate header fields can represent an ordered policy list. For Flowboard's connection page, `strict-origin-when-cross-origin, no-referrer` ends at no-referrer, while `no-referrer, unsafe-url` must fail. Requiring a literal single value rejects a valid equivalent response. Changing deployed headers or weakening the test to substring membership would add risk without correcting this measurement error.

The helper recognizes complete standard policy tokens, in order, and the smoke still requires the returned policy to equal `no-referrer`. Missing, unrecognized, uppercase-only and raw CR/LF fields fail closed. Ordered repeated fields are joined by commas; reversed permissive-policy negatives are retained. This judgment applies to the observed valid fields and bounded smoke use, not an assertion of exhaustive browser conformance.

Independent diff inspection confirms anonymous-hosted-smoke-v2 changes only the helper import and this single semantic predicate. All URLs, request caps, credential omissions, response/authority/cache/artifact-byte checks and failure conditions remain unchanged.

## Evidence and limits

- Reviewer executed `node --test docs/reviews/HOSTED-MCP-20261104/release-dce1a67/referrer-policy.test.mjs`:13/13 pass,0fail/0skip. These include unsafe-url ordering, unknown values and raw-newline rejection. An additional offline acceptance check confirmed reversed unsafe/strict, uppercase, empty and unknown values cannot satisfy the no-referrer assertion.
- The first actual browser report failed because Playwright's `response.headers()` object exposed repeated fields separated by a newline. That report is preserved. Pinned Playwright's local primary type documentation explains `headersArray()` repeated entries and `headerValue()` comma combination; the v2 probe reads ordered repeated fields via `headersArray()` rather than interpreting a raw newline as valid HTTP syntax.
- Architect executed the actual v2 isolated Chrome156.0.8078.80 probe against candidate `dce1a67dedb1de8f5f7aae9b99fcbcb2b875d105`. Reviewer inspected the finished report:statuspass/exit0, ordered policy fields exactly as above, effective no-referrer, precisely2GETs (real `/connect` document and one manifest-selected stylesheet), and no Referer on the outgoing stylesheet request. No credentials or application mutations were used;3other resources were blocked,0unexpected origins and cleanuptrue.
- Source inspection confirms a fresh browser context, JavaScript disabled, service workers blocked, only the exact document and one same-origin prepared stylesheet allowed, authorization/cookie headers refused before continuing, and a hard2-request ceiling. All other resource requests abort. This demonstrates the bounded document/stylesheet policy behavior; it does not prove sign-in, provider flow or all browser navigation scenarios.
- Reviewer reran the existing817-file independent backend record validator with `--feature HOSTED-MCP`:PASS8.955/10. No backend score was recalculated or source scope changed for this operations correction.
- Root's cumulative anonymous budget is22requests after the two preserved browser probes; the unchanged full15-request smoke v2 would reach37, below60. Reviewer sent no requests. Actual full-v2 smoke remains pending at this judgment.

## Reviewed byte identities

| File | SHA-256 |
|---|---|
| `referrer-policy.mjs` | `954e2365083027ca409f34cfc6651a65ead6cd314a26c8009729b6c3929cf840` |
| `referrer-policy.test.mjs` | `f20d077e32f143b1dbba585e9285df4eb438877762016aa3db5205921193fb64` |
| `anonymous-hosted-smoke-v2.mjs` | `7117fca5d2bf53c2d5cc3b6dd9a07434c874ae2dc651d6d985a6ab00f776858b` |
| `live-referrer-browser-v2.mjs` | `81849e0b352443238cdd674b401e19282e297e0f6c0faace3f29bd8c0ac5f6bb` |
| `live-referrer-browser-v2.json` | `11fe8666f15e774f9ed2965d2f0853506467bcf91c496e1c952b99b2ba926c9a` |
| `anonymous-hosted-smoke.mjs` | `4dc17ca821ededa380d0cee409dff6350e26e27d2b79aefc2cbe6c2c25b67a82` |
| `anonymous-smoke.json` | `4cae78e03e77bf353f47aa94c28f8e164d53ff95157fa34d366c88da8d6878f0` |
| `live-referrer-browser.mjs` | `17d9d5003077eeeb20b40ff118969e99810e1ac93d5a41985bd8ab56a57f4f3e` |
| `live-referrer-browser.json` | `92b8a9e0f7ab05c9ffc42e9510cbab218a280577eaa8c079fdafd53a42d867fb` |

## Next / your input

Architect runs the reviewed full anonymous smoke v2 once, preserves its result and checks the same criterion and request budget. A new failure stays open. No redeployment, backend score tuning, new hosted CI or user action is needed for this semantic test correction. Signed-in Google/Claude acceptance remains separate.
