# Production promotion preflight — 2026-11-05

Read-only investigation by `/root/production_preflight`. This is deployment preparation, not approval or a security score. No database query, application request, account creation, migration, upload, secret read, or production mutation was performed by this agent. Root separately owns Neon discovery, final gates and every deployment mutation. Metadata was fetched at `2026-11-05T09:17:39.496Z`; [sanitized receipt](preflight/cloudflare-before.json).

## Current production, independently read

| Item | Actual value |
| --- | --- |
| Cloudflare account | `6592b59b0da4771dc346b96c6fdc65fd` |
| Worker | `flowboard-api`; deployment `aaaaf3c3-1b1a-4382-9da6-823c9a1adf3e`; version `756fdc6e-34f9-4ea8-88cc-59f21cdc940b` at100%; deployed2026-10-31 |
| Pages | `flowboard-app`, canonical `876eacf4-2890-4b3a-a54b-d71cf1fa6ff1`, source `3a82b24`, clean, successful; production branch `main`; no Git integration |
| Pages service binding | `API` → `flowboard-api`, environment empty |
| Hyperdrive | `18f56141ecef4b7cb07ecd42c90b155f` / `flowboard-hyperdrive`; caching disabled |
| Database origin | `ep-patient-frost-a1kvcqki-pooler.ap-southeast-1.aws.neon.tech`, port5432, database `neondb`, user `neondb_owner` |
| Application vars | `APP_ORIGIN`, `FRONTEND_URL`, `CORS_ORIGIN` are exactly `https://flowboard-app.pages.dev`; Google callback is that origin plus `/api/v1/auth/google/callback`; mail sender vars configured |
| Secret names only | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CURSOR_SECRET`, `DEV_LOGIN_SECRET`, `BREVO_API_KEY`; no values retrieved |
| Images | `IMAGES` → `flowboard-images-prod`; r2.dev disabled; no custom domains; only default seven-day multipart-abort lifecycle |
| Missing binding | No `IMAGE_VERIFIER` in actual production or committed top-level config; UAT has it |

Neon branch/ledger/permissions and current branch quota have **not** been read by this agent. Root must verify production project/branch and its direct endpoint. Historical runbook target is project `misty-unit-76664549`, branch `br-orange-union-a1kqetvn`; do not substitute the UAT branch or infer ledger from deployed code. Runtime Hyperdrive remains pooled/owner; migration must use direct endpoint.

## Concrete promotion issues and dispositions

1. **Fix production image verifier configuration before upload.** `apps/api/src/runtime/worker.ts:96` installs a null verifier without the binding; `apps/api/src/services/image-verifier.ts:99` then rejects new image processing with503. The focused regression `apps/api/test/image-full-verifier.test.ts` includes “missing provider blocks new effects while existing private images remain readable”. Production needs top-level `images: {binding: 'IMAGE_VERIFIER'}` matching the tested UAT configuration, with its configuration/build proof reviewed. This is a deployment regression prevention fix; do not bypass pixel verification or reinterpret missing-provider503 as malformed user bytes. No provider-plan/billing claim is made here.
2. **Keep production's current image lifecycle.** It is already the safe multipart-only policy, identical in substance to UAT after the2026-11-04 repair. The old `PROD_CUTOVER_RUNBOOK` instruction to add `staging-expire` is unsafe and obsolete. `apps/api/src/adapters/images.ts:562` promotes the database reference while retaining the `staging/` object key; a one-day prefix deletion would delete finalized attachments. [Actual UAT lifecycle correction](../FULL-REVALIDATION-20261104/uat-preparation/r2-lifecycle-after.json) removed only that dangerous rule. No production lifecycle mutation is needed.
3. **Prepare an exact production migration plan after reading its real ledger.** Twenty-seven canonical migrations exist. UAT moved19→26 and then26→27; that does not prove production's ledger or data will accept the same transition. The release runner must compare the exact directory inventory/hashes against its actual matcher `^(\d+)_([a-zA-Z0-9_\-]+)\.sql$`. Existing UAT backup/migration guards are deliberately hardcoded to UAT branch, ledger26 and migration27 and cannot be reused unchanged on production.
4. **Acknowledge real data/schema transformations.** If production is at19, pending20–27 do not simply add empty tables:0021 expires historical uncommitted previews;0023 associates/redacts legacy notification/outbox content;0024 drops/replaces an old uniqueness constraint and installs column/card guards;0026 repairs finalized-upload state.0024 aborts if live column names conflict under `LOWER(BTRIM(name))`. Do read-only prechecks, review the retained historical UAT migration proof, take a fresh backup, and stop on any error. A code rollback retains these migrations; no downmigration or destructive restore is implied.
5. **Rebind review to final changes.** Existing independent review8.955 and CI41877634812 apply to source `dce1a67` plus the recorded source-continuity envelope. New prompt UI/configuration require a fresh independent delta review and actual affected checks, followed by required final CI. Do not call a new source manifest approved merely because the earlier candidate was approved. A successful user connection establishes the reported UAT journey, not every signed-in product/storage/mail/timer check.

## Existing beta limitations versus old blockers

The D-17 runbook is marked unexecuted, contains migrations1–17 and incorrect now-obsolete claims that production lacks R2/APP_ORIGIN/mail. Prefer actual provider reads and the executed D-24 addendum in `docs/UAT_DEPLOY.md:1318–1363`. That addendum expressly records: **“Accepted: runtime database role is still neondb_owner; no uptime alert on production.”** Current reads confirm the owner runtime remains. Alert existence/delivery was not independently checked here.

This is evidence of the previous beta's explicit exceptions, not a claim that S3/S4 are implemented or permission to waive new blockers. Keep these exceptions visible if promoting the same internal beta scope; do not announce general availability or mark `SECURITY_ROADMAP` S3/S4 done. No row-level-security deployment, separate runtime role or received-human-alert proof exists in this investigation. The old initial board-access beta exceptions are historical; current source has later independent reviews and must be assessed using their current evidence.

## Backup and rollback conditions

`PROD_BACKUP_AND_ROLLBACK.md` is adopted and requires a fresh data-bearing predeploy production branch backup, recorded retention/row counts and rollback IDs, migration safety, clean exact-source deploy, smoke and fifteen-minute observation. Current quota/retention is unknown here. Never delete backup branches merely to make space without authorization. Prior approval to copy **UAT** data into an encrypted local backup does not automatically approve copying **production** data to a Mac; if branch backup cannot be created, root must resolve an authorized alternative before writes rather than silently reusing the UAT approval.

Worker rollback anchor: `756fdc6e-34f9-4ea8-88cc-59f21cdc940b`. Pages rollback anchor: `876eacf4-2890-4b3a-a54b-d71cf1fa6ff1`. Re-read immediately before upload in case another operator changed them. Roll back application artifacts together if necessary, keep safe image lifecycle/additive OAuth schema, and never overwrite production with a whole-database restore to undo software. Older Worker/Pages may lack the connector; state that loss honestly.

## Exact deployment shape for root (commands not executed here)

Build from a new clean detached candidate at the final full SHA. Whitelist the environment; exclude inherited `NEXT_PUBLIC_*`, DB URLs, test auth and dev settings. Fresh exact-lock installation must apply/verify the tracked dependency patch; after ignored scripts run `npm run deps:apply` and `npm run deps:verify`. Build MCP before Worker, verify Worker ESM source map and hashes. Prepare both production and UAT artifacts and bind them to the same reviewed source. Recursively stage Pages Functions, same-origin static output and the environment's selected config. The existing preparation helper is UAT-specific and copies `wrangler.uat.jsonc`; production stage must instead copy `apps/web/wrangler.prod.jsonc` as `wrangler.jsonc`.

After root clears gates/backup/migrations, upload the already-built production Worker from candidate `apps/api` with the pinned local Wrangler executable: `wrangler deploy dist/<verified-production-output>/worker.js --no-bundle --name flowboard-api` (no `--env`; top level is production, there is no `env.production`). First prove with an exact `--dry-run --no-bundle` that upload bytes equal the reviewed prepared bytes and production bindings include `IMAGE_VERIFIER`, the production Hyperdrive/R2, exact origins, and no test controls. Then run from the separate production Pages stage: `wrangler pages deploy out --project-name flowboard-app --branch main --commit-hash <full-reviewed-SHA> --commit-dirty=false`. Do not deploy UAT stage/config under the production name.

Retain existing secret bindings, never fetch/print their values. The reviewed UAT `getHostedMcpConfig` derives issuer/resource only from `APP_ORIGIN`, not incoming/forwarded hosts, so production changes the audience to `https://flowboard-app.pages.dev/api/v1/mcp`. Connections/tokens/data are environment-specific; a UAT connection must not be reused as a production login. The current hosted client registration/CIMD accepts only Claude's exact `https://claude.ai/api/mcp/auth_callback` and fixed claude.ai metadata host; “any AI” in help must describe the template's portability, not claim arbitrary AI OAuth callbacks are supported. No Google console change is proved necessary from current config alone; owner must test the actual production provider round trip.

## Postdeploy proof, bounded and honest

Read actual Worker version/module hash and Pages canonical source/binding/deployment status. Run only a small bounded anonymous smoke: direct Worker health; same-origin session401/no-store; exact hosted metadata issuer/resource; anonymous MCP401/challenge; foreign-origin refusal; static prompt/help chunks versus prepared bytes; safe sign-in redirect; closed dev/admin paths. No production burst, sign-in, email, upload, or synthetic card mutation by this agent. Real production Google/Claude connection/create/disconnect is owner acceptance and must be separately reported. Observe cron/errors without logging bearer credentials or card text. A passing anonymous probe is not authenticated acceptance.

## Commands and tool results in this preflight

All shell reads exited0 unless noted. `cat apps/web/wrangler.jsonc` exited1 because no such file exists; production uses `wrangler.prod.jsonc`. One initial Cloudflare spec search failed because it used `schema` instead of documented `spec`; corrected search succeeded. Seven concurrent Cloudflare GETs succeeded: Worker settings/deployments, Pages project, Hyperdrive and R2 managed/custom/lifecycle. Their filtered result is the metadata receipt above. No tests were run, no passing score assigned, and no production effect was performed.
