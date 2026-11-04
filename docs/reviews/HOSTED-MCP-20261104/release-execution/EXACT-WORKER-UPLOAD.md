# Exact reviewed Worker upload

**Local preparation only; no cloud write executed.** Root reported final local/independent gates passed at source `77a9fbbef35d5a0e3be72fc7c390b46972718f89`; Linux CI remains separately parent-controlled.

Wrangler4.156.2 CLI help confirms `deploy [path]`, `--no-bundle`, `--env` and `--dry-run`. A credential-free local invocation from the clean detached candidate used the prepared production Worker as its entry and skipped rebuilding. [Proof](exact-upload-proof.json), [actual log](exact-upload-dryrun.log): exit0, exact input/output equality, SHA256 `58481d8f08ce4e67b0921551a33605c714928abc799e8a69aa156670b7beccad`. Candidate tracked state remained clean. The dry-run displayed UAT Hyperdrive/R2/Images/rate and canonical Pages-origin bindings. The duplicate2.8MiB generated source was removed after recording the byte comparison; no source content was printed.

After root clears green Linux CI, refreshes/verifies the encrypted UAT backup and applies/verifies only reviewed0027, use this actual upload command, cwd `/private/tmp/flowboard-hosted-release-prepared-20261104/apps/api`:

```sh
NODE_ENV=production NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false node ../../node_modules/wrangler/bin/wrangler.js deploy dist/worker-uat/worker.js --env uat --no-bundle
```

Before executing, recheck cleanHEAD77 and preparedworkerSHA. `--env uat` selects the known UAT config and bindings; the explicit entry plus `--no-bundle` uploads the reviewed bytes. Do not omit the environment, do not use the top-level production target, and do not add variable/secret-file overrides. Existing secret bindings are retained by Wrangler deployment. No new hostedOAuthsecret is needed. `NODE_ENV=production` remains explicit to match runtime/test provenance even though no rebuild occurs.

For Pages, cwd `/private/tmp/flowboard-hosted-pages-77a9fbb`, after rechecking the157file prepared manifest:

```sh
NODE_ENV=production NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false node /private/tmp/flowboard-hosted-release-prepared-20261104/node_modules/wrangler/bin/wrangler.js pages deploy out --project-name flowboard-app-uat --branch main --commit-hash 77a9fbbef35d5a0e3be72fc7c390b46972718f89 --commit-dirty=false
```

The stage has UAT `wrangler.jsonc` and recursive Functions sources. Provider compilation of Functions must be recorded independently; source/static artifact equality does not prove the exact hosted compiled Functions bytes unless fetched and compared.

## Postdeploy identity and byte proof

Read only, on account `6592b59b0da4771dc346b96c6fdc65fd`:

1. `GET /accounts/{account}/workers/scripts/flowboard-api-uat/deployments`: retain latest deploymentID, versionID and100%traffic. Fetch version metadata and selected settings only; record UAT Hyperdrive/R2/Images/rate/origin references, never secret values.
2. `GET /accounts/{account}/workers/scripts/flowboard-api-uat/content/v2`: Wrangler’s installed Cloudflare SDK uses this endpoint for script content. Treat binary/multipart bytes as private in-memory data. Parse the returned module parts and SHA256hash `worker.js`; output **only name,bytecount,hash,matchboolean**. Never print/base64/store full deployed source in tool output. Expected hash above. If metadata/body shape differs, report hashunverified; do not substitute provider success for byte proof.
3. `GET /accounts/{account}/pages/projects/flowboard-app-uat`: canonicaldeployment source must equal full77SHA and `commit_dirty=false`, stage success, `API → flowboard-api-uat`. Record exact newdeploymentID/URL. Recheck staticasset hashes using prepared byte map and bounded public requests; this is distinct from compiledFunctions proof.
4. Run bounded anonymous smoke plus consent/Connections actual signed-in checks; save actual outcomes separately from upload evidence. Verify OAuth discovery exact issuer/resource and401challenge through the public PagesURL, not directWorkerURL. The API binding must preserve the canonical PagesURL.

The Cloudflare connector namespace is unavailable in this release-preparation agent’s current toolset; no provider postdeploy read was run here. Root must use its available connector/authorized CLI and keep credential material entirely out of output.

## Rollback plan

Immediately before upload, reverify the previous UAT Worker version `21d3c2d8-2955-4aab-9765-5db6ad568d2e` and canonical Pagesdeployment `4dbcd83f-b562-4fc5-bbac-2e6f40bee529`. On a deployment regression, restore the prior UAT application artifacts using Worker rollback or an explicit100%deployment of that version, and Pages’ rollback endpoint for that exact UAT project/deployment. Root should inspect installed CLI/API schema before invoking either mutation. Retain additive schema27 and safeR2policy; no downmigration or destructive restore is authorized. Never roll back by redeploying production or by blindly repeating the migration after a network error.

No rollback or deployment was executed by this agent.
