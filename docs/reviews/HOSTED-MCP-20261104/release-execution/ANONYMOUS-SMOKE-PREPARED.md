# Prepared anonymous smoke — not executed

**Hold:** root reported Linux CI41844757342failed API. No backup, migration, deployment or smoke execution is authorized while that gate is blocked. Existing liveUAT stays unchanged. These scripts are prepared and syntax-checked only.

`anonymous-hosted-smoke.mjs` makes exactly15planned anonymous requests to the canonical UAT Pageshost and enforces a hardcap25. All fetches use manual redirects, omitted credentials, fixed safe headers,15second timeout and4MiBresponse cap. No DCR/clientregistration/authorize request/cardwrite/SDKtoolcall occurs. The single POST contains only unauthenticatedJSONRPCping and expects401beforeSDKdispatch; other MCPmethods also expect401. Output contains statuses/checkbooleans/bytehashes, never body/cookie/challenge contents/callbackquery. A new report path is required; no overwrite.

Checks: threewellknownexactmetadata/no-storeJSON; POST/GET/DELETEMCP401with exactresource challenge; Claude preflight204 and attacker-origin403with no credentialCORS; ownconnections/session/tokens401withoutdata; invalidconnecthandle staticHTML200/no-store/no-referrer matching preparedbytes; Connectionstab safe signinredirect; two immutable preparedJS/CSSbyte matches. IDs may be supplied for actual Worker/Pagesdeployed versions.

Health is honestly marked notcovered there: Pagesdoesnotproxy `/health/*`. `anonymous-health-only.mjs` separately makes exactlytwoanonymousGETs to the prior confirmed UAT Workerhost (`flowboard-api-uat.web-app-cloud.workers.dev`), expecting liveok/readyready. It does not test OAuth. Combinedplannedtotal17, leaving room under the global60requestbudget for root’s other checks. Root must account for every earlier/later probe and avoid automatic retries.

After greenCI/reviewandactualmatchingdeployment, root must inspect and explicitly invoke:

```sh
node docs/reviews/HOSTED-MCP-20261104/release-execution/anonymous-hosted-smoke.mjs --execute deployed-77a9fbb --report /absolute/path/docs/reviews/HOSTED-MCP-20261104/release-execution/smoke-<unique>.json --worker-version <actualUUID> --pages-deployment <actualUUID>
node docs/reviews/HOSTED-MCP-20261104/release-execution/anonymous-health-only.mjs --execute deployed-reviewed-uat --report /absolute/path/docs/reviews/HOSTED-MCP-20261104/release-execution/health-<unique>.json
```

Mainprobe is deliberately bound to source77SHA/stage `/private/tmp/flowboard-hosted-pages-77a9fbb`. If the CI repair changes candidate/artifacts, root must update/review that binding before invocation; passing old staticbytes cannot approve new source. Actual Googlelogin/Claudeconnection/refresh/create/disconnect remain separate signed-in acceptance.
