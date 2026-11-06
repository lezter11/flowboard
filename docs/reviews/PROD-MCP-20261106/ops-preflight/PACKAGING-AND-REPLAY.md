# Prepared operator plan — no deployment or mutation executed

Actions: Fresh filtered provider receipts establish the current targets. Root owns actual gate declarations, exact candidate/CI, deletion, backup, uploads, observation and main promotion. This document is a replay plan, not permission to bypass those gates or a claim that active/inactive artifacts already exist.

## Packaging the reviewed banner candidate

1. Freeze the final full source SHA only after builder checks, independent review and one required exact-candidate CI pass. Build from a clean detached candidate using the existing sanitized exact-lock process: no inherited database URLs/test auth/NEXT_PUBLIC overrides or dotenv/devvars files. Apply/verify the tracked dependency patch and preserve Worker/Pages artifact provenance. Current tracked API/packages/database bytes still match f32; the27 migration hashes are unchanged. Do not rerun migrations. A new commit containing only banner UI and operator evidence still needs its affected source gates.
2. Prepare canonical UAT and production Pages inputs separately. Production uses apps/web/wrangler.prod.jsonc copied as wrangler.jsonc and API→flowboard-api; UAT uses wrangler.uat.jsonc and API→flowboard-api-uat. Recursively include all out/ and functions/ files. Reject symlinks and unexpected paths; do not copy node_modules, private files or mutable evidence into deployed inputs. Require the base out/release-status.json to parse as an object with exactly one key active:false. Verify the built out/_headers has the exact /release-status.json no-store rule and the reviewed middleware file fastpath avoids API/session calls for this static asset.
3. From each immutable verified base, make inactive and active Pages input trees without rebuilding application code. Inactive keeps the exact base status bytes. Active changes ONLY out/release-status.json to {"active":true} plus a newline. Store manifests OUTSIDE both stage roots; otherwise the manifests themselves would become extra changed files. The payload roots contain only published out/, functions/ and wrangler.jsonc. Do not leave a stale artifact-manifest.json inside a variant and treat it as proof of the overlaid status asset.
4. Enumerate every recursive regular file, including hidden files, in each full Pages input tree. Each manifest maps relative POSIX path→SHA256/byte count and binds full source SHA, base artifact manifest hash, environment, config hash and explicit approved status overlay. Require identical inventories and require the symmetric changed-file set to equal exactly ["out/release-status.json"]. All HTML, JS, CSS, functions, _headers and wrangler.jsonc hashes must match across that environment's two variants. Require active JSON to have exactly active:true and inactive JSON exactly active:false. Hash the canonical manifest map separately and retain both manifests plus a machine-readable one-file difference receipt. Do not claim the active status bytes are unchanged checked-in source; they are the specifically approved static configuration overlay.
5. Preserve the Worker module separately, unchanged between Pages status variants. The last reviewed f32 module SHA is9bc6986e15691ad32aaf67b8490bf4dadcba01c769add4a0c42281beb4f1204d; a new candidate must establish actual source/build continuity rather than assume it. If Pages recompiles functions during upload, use the same canonical upload working path and pinned CLI or an already verified identical compiled function artifact, then verify function-byte continuity. Equal source-stage manifests alone do not prove two separately generated server bundles have equal bytes.
6. Exercise active→inactive behavior against a real local/browser or UAT surface before production: valid inactive hides; active appears accessibly; failed/malformed responses keep the last valid active state; visibility/unmount abort/cleanup works; no forced navigation/reload/draft changes;320px/zoom/light/dark do not cover controls. Status polling must be bounded and must not create API/session/database work. Prove actual deployed status headers and bytes with bounded public requests, not only source _headers text.

Old production tabs do not contain the new component and cannot acquire it without refresh. Worker-first deployment avoids exposing new UI to an older incompatible API, but means the new banner cannot cover the initial Worker upload interval. It begins when the active Pages variant is served to a tab containing the component. Disclose that limit; do not force refresh or add a larger preliminary rollout to conceal it.

## Current rollback and environment anchors

Fresh Cloudflare metadata at05:20:47UTC on2026-11-06:

- Production Worker deployment85a8828e-0345-4219-9fa0-2856f2566deb, version756fdc6e-34f9-4ea8-88cc-59f21cdc940b at100%; Pages876eacf4-2890-4b3a-a54b-d71cf1fa6ff1, source3a82b24, success/dirtyfalse.
- UAT Worker deployment4b68846a-d7ae-4d45-84f0-49ba1f3280ea, versiona3d243dd-7f80-447d-908b-1af466c1f46f at100%; Pages549e766e-2c4f-4b3d-adbb-633384381347, full sourcef32eafae0f59bf1601d4a84e2a0e3208ae9db4bc, success/dirtyfalse.
- Both Pages projects have the correct API service binding, no Git integration, production branch main. Production/UAT origins, Hyperdrive and R2 identities remain separate; IMAGE_VERIFIER is bound in both Workers. Both Hyperdrive caches are disabled. Both buckets have r2.dev disabled, no custom domains and only seven-day multipart abort. No staging-prefix expiration is present or authorized.

Re-read these immediately before upload/rollback in case another operator changes them. Do not infer actual CPU allowance from usageModel standard or missing limits; no paid settings changed. Keep the existing owner-role/no-uptime-alert beta limitations visible.

## Read-only and gated replay sequence for root

Read-only replay is permitted for filtered metadata. Preserve current receipts and choose a new output path in a copy of read-neon-metadata-round-2.mjs before repeating it; its current receipt is exclusive and must not be overwritten. Cloudflare replay uses only GETs to the exact account and named settings/deployments/Pages/Hyperdrive/R2 metadata endpoints represented in cloudflare-provider-metadata.json. Do NOT use yesterday's read-db-preflight.mjs: it obtains connection material and reads database/application state outside this agent's scope.

After actual final candidate CI/review and new banner UAT acceptance, root may consume the user-approved exact Oct29 deletion using the unchanged reviewed helper. Its three values attest distinct facts: the new exact Owner permission; Owner acceptance of the deployed f32 baseline; and root's new banner/release gates recorded separately. The helper's f32 source gate must not be silently edited to the new UI SHA.

```text
FLOWBOARD_CPU_UAT_GATE=accepted-f32eafae0f59bf1601d4a84e2a0e3208ae9db4bc node docs/reviews/PROD-MCP-20261105/operations-review/release-check/delete-oct29-uat-backup.mjs --execute owner-approved-single-delete --owner-approval delete-only-br-damp-poetry-a1gfbcvn-and-ep-bold-hill-a1mlmaly
```

This is a future root invocation, NOT executed here. First confirm helper e87aaad40c215054c5f0ca199d3059904d9e88d4039e6e2a00df1366daca7818, its independent round2 record/dependency and unused receipt path. The helper rechecks target leaf/flags/idle compute, both active branches, both production backups and exact before/after branch+endpoint sets. Timeout, partial receipt or mismatch means STOP; never retry or pick another branch automatically. It writes only the reviewed old CPU-release receipt location; date/folder naming is historical campaign metadata, not permission expansion.

Then root takes a fresh production data-bearing/no-compute backup through the unchanged reviewed creator, passing the new clean candidate and full new SHA, with an unused receipt under the2026-11-06 release folder:

```text
FLOWBOARD_PROD_RELEASE_GATE=reviewed node docs/reviews/PROD-MCP-20261105/operations/backup-prod-branch.mjs --candidate <clean-detached-private-tmp-candidate> --sha <full-new-reviewed-SHA> --receipt <absolute-new-20261106-backup-receipt.json>
```

The creator's production-backup-2026-11-05-mcp-pre-* prefix is a legacy campaign label. Actual provider created_at and the strict fresh30-minute check establish creation time; explicitly record the true2026-11-06 timestamp. Never edit a receipt timestamp or reuse yesterday's branch as a fresh schema27 backup. The exact Oct29 permission does not authorize any other deletion. Keep both production backups and every other branch; no local production data copy, restore, downmigration or migration19→27 helper replay is authorized. Root owns any necessary fresh read-only ledger verification; this preflight queried no database ledger or application records.

Once backup and all deployment gates pass: use the pinned candidate CLI, production top-level Worker (no --env production), exact no-bundle prepared module, and the active production Pages stage. Example shapes only:

```text
<canonical-candidate-node_modules/wrangler/bin/wrangler.js> deploy <verified-production-worker.js> --no-bundle --name flowboard-api
<canonical-candidate-node_modules/wrangler/bin/wrangler.js> pages deploy out --project-name flowboard-app --branch main --commit-hash <full-new-reviewed-SHA> --commit-dirty=false
```

Run the Pages command from its approved active production stage, then fetch actual version/module/source/binding proof. Observe15minutes with the reviewed aggregate observer against that exact version. Keep any existing pool-error labels and strict needs-inspection status; require no new CPU/uncaught/new-error/job failures and an explicit scoped baseline disposition. If healthy under the actual gates, deploy the approved inactive Pages variant from the same source, prove statusfalse/no-store and banner clearing without reload in a tab already containing the component, and record the new canonical Pages ID. If failed, roll back code first using re-read anchors and ensure the public status is inactive; do not leave an active banner indefinitely or restore production data. Never declare authenticated production acceptance from anonymous smoke, polling, the user UAT statement or absence of errors.

Promote Git main only when root's release gates permit it, without a duplicate hosted CI run. Current global gh login is damaged-goods-admin with pull:true/push:false on lezter11/flowboard. Do not switch global login; root may use its previously authorized repository-scoped child authentication without exposing credential values. This preflight did not retrieve such credentials or prove write auth is ready.

Evidence and limits: Fresh metadata authorizations succeeded for Cloudflare, Neon and GitHub read access. The initial restricted Neon attempt failed locally and is retained; the authorized escalated metadata-only read succeeded. No application probes, database queries, branch creation/deletion, deployments, secret-value fetches, paid changes or global-login changes were performed by this agent. Owner production signed-in acceptance remains deferred. The user reports UAT works; no unspecified Google/Claude/create/revoke substep is invented.
